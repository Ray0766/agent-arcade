'use strict';

// Actual BotService, QQClient and manual voice controller. The OneBot socket,
// account, WAV and replies are fixtures; no QQ account or network is opened.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {BotService} = require('../src/bot/service.cjs');
const {QQClient} = require('../src/bot/qq.cjs');
const {QQOwnerVoice} = require('../src/bot/qq-voice.cjs');
const {CharacterLibrary} = require('../src/bot/character-library.cjs');
const {normalizeCard} = require('../src/vendor/sillytavern/character-card.cjs');
const {scope: manualScope} = require('../src/bot/manual-qq-receipts.cjs');
const {wav} = require('./helpers/fixture-wav.cjs');

const ACCOUNT = '87654321';
const OWNER = '12345678';
const OTHER_ACCOUNT = '87654322';
const GROUP_A = '55556666';
const GROUP_B = '77778888';
const DISALLOWED = '99991111';
const CARD_NAME = '同名合成群角色';
const FILE_NAME = 'synthetic-local-recording.wav';
const GROUP_MSG = '843';
const PRIVATE_MSG = '844';
const REPLY_TEXT = '合成公开文字回复。';
const gatePrefix = 'Decide whether this character should answer';
const enabledGroups = groupIds => ({enabled: true, groupIds, proactive: false});
const allowedScopeCodes = new Set(['stale_ticket', 'changed', 'group_unavailable', 'disconnected', 'account_mismatch', 'account_changed']);

