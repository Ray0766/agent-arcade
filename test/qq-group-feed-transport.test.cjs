'use strict';

const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {test} = require('node:test');
const {QQClient} = require('../src/bot/qq.cjs');

const ACCOUNT = '87654321', OWNER = '12345678', MEMBER = '44443333';
const GROUP = '55556666', OTHER = '77778888', OUTSIDE = '66665555';
const NOW = 1800000000000;
const TEXT = '合成来源公告 [CQ:at,qq=12345678]';

async function fixture(t, {expectedAccountId = ACCOUNT} = {}) {
  const actions = [];
  const state = {current: true, online: true, member: {group_id: GROUP, user_id: ACCOUNT}, beforeReply: null};
  class Socket extends EventEmitter {
    constructor() {
      super();
      this.readyState = 0;
      queueMicrotask(() => { this.readyState = 1; this.emit('open'); });
    }
    send(raw, callback) {
      const {action, params, echo} = JSON.parse(raw);
      actions.push([action, params]);
      callback();
      const respond = (data, fields = {}) => this.frame({echo, status: 'ok', retcode: 0, data, ...fields});
      if (state.beforeReply?.(action, respond, this)) return;
      switch (action) {
        case 'get_login_info': respond({user_id: ACCOUNT}); break;
        case 'get_status': respond({online: state.online, good: true}); break;
        case 'get_group_member_info': respond(state.member); break;
        case 'send_group_msg': respond({message_id: 47}); break;
        default: throw new Error(`Unexpected action ${action}`);
      }
    }
    frame(value) { this.emit('message', JSON.stringify(value), false); }
    ping() { this.emit('pong'); }
    terminate() { this.readyState = 3; }
  }
  let socket;
  const client = new QQClient({
    token: 'synthetic-group-feed-token', ownerId: OWNER, expectedAccountId: expectedAccountId || undefined, groupIds: [GROUP, OTHER],
    socketFactory: () => socket = new Socket(), timeoutMs: 40, now: () => NOW,
  });
  t.after(() => client.close());
  await client.connect();
  actions.length = 0;
  const post = (options, {group = GROUP, text = TEXT, id = 'synthetic-feed-event', signal} = {}) =>
    client.sendGroupFeedNotice(group, text, id, signal, {
      assertCurrent: () => state.current,
      beforeSubmit: () => { actions.push(['beforeSubmit']); },
      ...options,
    });
  const writes = () => actions.filter(([action]) => action === 'send_group_msg');
  let nextId = 1000;
  const quote = async (messageId, groupId = GROUP) => {
    socket.frame({post_type: 'message', message_type: 'group', sub_type: 'normal', self_id: Number(ACCOUNT),
      user_id: Number(MEMBER), group_id: Number(groupId), message_id: nextId++, time: NOW / 1000,
      message: [{type: 'reply', data: {id: messageId}}, {type: 'text', data: {text: '合成引用'}}],
    });
    const {messages} = await client.getUpdates();
    assert.equal(messages.length, 1);
    return messages[0].addressing.reference;
  };
  return {actions, state, post, writes, quote};
}

test('a feed notice verifies its own account in the selected group and submits only literal native text', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.post(), {outcome: 'accepted', messageId: '47'});
  assert.deepEqual(f.actions, [
    ['get_login_info', {}], ['get_status', {}],
    ['get_group_member_info', {group_id: Number(GROUP), user_id: Number(ACCOUNT), no_cache: true}],
    ['get_login_info', {}], ['beforeSubmit'],
    ['send_group_msg', {group_id: Number(GROUP), message: [{type: 'text', data: {text: TEXT}}], auto_escape: true}],
  ]);
  assert.equal(await f.quote('47'), 'self');
  assert.equal(await f.quote('47', OTHER), 'unknown');
});

test('an invalid request, an unpinned account or an unproven target never reaches the submission hook', async t => {
  const f = await fixture(t);
  const unpinned = await fixture(t, {expectedAccountId: null});
  for (const post of [
    () => f.post({beforeSubmit: null}), () => f.post({assertCurrent: null}),
    () => f.post({}, {group: OUTSIDE}), () => f.post({}, {text: '\0'}),
    () => f.post({}, {id: ''}), () => unpinned.post(),
  ]) assert.deepEqual(await post(), {outcome: 'not_submitted'});

  f.state.online = false;
  assert.deepEqual(await f.post(), {outcome: 'not_submitted'});
  f.state.online = true;
  for (const member of [null, {group_id: OTHER, user_id: ACCOUNT}, {group_id: GROUP, user_id: OWNER}]) {
    f.state.member = member;
    assert.deepEqual(await f.post(), {outcome: 'not_submitted'});
  }
  assert(!f.actions.some(([action]) => action === 'beforeSubmit' || action.startsWith('send_')));
  f.state.member = {group_id: GROUP, user_id: ACCOUNT};
  f.state.beforeReply = (action, respond) => {
    if (action !== 'get_login_info' || f.actions.filter(([event]) => event === action).length < 2) return false;
    respond({user_id: OWNER});
    return true;
  };
  f.actions.length = 0;
  assert.deepEqual(await f.post(), {outcome: 'not_submitted'});
  for (const actions of [f.actions, unpinned.actions]) {
    assert(!actions.some(([action]) => action === 'beforeSubmit' || action.startsWith('send_')));
  }
});

test('a synchronous journal hook must allow submission and the captured scope must remain current', async t => {
  const f = await fixture(t);
  const aborter = new AbortController();
  for (const beforeSubmit of [
    () => false,
    () => { throw new Error('synthetic journal unavailable'); },
    () => Promise.reject(new Error('synthetic async hook')),
    () => { f.state.current = false; return true; },
    () => { aborter.abort(); return true; },
  ]) {
    f.state.current = true;
    let claims = 0;
    assert.deepEqual(await f.post({beforeSubmit: () => { claims++; return beforeSubmit(); }}, {signal: aborter.signal}),
      {outcome: 'not_submitted'});
    assert.equal(claims, 1);
  }
  assert.deepEqual(f.writes(), []);
});

test('an exact bridge receipt keeps its accepted result after acknowledgement when the caller scope changes', async t => {
  const f = await fixture(t);
  f.state.beforeReply = (action, respond) => {
    if (action !== 'send_group_msg') return false;
    respond({message_id: -49});
    f.state.current = false;
    return true;
  };
  assert.deepEqual(await f.post(), {outcome: 'accepted', messageId: '-49'});
  assert.equal(f.writes().length, 1);
  assert.equal(await f.quote('-49'), 'unknown');
});

test('ambiguous bridge writes are reported once without retry', async t => {
  const f = await fixture(t);
  const aborter = new AbortController();
  for (const reply of [
    respond => respond({message_id: 47}, {echo: 'unmatched-echo'}),
    respond => respond({message_id: {invalid: true}}),
    respond => respond(null, {status: 'failed', retcode: 1200}),
    () => aborter.abort(),
  ]) {
    f.actions.length = 0;
    f.state.beforeReply = (action, respond) => {
      if (action !== 'send_group_msg') return false;
      reply(respond);
      return true;
    };
    assert.deepEqual(await f.post({}, {signal: aborter.signal}), {outcome: 'unknown'});
    assert.equal(f.writes().length, 1);
    assert.equal(await f.quote('47'), 'unknown');
  }
});
