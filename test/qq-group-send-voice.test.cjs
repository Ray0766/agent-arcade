'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const {QQClient} = require('../src/bot/qq.cjs');
const {QQMediaError} = require('../src/bot/qq-media.cjs');
const {canonicalWav} = require('../src/bot/qq-voice-payload.cjs');
const {wav} = require('./helpers/fixture-wav.cjs');
const {png} = require('./helpers/fixture-image.cjs');

const ACCOUNT = '87654321', OWNER = '12345678', MEMBER = '44443333';
const GROUP = '55556666', OTHER = '77778888', OUTSIDE = '66665555';
const NOW = 1800000000000;
const IMAGE_SCOPE = 'synthetic-account:group:55556666:fixture-character:approved';
const accepted = data => ({status: 'ok', retcode: 0, data});
const recording = () => canonicalWav(wav()).bytes;
const photo = () => png(2, 2, {metadata: false});

async function fixture(t, {expectedAccountId = ACCOUNT, receiveGroupMessages = false, groupImageIds = []} = {}) {
  const calls = [], sockets = [], messagesById = new Map();
  const state = {online: true, account: ACCOUNT, member: {group_id: Number(GROUP), user_id: ACCOUNT}, intercept: null, now: NOW};
  class Socket extends EventEmitter {
    constructor() {
      super();
      this.readyState = 0;
      queueMicrotask(() => {
        this.readyState = 1;
        this.emit('open');
      });
    }
    send(raw, callback) {
      const call = JSON.parse(raw);
      calls.push(call);
      callback();
      const respond = response => this.frame({echo: call.echo, ...response});
      if (state.intercept?.(call, respond)) return;
      switch (call.action) {
        case 'get_login_info': respond(accepted({user_id: state.account})); break;
        case 'get_status': respond(accepted({online: state.online, good: true})); break;
        case 'get_group_info': respond(accepted({group_id: call.params.group_id, group_name: ' 合成群名 '})); break;
        case 'get_group_member_info': respond(accepted(state.member)); break;
        case 'send_group_msg': respond(accepted({message_id: 47})); break;
        case 'get_msg': respond(accepted(messagesById.get(String(call.params.message_id)))); break;
        default: throw new Error(`Unexpected action ${call.action}`);
      }
    }
    frame(value) { this.emit('message', JSON.stringify(value), false); }
    ping() { this.emit('pong'); }
    terminate() { this.readyState = 3; }
  }
  const client = new QQClient({
    token: 'synthetic-group-voice-token', ownerId: OWNER, expectedAccountId: expectedAccountId || undefined,
    groupIds: [GROUP, OTHER], groupImageIds, receiveOwnerMessages: receiveGroupMessages, timeoutMs: 40, pollTimeoutMs: 2, now: () => state.now,
    socketFactory: () => { const socket = new Socket(); sockets.push(socket); return socket; },
  });
  t.after(() => client.close());
  await client.connect();
  calls.length = 0;
  const notice = (notice_type, fields = {}) => sockets.at(-1).frame({
    post_type: 'notice', notice_type, self_id: Number(ACCOUNT), user_id: Number(ACCOUNT), group_id: Number(GROUP), ...fields,
  });
  let nextId = 1000;
  const message = async (parts, {groupId = GROUP, id = nextId++} = {}) => {
    const frame = {post_type: 'message', message_type: 'group', sub_type: 'normal', self_id: Number(ACCOUNT),
      user_id: Number(MEMBER), sender: {user_id: Number(MEMBER)}, group_id: Number(groupId),
      message_id: id, time: Math.floor(state.now / 1000), message: parts};
    messagesById.set(String(id), frame);
    sockets.at(-1).frame(frame);
    const {messages} = await client.getUpdates();
    assert.equal(messages.length, 1);
    return messages[0];
  };
  const quote = (quoted, options) => message([
    {type: 'reply', data: {id: quoted}}, {type: 'text', data: {text: '合成跟帖'}},
  ], options);
  return {client, calls, state, notice, message, quote, disconnect: () => sockets.at(-1).emit('close')};
}