async function fixture(t, {conversation = false} = {}) {
  const root = fs.mkdtempSync(path.join(fs.realpathSync.native(os.tmpdir()), 'arcade-group-voice-send-'));
  const file = path.join(root, FILE_NAME);
  const original = wav({rate: 16000});
  fs.writeFileSync(file, original);
  const requests = [], sockets = [], prompts = [];
  let textReceipt = 2000;
  const state = {account: ACCOUNT, groupReceipt: 'accepted', membership: null, modelExecutions: 0};
  class Bridge extends EventEmitter {
    constructor() {
      super();
      this.readyState = 0;
      sockets.push(this);
      queueMicrotask(() => {this.readyState = 1;this.emit('open');});
    }
    frame(value) {this.emit('message', JSON.stringify(value), false);}
    send(raw, callback) {
      const row = JSON.parse(raw);
      requests.push(row);
      callback?.();
      let data;
      if (row.action === 'get_login_info') data = {user_id: Number(state.account), nickname: '合成群账号'};
      else if (row.action === 'get_status') data = {online: true, good: true};
      else if (row.action === 'get_friend_list') data = [{user_id: Number(OWNER)}];
      else if (row.action === 'get_group_member_info') {
        assert.equal(String(row.params.user_id), state.account);
        assert([GROUP_A, GROUP_B].includes(String(row.params.group_id)), 'membership may only be checked for a configured group');
        assert.equal(row.params.no_cache, true);
        const current = {group_id: Number(row.params.group_id), user_id: Number(state.account)};
        data = state.membership ? state.membership(current) : current;
      } else if (row.action === 'get_group_info') {
        data = {group_id: row.params.group_id, group_name: '合成群聊'};
      } else if (row.action === 'send_group_msg') {
        if (conversation && row.params.message.some(segment => segment.type === 'text')) {
          data = {message_id: ++textReceipt};
        } else {
          if (state.groupReceipt === 'timeout') return;
          // An unrelated echo cannot establish acceptance for this request.
          this.frame({status: 'ok', retcode: 0, data: {message_id: 9999}, echo: 'synthetic-unmatched-echo'});
          data = state.groupReceipt === 'accepted' ? {message_id: Number(GROUP_MSG)} :
            state.groupReceipt === 'malformed' ? {message_id: 'invalid-receipt'} : {};
        }
      } else if (row.action === 'send_private_msg') data = {message_id: Number(PRIVATE_MSG)};
      else assert.fail('unexpected native action: ' + row.action);
      setImmediate(() => {
        if (this.readyState === 1) this.frame({status: 'ok', retcode: 0, data, echo: row.echo});
      });
    }
    ping() {this.emit('pong');}
    terminate() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit('close');
    }
  }
  const library = new CharacterLibrary({root: path.join(root, 'characters')});
  const cards = ['潮汐绘图员', '钟表修理员'].map(description =>
    library.add({card: normalizeCard({name: CARD_NAME, description})}));
  const service = new BotService({
    root, characterLibrary: library,
    vault: {isEncryptionAvailable: () => true, encryptString: text => Buffer.from(text), decryptString: data => data.toString()},
    qqClientFactory: options => new QQClient({...options, timeoutMs: 200, pollTimeoutMs: 15, socketFactory: () => new Bridge()}),
    runnerFactory: options => async ({prompt, request}) => {
      state.modelExecutions++;
      if (!conversation) throw Error('manual voice must not use the group or owner model');
      const gate = prompt.includes(gatePrefix);
      prompts.push({prompt, gate, options, permission: await request({tool: 'Bash'})});
      return {outcome: 'reply_ended', text: gate ? JSON.stringify({action: 'message', text: '合成接话判断'}) : REPLY_TEXT};
    },
    voiceFactory: options => new QQOwnerVoice(options),
  });
  service.configure({
    channel: 'qq', mode: 'api', key: 'synthetic-local-provider-key',
    qqAccountId: ACCOUNT, qqOwnerId: OWNER, qqToken: 'synthetic-voice-send-token',
    qqGroups: enabledGroups([GROUP_A, GROUP_B]),
  });
  service.socialConfigure({enabled: true, proactiveMessages: false, qzonePosts: false});
  const approve = (groupId, index) => {
    const cardId = cards[index].id;
    const {approval} = service.groupRolePreview({groupId, cardId});
    service.groupRoleSet({groupId, cardId, approval});
  };
  approve(GROUP_A, 0);
  approve(GROUP_B, 1);
  const connect = async () => {
    await service.connect();
    assert.equal(service.status, 'connected', service.problem);
    if (conversation) service.groupRoute.flow = {debounceMs: 0, bubbleDelayMs: 0};
  };
  t.after(async () => {
    await service.disconnect();
    assert(sockets.every(socket => socket.readyState === 3));
    fs.rmSync(root, {recursive: true, force: true});
  });
  await connect();

  const writes = () => requests.filter(row => ['send_group_msg', 'send_private_msg'].includes(row.action));
  const groupChecks = () => requests.filter(row => row.action === 'get_group_member_info');
  const ownerReceipts = () => {
    const {accountId, ownerId, characterId} = service.voiceBinding();
    return service.socialStore.manualQQActions(manualScope({accountId, ownerId, characterId}));
  };
  const role = index => 'card-' + cards[index].id;
  let incomingId = 3000;
  const converse = async (groupId, question, reply, id = ++incomingId) => {
    const at = prompts.length;
    const before = writes().length;
    sockets.at(-1).frame({
      post_type: 'message', message_type: 'group', sub_type: 'normal', time: Math.ceil(Date.now() / 1000),
      self_id: Number(state.account), user_id: 44443333, group_id: Number(groupId), message_id: id,
      message: [...(reply ? [{type: 'reply', data: reply}] : []), {type: 'text', data: {text: question}}],
    });
    const deadline = Date.now() + 3500;
    while (writes().length === before) {
      assert(Date.now() < deadline, 'the test group reply was never submitted');
      await delay(2);
    }
    await Promise.all([...service.groupRoute.actors.values()].map(actor => actor.engine.whenIdle()));
    assert.equal(writes().length, before + 1);
    const sent = writes().at(-1);
    assert.equal(String(sent.params.group_id), groupId);
    assert.deepEqual(sent.params.message[0], {type: 'reply', data: {id: String(id)}});
    const recorded = prompts.slice(at);
    assert.deepEqual(recorded.map(row => row.gate), [true, false]);
    return {recorded, receipt: String(textReceipt)};
  };
  return {file, original, service, state, sockets, requests, writes, groupChecks, approve, connect, role, ownerReceipts, library, cards, converse};
}

