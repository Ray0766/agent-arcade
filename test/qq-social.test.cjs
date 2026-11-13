'use strict';
// Synthetic OneBot responses only; no account access or external messages/posts.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {QQClient} = require('../src/bot/qq.cjs');

const OWNER = '12345678', ACCOUNT = '87654321';
class Socket extends EventEmitter {
  constructor(reply) {
    super(); this.reply = reply; this.readyState = 0; this.calls = [];
    queueMicrotask(() => { this.readyState = 1; this.emit('open'); });
  }
  send(raw, callback) { const request = JSON.parse(raw); this.calls.push(request); callback?.(); this.reply(request, this); }
  frame(value) { this.emit('message', JSON.stringify(value), false); }
  answer(request, data) { this.frame({status: 'ok', retcode: 0, echo: request.echo, data}); }
  terminate() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  ping() { this.emit('pong'); }
}
function setup(reply, options = {}) {
  let socket, logins = 0, connections = 0;
  const client = new QQClient({token: 'synthetic-social-token', ownerId: OWNER, timeoutMs: 100,
    socketFactory: () => {
      connections++;
      socket = new Socket((request, ws) => {
        if (request.action === 'get_login_info') ws.answer(request, {user_id: typeof options.account === 'function' ? options.account(++logins) : ACCOUNT});
        else if (request.action === 'get_status') ws.answer(request, {online: true, good: true});
        else reply?.(request, ws);
      });
      return socket;
    }, ...options});
  return {client, get socket() { return socket; }, get connections() { return connections; }};
}

test('proactive QQ send works before inbound context and remains literal, owner-bound and receipt-correlated', async t => {
  let pending;
  const fixture = setup((request, ws) => {
    pending = request;
    ws.frame({status: 'ok', retcode: 0, echo: 'unrelated', data: {message_id: 1}});
  });
  const {client} = fixture; t.after(() => client.close()); await client.connect();
  assert.equal(client.contextToken, '');
  await assert.rejects(client.sendText(OWNER, 'reply', ''), {code: 'stale_context'});
  await assert.rejects(client.sendProactiveText('99999999', 'hello'), {code: 'owner_required'});
  const send = client.sendProactiveText(OWNER, '[CQ:at,qq=all] 好久不见', 'action-1');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(pending.action, 'send_private_msg');
  assert.deepEqual(pending.params, {user_id: Number(OWNER), message: [{type: 'text', data: {text: '[CQ:at,qq=all] 好久不见'}}], auto_escape: true});
  fixture.socket.answer(pending, {message_id: -100});
  assert.deepEqual(await send, {id: '-100', clientId: 'action-1'});
  assert.equal(client.contextToken, '', 'proactive send must not manufacture a reply context');
  assert.deepEqual(fixture.socket.calls.map(x => x.action), ['get_login_info', 'get_status', 'get_login_info', 'send_private_msg']);
});

test('social actions refuse silent account switch, changed account events and reconnect races', async t => {
  const switched = setup(() => assert.fail('write after account switch'), {account: n => n === 1 ? ACCOUNT : '99999999'});
  t.after(() => switched.client.close()); await switched.client.connect();
  await assert.rejects(switched.client.sendProactiveText(OWNER, 'hello'), {code: 'account_changed'});
  assert.equal(switched.client.ready, false);
  assert.equal(switched.socket.calls.filter(x => x.action === 'send_private_msg').length, 0);

  const eventSwitch = setup((request, ws) => {
    ws.frame({post_type: 'meta_event', meta_event_type: 'heartbeat', self_id: 99999999, status: {online: true}});
    ws.answer(request, {message_id: 88});
  });
  t.after(() => eventSwitch.client.close()); await eventSwitch.client.connect();
  await assert.rejects(eventSwitch.client.sendProactiveText(OWNER, 'hello'), {code: 'account_changed'});
  assert.equal(eventSwitch.client.ready, false);

  const closed = setup(); t.after(() => closed.client.close()); await closed.client.connect(); closed.socket.terminate();
  await assert.rejects(closed.client.sendProactiveText(OWNER, 'hello'), {code: 'disconnected'});
  await assert.rejects(closed.client.publishQzoneText('post'), {code: 'disconnected'});
  assert.equal(closed.connections, 1, 'a social action must not silently reopen its bridge');
});

test('proactive message ambiguity and abort never cause retransmission', async t => {
  const fixture = setup(() => {}, {timeoutMs: 10}); t.after(() => fixture.client.close()); await fixture.client.connect();
  await assert.rejects(fixture.client.sendProactiveText(OWNER, 'hello'), {code: 'action_timeout'});
  assert.equal(fixture.socket.calls.filter(x => x.action === 'send_private_msg').length, 1);
  const controller = new AbortController(); controller.abort();
  await assert.rejects(fixture.client.sendProactiveText(OWNER, 'hello', 'action-2', controller.signal), {code: 'aborted'});
  assert.equal(fixture.socket.calls.filter(x => x.action === 'send_private_msg').length, 1);
  assert.equal(fixture.connections, 1);
});