test('a pinned account verifies uncached own group membership, then sends exactly one canonical record', async t => {
  const f = await fixture(t);
  const revision = f.client.groupVoiceRevision(GROUP);
  assert.equal(typeof revision, 'string');
  assert.deepEqual(await f.client.verifyGroupVoiceTarget(GROUP), {accountId: ACCOUNT, groupId: GROUP, revision, groupName: '合成群名'});
  assert.deepEqual(f.calls.map(call => call.action), ['get_login_info', 'get_status', 'get_group_member_info', 'get_login_info', 'get_group_info']);
  assert.deepEqual(f.calls.at(-1).params, {group_id: Number(GROUP), no_cache: true});
  f.calls.length = 0;
  const bytes = recording();
  assert.deepEqual(await f.client.sendGroupRecord(GROUP, bytes, 'ticket-ordinary-group'), {outcome: 'accepted', messageId: '47'});
  assert.deepEqual(f.calls.map(({action, params}) => [action, params]), [
    ['get_login_info', {}], ['get_status', {}],
    ['get_group_member_info', {group_id: Number(GROUP), user_id: Number(ACCOUNT), no_cache: true}],
    ['get_login_info', {}],
    ['send_group_msg', {group_id: Number(GROUP), message: [{type: 'record', data: {file: `base64://${bytes.toString('base64')}`}}]}],
  ]);
});

test('group preflight refuses an unpinned, unlisted, offline, malformed or mismatched target before sending', async t => {
  const f = await fixture(t);
  await assert.rejects(f.client.verifyGroupVoiceTarget(OUTSIDE), {code: 'group_unavailable'});
  assert.deepEqual(f.calls, []);
  const unpinned = await fixture(t, {expectedAccountId: null});
  assert.equal(unpinned.client.groupVoiceRevision(GROUP), null);
  await assert.rejects(unpinned.client.verifyGroupVoiceTarget(GROUP), {code: 'account_mismatch'});
  assert.deepEqual(unpinned.calls, []);
  f.state.online = false;
  await assert.rejects(f.client.verifyGroupVoiceTarget(GROUP), {code: 'account_offline'});
  f.state.online = true;
  for (const member of [null, {}, {group_id: OUTSIDE, user_id: ACCOUNT}, {group_id: GROUP, user_id: OWNER}]) {
    f.state.member = member;
    assert.deepEqual(await f.client.sendGroupRecord(GROUP, recording(), 'ticket-mismatch'), {outcome: 'not_sent', code: 'group_unavailable'});
  }
  f.state.intercept = (call, respond) => {
    if (call.action !== 'get_group_member_info') return false;
    respond({status: 'failed', retcode: 100});
    return true;
  };
  await assert.rejects(f.client.verifyGroupVoiceTarget(GROUP), {code: 'group_unavailable'});
  assert(f.calls.every(call => !call.action.startsWith('send_')));
});

test('only authenticated own membership notices rotate the exact group revision and reconnect invalidates it', async t => {
  const f = await fixture(t);
  const old = f.client.groupVoiceRevision(GROUP), other = f.client.groupVoiceRevision(OTHER);
  assert.equal(f.client.groupVoiceRevision(OUTSIDE), null);
  f.notice('group_decrease', {user_id: OWNER, sub_type: 'kick'});
  f.notice('group_decrease', {self_id: undefined, sub_type: 'leave'});
  f.notice('group_decrease', {group_id: {toString: null}, sub_type: 'leave'});
  assert.equal(f.client.groupVoiceRevision(GROUP), old);
  f.notice('group_decrease', {sub_type: 'leave'});
  const afterLeave = f.client.groupVoiceRevision(GROUP);
  assert.notEqual(afterLeave, old);
  assert.equal(f.client.groupVoiceRevision(OTHER), other);
  f.notice('group_increase', {sub_type: 'approve'});
  const afterRejoin = f.client.groupVoiceRevision(GROUP);
  assert.notEqual(afterRejoin, afterLeave);
  f.disconnect();
  assert.equal(f.client.groupVoiceRevision(GROUP), null);
  await f.client.connect();
  assert.notEqual(f.client.groupVoiceRevision(GROUP), afterRejoin);
});

