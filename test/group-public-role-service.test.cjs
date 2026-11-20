'use strict';

// Actual BotService, CharacterLibrary, SQLite stores and QQClient. Only the
// OneBot socket, provider runner and vault are stand-ins; no network is opened.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {BotService} = require('../src/bot/service.cjs');
const {CharacterLibrary} = require('../src/bot/character-library.cjs');
const {LorebookLibrary} = require('../src/bot/st/lorebooks.cjs');
const {book} = require('./st-local-fixture.cjs');
const {QQClient} = require('../src/bot/qq.cjs');
const {createDeepSeekRunner} = require('../src/bot/deepseek-runner.cjs');
const {normalizeCard} = require('../src/vendor/sillytavern/character-card.cjs');

const ACCOUNT = '87654321';
const OTHER_ACCOUNT = '87654322';
const OWNER = '12345678';
const MEMBER = '44443333';
const GROUP_A = '55556666';
const GROUP_B = '77778888';
const NOW = 1800000000000;
const QUESTION = '你平时会留意什么？';
const WAIT = '合成应当留给两位成员继续的话题';
const descriptions = ['晚潮绘图员', '午后修表师'];
const examples = ['潮汐刻度', '秒针误差'];
const privateMarkers = [
  '卡片创作者私记零点', '卡片未批准系统提示一', '卡片未批准后置提示二',
  '卡片未批准开场白三', '本机私人角色简介四', '本机私人语气示例五', '本机App个人记忆六',
];
const groups = groupIds => ({enabled: true, groupIds, proactive: false});
const vault = {
  isEncryptionAvailable: () => true,
  encryptString: text => Buffer.from(text),
  decryptString: bytes => bytes.toString(),
};
const gatePrefix = 'Decide whether this character should answer';

class Bridge extends EventEmitter {
  constructor(accountId, outbound) {
    super();
    this.accountId = accountId;
    this.outbound = outbound;
    this.readyState = 0;
    queueMicrotask(() => {this.readyState = 1;this.emit('open');});
  }
  frame(value) {this.emit('message', JSON.stringify(value), false);}
  send(raw, callback) {
    const {action, echo, params} = JSON.parse(raw);
    callback?.();
    const responses = {
      get_login_info: {user_id: this.accountId, nickname: '合成 QQ 档案'},
      get_status: {online: true, good: true},
      get_friend_list: [{user_id: OWNER}],
      send_group_msg: {message_id: 5000 + this.outbound.length},
      send_private_msg: {message_id: 5000 + this.outbound.length},
    };
    assert(Object.hasOwn(responses, action), 'unexpected OneBot action: ' + action);
    if (action === 'send_group_msg' || action === 'send_private_msg') {
      this.lastReceipt = String(responses[action].message_id);
      this.outbound.push(params);
    }
    this.frame({status: 'ok', retcode: 0, data: responses[action], echo});
  }
  terminate() {this.readyState = 3;this.emit('close');}
}

async function until(predicate, message) {
  const deadline = Date.now() + 3500;
  while (!predicate()) {
    assert(Date.now() < deadline, message);
    await delay(2);
  }
}

