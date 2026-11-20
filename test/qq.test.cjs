'use strict';
// Protocol fixtures only. No QQ account, client modification or external send.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {QQClient, validateQQUrl, validateQQOwner, prepareQQInbound} = require('../src/bot/qq.cjs');

const NOW = 1800000000000, OWNER = '12345678', ACCOUNT = '87654321';
class Socket extends EventEmitter {
  constructor(reply) { super(); this.reply = reply; this.readyState = 0; this.calls = []; queueMicrotask(() => { if (this.readyState !== 0) return; this.readyState = 1; this.emit('open'); }); }
  send(raw, callback) { const value = JSON.parse(raw); this.calls.push(value); callback?.(); this.reply?.(value, this); }
  frame(value) { this.emit('message', JSON.stringify(value), false); }
  answer(value, data, extra = {}) { this.frame({status: 'ok', retcode: 0, echo: value.echo, data, ...extra}); }
  terminate() { if (this.readyState === 3) return; this.readyState = 3; this.emit('close'); }
  ping() { this.emit('pong'); }
}
function setup(extra = {}, reply) {
  const {statusReply, ...options} = extra;
  const sockets = [], connections = [];
  const client = new QQClient({url: 'ws://127.0.0.1:3001/', token: 'synthetic-bridge-token', ownerId: OWNER,
    now: () => NOW, pollTimeoutMs: 5, timeoutMs: 100,
    socketFactory: (url, options) => {
      connections.push({url, options});
      const socket = new Socket((request, ws) => {
        if (request.action === 'get_login_info') ws.answer(request, {user_id: ACCOUNT, nickname: 'fixture'});
        else if (request.action === 'get_status') statusReply ? statusReply(request, ws) : ws.answer(request, {online: true, good: true});
        else if (reply) reply(request, ws);
        else ws.answer(request, {message_id: 88});
      });
      sockets.push(socket); return socket;
    }, ...options});
  return {client, sockets, connections};
}
function event(extra = {}) { return {post_type: 'message', message_type: 'private', sub_type: 'friend',
  self_id: Number(ACCOUNT), user_id: Number(OWNER), time: NOW / 1000, message_id: 1,
  message: [{type: 'text', data: {text: 'hello'}}], ...extra}; }

test('QQ accepts only explicit local WS endpoint, numeric owner and header-safe token', () => {
  assert.equal(validateQQUrl('ws://127.0.0.1:3001'), 'ws://127.0.0.1:3001/');
  assert.equal(validateQQUrl('wss://[::1]:3001/'), 'wss://[::1]:3001/');
  for (const url of ['ws://localhost:3001', 'ws://bridge.test:3001', 'ws://127.0.0.1:3001/api',
    'ws://127.0.0.1:3001/?token=bad', 'ws://user@127.0.0.1:3001/', 'https://127.0.0.1:3001', 'ws://127.0.0.1/']) {
    assert.throws(() => validateQQUrl(url), {code: 'invalid_bridge_url'});
  }
  assert.equal(validateQQOwner(12345678), OWNER);
  for (const value of ['', 'someone', '1234', '-123456', '9007199254740992', {}, null]) assert.throws(() => validateQQOwner(value), {code: 'invalid_owner'});
  for (const token of ['', 'short', 'a'.repeat(257), 'safe-token-but\r\ninjected']) assert.throws(() => setup({token}), {code: 'invalid_token'});
});

test('QQ login identity and owner-only friend events precede task normalization', async t => {
  const {client, sockets, connections} = setup(); t.after(() => client.close());
  assert.deepEqual(await client.connect(), {accountId: ACCOUNT, nickname: 'fixture'});
  assert.equal(connections[0].options.headers.Authorization, 'Bearer synthetic-bridge-token');
  assert.equal(connections[0].options.followRedirects, false);
  assert.equal(connections[0].options.maxPayload, 1024 * 1024);
  const ws = sockets[0];
  for (const [index,extra] of [{user_id: 99999999}, {post_type: 'message_sent'},
    {message_type: 'group'}, {sub_type: 'group'}, {group_id: 12345}, {time: NOW / 1000 - 1}, {time: NOW / 1000 + 61}].entries()) ws.frame(event({...extra,message_id:100+index,message:[{type:'text',data:{text:`rejected-${index}`}}]}));
  ws.frame(event()); ws.frame(event());
  const batch = await client.getUpdates();
  assert.equal(batch.cursor, '1'); assert.equal(batch.messages.length, 1);
  assert.equal(batch.messages[0].text, 'hello'); assert.equal(batch.messages[0].from, OWNER);
  assert.equal((await client.getUpdates(batch.cursor)).messages.length, 0);
  await assert.rejects(client.getUpdates('2'), {code: 'invalid_cursor'});
});

