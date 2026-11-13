'use strict';
// Service integration fixtures: local stores, fake vault, model and QQ account.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {BotService} = require('../src/bot/service.cjs');
const {SocialCompanion, scopeFor} = require('../src/bot/social-companion.cjs');

const OWNER = '12345678', ACCOUNT = '87654321', TOKEN = 'synthetic-social-bridge-token';
function fixture(t, execute) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-social-service-'));
  const state = {account: ACCOUNT}, factoryCalls = [], modelCalls = [], sent = [], posts = [], clients = [];
  const vault = {isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString()};
  const factory = options => {
    factoryCalls.push(options);
    return async args => { modelCalls.push(args); return execute ? execute(args, modelCalls.length) : {outcome: 'reply_ended', text: '我在，接着说吧。'}; };
  };
  const service = new BotService({root, vault, claudeProgramRunnerFactory: factory, runnerFactory: factory,
    deepseekRunnerFactory: factory, gptRunnerFactory: factory,
    qqClientFactory: options => {
      const client = {accountId: state.account,
        connect: async () => ({accountId: client.accountId}),
        inspect: async () => ({accountId: client.accountId, online: true, ownerIsFriend: true, nickname: 'fixture'}),
        getUpdates: (_cursor, signal) => new Promise((resolve, reject) => {
          if (signal.aborted) return reject(Error('aborted'));
          signal.addEventListener('abort', () => reject(Error('aborted')), {once: true});
        }),
        sendText: async (to, text, context) => { sent.push({to, text, context, kind: 'reply'}); return {id: String(sent.length)}; },
        sendProactiveText: async (to, text, id) => { sent.push({to, text, id, kind: 'message'}); return {id: String(sent.length)}; },
        publishQzoneText: async (text, settings) => { posts.push({text, settings}); return {id: 'post-1', visibilityVerified: false}; },
        getOwnQzonePost: async id => ({id, text: posts.at(-1)?.text}), close: async () => {}};
      clients.push({client, options}); return client;
    }});
  service.configure({channel: 'qq', mode: 'claude', qqOwnerId: OWNER, qqUrl: 'ws://127.0.0.1:3001/', qqToken: TOKEN});
  service.socialConfigure({enabled: true, proactiveMessages: true, qzonePosts: true, activeStart: 0, activeEnd: 24, intervalMinutes: 30});
  t.after(async () => {
    await service.disconnect();
    const resolved = path.resolve(root);
    assert(resolved.startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(resolved).startsWith('arcade-social-service-'));
    fs.rmSync(resolved, {recursive: true, force: true});
  });
  return {root, service, state, factoryCalls, modelCalls, sent, posts, clients};
}

test('QQ companion uses a separate conversation-only workspace, no project prerequisite and no resumed coding session', async t => {
  const f = fixture(t); assert.equal(f.service.config.workspace, undefined);
  await f.service.connect(); assert.equal(f.service.status, 'connected'); assert(f.service.dispatcher instanceof SocialCompanion);
  assert.equal(f.factoryCalls.length, 1); assert.equal(f.factoryCalls[0].conversationOnly, true);
  assert.equal(f.factoryCalls[0].workspace, path.join(f.root, 'social-workspace'));
  assert.deepEqual(f.factoryCalls[0].persona, {enabled: false, selection: 'default'}); assert.equal(Object.hasOwn(f.factoryCalls[0], 'key'), false);
  await f.service.dispatcher.receive({id: 'hello', text: '你好，想聊聊天。', contextToken: 'fixture-context'});
  await f.service.dispatcher.whenIdle();
  assert.equal(f.modelCalls.length, 1); assert.equal(Object.hasOwn(f.modelCalls[0], 'resume'), false);
  assert.deepEqual(await f.modelCalls[0].request({tool: 'Bash'}), {allow: false});
  assert.equal(f.service.snapshot().tasks.pending.length, 0); assert.equal(f.sent[0].to, OWNER);
  assert.equal(f.service.snapshot().outgoingAccepted, 1);
});