function fixture(t, {saveAccount = true, embeddedEntry, deepseek = false} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-group-public-role-'));
  const calls = [], outbound = [], bridges = [], services = [];
  const state = {accountId: ACCOUNT, wait: false, reply: null};
  let lastRawId = 0;
  const create = observeLorebooks => {
    const library = new CharacterLibrary({root: path.join(root, 'characters')});
    const lorebooks = new LorebookLibrary({root: path.join(root, 'lorebooks')});
    observeLorebooks?.(lorebooks);
    const service = new BotService({
      root, vault, characterLibrary: library, lorebookLibrary: lorebooks,
      runnerFactory: options => async ({prompt, request}) => {
        const gate = prompt.includes(gatePrefix);
        calls.push({prompt, gate, options, permission: await request({tool: 'Bash'})});
        const text = gate ? JSON.stringify(state.wait ? {action: 'wait', text: ''} : {action: 'message', text: '合成接话判断'}) : state.reply?.(prompt) || '合成群聊回复。';
        return {outcome: 'reply_ended', text};
      },
      ...(deepseek ? {deepseekRunnerFactory: options => createDeepSeekRunner({...options, fetchImpl: async (_url, request) => {
        const body = JSON.parse(request.body);
        const prompt = body.messages.at(-1).content;
        const gate = prompt.includes(gatePrefix);
        calls.push({body, prompt, gate});
        const content = gate ? JSON.stringify({action: 'message', text: '合成接话判断'}) : '合成 DeepSeek 回复。';
        return new Response(JSON.stringify({choices: [{finish_reason: 'stop', message: {role: 'assistant', content}}]}),
          {status: 200, headers: {'content-type': 'application/json'}});
      }})} : {}),
      qqClientFactory: options => new QQClient({...options, timeoutMs: 300, pollTimeoutMs: 15, now: () => NOW,
        socketFactory: () => {
          const bridge = new Bridge(state.accountId, outbound);
          bridges.push(bridge);
          return bridge;
        },
      }),
    });
    services.push(service);
    return {service, library, lorebooks};
  };
  const {service, library, lorebooks} = create();
  service.configure({channel: 'qq', mode: 'api', key: 'fixture-api-key',
    ...(saveAccount ? {qqAccountId: ACCOUNT} : {}), qqOwnerId: OWNER, qqToken: 'fixture-onebot-token',
    qqGroups: groups([GROUP_A, GROUP_B]),
  });
  service.socialConfigure({
    enabled: true,
    description: privateMarkers[4],
    speechExamples: [{user: '私人问题', assistant: privateMarkers[5]}],
  });
  const cards = descriptions.map((description, index) => library.add({card: normalizeCard({
    name: '阿青', description, mes_example: '<START>\n{{char}}: ' + examples[index],
    creatorcomment: privateMarkers[0], system_prompt: privateMarkers[1],
    post_history_instructions: privateMarkers[2], first_mes: privateMarkers[3],
    ...(embeddedEntry && index === 0 ? {character_book: {entries: [{...embeddedEntry}]}} : {}),
  })}));
  t.after(async () => {
    for (const item of services) await item.disconnect();
    fs.rmSync(root, {recursive: true, force: true});
  });

  const connect = async current => {
    await current.connect();
    assert.equal(current.status, 'connected', current.problem);
    current.groupRoute.flow = {debounceMs: 0, bubbleDelayMs: 0};
  };
  const frame = (groupId, text = QUESTION, messageId = ++lastRawId, senderId = MEMBER) => {
    bridges.at(-1).frame({
      post_type: 'message', message_type: 'group', sub_type: 'normal', time: NOW / 1000,
      self_id: Number(state.accountId), user_id: Number(senderId), group_id: Number(groupId),
      message_id: messageId, message: Array.isArray(text) ? text : [{type: 'text', data: {text}}],
    });
    return messageId;
  };
  const idle = current => Promise.all([...current.groupRoute.actors.values()].map(actor => actor.engine.whenIdle()));
  const converse = async (current, groupId, text, {quiescent = false, senderId} = {}) => {
    const firstCall = calls.length;
    const sendCount = outbound.length;
    const skipped = current.groupRoute.snapshot().skipped;
    const rawId = frame(groupId, text, undefined, senderId);
    if (quiescent) {
      await until(() => current.groupRoute.snapshot().skipped > skipped, 'the reply gate did not settle');
      assert.equal(outbound.length, sendCount);
    } else {
      await until(() => outbound.length > sendCount, 'the group reply was never sent');
      assert.equal(outbound.length, sendCount + 1);
      assert.equal(outbound.at(-1).group_id, Number(groupId));
      assert.deepEqual(outbound.at(-1).message[0], {type: 'reply', data: {id: String(rawId)}});
    }
    await idle(current);
    const recorded = calls.slice(firstCall);
    assert.deepEqual(recorded.map(call => call.gate), quiescent ? [true] : [true, false]);
    return {recorded, rawId, receipt: quiescent ? null : bridges.at(-1).lastReceipt};
  };
  const conversePrivate = async (current, text) => {
    const firstCall = calls.length;
    const sendCount = outbound.length;
    bridges.at(-1).frame({
      post_type: 'message', message_type: 'private', sub_type: 'friend',
      time: NOW / 1000, self_id: Number(state.accountId), user_id: Number(OWNER),
      message_id: ++lastRawId, message: [{type: 'text', data: {text}}],
    });
    await until(() => outbound.length > sendCount, 'the private reply was never sent');
    await current.dispatcher.whenIdle();
    assert.equal(String(outbound.at(-1).user_id), OWNER);
    assert.equal(Object.hasOwn(outbound.at(-1), 'group_id'), false);
    const [recorded] = calls.slice(firstCall);
    assert(recorded);
    assert.equal(calls.length, firstCall + 1);
    return [recorded];
  };
  return {root, service, library, lorebooks, cards, calls, outbound, bridges, create, connect, frame, converse, conversePrivate, state};
}

function approve(service, groupId, cardId) {
  const preview = service.groupRolePreview({groupId, cardId});
  assert.deepEqual(Object.keys(preview).sort(), ['approval', 'cardId', 'description', 'examples', 'name']);
  assert.equal(preview.name, '阿青');
  assert.equal(preview.cardId, cardId);
  assert.equal(typeof preview.approval, 'string');
  assert(preview.approval.length > 0);
  assert(privateMarkers.every(marker => !JSON.stringify(preview).includes(marker)));
  service.groupRoleSet({groupId, cardId, approval: preview.approval});
  return preview;
}

function checkPrompts(recorded, roleIndex, text = QUESTION) {
  for (const {prompt, options, permission} of recorded) {
    assert(prompt.includes(text));
    assert(prompt.includes('不能声称知道私聊、其他群或其他角色'));
    assert(options.conversationOnly);
    assert.deepEqual(permission, {allow: false});
    assert(privateMarkers.every(marker => !prompt.includes(marker)), 'private state projected to group');
    for (const [index, markers] of descriptions.map((description, i) => [i, [description, examples[i]]])) {
      for (const marker of markers) assert.equal(prompt.includes(marker), roleIndex === index, marker);
    }
    if (roleIndex !== null) assert(prompt.includes('阿青'));
  }
}

test('ordinary QQ projects explicit same-named cards independently into decision and reply, independent of private App state', async t => {
  const f = fixture(t);
  const {service, cards} = f;
  assert.notEqual(cards[0].id, cards[1].id);
  service.stConfigure({characterId: cards[0].id});
  const memoryId = service.localSnapshot().memory.id;
  await service.localMemory({memoryId, action: 'remember', text: privateMarkers[6]});
  assert(service.localSnapshot().memory.facts.some(fact => fact.text === privateMarkers[6]));
  const a = approve(service, GROUP_A, cards[0].id);
  const b = approve(service, GROUP_B, cards[1].id);
  assert.equal(a.description, descriptions[0]);
  assert.equal(b.description, descriptions[1]);
  assert(JSON.stringify(a.examples).includes(examples[0]));
  assert(JSON.stringify(b.examples).includes(examples[1]));
  assert.notEqual(a.approval, b.approval);
  assert.throws(() => service.groupRoleSet({groupId: GROUP_B, cardId: cards[0].id, approval: a.approval}),
    {code: 'group_role_changed'}, 'the preview hash must be scoped to the reviewed group');
  const configText = fs.readFileSync(path.join(f.root, 'bot-config.json'), 'utf8');
  assert(privateMarkers.every(marker => !configText.includes(marker)));
  await f.connect(service);
  assert.throws(() => service.groupRoleSet({groupId: GROUP_A, cardId: null, approval: null}));

  checkPrompts((await f.converse(service, GROUP_A)).recorded, 0);
  checkPrompts((await f.converse(service, GROUP_B)).recorded, 1);

  f.state.wait = true;
  const {recorded} = await f.converse(service, GROUP_A, WAIT, {quiescent: true});
  checkPrompts(recorded, 0, WAIT);
  assert(recorded[0].prompt.includes('Waiting is normal.'));
});