test('membership changes and signed-in account changes during preflight cannot reach a send', async t => {
  const f = await fixture(t);
  f.state.intercept = (call, respond) => {
    if (call.action !== 'get_group_member_info') return false;
    f.notice('group_decrease', {sub_type: 'leave'});
    respond(accepted(f.state.member));
    return true;
  };
  assert.deepEqual(await f.client.sendGroupRecord(GROUP, recording(), 'ticket-scope-change'), {outcome: 'not_sent', code: 'changed'});
  f.state.intercept = (call, respond) => {
    if (call.action !== 'get_group_member_info') return false;
    f.state.account = OWNER;
    respond(accepted(f.state.member));
    return true;
  };
  assert.deepEqual(await f.client.sendGroupRecord(GROUP, recording(), 'ticket-account-change'), {outcome: 'not_sent', code: 'account_mismatch'});
  assert(f.calls.every(call => !call.action.startsWith('send_')));
});

test('paths, caller cancellation and scope changes cannot submit a group recording', async t => {
  const f = await fixture(t);
  assert.deepEqual(await f.client.sendGroupRecord(GROUP, '/never-open.wav', 'ticket-file-path'), {outcome: 'not_sent', code: 'voice_too_large'});
  assert.deepEqual(await f.client.sendGroupRecord(GROUP, wav(), 'ticket-metadata'), {outcome: 'not_sent', code: 'voice_not_canonical'});
  assert.deepEqual(await f.client.sendGroupRecord(GROUP, recording(), ''), {outcome: 'not_sent', code: 'invalid_request'});
  const aborter = new AbortController();
  aborter.abort();
  assert.deepEqual(await f.client.sendGroupRecord(GROUP, recording(), 'ticket-aborted', aborter.signal), {outcome: 'not_sent', code: 'cancelled'});
  assert.deepEqual(await f.client.sendGroupRecord(GROUP, recording(), 'ticket-changed', undefined, {assertCurrent: () => false}),
    {outcome: 'not_sent', code: 'changed'});
  assert.deepEqual(f.calls, []);
});

test('missing, malformed and unmatched echo receipts result in unknown after one write without a fallback', async t => {
  const f = await fixture(t, {receiveGroupMessages: true});
  for (const receipt of [null, accepted({message_id: 'untrusted'}), {echo: 'different', ...accepted({message_id: 47})}]) {
    f.calls.length = 0;
    f.state.intercept = (call, respond) => {
      if (call.action !== 'send_group_msg') return false;
      if (receipt) respond(receipt);
      return true;
    };
    assert.deepEqual(await f.client.sendGroupRecord(GROUP, recording(), 'consumed-by-caller'), {outcome: 'unknown', code: 'send_unknown'});
    assert.deepEqual(f.calls.filter(call => call.action.startsWith('send_')).map(call => call.action), ['send_group_msg']);
    assert.deepEqual((await f.quote(47)).addressing, {mentions: [], reference: 'unknown'});
  }
});