test('QQ preserves message segments and forbids quoted approval or partial attachment execution', async t => {
  const {client, sockets} = setup(); t.after(() => client.close()); await client.connect();
  sockets[0].frame(event({message: [{type: 'reply', data: {id: -22}}, {type: 'text', data: {text: '同意 ABC123'}}]}));
  sockets[0].frame(event({message_id: 2, message: [{type: 'text', data: {text: 'write a file'}}, {type: 'image', data: {file: 'x'}}]}));
  sockets[0].frame(event({message_id: 3, message: '[CQ:reply,id=1]同意 ABC123'}));
  sockets[0].frame(event({message_id: 4, message: [{type: 'reply', data: {id: 1}}, {type: 'text', data: {text: 'explain that'}}]}));
  const rows = (await client.getUpdates()).messages.map(prepareQQInbound);
  assert.match(rows[0].rejection, /不会执行控制/); assert.equal(rows[0].text, '');
  for (const row of rows.slice(1, 3)) { assert.match(row.rejection, /只处理文字/); assert.equal(row.text, ''); }
  assert.match(rows[3].text, /仅供理解/); assert.match(rows[3].text, /原文未读取/);
  assert.deepEqual(sockets[0].calls.map(x => x.action), ['get_login_info', 'get_status'], 'no get_msg history read');
});

test('QQ text send is escaped, destination-bound and requires matching echo receipt', async t => {
  let replyRequest;
  const {client, sockets} = setup({}, (request, ws) => { replyRequest = request; ws.frame({echo: 'wrong-echo', status: 'ok', retcode: 0, data: {message_id: 1}}); });
  t.after(() => client.close()); await client.connect();
  sockets[0].frame(event()); const context = (await client.getUpdates()).messages[0].contextToken;
  await assert.rejects(client.sendText('99999999', 'hello', context), {code: 'owner_required'});
  await assert.rejects(client.sendText(OWNER, 'hello', 'wrong'), {code: 'stale_context'});
  const result = client.sendText(OWNER, '[CQ:at,qq=all]', context, 'fixture-send');
  assert.equal(replyRequest.action, 'send_private_msg');
  assert.equal(replyRequest.params.user_id, Number(OWNER));
  assert.deepEqual(replyRequest.params.message, [{type: 'text', data: {text: '[CQ:at,qq=all]'}}]);
  assert.equal(replyRequest.params.auto_escape, true);
  sockets[0].answer(replyRequest, {message_id: -100});
  assert.deepEqual(await result, {id: '-100', clientId: 'fixture-send'});
});

test('QQ send timeout is not retried and sensitive bridge errors are not relayed', async t => {
  const {client, sockets} = setup({timeoutMs: 10}, () => {}); t.after(() => client.close()); await client.connect();
  sockets[0].frame(event()); const context = (await client.getUpdates()).messages[0].contextToken;
  await assert.rejects(client.sendText(OWNER, 'hello', context), {code: 'action_timeout'});
  assert.equal(sockets[0].calls.filter(x => x.action === 'send_private_msg').length, 1);
  const pending = client.sendText(OWNER, 'hello', context);
  const request = sockets[0].calls.at(-1);
  sockets[0].answer(request, null, {status: 'failed', retcode: 1403, message: 'secret should never appear'});
  await assert.rejects(pending, error => error.code === 'action_failed' && !error.message.includes('secret'));
});