test('role choice persists across re-open, switches only the chosen group, and cancels without replay or implicit library selection', async t => {
  const f = fixture(t);
  const {service, cards} = f;
  service.stConfigure({characterId: cards[0].id});
  approve(service, GROUP_A, cards[0].id);
  approve(service, GROUP_B, cards[1].id);
  await f.connect(service);
  const previous = await f.converse(service, GROUP_A, '旧角色公开背景，只在旧人设内');
  checkPrompts(previous.recorded, 0, '旧角色公开背景，只在旧人设内');
  await service.disconnect();

  const next = f.create().service;
  assert.deepEqual(new Map(next.snapshot().qq.groups.roles.map(role => [role.groupId, role.cardId])),
    new Map([[GROUP_A, cards[0].id], [GROUP_B, cards[1].id]]));
  await f.connect(next);
  checkPrompts((await f.converse(next, GROUP_A)).recorded, 0);
  await next.disconnect();

  approve(next, GROUP_A, cards[1].id);
  await f.connect(next);
  f.frame(GROUP_A, '旧角色公开背景，只在旧人设内', previous.rawId);
  const switched = (await f.converse(next, GROUP_A)).recorded;
  checkPrompts(switched, 1);
  assert(switched.every(({prompt}) => !prompt.includes('旧角色公开背景，只在旧人设内')));
  checkPrompts((await f.converse(next, GROUP_B)).recorded, 1);
  await next.disconnect();

  next.groupRoleSet({groupId: GROUP_A, cardId: null, approval: null});
  await f.connect(next);
  checkPrompts((await f.converse(next, GROUP_A)).recorded, null);
  checkPrompts((await f.converse(next, GROUP_B)).recorded, 1);
});

test('public card changes require fresh review and cannot implicitly disclose content on reconnect', async t => {
  const f = fixture(t);
  const {service, library, cards} = f;
  approve(service, GROUP_A, cards[0].id);
  approve(service, GROUP_B, cards[1].id);

  // Private edits do not change the approved public projection.
  library.update(cards[0].id, {creatorNotes: '编辑后的另一条私记'});
  await f.connect(service);
  checkPrompts((await f.converse(service, GROUP_A)).recorded, 0);
  await service.disconnect();

  const stale = service.groupRolePreview({groupId: GROUP_A, cardId: cards[0].id});
  const changed = '没有批准的新角色描述';
  library.update(cards[0].id, {description: changed});
  assert.throws(() => service.groupRoleSet({groupId: GROUP_A, cardId: cards[0].id, approval: stale.approval}));
  await f.connect(service);
  f.frame(GROUP_A);
  const other = await f.converse(service, GROUP_B);
  checkPrompts(other.recorded, 1);
  assert(f.calls.every(({prompt}) => !prompt.includes(changed)));
  await service.disconnect();

  approve(service, GROUP_A, cards[0].id);
  await f.connect(service);
  const revised = await f.converse(service, GROUP_A);
  assert(revised.recorded.every(({prompt}) => prompt.includes(changed) && !prompt.includes(descriptions[0])));
});

test('expected QQ account and saved allowlist are required, and an old account or removed group does not inherit approvals', async t => {
  const f = fixture(t, {saveAccount: false});
  const {service, cards} = f;
  const cardId = cards[0].id;
  assert.throws(() => service.groupRolePreview({groupId: GROUP_A, cardId}));
  service.configure({qqAccountId: ACCOUNT});
  assert.throws(() => service.groupRolePreview({groupId: '99991111', cardId}));
  assert.throws(() => service.groupRolePreview({groupId: GROUP_A, cardId, expectedAccountId: OTHER_ACCOUNT}),
    {code: 'group_role_scope'});
  approve(service, GROUP_A, cardId);
  approve(service, GROUP_B, cards[1].id);

  f.state.accountId = OTHER_ACCOUNT;
  await service.connect();
  assert.equal(service.status, 'disconnected');
  assert.equal(f.calls.length, 0);
  assert.equal(f.outbound.length, 0);
  f.state.accountId = ACCOUNT;
  service.configure({qqGroups: groups([GROUP_B])});
  service.configure({qqGroups: groups([GROUP_A, GROUP_B])});
  await f.connect(service);
  checkPrompts((await f.converse(service, GROUP_A)).recorded, null);
  checkPrompts((await f.converse(service, GROUP_B)).recorded, 1);
  await service.disconnect();

  f.state.accountId = OTHER_ACCOUNT;
  service.configure({qqAccountId: OTHER_ACCOUNT});
  await f.connect(service);
  checkPrompts((await f.converse(service, GROUP_B)).recorded, null);
});