test('an accepted group record contributes only same-group native voice quote evidence', async t => {
  const f = await fixture(t, {receiveGroupMessages: true});
  assert.deepEqual(await f.client.sendGroupRecord(GROUP, recording(), 'ticket-for-continuity'), {outcome: 'accepted', messageId: '47'});
  const tagged = await f.quote(47);
  assert.deepEqual(tagged.addressing, {mentions: [], reference: 'self', voiceReference: true});
  assert.deepEqual(tagged.quote, {id: '47', title: 'QQ 引用（原文未读取）', text: ''});
  assert.equal(tagged.voice, undefined);
  assert.deepEqual((await f.quote('047')).addressing, {mentions: [], reference: 'unknown'});
  assert.deepEqual((await f.quote(47, {groupId: OTHER})).addressing, {mentions: [], reference: 'unknown'});
  assert.deepEqual((await f.message('[CQ:reply,id=47]伪造跟帖')).addressing, {mentions: [], reference: 'none'});
  f.state.intercept = (call, respond) => {
    if (call.action !== 'send_group_msg') return false;
    respond(accepted({message_id: 48}));
    return true;
  };
  await f.client.sendGroupText({groupId: GROUP, senderId: MEMBER}, '普通文字', tagged.contextToken);
  assert.deepEqual((await f.quote(48)).addressing, {mentions: [], reference: 'self'});
});

test('group membership scope changes and connection renewal invalidate voice quote evidence', async t => {
  const f = await fixture(t, {receiveGroupMessages: true});
  await f.client.sendGroupRecord(GROUP, recording(), 'ticket-first-group');
  f.state.member = {group_id: OTHER, user_id: ACCOUNT};
  await f.client.sendGroupRecord(OTHER, recording(), 'ticket-other-group');
  const confirmed = {mentions: [], reference: 'self', voiceReference: true};
  const unknown = {mentions: [], reference: 'unknown'};
  f.notice('group_decrease', {user_id: OWNER, sub_type: 'kick'});
  f.notice('group_decrease', {self_id: undefined, sub_type: 'leave'});
  assert.deepEqual((await f.quote(47)).addressing, confirmed);
  f.notice('group_decrease', {sub_type: 'leave'});
  assert.deepEqual((await f.quote(47)).addressing, unknown);
  assert.deepEqual((await f.quote(47, {groupId: OTHER})).addressing, confirmed);
  f.notice('group_increase', {sub_type: 'approve'});
  assert.deepEqual((await f.quote(47)).addressing, unknown);
  f.disconnect();
  await f.client.connect();
  assert.deepEqual((await f.quote(47, {groupId: OTHER})).addressing, unknown);
});

test('exact acceptance survives post-write scope change without adding a voice quote marker', async t => {
  const f = await fixture(t, {receiveGroupMessages: true});
  let current = true;
  f.state.intercept = (call, respond) => {
    if (call.action !== 'send_group_msg') return false;
    respond(accepted({message_id: 47}));
    current = false;
    return true;
  };
  assert.deepEqual(await f.client.sendGroupRecord(GROUP, recording(), 'ticket-scope-ended', undefined, {assertCurrent: () => current}),
    {outcome: 'accepted', messageId: '47'});
  assert.deepEqual((await f.quote(47)).addressing, {mentions: [], reference: 'unknown'});
});

test('conflicting group message ids cannot promote voice quote evidence', async t => {
  const f = await fixture(t, {receiveGroupMessages: true});
  const conflict = {mentions: [], reference: 'unknown', quoteConflict: true};
  await f.client.sendGroupRecord(GROUP, recording(), 'ticket-voice-first');
  assert.deepEqual((await f.quote(47, {id: 47})).addressing, conflict);
  assert.deepEqual((await f.quote(47)).addressing, conflict);
  f.state.intercept = (call, respond) => {
    if (call.action !== 'send_group_msg') return false;
    respond(accepted({message_id: 49}));
    return true;
  };
  await f.client.sendGroupRecord(GROUP, recording(), 'ticket-voice-repeat-one');
  await f.client.sendGroupRecord(GROUP, recording(), 'ticket-voice-repeat-two');
  assert.deepEqual((await f.quote(49)).addressing, conflict);
});