test('QQ reconnect drops stale socket frames, contexts and queued messages without replay', async t => {
  let now = NOW;
  const {client, sockets} = setup({now: () => now}); t.after(() => client.close()); await client.connect();
  sockets[0].frame(event()); const first = await client.getUpdates();
  sockets[0].frame(event({message_id: 2}));
  sockets[0].terminate();
  await assert.rejects(client.sendText(OWNER, 'old result', first.messages[0].contextToken), {code: 'stale_context'});
  now += 2000;
  await client.connect(); assert.equal(sockets.length, 2);
  sockets[0].frame(event({message_id: 3, time: now / 1000}));
  sockets[1].frame(event({message_id: 2}));
  sockets[1].frame(event({message_id: 4, time: now / 1000}));
  const next = await client.getUpdates(first.cursor);
  assert.deepEqual(next.messages.map(x => x.id), ['4']);
  assert.notEqual(next.messages[0].contextToken, first.messages[0].contextToken);
});

test('QQ disconnect rejects pending send and cancellation releases long poll', async t => {
  const {client, sockets} = setup({pollTimeoutMs: 1000}, () => {}); t.after(() => client.close()); await client.connect();
  sockets[0].frame(event()); const context = (await client.getUpdates()).messages[0].contextToken;
  const send = client.sendText(OWNER, 'hello', context); sockets[0].terminate();
  await assert.rejects(send, {code: 'disconnected'});
  const controller = new AbortController();
  const poll = client.getUpdates('1', controller.signal);
  await new Promise(resolve => setImmediate(resolve)); controller.abort();
  await assert.rejects(poll, {code: 'aborted'});
  assert.equal(client.pending.size, 0); assert.equal(client.waiter, null);
});

test('QQ reconnect refuses a different logged-in account', async t => {
  let count = 0;
  const {client} = setup({socketFactory: () => new Socket((request, ws) => ws.answer(request,
    request.action === 'get_status' ? {online: true} : {user_id: ++count === 1 ? ACCOUNT : '99999999'}))});
  t.after(() => client.close()); await client.connect(); client.socket.terminate();
  await assert.rejects(client.connect(), {code: 'account_changed'});
  assert.equal(client.ready, false); assert.equal(client.accountId, ACCOUNT);
});

for (const type of ['message', 'heartbeat']) test(`QQ ${type} from a switched account revokes reply contexts and pending sends`, async t => {
  const {client, sockets} = setup({}, () => {}); t.after(() => client.close()); await client.connect();
  sockets[0].frame(event()); const context = (await client.getUpdates()).messages[0].contextToken;
  const send = client.sendText(OWNER, 'pending reply', context);
  sockets[0].frame(type === 'message' ? event({self_id: 99999999, message_id: 2}) :
    {post_type: 'meta_event', meta_event_type: 'heartbeat', self_id: 99999999, status: {online: true, good: true}});
  await assert.rejects(send, {code: 'account_changed'});
  assert.equal(client.ready, false); assert.equal(client.contextToken, ''); assert.equal(client.queue.length, 0);
  await assert.rejects(client.sendText(OWNER, 'late reply', context), {code: 'stale_context'});
  assert.equal(sockets[0].calls.filter(x => x.action === 'send_private_msg').length, 1);
});

test('QQ event cannot masquerade as an action response using echo', async t => {
  let request;
  const {client, sockets} = setup({}, value => { request = value; }); t.after(() => client.close()); await client.connect();
  sockets[0].frame(event()); const context = (await client.getUpdates()).messages[0].contextToken;
  const send = client.sendText(OWNER, 'pending reply', context);
  sockets[0].frame({...event({self_id: 99999999}), echo: request.echo, status: 'ok', retcode: 0, data: {message_id: 1}});
  await assert.rejects(send, {code: 'invalid_frame'}); assert.equal(client.ready, false);
});

test('QQ framing, queue and lifecycle bounds fail closed', async t => {
  const first = setup(); t.after(() => first.client.close()); await first.client.connect();
  first.sockets[0].frame({post_type: 'meta_event', meta_event_type: 'heartbeat', status: {online: false}});
  assert.equal(first.client.lastError.code, 'account_offline');
  await first.client.connect(); first.sockets[1].emit('message', Buffer.from('{bad'), false);
  assert.equal(first.client.lastError.code, 'invalid_frame');
  await first.client.connect();
  for (let n = 1; n <= 201; n++) first.sockets[2].frame(event({message_id: n}));
  assert.equal(first.client.lastError.code, 'message_limit'); assert.equal(first.client.queue.length, 0);
  first.client.close(); await assert.rejects(first.client.connect(), {code: 'closed'});
});