const LORE_KEY = '北塔秘钟';
const LORE_QUESTION = '你记得北塔秘钟什么时候响吗？';
const PUBLIC_LORE = ['群用背景：落潮前敲七声钟。', '群用背景：塔顶常亮琥珀色灯。'];
const UNMATCHED_LORE = '群用背景：东码头停着绿船。';
const PRIVATE_LORE = '仅 App 世界书：箱底是一张蓝纸。';
const EMBEDDED_LORE = '仅卡片内嵌世界书：织带藏着红石。';
const entry = (key, content, extensions) => ({keys: [key], content, enabled: true, ...(extensions ? {extensions} : {})});
const scopeForGroup = groupId => ({expectedAccountId: ACCOUNT, groupId});

function approveLore(service, groupId, bookId) {
  const draft = service.groupLorebookPreview({...scopeForGroup(groupId), bookId});
  assert.equal(typeof draft.approval, 'string');
  assert(draft.approval.length > 0);
  assert.equal(typeof draft.roleId, 'string');
  service.groupLorebookSet({...scopeForGroup(groupId), bookId, roleId: draft.roleId, approval: draft.approval});
  return draft;
}

function selectedBooks(service) {
  const summary = service.snapshot().qq.groups.lorebooks;
  assert(Array.isArray(summary));
  return new Map(summary.map(row => [row.groupId, row.bookId]));
}

function loreAssertions(recorded, {present = [], absent = []} = {}) {
  for (const {prompt, options, permission} of recorded) {
    assert.equal(options.conversationOnly, true);
    assert.deepEqual(permission, {allow: false});
    for (const marker of present) {
      assert(prompt.includes(marker), 'missing world-book entry: ' + marker);
      assert.equal(prompt.split(marker).length, 2, 'a triggered entry is projected exactly once');
    }
    for (const marker of absent) assert(!prompt.includes(marker), 'unexpected world-book entry: ' + marker);
  }
}

test('K05 approves a standalone book for one group and exposes exactly two hits to gate and reply', async t => {
  const f = fixture(t, {embeddedEntry: entry(LORE_KEY, EMBEDDED_LORE)});
  const {service, cards, lorebooks} = f;
  const shared = lorebooks.add({name: '合成别名群世界书', book: book([
    ...PUBLIC_LORE.map(content => entry(LORE_KEY, content)),
    entry('东码头', UNMATCHED_LORE),
  ])});
  const privateBook = lorebooks.add({name: '合成 App 私用世界书', book: book([entry(LORE_KEY, PRIVATE_LORE)])});

  service.stConfigure({characterId: cards[0].id, lorebookIds: [shared.id, privateBook.id]});
  await service.localStart();
  const beginning = f.calls.length;
  assert.equal((await service.localReply(LORE_QUESTION)).outcome, 'reply_ended');
  const app = f.calls.slice(beginning);
  assert.equal(app.length, 1);
  loreAssertions(app, {present: [...PUBLIC_LORE, PRIVATE_LORE, EMBEDDED_LORE], absent: [UNMATCHED_LORE]});
  await service.localStop();

  approve(service, GROUP_A, cards[0].id);
  approve(service, GROUP_B, cards[0].id);
  const consent = approveLore(service, GROUP_A, shared.id);
  assert.equal(consent.roleId, 'card-' + cards[0].id);
  assert.throws(() => service.groupLorebookSet({...scopeForGroup(GROUP_B),
    bookId: shared.id, roleId: consent.roleId, approval: consent.approval,
  }), {code: 'group_lorebook_changed'});
  assert.deepEqual(selectedBooks(service), new Map([[GROUP_A, shared.id]]));

  await f.connect(service);
  const noLore = [...PUBLIC_LORE, UNMATCHED_LORE, PRIVATE_LORE, EMBEDDED_LORE];
  const untriggered = await f.converse(service, GROUP_A, '聊聊今天的云。');
  loreAssertions(untriggered.recorded, {absent: noLore});
  const activated = await f.converse(service, GROUP_A, LORE_QUESTION);
  loreAssertions(activated.recorded, {present: PUBLIC_LORE, absent: [UNMATCHED_LORE, PRIVATE_LORE, EMBEDDED_LORE]});
  assert(activated.recorded.every(({prompt}) => prompt.includes(descriptions[0]) && prompt.includes(LORE_QUESTION)));
  const otherGroup = await f.converse(service, GROUP_B, LORE_QUESTION);
  loreAssertions(otherGroup.recorded, {absent: noLore});
  assert(otherGroup.recorded.every(({prompt}) => prompt.includes(descriptions[0]) && prompt.includes(LORE_QUESTION)));
  loreAssertions(await f.conversePrivate(service, LORE_QUESTION), {absent: noLore});
  assert.throws(() => service.groupLorebookSet({...scopeForGroup(GROUP_A),
    bookId: shared.id, roleId: consent.roleId, approval: null,
  }), /disconnect/i);
});