test('an ordinary group image uses shared exact target proof and one canonical image action', async t => {
  const f = await fixture(t, {receiveGroupMessages: true});
  const revision = f.client.groupVoiceRevision(GROUP);
  assert.deepEqual(await f.client.verifyGroupImageTarget(GROUP), {accountId: ACCOUNT, groupId: GROUP, revision, groupName: '合成群名'});
  assert.deepEqual(f.calls.at(-1).params, {group_id: Number(GROUP), no_cache: true});
  f.calls.length = 0;
  const bytes = photo();
  assert.deepEqual(await f.client.sendGroupImage(GROUP, bytes, 'picture-ticket'), {outcome: 'accepted', messageId: '47'});
  assert.deepEqual(f.calls.map(({action, params}) => [action, params]), [
    ['get_login_info', {}], ['get_status', {}],
    ['get_group_member_info', {group_id: Number(GROUP), user_id: Number(ACCOUNT), no_cache: true}],
    ['get_login_info', {}],
    ['send_group_msg', {group_id: Number(GROUP), message: [{type: 'image', data: {file: `base64://${bytes.toString('base64')}`}}]}],
  ]);
  const quoted = await f.quote(47);
  assert.deepEqual(quoted.addressing, {mentions: [], reference: 'self', imageReference: true});
  assert.equal(quoted.quote.text, '');
  assert.equal(quoted.image, undefined);
  assert.deepEqual((await f.quote(47, {groupId: OTHER})).addressing, {mentions: [], reference: 'unknown'});
  assert.deepEqual((await f.message('[CQ:reply,id=47]伪造跟帖')).addressing, {mentions: [], reference: 'none'});
  assert(!f.calls.some(call => call.action === 'get_msg'));
});

test('group image validation rejects an invalid payload or target before the native send', async t => {
  const f = await fixture(t);
  await assert.rejects(f.client.verifyGroupImageTarget(OUTSIDE), error => error instanceof QQMediaError && error.code === 'group_unavailable');
  const abort = new AbortController();
  abort.abort();
  const cases = [
    [OUTSIDE, photo(), 'image-no-group', undefined, 'group_unavailable'],
    [GROUP, photo(), '', undefined, 'invalid_request'],
    [GROUP, 'file:///host/image.png', 'image-path', undefined, 'image_too_large'],
    [GROUP, Buffer.alloc(4 * 1024 * 1024 + 1), 'image-over-limit', undefined, 'image_too_large'],
    [GROUP, png(), 'image-metadata', undefined, 'image_invalid'],
    [GROUP, png(2, 2, {metadata: false, animated: true}), 'image-animated', undefined, 'image_animated'],
    [GROUP, photo(), 'image-cancelled', abort.signal, 'cancelled'],
  ];
  for (const [groupId, bytes, ticketId, signal, code] of cases) {
    assert.deepEqual(await f.client.sendGroupImage(groupId, bytes, ticketId, signal), {outcome: 'not_sent', code});
  }
  assert.deepEqual(f.calls, []);
  f.state.member = {group_id: OTHER, user_id: ACCOUNT};
  assert.deepEqual(await f.client.sendGroupImage(GROUP, photo(), 'image-wrong-membership'), {outcome: 'not_sent', code: 'group_unavailable'});
  assert(!f.calls.some(call => call.action.startsWith('send_')));
});

test('only pinned pre-dispatch rejections are not_sent after one exact group image request', async t => {
  const f = await fixture(t, {receiveGroupMessages: true});
  const rejected = {outcome: 'not_sent', code: 'send_rejected'};
  const unknown = {outcome: 'unknown', code: 'send_unknown'};
  const cases = [
    [{status: 'failed', retcode: 1400, data: null}, rejected],
    [{status: 'failed', retcode: 1404, data: null}, rejected],
    [{status: 'failed', retcode: 1200, data: null}, unknown],
    [{status: 'failed', retcode: 1400, data: {}}, unknown],
    [{status: 'failed', retcode: '1400', data: null}, unknown],
    [{status: 'pending', retcode: 1400, data: null}, unknown],
    [accepted({}), unknown],
    [{echo: 'wrong', ...accepted({message_id: 47})}, unknown],
    [null, unknown],
  ];
  for (const [index, [receipt, result]] of cases.entries()) {
    f.calls.length = 0;
    f.state.intercept = (call, respond) => {
      if (call.action !== 'send_group_msg') return false;
      if (receipt) respond(receipt);
      return true;
    };
    assert.deepEqual(await f.client.sendGroupImage(GROUP, photo(), `image-one-action-${index}`), result);
    assert.deepEqual(f.calls.filter(call => call.action.startsWith('send_')).map(call => call.action), ['send_group_msg']);
    assert.deepEqual((await f.quote(47)).addressing, {mentions: [], reference: 'unknown'});
  }
});