test('QQ logged-in account cannot be its own task owner', async () => {
  const {client} = setup({ownerId: ACCOUNT});
  await assert.rejects(client.connect(), {code: 'owner_is_agent_account'});
  client.close();
});

test('QQ reconnect verifies current online status instead of accepting cached identity', async t => {
  let online = true;
  const {client, sockets} = setup({statusReply: (request, ws) => ws.answer(request, {online, good: true})});
  t.after(() => client.close()); await client.connect();
  sockets[0].frame(event()); const context = (await client.getUpdates()).messages[0].contextToken;
  sockets[0].terminate(); online = false;
  await assert.rejects(client.getUpdates('1'), {code: 'account_offline'});
  assert.equal(client.ready, false); assert.equal(client.contextToken, '');
  assert.deepEqual(sockets[1].calls.map(x => x.action), ['get_login_info', 'get_status']);
  await assert.rejects(client.sendText(OWNER, 'old reply', context), {code: 'stale_context'});
  online = true; await client.connect();
  assert.equal(client.ready, true); assert.equal(sockets.length, 3);
  assert.equal(sockets.flatMap(socket => socket.calls).filter(call => call.action === 'send_private_msg').length, 0);
});

for (const punctuation of ['', '。']) test(`QQ exact login-invalidated notice (${punctuation || 'no punctuation'}) revokes work and stops reconnect`, async t => {
  const {client, sockets} = setup({}, () => {});t.after(() => client.close());await client.connect();
  sockets[0].frame(event());const context=(await client.getUpdates()).messages[0].contextToken;
  const pending=client.sendText(OWNER,'pending',context);
  sockets[0].frame(event({message_id:2}));
  sockets[0].frame({post_type:'notice',notice_type:'bot_offline',self_id:Number(ACCOUNT),user_id:Number(ACCOUNT),
    tag:'下线通知',message:`你的账号当前登录已失效，请重新登录${punctuation}`});
  await assert.rejects(pending,{code:'login_required'});
  assert.equal(client.ready,false);assert.equal(client.queue.length,0);assert.equal(client.contextToken,'');
  await assert.rejects(client.getUpdates('1'),{code:'login_required'});
  assert.equal(sockets.length,1,'no automatic reconnect after explicit login expiry');
  assert.equal(sockets[0].calls.filter(x=>x.action==='send_private_msg').length,1,'ambiguous send is not replayed');
});

test('QQ offline notices require current identity and do not infer expiry from arbitrary text', async t => {
  for(const [extra,expected] of [
    [{self_id:undefined},null],
    [{self_id:99999999},'account_changed'],
    [{tag:'other'},'account_offline'],
    [{message:'prefix 你的账号当前登录已失效，请重新登录 suffix SECRET'},'account_offline'],
    [{message:{text:'你的账号当前登录已失效，请重新登录'}},'account_offline'],
  ]){
    const {client,sockets}=setup();t.after(()=>client.close());await client.connect();
    sockets[0].frame({post_type:'notice',notice_type:'bot_offline',self_id:Number(ACCOUNT),tag:'下线通知',message:'你的账号当前登录已失效，请重新登录',...extra});
    assert.equal(client.lastError?.code||null,expected);
    assert.equal(client.ready,expected===null);
    assert.doesNotMatch(client.lastError?.message||'',/SECRET|你的账号/);
  }
});

test('QQ unhealthy bridge is distinct from offline login and a chat cannot act as a notice', async t => {
  const unhealthy=setup({statusReply:(request,ws)=>ws.answer(request,{online:true,good:false})});t.after(()=>unhealthy.client.close());
  await assert.rejects(unhealthy.client.connect(),{code:'bridge_unhealthy'});assert.equal(unhealthy.client.ready,false);
  const {client,sockets}=setup();t.after(()=>client.close());await client.connect();
  sockets[0].frame(event({notice_type:'bot_offline',tag:'下线通知',message:'你的账号当前登录已失效，请重新登录'}));
  assert.equal(client.ready,true);
  sockets[0].frame({post_type:'meta_event',meta_event_type:'heartbeat',self_id:Number(ACCOUNT),status:{online:true,good:false}});
  assert.equal(client.lastError.code,'bridge_unhealthy');
});