test('K05 editing, re-reviewing, deleting, and clearing a selected book fail closed without stopping group chat', async t => {
  const f = fixture(t);
  const {service, cards, lorebooks} = f;
  const original = PUBLIC_LORE[0], changed = '新审阅后才可公开：塔顶只亮白灯。';
  const shared = lorebooks.add({name: '合成可撤回世界书', book: book([entry(LORE_KEY, original)])});
  approve(service, GROUP_A, cards[0].id);
  const consent = approveLore(service, GROUP_A, shared.id);
  await f.connect(service);
  const derived = '合成模型已发送的旧世界书派生句。';
  f.state.reply = prompt => prompt.includes(original) ? derived : '';
  const first = await f.converse(service, GROUP_A, LORE_QUESTION);
  const sent = f.outbound.at(-1).message.at(-1).data.text;
  assert.equal(sent, derived, 'the approved original must produce an actual accepted reply');
  loreAssertions(first.recorded, {present: [original], absent: [changed]});
  f.state.reply = null;
  const quoted = [
    {type: 'reply', data: {id: first.receipt}},
    {type: 'text', data: {text: LORE_QUESTION}},
  ];
  const beforeEdit = await f.converse(service, GROUP_A, quoted);
  assert(beforeEdit.recorded.every(({prompt}) => prompt.includes(derived)), 'the accepted original reply is visible before revocation');

  lorebooks.update(shared.id, {book: book([entry(LORE_KEY, changed)])});
  const afterEdit = await f.converse(service, GROUP_A, quoted);
  loreAssertions(afterEdit.recorded, {absent: [original, changed, derived]});
  await service.disconnect();
  assert.throws(() => service.groupLorebookSet({...scopeForGroup(GROUP_A),
    bookId: shared.id, roleId: consent.roleId, approval: consent.approval,
  }));
  approveLore(service, GROUP_A, shared.id);
  await f.connect(service);
  loreAssertions((await f.converse(service, GROUP_A, LORE_QUESTION)).recorded, {present: [changed], absent: [original]});

  assert.deepEqual(lorebooks.remove(shared.id), {removed: true});
  loreAssertions((await f.converse(service, GROUP_A, LORE_QUESTION)).recorded, {absent: [original, changed]});
  await service.disconnect();
  service.groupLorebookSet({...scopeForGroup(GROUP_A), bookId: shared.id, roleId: consent.roleId, approval: null});
  assert.deepEqual(selectedBooks(service), new Map());
  await f.connect(service);
  loreAssertions((await f.converse(service, GROUP_A, LORE_QUESTION)).recorded, {absent: [original, changed]});
});

test('K05 another role or removing and re-adding an allowed group does not resurrect old approval', async t => {
  const f = fixture(t);
  const {service, cards, lorebooks} = f;
  const shared = lorebooks.add({name: '合成按群和角色限定的世界书', book: book([entry(LORE_KEY, PUBLIC_LORE[0])])});
  assert.throws(() => service.groupLorebookPreview({...scopeForGroup('99991111'), bookId: shared.id}), {code: 'group_role_scope'});
  approve(service, GROUP_A, cards[0].id);
  approveLore(service, GROUP_A, shared.id);
  approve(service, GROUP_B, cards[0].id);
  approveLore(service, GROUP_B, shared.id);
  assert.throws(() => service.groupLorebookPreview({expectedAccountId: OTHER_ACCOUNT, groupId: GROUP_A, bookId: shared.id}), {code: 'group_role_scope'});
  approve(service, GROUP_A, cards[0].id);
  assert.deepEqual(selectedBooks(service), new Map([[GROUP_A, shared.id], [GROUP_B, shared.id]]));
  approve(service, GROUP_A, cards[1].id);
  assert.deepEqual(selectedBooks(service), new Map([[GROUP_B, shared.id]]));

  approve(service, GROUP_A, cards[0].id);
  await f.connect(service);
  loreAssertions((await f.converse(service, GROUP_A, LORE_QUESTION)).recorded, {absent: PUBLIC_LORE});
  await service.disconnect();
  approveLore(service, GROUP_A, shared.id);
  service.configure({qqGroups: groups([GROUP_B])});
  service.configure({qqGroups: groups([GROUP_A, GROUP_B])});
  approve(service, GROUP_A, cards[0].id);
  assert.deepEqual(selectedBooks(service), new Map([[GROUP_B, shared.id]]));
  await f.connect(service);
  loreAssertions((await f.converse(service, GROUP_A, LORE_QUESTION)).recorded, {absent: PUBLIC_LORE});
  loreAssertions((await f.converse(service, GROUP_B, LORE_QUESTION)).recorded, {present: [PUBLIC_LORE[0]]});
});

test('K05 a cold restart restores sticky state only for its exact group, role, and approval version', async t => {
  const f = fixture(t);
  const {service, cards, lorebooks} = f;
  const mark = '合成黏着条目：暂时举起蓝旗。';
  const shared = lorebooks.add({name: '合成黏着世界书', book: book([
    entry(LORE_KEY, mark, {sticky: 5, scan_depth: 1}),
  ])});
  for (const groupId of [GROUP_A, GROUP_B]) {
    approve(service, groupId, cards[0].id);
    approveLore(service, groupId, shared.id);
  }
  await f.connect(service);
  loreAssertions((await f.converse(service, GROUP_A, LORE_QUESTION)).recorded, {present: [mark]});
  loreAssertions((await f.converse(service, GROUP_B, '新来的群友打招呼。')).recorded, {absent: [mark]});
  const sameGroup = await f.converse(service, GROUP_A, '新来的群友打招呼。', {senderId: '44443334'});
  loreAssertions(sameGroup.recorded, {present: [mark]});
  const timingRoot = service.groupRoute.root;
  await service.disconnect();

  const persisted = fs.readdirSync(timingRoot).filter(name => /^world-info-[a-f0-9]{64}\.json$/.test(name)).map(name => {
    const raw = fs.readFileSync(path.join(timingRoot, name), 'utf8');
    for (const content of [mark, LORE_KEY, LORE_QUESTION, '新来的群友打招呼。', '合成群聊回复。']) assert(!raw.includes(content));
    const record = JSON.parse(raw);
    assert.deepEqual(Object.keys(record).sort(), ['revision', 'schema', 'scope', 'state']);
    assert.deepEqual(Object.keys(record.state.effects).sort(), ['cooldown', 'sticky', 'turn']);
    return record;
  });
  assert.equal(persisted.length, 2);
  assert.equal(persisted.filter(record => Object.keys(record.state.effects.sticky).length > 0).length, 1);

  const cold = f.create().service;
  await f.connect(cold);
  loreAssertions((await f.converse(cold, GROUP_B, '另一群重启后的第一条消息。')).recorded, {absent: [mark]});
  loreAssertions((await f.converse(cold, GROUP_A, '原群重启后的第一条消息。')).recorded, {present: [mark]});
  // Renew the effect so its ordinary expiration cannot explain the result after revocation.
  loreAssertions((await f.converse(cold, GROUP_A, LORE_QUESTION)).recorded, {present: [mark]});
  await cold.disconnect();

  const original = cold.groupLorebookPreview({...scopeForGroup(GROUP_A), bookId: shared.id});
  cold.groupLorebookSet({...scopeForGroup(GROUP_A), bookId: shared.id, roleId: original.roleId, approval: null});
  const renewed = approveLore(cold, GROUP_A, shared.id);
  assert.deepEqual(renewed.review, original.review, 'the same exact world-book bytes are approved again');
  const afterRevoke = f.create().service;
  await f.connect(afterRevoke);
  loreAssertions((await f.converse(afterRevoke, GROUP_A, '撤回后重新批准时的普通消息。')).recorded, {absent: [mark]});
  loreAssertions((await f.converse(afterRevoke, GROUP_A, LORE_QUESTION)).recorded, {present: [mark]});
  await afterRevoke.disconnect();

  approve(afterRevoke, GROUP_A, cards[1].id);
  approveLore(afterRevoke, GROUP_A, shared.id);
  const otherRole = f.create().service;
  await f.connect(otherRole);
  const turn = await f.converse(otherRole, GROUP_A, '换了同名角色后的普通消息。');
  loreAssertions(turn.recorded, {absent: [mark]});
  checkPrompts(turn.recorded, 1, '换了同名角色后的普通消息。');
});