test('image quote markers are discarded on stale scope, media collision, membership changes and reconnect', async t => {
  const f = await fixture(t, {receiveGroupMessages: true});
  const unknown = {mentions: [], reference: 'unknown'};
  const photoQuote = {mentions: [], reference: 'self', imageReference: true};
  const accepted47 = {outcome: 'accepted', messageId: '47'};
  let current = true;
  f.state.intercept = (call, respond) => {
    if (call.action !== 'send_group_msg') return false;
    respond(accepted({message_id: 47}));
    current = false;
    return true;
  };
  assert.deepEqual(await f.client.sendGroupImage(GROUP, photo(), 'image-stale-after-write', undefined, {assertCurrent: () => current}), accepted47);
  assert.deepEqual((await f.quote(47)).addressing, unknown);
  f.state.intercept = null;
  assert.deepEqual(await f.client.sendGroupImage(GROUP, photo(), 'image-current'), accepted47);
  assert.deepEqual((await f.quote(47)).addressing, photoQuote);
  assert.deepEqual(await f.client.sendGroupRecord(GROUP, recording(), 'voice-same-id'), accepted47);
  assert.deepEqual((await f.quote(47)).addressing, {...unknown, quoteConflict: true});
  f.state.intercept = (call, respond) => {
    if (call.action !== 'send_group_msg') return false;
    respond(accepted({message_id: 48}));
    return true;
  };
  await f.client.sendGroupImage(GROUP, photo(), 'image-before-leave');
  assert.deepEqual((await f.quote(48)).addressing, photoQuote);
  f.notice('group_decrease', {sub_type: 'leave'});
  f.notice('group_increase', {sub_type: 'approve'});
  assert.deepEqual((await f.quote(48)).addressing, unknown);
  await f.client.sendGroupImage(GROUP, photo(), 'image-after-rejoin');
  assert.deepEqual((await f.quote(48)).addressing, photoQuote);
  f.disconnect();
  await f.client.connect();
  assert.deepEqual((await f.quote(48)).addressing, unknown);
});