test('QQ inspection uses only account metadata and reports an explicit friend match', async t => {
  const {client, sockets} = setup({}, (request, ws) => ws.answer(request,
    request.action === 'get_status' ? {online: true, good: true} : [{user_id: 99999999}, {user_id: OWNER}]));
  t.after(() => client.close());
  assert.deepEqual(await client.inspect(), {accountId: ACCOUNT, nickname: 'fixture', online: true, ownerIsFriend: true});
  assert.deepEqual(sockets[0].calls.map(x => x.action), ['get_login_info', 'get_status', 'get_friend_list']);
  assert.ok(sockets[0].calls.every(x => Object.keys(x.params).length === 0));
  assert.equal(client.contextToken, '', 'inspection does not authorize an unsolicited reply');
  assert.deepEqual(await client.connect(), {accountId: ACCOUNT, nickname: 'fixture'});
  assert.equal(sockets[0].calls.length, 3, 'a repeated connect preserves the inspected identity');
});

test('QQ inspection refuses offline or unverifiable status but friendship remains optional', async t => {
  const offline = setup({statusReply: (request, ws) => ws.answer(request, {online: false, good: false})});
  t.after(() => offline.client.close());
  await assert.rejects(offline.client.inspect(), {code: 'account_offline'});
  assert.equal(offline.client.ready, false);
  const missingStatus = setup({statusReply: (request, ws) => ws.answer(request, null, {status: 'failed', retcode: 1404, message: 'secret diagnostic'})});
  t.after(() => missingStatus.client.close());
  await assert.rejects(missingStatus.client.inspect(), error => error.code === 'action_failed' && !error.message.includes('secret'));
  assert.equal(missingStatus.client.ready, false);
  const missing = setup({timeoutMs: 10}, () => {});
  t.after(() => missing.client.close());
  assert.deepEqual(await missing.client.inspect(), {accountId: ACCOUNT, nickname: 'fixture', online: true, ownerIsFriend: null});
  assert.equal(missing.client.ready, true); assert.equal(missing.client.pending.size, 0);
});

test('QQ inspection refreshes online status on an already connected socket', async t => {
  let online = true;
  const {client, sockets} = setup({statusReply: (request, ws) => ws.answer(request, {online})},
    (request, ws) => ws.answer(request, [{user_id: OWNER}]));
  t.after(() => client.close());
  assert.deepEqual(await client.inspect(), {accountId: ACCOUNT, nickname: 'fixture', online: true, ownerIsFriend: true});
  online = false;
  await assert.rejects(client.inspect(), {code: 'account_offline'});
  assert.equal(client.ready, false);
  assert.equal(sockets[0].calls.filter(x => x.action === 'get_friend_list').length, 1);
});

test('QQ inspection never infers online or friendship from malformed or oversized metadata', async t => {
  for (const [status, friends] of [
    [{good: true}, {friends: [{user_id: OWNER}]}],
    [{online: 'true'}, [{user_id: OWNER}, {user_id: 'invalid'}]],
    [[], Array.from({length: 10001}, () => ({user_id: OWNER}))],
    [null, [{user_id: OWNER}, null]],
  ]) {
    const {client} = setup({statusReply: (request, ws) => ws.answer(request, status)}, (request, ws) => ws.answer(request, friends));
    t.after(() => client.close());
    await assert.rejects(client.inspect(), {code: 'status_unverified'});
    assert.equal(client.ready, false);
    const online = setup({}, (request, ws) => ws.answer(request, friends));t.after(() => online.client.close());
    assert.equal((await online.client.inspect()).ownerIsFriend, null);
  }
});

test('QQ login nickname is optional, bounded and stripped of control characters', async t => {
  for (const [nickname, expected] of [
    [undefined, ''], [42, ''], [' \u0000橘\r\n\u001b\u007f\u0085\u202e\u2066\u2028\u2029 ', '橘'],
    ['龙'.repeat(130), '龙'.repeat(128)], ['a'.repeat(127) + '🐉', 'a'.repeat(127)],
  ]) {
    const {client} = setup({socketFactory: () => new Socket((request, ws) => ws.answer(request,
      request.action === 'get_status' ? {online: true} : {user_id: ACCOUNT, nickname}))});
    t.after(() => client.close());
    assert.deepEqual(await client.connect(), {accountId: ACCOUNT, nickname: expected});
    assert.equal(client.nickname, expected);
  }
});