test('K05 two approved books with equal entry IDs recurse together and a per-book revoke preserves the other', async t => {
  const f = fixture(t);
  const {service, cards, lorebooks} = f;
  const firstText = '群用入口：钟楼后面有一条槐树小径。';
  const secondText = '群用规则：要按两下青铜铃。';
  const derived = '合成可撤旧回复：先沿着树影小路走。';
  const make = (name, key, content) => lorebooks.add({name, book: {
    ...book([{...entry(key, content), id: 1}]), recursiveScanning: true,
  }});
  const tower = make('合成公开钟楼', '钟楼', firstText);
  const bell = make('合成公开铃', '槐树小径', secondText);
  const diary = make('合成私用日记', '钟楼', PRIVATE_LORE);

  // The private book deliberately has the initial trigger, but belongs to App.
  service.stConfigure({characterId: cards[0].id, lorebookIds: [diary.id]});
  approve(service, GROUP_A, cards[0].id);
  const towerApproval = approveLore(service, GROUP_A, tower.id);
  approveLore(service, GROUP_A, bell.id);
  const bookIds = () => service.snapshot().qq.groups.lorebooks.filter(row => row.groupId === GROUP_A).map(row => row.bookId).sort();
  assert.deepEqual(bookIds(), [tower.id, bell.id].sort());
  await f.connect(service);

  f.state.reply = prompt => prompt.includes(firstText) ? derived : '';
  const first = await f.converse(service, GROUP_A, '钟楼后面该往哪儿走？');
  loreAssertions(first.recorded, {present: [firstText, secondText], absent: [PRIVATE_LORE]});
  assert.equal(f.outbound.at(-1).message.at(-1).data.text, derived);
  f.state.reply = null;

  await service.disconnect();
  service.groupLorebookSet({...scopeForGroup(GROUP_A), bookId: tower.id, roleId: towerApproval.roleId, approval: null});
  assert.deepEqual(bookIds(), [bell.id]);
  await f.connect(service);
  const oldKeyword = await f.converse(service, GROUP_A, [
    {type: 'reply', data: {id: first.receipt}},
    {type: 'text', data: {text: '这座钟楼附近是什么？'}},
  ]);
  loreAssertions(oldKeyword.recorded, {absent: [firstText, secondText, PRIVATE_LORE, derived]});
  const bRemains = await f.converse(service, GROUP_A, '我到槐树小径了，下一步呢？');
  loreAssertions(bRemains.recorded, {present: [secondText], absent: [firstText, PRIVATE_LORE, derived]});
});

test('K05 native App books with long content or 500 entries can be reviewed through their last group page', async t => {
  const f = fixture(t);
  const {service, cards, lorebooks} = f;
  approve(service, GROUP_A, cards[0].id);
  const lastMarkers = [];
  const unrelatedMarkers = [];
  const questions = [];
  for (const entryCount of [8, 65, 500]) {
    const keyAt = index => `合成线索[${entryCount}-${index}]`;
    const markerAt = index => `群用条目内容[${entryCount}-${index}]`;
    const lastIndex = entryCount - 1;
    const entries = Array.from({length: entryCount}, (_, index) => ({
      ...entry(keyAt(index), markerAt(index) + (entryCount === 8 && index !== lastIndex ? '甲'.repeat(2200) : ''),
        {scan_depth: 1}),
      id: index + 1,
    }));
    if (entryCount === 8) assert(entries.reduce((count, item) => count + item.content.length, 0) > 15000);
    const saved = lorebooks.add({name: `合成可分页世界书 ${entryCount}`, book: book(entries)});
    const question = `请说明${keyAt(lastIndex)}。`;
    questions.push(question);
    lastMarkers.push(markerAt(lastIndex));
    unrelatedMarkers.push(markerAt(0));

    service.stConfigure({characterId: cards[0].id, lorebookIds: [saved.id]});
    await service.localStart();
    const begin = f.calls.length;
    assert.equal((await service.localReply(question)).outcome, 'reply_ended');
    assert.equal(f.calls.length, begin + 1);
    loreAssertions(f.calls.slice(begin), {present: [markerAt(lastIndex)], absent: [markerAt(0)]});
    await service.localStop();

    const scope = {...scopeForGroup(GROUP_A), bookId: saved.id};
    const first = service.groupLorebookPreview(scope);
    const lastPage = Math.floor(lastIndex / 10);
    const last = service.groupLorebookPreview({...scope, page: lastPage});
    assert.equal(first.enabledEntries, entryCount);
    assert.equal(first.review.length, Math.min(entryCount, 10));
    assert.equal(first.review[0].content, entries[0].content);
    assert.equal(last.page, lastPage);
    assert.equal(last.pageCount, lastPage + 1);
    assert.equal(last.review.length, entryCount - lastPage * 10);
    assert.equal(last.review.at(-1).id, entryCount);
    assert.equal(last.review.at(-1).content, markerAt(lastIndex));
    assert.equal(last.approval, first.approval);
    service.groupLorebookSet({...scope, roleId: last.roleId, approval: last.approval});
  }

  await f.connect(service);
  const turn = await f.converse(service, GROUP_A, questions.join(' '));
  loreAssertions(turn.recorded, {present: lastMarkers, absent: unrelatedMarkers});
});