test('an opted-in accepted own PNG can be copied only after proof of its exact requester quote and group role', async t => {
  const f = await fixture(t, {receiveGroupMessages:true, groupImageIds:[GROUP]});
  const sourceBytes = photo(), expected = Buffer.from(sourceBytes);
  f.state.now += 789;
  f.state.intercept = (call, respond) => {
    if (call.action !== 'send_group_msg') return false;
    sourceBytes.fill(0);
    respond(accepted({message_id:47}));
    return true;
  };
  assert.deepEqual(await f.client.sendGroupImage(GROUP, sourceBytes, 'image-own-copy', undefined, {scopeId:IMAGE_SCOPE}),
    {outcome:'accepted', messageId:'47'});
  assert(sourceBytes.every(byte => byte === 0));
  const quote = await f.quote(47);
  const source = quote.image.source;
  assert.deepEqual(source, {kind:'qq-group-sent-image',groupId:GROUP,accountId:ACCOUNT,id:'47',createdAt:NOW});
  assert.doesNotMatch(JSON.stringify(quote), /base64|scopeId|image-own-copy/);
  assert.equal(f.client.hasCurrentGroupSentImage(source, IMAGE_SCOPE), true);
  assert.equal(f.client.hasCurrentGroupSentImage({...source}, IMAGE_SCOPE), false);
  assert.equal(f.client.hasCurrentGroupSentImage(source, IMAGE_SCOPE + ':changed'), false);
  assert.throws(() => f.client.bindGroupImageRead(quote, undefined, {sentScopeId:IMAGE_SCOPE + ':changed'}), {code:'stale_context'});
  assert.throws(() => f.client.bindGroupImageRead({...quote,from:OWNER}, undefined, {sentScopeId:IMAGE_SCOPE}), {code:'wrong_scope'});

  const binding = f.client.bindGroupImageRead(quote, undefined, {sentScopeId:IMAGE_SCOPE});
  const quoteId = quote.image.id;
  try {
    assert.throws(() => binding.readSentImage(), {code:'wrong_scope'});
    await assert.rejects(binding.getMessage(quoteId), {code:'wrong_scope'});
    await binding.verify();
    await assert.rejects(binding.getMessage(source.id), {code:'wrong_scope'});
    assert.throws(() => binding.readSentImage(), {code:'wrong_scope'});
    await binding.getMessage(quoteId);
    const bytes = binding.readSentImage();
    assert.deepEqual(bytes, expected);
    bytes.fill(0);
    assert.throws(() => binding.readSentImage(), {code:'wrong_scope'});
  } finally { binding.release(); }
  assert.deepEqual(f.calls.filter(call => call.action === 'get_msg').map(call => call.params.message_id), [quoteId]);
  assert.deepEqual(f.calls.filter(call => call.action === 'get_group_member_info').map(call => call.params), [
    {group_id:Number(GROUP),user_id:Number(ACCOUNT),no_cache:true},
    {group_id:Number(GROUP),user_id:Number(ACCOUNT),no_cache:true},
  ]);
  const second = f.client.bindGroupImageRead(quote, undefined, {sentScopeId:IMAGE_SCOPE});
  try {
    await second.verify();await second.getMessage(quoteId);
    const bytes = second.readSentImage();
    assert.deepEqual(bytes, expected);
    bytes.fill(0);
  } finally { second.release(); }
});

test('own PNG quote media remains inaccessible if consent, role scope, receipt or current membership is missing', async t => {
  for (const scenario of ['disabled','missing-scope','invalid-scope','unknown-receipt','late-scope-change','collision']) {
    await t.test(scenario, async t => {
      const f = await fixture(t, {receiveGroupMessages:true, groupImageIds:scenario==='disabled'?[]:[GROUP]});
      let current = true;
      f.state.intercept = (call, respond) => {
        if (call.action !== 'send_group_msg') return false;
        respond(accepted(scenario==='unknown-receipt'?{}:{message_id:47}));
        if (scenario === 'late-scope-change') current = false;
        return true;
      };
      const scopeId = scenario==='missing-scope'?undefined:scenario==='invalid-scope'?'\x00invalid':IMAGE_SCOPE;
      const result = await f.client.sendGroupImage(GROUP, photo(), 'image-no-cache', undefined, {scopeId,assertCurrent:()=>current});
      assert.equal(result.outcome, scenario==='unknown-receipt'?'unknown':'accepted');
      if (scenario==='collision') await f.client.sendGroupRecord(GROUP, recording(), 'voice-conflicting-receipt');
      assert.equal((await f.quote(47)).image, undefined);
      assert.equal((await f.quote(47, {groupId:OTHER})).image, undefined);
    });
  }
});