for (const interruption of ['disconnect', 'account_changed', 'abort']) test(`QQ inspection propagates ${interruption} instead of returning stale identity`, async t => {
  const controller = new AbortController();
  const {client, sockets} = setup({statusReply: (request, ws) => {
    if (interruption === 'disconnect') ws.terminate();
    else if (interruption === 'account_changed') ws.frame({post_type: 'meta_event', meta_event_type: 'heartbeat', self_id: 99999999});
    else controller.abort();
  }});
  t.after(() => client.close());
  await assert.rejects(client.inspect(controller.signal), {code: {disconnect: 'disconnected', account_changed: 'account_changed', abort: 'aborted'}[interruption]});
  assert.deepEqual(sockets[0].calls.map(x => x.action), ['get_login_info', 'get_status']);
  assert.equal(client.pending.size, 0); assert.equal(client.ready, false);
});

test('QQ inspection does not reconnect after a cancelled check or accept a changed account', async t => {
  const stopped = new AbortController(); stopped.abort();
  const fresh = setup(); t.after(() => fresh.client.close());
  await assert.rejects(fresh.client.inspect(stopped.signal), {code: 'aborted'});
  assert.equal(fresh.connections.length, 0);
  let count = 0;
  const changed = setup({socketFactory: () => new Socket((request, ws) => ws.answer(request,
    request.action === 'get_status' ? {online: true} : {user_id: ++count === 1 ? ACCOUNT : '99999999', nickname: 'fixture'}))});
  t.after(() => changed.client.close());
  await changed.client.connect(); changed.client.socket.terminate();
  await assert.rejects(changed.client.inspect(), {code: 'account_changed'});
});