test('owner change pauses autonomous behavior and keeps private notes/history bound to original contact', async t => {
  const f = fixture(t); await f.service.connect(); const original = f.service.socialScope;
  f.service.socialStore.append(original, {id: 'old-owner', role: 'user', text: 'private-old-owner-fact'});
  await f.service.disconnect(); f.service.socialConfigure({notes: 'private-old-owner-note'});
  f.service.configure({qqOwnerId: '22223333'});
  assert.equal(f.service.socialScope, null); assert.equal(f.service.socialSnapshot().config.notes, '');
  assert.deepEqual(f.service.socialSnapshot().history, [], 'changed identity must not display the previous contact history before reconnect');
  assert.equal(f.service.socialSnapshot().config.proactiveMessages, false); assert.equal(f.service.socialSnapshot().config.qzonePosts, false);
  await f.service.connect(); assert.equal(f.service.status, 'connected');
  assert.equal(f.service.socialScope, scopeFor(ACCOUNT, '22223333', 'claude-ju')); assert.notEqual(f.service.socialScope, original);
  assert.deepEqual(f.service.socialSnapshot().history, []); assert.equal(f.service.socialSnapshot().config.notes, '');
  assert.equal(f.service.socialStore.getNotes(original), 'private-old-owner-note'); assert.equal(f.service.socialStore.history(original)[0].text, 'private-old-owner-fact');
});

test('an actual bridge account switch pauses saved initiative consent without exposing previous character memory', async t => {
  const f = fixture(t); await f.service.connect(); const original = f.service.socialScope;
  await f.service.disconnect(); f.service.socialConfigure({notes: 'private-original-account-note'});
  assert.equal(f.service.socialSnapshot().config.proactiveMessages, true);
  f.state.account = '99998888'; await f.service.connect(); assert.equal(f.service.status, 'connected');
  assert.notEqual(f.service.socialScope, original); assert.equal(f.service.socialSnapshot().config.proactiveMessages, false);
  assert.equal(f.service.socialSnapshot().config.qzonePosts, false); assert.equal(f.service.socialSnapshot().config.notes, '');
  assert.match(f.service.dispatcher.problem, /账号、联系人或角色已改变/);
  assert.equal(f.sent.length, 0); assert.equal(f.posts.length, 0);
});

test('resubmitting unchanged QQ fields preserves existing social consent and scoped notes', async t => {
  const f = fixture(t); await f.service.connect(); const original = f.service.socialScope;
  await f.service.disconnect(); f.service.socialConfigure({notes: 'keep-this-note'});
  f.service.configure({qqOwnerId: OWNER, qqUrl: 'ws://127.0.0.1:3001/', qqToken: TOKEN});
  assert.equal(f.service.socialScope, original); assert.equal(f.service.socialSnapshot().config.notes, 'keep-this-note');
  assert.equal(f.service.socialSnapshot().config.proactiveMessages, true); assert.equal(f.service.socialSnapshot().config.qzonePosts, true);
  await f.service.connect(); assert.equal(f.service.socialScope, original); assert.equal(f.service.socialSnapshot().config.proactiveMessages, true);
});

test('changing character keeps character/contact memories separate and pauses autonomous activity', async t => {
  const f = fixture(t); await f.service.connect(); const original = f.service.socialScope;
  f.service.socialStore.append(original, {id: 'ju-chat', role: 'user', text: 'Ju-specific-conversation'});
  await f.service.disconnect(); f.service.socialConfigure({notes: 'Ju-specific-private-memory'});
  f.service.socialConfigure({characterId: 'codex-dragon', name: '龙娘'});
  assert.equal(f.service.socialScope, null); assert.equal(f.service.socialSnapshot().config.proactiveMessages, false);
  assert.deepEqual(f.service.socialSnapshot().history, [], 'old character history is not shown under the newly selected character');
  await f.service.connect(); assert.equal(f.service.socialScope, scopeFor(ACCOUNT, OWNER, 'codex-dragon'));
  assert.equal(f.service.socialSnapshot().config.notes, ''); assert.equal(f.service.socialStore.getNotes(original), 'Ju-specific-private-memory');
});

test('service fixes space audience to the bound owner and keeps post generation isolated from private context', async t => {
  const f = fixture(t, async (_args, call) => ({outcome: 'reply_ended', text: call === 1 ? '{"action":"post","text":""}' : '今天想把一小片海，画进书签里。'}));
  await f.service.connect(); f.service.socialStore.append(f.service.socialScope, {id: 'seed', role: 'user', text: 'PRIVATE_CONTACT_STORY', at: Date.now() - 20 * 60000});
  await f.service.socialConsider(); assert.equal(f.posts.length, 1);
  assert.equal(f.posts[0].settings.audience, 'owner'); assert.equal(typeof f.posts[0].settings.clientId, 'string');
  assert.match(f.modelCalls[0].prompt, /PRIVATE_CONTACT_STORY/); assert.doesNotMatch(f.modelCalls[1].prompt, /PRIVATE_CONTACT_STORY/);
  assert.equal(f.sent.length, 0); assert(f.modelCalls.every(call => !Object.hasOwn(call, 'resume')));
});