test('own PNG cache expires, evicts older entries and clears active quote access explicitly or on leave', async t => {
  const f = await fixture(t, {receiveGroupMessages:true, groupImageIds:[GROUP]});
  let next = 47;
  f.state.intercept = (call, respond) => {
    if (call.action !== 'send_group_msg') return false;
    respond(accepted({message_id:next++}));
    return true;
  };
  const send = ticket => f.client.sendGroupImage(GROUP, photo(), ticket, undefined, {scopeId:IMAGE_SCOPE});
  for (let index=0; index<5; index++) await send(`image-cap-${index}`);
  assert.equal((await f.quote(47)).image, undefined);
  const quoted = await f.quote(48);
  assert.equal(f.client.hasCurrentGroupSentImage(quoted.image.source, IMAGE_SCOPE), true);
  const active = f.client.bindGroupImageRead(quoted, undefined, {sentScopeId:IMAGE_SCOPE});
  f.client.clearGroupSentImages(GROUP);
  assert.equal(active.signal.aborted, true);
  active.release();
  assert.equal(f.client.hasCurrentGroupSentImage(quoted.image.source, IMAGE_SCOPE), false);
  assert.deepEqual((await f.quote(48)).addressing, {mentions:[],reference:'self',imageReference:true});
  assert.equal((await f.quote(48)).image, undefined);

  const {messageId: expired} = await send('image-expiry');
  const beforeExpiry = await f.quote(expired);
  f.state.now += 5 * 60 * 1000;
  assert.equal(f.client.hasCurrentGroupSentImage(beforeExpiry.image.source, IMAGE_SCOPE), false);
  assert.equal((await f.quote(expired)).image, undefined);

  const {messageId: priorMembership} = await send('image-prior-membership');
  const beforeLeave = await f.quote(priorMembership);
  f.notice('group_decrease', {sub_type:'leave'});
  f.notice('group_increase', {sub_type:'approve'});
  assert.equal(f.client.hasCurrentGroupSentImage(beforeLeave.image.source, IMAGE_SCOPE), false);
  assert.equal((await f.quote(priorMembership)).image, undefined);

  const {messageId: priorConnection} = await send('image-prior-connection');
  const beforeReconnect = await f.quote(priorConnection);
  f.disconnect();
  await f.client.connect();
  assert.equal(f.client.hasCurrentGroupSentImage(beforeReconnect.image.source, IMAGE_SCOPE), false);
  assert.equal((await f.quote(priorConnection)).image, undefined);
});

test('late membership or substituted quote facts cannot yield an own-image copy', async t => {
  const f = await fixture(t, {receiveGroupMessages:true, groupImageIds:[GROUP]});
  await f.client.sendGroupImage(GROUP, photo(), 'image-quote-recheck', undefined, {scopeId:IMAGE_SCOPE});
  const quote = await f.quote(47), binding = f.client.bindGroupImageRead(quote, undefined, {sentScopeId:IMAGE_SCOPE});
  try {
    f.state.member = {group_id:OTHER,user_id:ACCOUNT};
    await assert.rejects(binding.verify(), {code:'group_unavailable'});
    assert.throws(() => binding.readSentImage(), {code:'wrong_scope'});
    f.state.member = {group_id:GROUP,user_id:ACCOUNT};
    await binding.verify();
    f.state.intercept = (call, respond) => {
      if (call.action !== 'get_msg') return false;
      respond(accepted({message_id:quote.image.id,message_type:'group',group_id:GROUP,
        sender:{user_id:OWNER},time:NOW/1000,message:[{type:'reply',data:{id:47}}]}));
      return true;
    };
    await assert.rejects(binding.getMessage(quote.image.id), {code:'message_changed'});
    assert.throws(() => binding.readSentImage(), {code:'wrong_scope'});
    f.state.intercept = (call, respond) => {
      if (call.action !== 'get_msg') return false;
      respond(accepted({status:'deleted',message_id:quote.image.id,message_type:'group',group_id:GROUP,
        sender:{user_id:MEMBER},time:NOW/1000,message:[{type:'reply',data:{id:47}},{type:'text',data:{text:quote.text}}]}));
      return true;
    };
    await assert.rejects(binding.getMessage(quote.image.id), {code:'message_changed'});
    assert.throws(() => binding.readSentImage(), {code:'wrong_scope'});
  } finally { binding.release(); }
});