test('K05 snapshots share cold validation and do not reread unmodified world books across five groups', t => {
  const f = fixture(t);
  const {service, cards, lorebooks} = f;
  const groupIds = [GROUP_A, GROUP_B, '55556667', '55556668', '55556669'];
  const entries = Array.from({length: 300}, (_, index) => entry(`合成查找词${index}`, `合成世界书内容${index}`));
  const books = Array.from({length: 10}, (_, index) => lorebooks.add({name: `合成快照世界书 ${index}`, book: book(entries)}));
  service.configure({qqGroups: groups(groupIds)});
  for (const groupId of groupIds) {
    approve(service, groupId, cards[0].id);
    for (const saved of books) approveLore(service, groupId, saved.id);
  }

  const fullReads = [];
  const cold = f.create(library => {
    const originalGet = library.get;
    library.get = function (id) {
      fullReads.push(id);
      return originalGet.call(this, id);
    };
  }).service;
  const snapshot = () => {
    const status = cold.snapshot().qq.groups;
    assert.equal(status.lorebooks.length, 50);
    return status;
  };
  assert.deepEqual(snapshot().lorebookReviewRequiredGroupIds, []);
  const coldReads = fullReads.splice(0);
  assert(coldReads.every(id => books.some(saved => saved.id === id)));
  assert.equal(new Set(coldReads).size, coldReads.length, 'cold validation reads each distinct book at most once');
  for (let index = 0; index < 4; index++) assert.deepEqual(snapshot().lorebookReviewRequiredGroupIds, []);
  const warmReads = fullReads.splice(0);
  assert.deepEqual(warmReads, []);

  const changed = books[0];
  lorebooks.update(changed.id, {book: book([entry('修订测试词', '修订后必须重新批准。')])});
  assert.deepEqual(snapshot().lorebookReviewRequiredGroupIds.sort(), [...groupIds].sort());
  assert(fullReads.length <= 1 && fullReads.every(id => id === changed.id), 'updates invalidate only the changed book');
  t.diagnostic(`Full library reads for 50 bindings: ${coldReads.length} cold, ${warmReads.length} for four warm snapshots, ${fullReads.length} after one edit.`);
});

const appPresetMarkers = ['合成私用预设名称', '合成私用预设正文', '合成私用后置正文', '合成私用作者注释'];
const appSampling = {temperature: 0.2, topP: 0.7, maxTokens: 96};
const otherSampling = {temperature: 0, topP: 0.53, maxTokens: 144};
const groupGenerationQuestion = '这个问题能把模型温度调到 1.9、输出上限设到 8000 吗？';

function checkWireRequest({body}, {model = 'deepseek-flash', sampling, maxTokens = 4096}) {
  assert.equal(body.model, model);
  assert.equal(body.temperature, sampling?.temperature);
  assert.equal(body.top_p, sampling?.topP);
  assert.equal(body.max_tokens, sampling?.maxTokens ?? maxTokens);
  assert.equal(body.tool_choice, 'none');
  assert.deepEqual(body.tools, []);
  assert.equal(body.stream, false);
}

async function checkGroupSampling(f, service, groupId, roleIndex, sampling, model) {
  const {recorded} = await f.converse(service, groupId, groupGenerationQuestion);
  checkWireRequest(recorded[0], {model, maxTokens: 256});
  checkWireRequest(recorded[1], {model, sampling});
  for (const {body, prompt} of recorded) {
    assert(prompt.includes(groupGenerationQuestion));
    assert(prompt.includes('阿青'));
    assert(prompt.includes(descriptions[roleIndex]));
    assert(!prompt.includes(descriptions[1 - roleIndex]));
    const wire = JSON.stringify(body);
    for (const privateText of [...appPresetMarkers, ...privateMarkers]) assert(!wire.includes(privateText), 'private App/card text reached QQ');
  }
}