test('Qzone publish sets an explicit restricted audience and does not claim verified visibility', async t => {
  const fixture = setup((request, ws) => ws.answer(request, {tid: 'fixture-post', time: 1800000000}));
  t.after(() => fixture.client.close()); await fixture.client.connect();
  assert.deepEqual(await fixture.client.publishQzoneText('角色的小想法', {clientId: 'post-1'}),
    {id: 'fixture-post', clientId: 'post-1', time: 1800000000, audience: 'self', visibilityVerified: false});
  assert.deepEqual(fixture.socket.calls.at(-1).params, {content: '角色的小想法', ugc_right: 64});
  await fixture.client.publishQzoneText('仅分享给主人', {audience: 'owner', clientId: 'post-2'});
  assert.deepEqual(fixture.socket.calls.at(-1).params, {content: '仅分享给主人', ugc_right: 16, target_uins: [OWNER]});
  assert.equal(fixture.socket.calls.at(-1).action, 'send_qzone_msg');
  for (const audience of ['public', 'friends', '', 1, 4, 128, null]) {
    await assert.rejects(fixture.client.publishQzoneText('no', {audience}), {code: 'invalid_social_audience'});
  }
  assert.equal(fixture.socket.calls.filter(x => x.action === 'send_qzone_msg').length, 2);
});

test('Qzone readback targets only this account and returns exact content without private comments', async t => {
  const fixture = setup((request, ws) => ws.answer(request,
    {tid: request.params.tid, content: '角色的小想法', comments: [{content: 'must not be exported'}], comment_num: 1}));
  t.after(() => fixture.client.close()); await fixture.client.connect();
  assert.deepEqual(await fixture.client.getOwnQzonePost('fixture-post'), {id: 'fixture-post', text: '角色的小想法'});
  assert.deepEqual(fixture.socket.calls.at(-1).params, {tid: 'fixture-post', target_uin: ACCOUNT, pos: 0, num: 1});
  assert.equal(fixture.socket.calls.at(-1).action, 'get_qzone_msg_detail');
});

test('social text, IDs and receipts are bounded before writes and raw bridge errors stay private', async t => {
  const fixture = setup((request, ws) => ws.answer(request, {message_id: null, tid: '', time: -1}));
  t.after(() => fixture.client.close()); await fixture.client.connect();
  for (const text of ['', '   ', 'x'.repeat(2001), 'hello\0', null, {}]) {
    await assert.rejects(fixture.client.sendProactiveText(OWNER, text), {code: 'invalid_social_text'});
    await assert.rejects(fixture.client.publishQzoneText(text), {code: 'invalid_social_text'});
  }
  await assert.rejects(fixture.client.getOwnQzonePost('x'.repeat(513)), {code: 'invalid_social_id'});
  assert.deepEqual(fixture.socket.calls.map(x => x.action), ['get_login_info', 'get_status']);
  await assert.rejects(fixture.client.sendProactiveText(OWNER, 'hello'), {code: 'invalid_send_receipt'});
  await assert.rejects(fixture.client.publishQzoneText('hello'), {code: 'invalid_send_receipt'});
  await assert.rejects(fixture.client.getOwnQzonePost('fixture-post'), {code: 'invalid_post_receipt'});

  fixture.socket.reply = (request, ws) => {
    if (request.action === 'get_login_info') return ws.answer(request, {user_id: ACCOUNT});
    ws.frame({echo: request.echo, status: 'failed', retcode: 1403, message: 'secret bridge diagnostics'});
  };
  await assert.rejects(fixture.client.publishQzoneText('hello', {audience: 'owner'}),
    e => e.code === 'action_failed' && !e.message.includes('secret'));
  assert.equal(fixture.socket.calls.filter(x => x.action === 'send_qzone_msg').length, 2, 'one attempt per explicit call, no fallback');
});

test('Qzone publish timeout is ambiguous and does not widen visibility or retry', async t => {
  const fixture = setup(() => {}, {timeoutMs: 10}); t.after(() => fixture.client.close()); await fixture.client.connect();
  await assert.rejects(fixture.client.publishQzoneText('hello', {audience: 'owner'}), {code: 'action_timeout'});
  const writes = fixture.socket.calls.filter(x => x.action === 'send_qzone_msg');
  assert.equal(writes.length, 1); assert.equal(writes[0].params.ugc_right, 16);
});