test('QQ HTTP authentication failures produce a sanitized unauthorized code', async t => {
  const {createServer} = require('node:http');
  let statusCode = 401;
  const server = createServer((_request, response) => { response.writeHead(statusCode); response.end('private bridge diagnostic'); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(() => new Promise(resolve => server.close(resolve)));
  for (statusCode of [401, 403]) {
    const client = new QQClient({url: `ws://127.0.0.1:${server.address().port}`, token: 'synthetic-network-token', ownerId: OWNER, timeoutMs: 1000});
    t.after(() => client.close());
    await assert.rejects(client.inspect(), error => error.code === 'unauthorized' && !error.message.includes('private'));
    assert.equal(client.ready, false); assert.equal(client.pending.size, 0);
  }
});

test('QQ real loopback WebSocket exchanges authenticated OneBot frames without an account', async t => {
  const {WebSocketServer} = require('ws');
  const server = new WebSocketServer({host: '127.0.0.1', port: 0});
  await new Promise((resolve, reject) => { server.once('listening', resolve); server.once('error', reject); });
  let peer, authorization, sent;
  server.on('connection', (socket, request) => {
    peer = socket; authorization = request.headers.authorization;
    socket.on('message', raw => {
      const frame = JSON.parse(String(raw));
      if (frame.action === 'get_login_info') socket.send(JSON.stringify({status: 'ok', retcode: 0, echo: frame.echo, data: {user_id: Number(ACCOUNT)}}));
      else if (frame.action === 'get_status') socket.send(JSON.stringify({status: 'ok', retcode: 0, echo: frame.echo, data: {online: true, good: true}}));
      else { sent = frame; socket.send(JSON.stringify({status: 'ok', retcode: 0, echo: frame.echo, data: {message_id: 105}})); }
    });
  });
  const client = new QQClient({url: `ws://127.0.0.1:${server.address().port}`, token: 'synthetic-network-token',
    ownerId: OWNER, now: () => NOW, timeoutMs: 1000, pollTimeoutMs: 1000});
  t.after(async () => { client.close(); for (const socket of server.clients) socket.terminate(); await new Promise(resolve => server.close(resolve)); });
  await client.connect(); assert.equal(authorization, 'Bearer synthetic-network-token');
  peer.send(JSON.stringify(event()));
  const batch = await client.getUpdates();
  assert.equal(batch.messages[0].text, 'hello');
  const result = await client.sendText(OWNER, 'fixture response', batch.messages[0].contextToken);
  assert.equal(result.id, '105'); assert.equal(sent.action, 'send_private_msg');
  assert.equal(sent.params.message[0].data.text, 'fixture response');
});

// Unique IDs/texts keep sender-policy defects from being hidden by dedupe.
test('QQ private foreign sender never acquires a reply context', async t => {
 const {client,sockets}=setup();t.after(()=>client.close());await client.connect();
 sockets[0].frame(event({message_id:701,user_id:99999999,message:'foreign-unique-private'}));
 assert.equal((await client.getUpdates()).messages.length,0);assert.equal(client.contextToken,'');
 assert.equal(sockets[0].calls.filter(c=>c.action.startsWith('send_')).length,0);
});

const GROUP='55556666',MEMBER='44443333';
function groupEvent(extra={}){return event({message_type:'group',sub_type:'normal',group_id:Number(GROUP),user_id:Number(MEMBER),...extra});}
test('QQ groups default off; explicit membership never changes the private owner guard',async t=>{
 const disabled=setup();t.after(()=>disabled.client.close());await disabled.client.connect();disabled.sockets[0].frame(groupEvent({message_id:801}));assert.equal((await disabled.client.getUpdates()).messages.length,0);
 const {client,sockets}=setup({groupIds:[GROUP]});t.after(()=>client.close());await client.connect();
 for(const [index,extra] of [{group_id:99999999},{anonymous:{id:1}},{sub_type:'anonymous'},{user_id:Number(ACCOUNT)},{sender:{user_id:99999999}},{group_id:'opaque-official-group'},{user_id:0}].entries()){
  sockets[0].frame(groupEvent({...extra,message_id:810+index,message:`blocked-group-${index}`}));
 }
 assert.equal((await client.getUpdates()).messages.length,0);assert.equal(client.groupContexts.size,0);
 sockets[0].frame(event({user_id:Number(MEMBER),message_id:820,message:'still-not-owner'}));
 assert.equal((await client.getUpdates()).messages.length,0);assert.equal(sockets[0].calls.filter(c=>c.action.startsWith('send_')).length,0);
});
test('QQ group inbound and sends bind account/group/member/generation, preserve mentions and quotes',async t=>{
 const {client,sockets}=setup({groupIds:[GROUP,'77778888']});t.after(()=>client.close());await client.connect();
 sockets[0].frame(groupEvent({message_id:901,message:[{type:'at',data:{qq:ACCOUNT}},{type:'text',data:{text:'你好角色'}}]}));
 const message=(await client.getUpdates()).messages[0];assert.equal(message.from,MEMBER);assert.equal(message.groupId,GROUP);assert.equal(message.accountId,ACCOUNT);assert.equal(message.route,'group');assert.equal(message.mentioned,true);assert.equal(message.text,'你好角色');
 await assert.rejects(client.sendGroupText({groupId:'77778888',senderId:MEMBER},'cross-group',message.contextToken),{code:'stale_context'});
 await assert.rejects(client.sendGroupText({groupId:GROUP,senderId:OWNER},'cross-member',message.contextToken),{code:'stale_context'});
 await client.sendGroupText({groupId:GROUP,senderId:MEMBER},'正常回复',message.contextToken);
 const call=sockets[0].calls.find(c=>c.action==='send_group_msg');assert.equal(call.params.group_id,Number(GROUP));assert.deepEqual(call.params.message,[{type:'reply',data:{id:'901'}},{type:'text',data:{text:'正常回复'}}]);
 sockets[0].frame(groupEvent({message_id:901,message:'duplicate'}));assert.equal((await client.getUpdates()).messages.length,0);
 sockets[0].terminate();await assert.rejects(client.sendGroupText({groupId:GROUP,senderId:MEMBER},'stale',message.contextToken),{code:'stale_context'});
});
test('QQ group media never uses private-owner image or voice descriptors',async t=>{
 const {client,sockets}=setup({groupIds:[GROUP],allowOwnerVoice:true,allowOwnerImage:true});t.after(()=>client.close());await client.connect();
 for(const [index,type] of ['image','record'].entries())sockets[0].frame(groupEvent({message_id:950+index,user_id:Number(OWNER),message:[{type,data:{file:'fixture'}}]}));
 const batch=await client.getUpdates();assert.equal(batch.messages.length,2);for(const row of batch.messages){assert.equal(row.unsupported,'qq_segments');assert.equal(row.image,undefined);assert.equal(row.voice,undefined);}
});