function inspectRecord(params, expectedField, expectedId) {
  assert.equal(String(params[expectedField]), expectedId);
  assert(Object.keys(params).every(key => [expectedField, 'message'].includes(key)), 'the transport must not broaden the fixed record action');
  assert.equal(params.message.length, 1);
  const [segment] = params.message;
  assert.deepEqual(Object.keys(segment).sort(), ['data', 'type']);
  assert.deepEqual(Object.keys(segment.data), ['file']);
  assert.equal(segment.type, 'record');
  assert.match(segment.data.file, /^base64:\/\//);
  const bytes = Buffer.from(segment.data.file.slice('base64://'.length), 'base64');
  assert.deepEqual(bytes, wav({rate: 16000, metadata: false}), 'only the complete canonical WAV is sent');
}

async function assertNotSent(operation, codes = allowedScopeCodes) {
  let result;
  try {result = await operation();}
  catch (error) {
    assert(codes.has(error.code), 'unexpected rejection: ' + error.code);
    return;
  }
  assert.equal(result?.outcome, 'not_sent');
  assert(codes.has(result.code), 'unexpected refusal: ' + result.code);
}

test('explicit ordinary group preview and send bind the exact role, verified membership and one canonical WAV receipt', async t => {
  const f = await fixture(t);
  const expectedRoleA = {groupId: GROUP_A, role: CARD_NAME, roleId: f.role(0)};
  const expectedRoleB = {groupId: GROUP_B, role: CARD_NAME, roleId: f.role(1)};
  assert.deepEqual(f.service.voiceSnapshot().groupTargets, [expectedRoleA, expectedRoleB]);
  assert.notEqual(expectedRoleA.roleId, expectedRoleB.roleId);
  const binding = f.service.voiceBinding(GROUP_A);
  assert.equal(binding.groupId, GROUP_A);
  assert.equal(binding.accountId, ACCOUNT);
  // This is the read-only preview preflight used by the registered main
  // handler, followed by local draft creation and the service's real send.
  await binding.client.verifyGroupVoiceTarget(GROUP_A);
  const draft = await f.service.selectVoice(f.file, {groupId: GROUP_A});
  assert.deepEqual(draft.recipient, {accountId: ACCOUNT, ...expectedRoleA});
  assert.match(draft.preview, /^data:audio\/wav;base64,/);
  assert.deepEqual(Buffer.from(draft.preview.split(',')[1], 'base64'), wav({rate: 16000, metadata: false}));
  assert.equal(f.groupChecks().length, 1);
  assert.deepEqual(f.writes(), []);
  assert.doesNotMatch(JSON.stringify(f.service.voiceSnapshot()), /base64|preview|synthetic-local-recording|scopeId|synthetic-voice-send-token/);
  const result = await f.service.sendVoice({ticketId: draft.ticketId}, {groupId: GROUP_A});
  assert.deepEqual(result, {kind: 'voice', ticketId: draft.ticketId, outcome: 'accepted', messageId: GROUP_MSG});
  assert.equal(f.groupChecks().length, 2);
  assert(f.groupChecks().every(row => String(row.params.group_id) === GROUP_A && String(row.params.user_id) === ACCOUNT));
  const [sent] = f.writes();
  assert.equal(f.writes().length, 1);
  assert.equal(sent.action, 'send_group_msg');
  inspectRecord(sent.params, 'group_id', GROUP_A);
  assert(f.requests.indexOf(f.groupChecks().at(-1)) < f.requests.indexOf(sent));
  assert.deepEqual(fs.readFileSync(f.file), f.original);
  assert.deepEqual(f.ownerReceipts(), [], 'group receipts may not become owner-private context');
  assert.equal(f.state.modelExecutions, 0);
  await assertNotSent(() => f.service.sendVoice({ticketId: draft.ticketId}, {groupId: GROUP_A}));
  assert.equal(f.writes().length, 1);
});

test('main-prepared WAV retains its chosen group and owner-private voice keeps its own scope', async t => {
  const f = await fixture(t);
  const bytes = Buffer.from(f.original);
  const group = await f.service.prepareVoice(bytes, {groupId: GROUP_B});
  bytes.fill(0);
  assert.deepEqual(group.recipient, {accountId: ACCOUNT, groupId: GROUP_B, role: CARD_NAME, roleId: f.role(1)});
  const groupResult = await f.service.sendVoice({ticketId: group.ticketId}, {groupId: GROUP_B});
  assert.equal(groupResult.outcome, 'accepted');
  assert.deepEqual(f.ownerReceipts(), []);

  const memberChecks = f.groupChecks().length;
  await f.service.resetVoices();
  const owner = await f.service.selectVoice(f.file);
  assert.equal(owner.recipient.ownerId, OWNER);
  assert.equal(Object.hasOwn(owner.recipient, 'groupId'), false);
  assert.equal((await f.service.sendVoice({ticketId: owner.ticketId})).messageId, PRIVATE_MSG);
  assert.equal(f.groupChecks().length, memberChecks, 'owner voice does not check group membership');
  const [groupWrite, ownerWrite] = f.writes();
  assert.equal(groupWrite.action, 'send_group_msg');
  assert.equal(ownerWrite.action, 'send_private_msg');
  inspectRecord(groupWrite.params, 'group_id', GROUP_B);
  inspectRecord(ownerWrite.params, 'user_id', OWNER);
  const receipts = f.ownerReceipts();
  assert.equal(receipts.length, 1);
  assert.equal(receipts[0].receipt, PRIVATE_MSG);
  assert.equal(f.state.modelExecutions, 0);
});

for (const receipt of ['missing', 'timeout']) {
  test('group voice ' + receipt + ' receipt remains unknown and is not replayed', async t => {
    const f = await fixture(t);
    const draft = await f.service.selectVoice(f.file, {groupId: GROUP_A});
    f.state.groupReceipt = receipt;
    const result = await f.service.sendVoice({ticketId: draft.ticketId}, {groupId: GROUP_A});
    assert.equal(result.outcome, 'unknown');
    assert.equal(result.code, 'send_unknown');
    assert.equal(f.service.outgoingAccepted, 0);
    assert.equal(f.service.voiceSnapshot().last?.outcome, 'unknown');
    await assertNotSent(() => f.service.sendVoice({ticketId: draft.ticketId}, {groupId: GROUP_A}));
    assert.deepEqual(f.writes().map(row => row.action), ['send_group_msg']);
    assert.deepEqual(f.ownerReceipts(), []);
  });
}

test('group voice cannot submit after live membership or bridge account changes', async t => {
  const cases = [
    ['member absent', state => {state.membership = () => null;}],
    ['wrong membership group', state => {state.membership = row => ({...row, group_id: Number(GROUP_B)});}],
    ['wrong membership user', state => {state.membership = row => ({...row, user_id: Number(OTHER_ACCOUNT)});}],
    ['bridge account changed', state => {state.account = OTHER_ACCOUNT;}],
  ];
  for (const [name, change] of cases) {
    await t.test(name, async t => {
      const f = await fixture(t);
      await f.service.voiceBinding(GROUP_A).client.verifyGroupVoiceTarget(GROUP_A);
      const draft = await f.service.selectVoice(f.file, {groupId: GROUP_A});
      const beforeSendCheck = f.groupChecks().length;
      change(f.state);
      await assertNotSent(() => f.service.sendVoice({ticketId: draft.ticketId}, {groupId: GROUP_A}));
      assert.deepEqual(f.writes(), []);
      assert.equal(f.groupChecks().length, beforeSendCheck + (f.state.account === ACCOUNT ? 1 : 0));
      assert.equal(f.state.modelExecutions, 0);
    });
  }
});

test('the exact account leaving and rejoining a group cannot revive an earlier preview', async t => {
  const f = await fixture(t);
  const draft = await f.service.selectVoice(f.file, {groupId: GROUP_A});
  const revision = f.service.voiceBinding(GROUP_A).groupRevision;
  const bridge = f.sockets.at(-1);
  const notice = (type, subtype, memberId) => ({post_type: 'notice', notice_type: type, sub_type: subtype,
    self_id: Number(ACCOUNT), user_id: Number(memberId), group_id: Number(GROUP_A),
  });
  bridge.frame(notice('group_decrease', 'leave', OWNER));
  assert.equal(f.service.voiceBinding(GROUP_A).groupRevision, revision, 'another member does not invalidate this account');
  bridge.frame(notice('group_decrease', 'leave', ACCOUNT));
  bridge.frame(notice('group_increase', 'approve', ACCOUNT));
  await f.service.voiceBinding(GROUP_A).client.verifyGroupVoiceTarget(GROUP_A);
  assert.notEqual(f.service.voiceBinding(GROUP_A).groupRevision, revision);
  await assertNotSent(() => f.service.sendVoice({ticketId: draft.ticketId}, {groupId: GROUP_A}));
  assert.deepEqual(f.writes(), []);
  const fresh = await f.service.selectVoice(f.file, {groupId: GROUP_A});
  assert.equal((await f.service.sendVoice({ticketId: fresh.ticketId}, {groupId: GROUP_A})).messageId, GROUP_MSG);
  assert.deepEqual(f.writes().map(row => row.action), ['send_group_msg']);
});

test('a changed approved card invalidates its live draft before any submission', async t => {
  const f = await fixture(t);
  const draft = await f.service.selectVoice(f.file, {groupId: GROUP_A});
  f.library.update(f.cards[0].id, {description: '等待重新确认的合成角色描述'});
  assert.deepEqual(f.service.voiceSnapshot().groupTargets.map(row => row.groupId), [GROUP_B]);
  await assertNotSent(() => f.service.sendVoice({ticketId: draft.ticketId}, {groupId: GROUP_A}));
  assert.deepEqual(f.writes(), []);
});

test('a different same-name role or removed allowlisted group cannot inherit a preview after reconnect', async t => {
  const f = await fixture(t);
  const old = await f.service.selectVoice(f.file, {groupId: GROUP_A});
  await f.service.disconnect();
  f.approve(GROUP_A, 1);
  await f.connect();
  assert(f.service.voiceSnapshot().groupTargets.some(row => row.groupId === GROUP_A && row.role === CARD_NAME && row.roleId === f.role(1)));
  await assertNotSent(() => f.service.sendVoice({ticketId: old.ticketId}, {groupId: GROUP_A}));
  const fresh = await f.service.selectVoice(f.file, {groupId: GROUP_A});
  assert.notEqual(fresh.recipient.roleId, old.recipient.roleId);

  await f.service.disconnect();
  f.service.configure({qqGroups: enabledGroups([GROUP_B])});
  await f.connect();
  assert.deepEqual(f.service.voiceSnapshot().groupTargets.map(row => row.groupId), [GROUP_B]);
  await assertNotSent(() => f.service.sendVoice({ticketId: fresh.ticketId}, {groupId: GROUP_A}));
  await assertNotSent(() => f.service.selectVoice(f.file, {groupId: DISALLOWED}));
  assert.deepEqual(f.writes(), []);
});

test('a group draft cannot be retargeted and discard consumes it without changing the original file', async t => {
  const f = await fixture(t);
  const wrong = await f.service.selectVoice(f.file, {groupId: GROUP_A});
  await assertNotSent(() => f.service.sendVoice({ticketId: wrong.ticketId}, {groupId: GROUP_B}));
  assert.deepEqual(f.writes(), []);

  const discard = await f.service.selectVoice(f.file, {groupId: GROUP_A});
  assert.deepEqual(await f.service.discardVoice({ticketId: discard.ticketId}, {groupId: GROUP_A}), {discarded: true});
  await assertNotSent(() => f.service.sendVoice({ticketId: discard.ticketId}, {groupId: GROUP_A}));
  assert.deepEqual(f.writes(), []);
  assert.deepEqual(fs.readFileSync(f.file), f.original);
});

function checkQuotePrompt({prompt, options, permission}, {author, question, voice, text, rawId}) {
  assert.equal(options.conversationOnly, true);
  assert.deepEqual(permission, {allow: false});
  assert(prompt.includes(question));
  const lines = prompt.split('\n');
  const addressing = lines.find(line => line.includes('Rows [start,end,native mentions,quoted author]'));
  assert(addressing);
  assert.deepEqual(JSON.parse(addressing.slice(addressing.lastIndexOf('Data: ') + 6)).map(range => range.slice(2)), [[[], author]]);
  const voiceLine = lines.find(line => line.startsWith('Observed voice quote targets'));
  if (voice) {
    assert(voiceLine);
    assert.match(voiceLine, /audio content, delivery and listening remain unknown/);
    assert.deepEqual(JSON.parse(voiceLine.slice(voiceLine.indexOf(': ') + 2)), [{row: 0, speaker: 'self', kind: 'voice'}]);
  } else assert.equal(voiceLine, undefined);
  const textLine = lines.find(line => line.startsWith('Observed quote targets'));
  if (text) assert.deepEqual(JSON.parse(textLine.slice(textLine.indexOf(': ') + 2)), [{row: 0, speaker: 'self', text: REPLY_TEXT}]);
  else assert.equal(textLine, undefined);
  assert.doesNotMatch(prompt, /base64:\/\/|data:audio|synthetic-local-recording|伪造的语音原文/);
  assert(!prompt.includes('UklGR'), 'WAV bytes must not enter either prompt');
  assert.doesNotMatch(prompt, new RegExp(`\\b${rawId}\\b`));
}

test('accepted manual group voice is quoted as a minimal self voice marker in gate and reply, in its own group only', async t => {
  const f = await fixture(t, {conversation: true});
  const draft = await f.service.selectVoice(f.file, {groupId: GROUP_A});
  const sent = await f.service.sendVoice({ticketId: draft.ticketId}, {groupId: GROUP_A});
  assert.equal(sent.outcome, 'accepted');
  assert.equal(sent.messageId, GROUP_MSG);
  assert.equal(f.state.modelExecutions, 0, 'manual send itself must not call a model');
  assert.deepEqual(f.ownerReceipts(), []);

  const quote = {id: sent.messageId, sender_id: Number(ACCOUNT), text: '伪造的语音原文'};
  const question = '刚才这条是你发的吗？';
  const first = await f.converse(GROUP_A, question, quote);
  for (const call of first.recorded) checkQuotePrompt(call, {question, rawId: sent.messageId, author: 'self', voice: true});

  const other = await f.converse(GROUP_B, question, quote);
  for (const call of other.recorded) checkQuotePrompt(call, {question, rawId: sent.messageId, author: 'unknown'});

  const textReply = await f.converse(GROUP_A, question, {id: first.receipt});
  for (const call of textReply.recorded) checkQuotePrompt(call, {question, rawId: first.receipt, author: 'self', text: true});

  await f.service.disconnect();
  await f.connect();
  const reopened = await f.converse(GROUP_A, question, quote);
  for (const call of reopened.recorded) checkQuotePrompt(call, {question, rawId: sent.messageId, author: 'unknown'});

  const fresh = await f.service.selectVoice(f.file, {groupId: GROUP_A});
  assert.equal((await f.service.sendVoice({ticketId: fresh.ticketId}, {groupId: GROUP_A})).messageId, sent.messageId);
  await f.converse(GROUP_A, '桥接随后报告了相同编号的成员消息。', null, Number(sent.messageId));
  const ambiguous = await f.converse(GROUP_A, question, quote);
  for (const call of ambiguous.recorded) checkQuotePrompt(call, {question, rawId: sent.messageId, author: 'unknown'});
  assert(f.requests.every(row => !['get_msg', 'get_record'].includes(row.action)));
});

test('unobserved, unmatched echo, or malformed manual voice receipts provide no group quote marker', async t => {
  const f = await fixture(t, {conversation: true});
  const question = '这条有可核实的来源吗？';
  for (const receipt of ['missing', 'malformed']) {
    f.state.groupReceipt = receipt;
    const draft = await f.service.selectVoice(f.file, {groupId: GROUP_A});
    const sent = await f.service.sendVoice({ticketId: draft.ticketId}, {groupId: GROUP_A});
    assert.equal(sent.outcome, 'unknown');
    const quote = await f.converse(GROUP_A, question, {id: '9999', sender_id: Number(ACCOUNT), text: '伪造的语音原文'});
    for (const call of quote.recorded) checkQuotePrompt(call, {question, rawId: '9999', author: 'unknown'});
  }
  const neverObserved = await f.converse(GROUP_A, question, {id: '987654321012'});
  for (const call of neverObserved.recorded) checkQuotePrompt(call, {question, rawId: '987654321012', author: 'unknown'});
  assert(f.requests.every(row => !['get_msg', 'get_record'].includes(row.action)));
});