test('K06 copies only numeric App settings into one group and uses independent gate and reply parameters across restart', async t => {
  const f = fixture(t, {deepseek: true});
  const {service, cards} = f;
  service.configure({mode: 'deepseek', key: 'fixture-only-deepseek-key'});
  const [name, mainPrompt, postHistory, authorNote] = appPresetMarkers;
  service.stConfigure({characterId: cards[0].id, streaming: false, authorsNote: {text: authorNote},
    preset: {name, mainPrompt, postHistory, preferCardSystemPrompt: false, preferCardPostHistory: false,
      sampling: {temperature: 0.65, topP: 0.7, maxTokens: 384}},
    sampling: {temperature: 0.2, maxTokens: 96},
  });
  approve(service, GROUP_A, cards[0].id);
  approve(service, GROUP_B, cards[1].id);
  const scopeA = {...scopeForGroup(GROUP_A), roleId: 'card-' + cards[0].id};
  const scopeB = {...scopeForGroup(GROUP_B), roleId: 'card-' + cards[1].id};
  const appSettings = service.stSnapshot().settings;
  const draft = service.groupGenerationPreset(scopeA);
  assert.deepEqual(draft, {groupId: GROUP_A, roleId: scopeA.roleId, sampling: appSampling});
  for (const input of [
    {...scopeA, sampling: {...appSampling, mainPrompt}},
    {...scopeA, sampling: appSampling, postHistory},
    {...scopeA, sampling: {maxTokens: '96'}},
    {...scopeA, sampling: {temperature: 2.1}},
    {...scopeA, sampling: appSampling, expectedAccountId: OTHER_ACCOUNT},
    {...scopeA, sampling: appSampling, groupId: '99991111'},
    {...scopeA, sampling: appSampling, roleId: scopeB.roleId},
  ]) assert.throws(() => service.groupGenerationSet(input), `accepted invalid group settings: ${Object.keys(input).join(', ')}`);
  service.groupGenerationSet({...scopeA, sampling: draft.sampling});
  service.groupGenerationSet({...scopeB, sampling: otherSampling});
  assert.deepEqual(service.stSnapshot().settings, appSettings);

  const generation = service.snapshot().qq.groups.generation;
  assert.deepEqual(generation.map(row => [row.groupId, row.roleId, row.roleName, row.sampling]).sort(), [
    [GROUP_A, scopeA.roleId, '阿青', appSampling], [GROUP_B, scopeB.roleId, '阿青', otherSampling],
  ]);
  for (const row of generation) {
    assert.deepEqual(Object.keys(row).sort(), ['effective', 'gateMaxTokens', 'groupId', 'roleId', 'roleName', 'sampling', 'unsupported']);
    assert.deepEqual(row.effective, row.sampling);
    assert.deepEqual(row.unsupported, []);
    assert.equal(row.gateMaxTokens, 256);
  }

  await service.localStart();
  const start = f.calls.length;
  assert.equal((await service.localReply(groupGenerationQuestion)).outcome, 'reply_ended');
  assert.equal(f.calls.length, start + 1);
  checkWireRequest(f.calls.at(-1), {sampling: appSampling});
  assert(f.calls.at(-1).prompt.includes(mainPrompt), 'the private preset is active in the actual App request');
  await service.localStop();

  const editedAppSampling = {temperature: 0.44, topP: 0.82, maxTokens: 160};
  service.stConfigure({sampling: editedAppSampling});
  assert.deepEqual(service.groupGenerationPreset(scopeA).sampling, editedAppSampling);
  assert.deepEqual(service.snapshot().qq.groups.generation.find(row => row.groupId === GROUP_A).sampling, appSampling);
  await f.connect(service);
  assert.throws(() => service.groupGenerationSet({...scopeA, sampling: editedAppSampling}), /disconnect/i);
  await checkGroupSampling(f, service, GROUP_A, 0, appSampling);
  await checkGroupSampling(f, service, GROUP_B, 1, otherSampling);
  await service.disconnect();

  const reopened = f.create().service;
  assert.deepEqual(reopened.stSnapshot().settings.sampling, editedAppSampling);
  await f.connect(reopened);
  await checkGroupSampling(f, reopened, GROUP_A, 0, appSampling);
  await reopened.disconnect();
  reopened.configure({deepseekModel: 'deepseek-v4-pro'});
  await f.connect(reopened);
  await checkGroupSampling(f, reopened, GROUP_A, 0, appSampling, 'deepseek-v4-pro');
  await reopened.disconnect();

  reopened.groupGenerationSet({...scopeA, sampling: null});
  assert.deepEqual(reopened.snapshot().qq.groups.generation.find(row => row.groupId === GROUP_A), {
    groupId: GROUP_A, roleId: scopeA.roleId, roleName: '阿青', sampling: {},
    effective: {temperature: null, topP: null, maxTokens: 4096}, unsupported: [], gateMaxTokens: 256,
  });
  await f.connect(reopened);
  await checkGroupSampling(f, reopened, GROUP_A, 0, undefined, 'deepseek-v4-pro');
  await reopened.disconnect();
  reopened.groupGenerationSet({...scopeA, sampling: appSampling});
  approve(reopened, GROUP_A, cards[1].id);
  assert.throws(() => reopened.groupGenerationSet({...scopeA, sampling: appSampling}));
  await f.connect(reopened);
  await checkGroupSampling(f, reopened, GROUP_A, 1, undefined, 'deepseek-v4-pro');
  await checkGroupSampling(f, reopened, GROUP_B, 1, otherSampling, 'deepseek-v4-pro');
  assert.deepEqual(reopened.stSnapshot().settings.sampling, editedAppSampling);
  await reopened.disconnect();
  await reopened.localStart();
  assert.equal((await reopened.localReply(groupGenerationQuestion)).outcome, 'reply_ended');
  checkWireRequest(f.calls.at(-1), {model: 'deepseek-v4-pro', sampling: editedAppSampling});
  assert(f.calls.at(-1).prompt.includes(mainPrompt));
  await reopened.localStop();

  t.diagnostic('DeepSeek request fields in execution order: ' + JSON.stringify(f.calls.map(({body, gate, prompt}) => ({
    stage: gate ? 'gate' : 'reply', model: body.model, temperature: body.temperature ?? null, top_p: body.top_p ?? null,
    max_tokens: body.max_tokens, tool_choice: body.tool_choice, toolCount: body.tools.length, privateAppPrompt: prompt.includes(mainPrompt),
  }))));
});
