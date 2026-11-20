'use strict';

// Production QQClient and group route, with in-process bridge/model stand-ins.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {QQClient} = require('../src/bot/qq.cjs');
const {GroupCompanionRoute} = require('../src/bot/group-companion-route.cjs');
const {SocialStore} = require('../src/bot/social-store.cjs');

const ACCOUNT = '87654321', OWNER = '12345678', A = '44443333', B = '22221111';
const GROUP = '55556666', OTHER = '77778888', NOW = 1800000000000;
const C = '60000333', STRANGER = '61111999', NICKNAME = '两个成员共用的显示名';
const fragment = value => ({type: 'text', data: {text: value}});
const mention = qq => ({type: 'at', data: {qq}});
const quote = id => ({type: 'reply', data: {id, user_id: ACCOUNT}});

class Bridge extends EventEmitter {
  constructor() {
    super();
    this.readyState = 0;
    this.requests = [];
    this.nextOutbound = 5000;
    queueMicrotask(() => {this.readyState = 1;this.emit('open');});
  }
  frame(value) {this.emit('message', JSON.stringify(value), false);}
  send(raw, callback) {
    const request = JSON.parse(raw);
    this.requests.push(request.action);
    callback?.();
    const responses = {
      get_login_info: {user_id: ACCOUNT, nickname: 'Synthetic role'},
      get_status: {online: true, good: true},
      send_group_msg: {message_id: this.nextOutbound++},
    };
    assert(Object.hasOwn(responses, request.action), 'Addressing must use no reference lookup');
    this.frame({status: 'ok', retcode: 0, data: responses[request.action], echo: request.echo});
  }
  terminate() {this.readyState = 3;this.emit('close');}
  ping() {this.emit('pong');}
}

async function fixture(t, {reply = false, debounceMs = 0, persona} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-addressing-'));
  const sockets = [], calls = [], sent = [];
  const client = new QQClient({
    url: 'ws://127.0.0.1:3001/', token: 'synthetic-local-token', ownerId: OWNER,
    groupIds: [GROUP, OTHER], now: () => NOW, timeoutMs: 200, pollTimeoutMs: 5,
    socketFactory: () => {const socket = new Bridge();sockets.push(socket);return socket;},
  });
  const openRoute = (activePersona = persona) => new GroupCompanionRoute({
    root, platform: 'qq-onebot', accountId: ACCOUNT,
    configuration: {enabled: true, groupIds: [GROUP, OTHER], proactive: false},
    persona: activePersona || new SocialStore({root}).config(),
    now: () => NOW, tickMs: 0, flow: {debounceMs, maxBatchMs: debounceMs, bubbleDelayMs: 0},
    createExecute: () => async ({prompt, request}) => {
      assert.deepEqual(await request({tool: 'fixture-denied'}), {allow: false});
      const gate = prompt.includes('Decide whether this character should answer');
      calls.push({gate, prompt});
      return {outcome: 'reply_ended', text: gate ? JSON.stringify({action: reply ? 'message' : 'wait', text: reply ? 'synthetic cue' : ''}) : '合成回复。'};
    },
    send: async (...args) => {
      const receipt = await client.sendGroupText(...args);
      sent.push(receipt);
      return receipt;
    },
  });
  let route = openRoute();
  await client.connect();
  let counter = 0;
  t.after(async () => {
    await route.stop();client.close();fs.rmSync(root, {recursive: true, force: true});
  });
  const frame = (message, {group = GROUP, member = A, rawId = ++counter} = {}) => {
    sockets.at(-1).frame({post_type: 'message', message_type: 'group', sub_type: 'normal',
      self_id: Number(ACCOUNT), user_id: Number(member), group_id: Number(group),
      sender: {user_id: Number(member), nickname: NICKNAME}, time: NOW / 1000, message_id: rawId, message});
    return rawId;
  };
  const flush = async ({drain = true} = {}) => {
    const {messages} = await client.getUpdates();
    for (const row of messages) {
      const result = await route.receive(row);
      assert.equal(result.accepted, true, JSON.stringify({result, problem: route.snapshot().problem}));
    }
    if (drain) await Promise.all([...route.actors.values()].map(actor => actor.engine.whenIdle()));
    return messages;
  };
  const reopen = async activePersona => {await route.stop();route = openRoute(activePersona);};
  return {client, get route(){return route;}, sockets, calls, sent, frame, flush, reopen};
}

function addressing(prompt) {
  const header = prompt.split('\n').find(line => line.startsWith('Group addressing from the bridge'));
  assert(header, 'a real bridge event must carry a separate addressing frame');
  return JSON.parse(header.split(' Data: ')[1]);
}

function observedTargets(prompt) {
  const header = prompt.split('\n').find(line => line.startsWith('Observed quote targets '));
  return header ? JSON.parse(header.slice(header.indexOf(': [') + 2)) : [];
}

function observedMentionTargets(prompt) {
  const header = prompt.split('\n').find(line => line.startsWith('Observed mention targets '));
  return header ? JSON.parse(header.slice(header.indexOf(': [') + 2)) : [];
}

function memberLabel(prompt, historyText) {
  const context = prompt.split('\n').find(line => line.startsWith('{') && line.includes('"groupConversation":'));
  assert(context, 'the model sees the retained public group context');
  const member = JSON.parse(context).groupConversation.find(row => row.kind === 'member' && row.text === historyText);
  assert(member, 'the exact member source is present: ' + historyText);
  assert.match(member.speaker, /^[a-f0-9]{16}$/);
  return member.speaker;
}

function assertPrivateMentionIdsAbsent(prompt) {
  for (const id of [ACCOUNT, OWNER, A, B, C, STRANGER, GROUP, OTHER]) assert(!prompt.includes(id), 'native mention IDs must remain local');
}

function input(prompt) {
  return prompt.match(/\nBEGIN (ARCADE_INPUT_\d+)\n([\s\S]*?)\nEND \1/u)[2];
}

test('paired native self mention, other member, bypass-like typed text and ambient input remain distinct; all may wait', async t => {
  const f = await fixture(t);
  const sameText = '你怎么看？';
  const cases = [
    {parts: [fragment(sameText)], kind: []},
    {parts: [mention(ACCOUNT), fragment(sameText)], kind: ['self']},
    {parts: [mention(B), fragment(sameText)], kind: ['other']},
    {parts: [mention('all'), fragment(sameText)], kind: ['everyone']},
    {parts: [mention('nickname'), fragment(sameText)], kind: ['unknown']},
    {parts: [fragment('@' + ACCOUNT + ' ' + sameText)], kind: []},
  ];
  for (const {parts, kind} of cases) {
    f.frame(parts);
    const [event] = await f.flush();
    const prompt = f.calls.at(-1).prompt;
    const text = input(prompt);
    assert.deepEqual(addressing(prompt), [[0, text.length, kind, 'none']]);
    assert.equal(event.mentioned, kind.includes('self'));
    if (kind.length || parts.length === 1 && !parts[0].data.text.startsWith('@')) assert.equal(text, sameText);
  }
  assert.equal(f.calls.length, cases.length);
  assert.equal(f.sent.length, 0);
  assert(f.calls.every(call => call.gate));
  assert.notEqual(f.calls[0].prompt, f.calls[1].prompt);
});

test('only the tagged part in a natural batch receives the address; another member or group does not inherit it', async t => {
  const f = await fixture(t, {reply: true, debounceMs: 45});
  const first = '先说第一件事\n\n还有一点。';
  const second = '角色，你也说一句。';
  const third = '第三条。';
  f.frame([fragment(first)]);
  f.frame([mention(ACCOUNT), fragment(second)]);
  f.frame([fragment(third)]);
  f.frame([mention(A), fragment('问甲另一件事。')], {member: B});
  f.frame([fragment('另一个群的背景话题。')], {group: OTHER});
  await f.flush();
  const own = f.calls.filter(call => input(call.prompt).startsWith(first));
  assert.equal(own.length, 2, 'the group gate and reply get the same batch');
  for (const {prompt} of own) {
    const body = input(prompt);
    assert.equal(body, [first, second, third].join('\n\n'));
    assert.deepEqual(addressing(prompt).map(([start, end, kind, ref]) => [body.slice(start, end), kind, ref]), [
      [first, [], 'none'], [second, ['self'], 'none'], [third, [], 'none'],
    ]);
  }
  const others = f.calls.filter(call => !own.includes(call));
  assert.equal(others.length, 4);
  for (const {prompt} of others) {
    const body = input(prompt), expected = body.startsWith('问甲') ? ['other'] : [];
    assert.deepEqual(addressing(prompt), [[0, body.length, expected, 'none']]);
  }
  assert.doesNotMatch(JSON.stringify(f.route.actor(GROUP, A).engine.snapshot()), /Group addressing from the bridge/);
});

test('a quote resolves only to a locally observed author or confirmed same-group send on the current bridge', async t => {
  const f = await fixture(t, {reply: true});
  const human = f.frame([fragment('先聊一本书。')]);
  await f.flush();
  const ai = f.sent[0].id;
  for (const scenario of [
    {id: ai, reference: 'self'},
    {id: human, reference: 'other'},
    {id: ai, group: OTHER, reference: 'unknown'},
    {id: '98765', reference: 'unknown'},
  ]) {
    f.frame([quote(scenario.id), fragment('接着这句话说。')], {group: scenario.group, member: B});
    const [event] = await f.flush();
    assert.equal(event.addressing.reference, scenario.reference);
    const prompt = f.calls.at(-1).prompt;
    assert.deepEqual(addressing(prompt), [[0, input(prompt).length, [], scenario.reference]]);
  }
  f.sockets.at(-1).terminate();
  await f.client.connect();
  f.frame([quote(ai), fragment('重连后的旧引用。')]);
  const [after] = await f.flush();
  assert.equal(after.addressing.reference, 'unknown');
  assert.deepEqual(observedTargets(f.calls.at(-1).prompt), [{row: 0, speaker: 'self', text: '合成回复。'}]);
  assert(f.sockets.every(socket => !socket.requests.includes('get_msg')));
});

test('maximum natural batch carries native addressing within the existing prompt budget', async t => {
  const f = await fixture(t, {reply: true, debounceMs: 45, persona: {
    characterId: 'claude-ju', name: '名'.repeat(40), description: '描述'.repeat(400),
    speechExamples: [{user:'范'.repeat(240),assistant:'文'.repeat(240)},{user:'甲'.repeat(25),assistant:'乙'.repeat(30)}],
  }});
  for (let i = 0; i < 8; i++) {
    f.frame([mention(ACCOUNT), mention('all'), mention(B), mention('unknown'), fragment(String(i) + '文'.repeat(346))]);
  }
  await f.flush();
  assert.equal(f.calls.length, 2);
  for (const {prompt} of f.calls) {
    assert.equal(addressing(prompt).length, 8);
    assert(prompt.length <= 6000, 'the gate and formal reply both fit the model input budget: '+prompt.length);
  }
  assert.equal(f.sent.length, 1);
});


test('the same quoted reply resolves to the exact observed proposal in both model steps', async t => {
  const proposals = ['周六上午去海边公园。', '周日下午去市图书馆。'];
  for (const [selected, text] of proposals.entries()) {
    const f = await fixture(t, {reply: true});
    for (const [index, suggestion] of proposals.entries()) {
      f.frame([fragment(suggestion)], {rawId: index === selected ? 41 : 42});
      await f.flush();
    }
    f.frame([quote(41), fragment('我选这个，你呢？')], {member: B, rawId: 43});
    await f.flush();
    const pair = f.calls.slice(-2);
    assert.deepEqual(pair.map(call => call.gate), [true, false]);
    for (const {prompt} of pair) {
      assert(proposals.every(proposal => prompt.includes(proposal)), 'plain shared context contains both suggestions');
      const targets = observedTargets(prompt);
      assert.equal(targets.length, 1);
      assert.equal(targets[0].text, text);
      assert.equal(targets[0].row, 0);
      assert.match(targets[0].speaker, /^[a-f0-9]{16}$/, 'typed sender payload cannot impersonate the companion');
      assert.equal(addressing(prompt)[0][3], 'other');
    }
  }
});

test('quote targets can survive cold route reopen, never cross groups or return through a forget', async t => {
  const f = await fixture(t);
  const active = '仍然有效的港口计划。';
  f.frame([fragment(active)], {rawId: 81});
  await f.flush();
  const ask = async (id, group = GROUP) => {
    f.frame([quote(id), fragment('我说的是那条。')], {member: B, group});
    const [event] = await f.flush();
    return {event, prompt: f.calls.at(-1).prompt};
  };
  const cross = await ask(81, OTHER);
  assert.deepEqual(observedTargets(cross.prompt), []);
  assert.doesNotMatch(cross.prompt, /港口计划/);
  assert.deepEqual(observedTargets((await ask(9933)).prompt), []);
  f.sockets.at(-1).terminate();
  await f.client.connect();
  await f.reopen();
  const reopened = await ask(81);
  assert.equal(reopened.event.addressing.reference, 'unknown');
  assert.equal(addressing(reopened.prompt)[0][3], 'other');
  assert.equal(observedTargets(reopened.prompt)[0].text, active);

  f.frame([fragment('记住：我的测试偏好。')]);await f.flush();
  const actor = f.route.actor(GROUP, A);
  const fact = actor.store.facts(actor.scope, 1)[0];
  assert(fact);
  f.frame([fragment('忘记 '+fact.id.slice(0,8))]);await f.flush();
  assert.equal(actor.store.facts(actor.scope, 1).length, 0);
  const forgotten = await ask(81);
  assert.deepEqual(observedTargets(forgotten.prompt), []);
  assert.doesNotMatch(forgotten.prompt, /港口计划/);

  f.frame([quote(90), fragment('不能把我现在的话当成被引用的历史。')], {member: B, rawId: 90});
  await f.flush();
  assert.deepEqual(observedTargets(f.calls.at(-1).prompt), []);
  assert(f.sockets.every(socket => !socket.requests.includes('get_msg')));
});

test('a contradictory QQ message ID cannot attach either observed text as its quote target', async t => {
  const f = await fixture(t, {reply: true});
  f.frame([fragment('起始消息。')], {rawId: 101});
  await f.flush();
  const ambiguous = f.sent[0].id;
  f.frame([fragment('合成冲突 ID 的成员消息。')], {member: B, rawId: ambiguous});
  await f.flush();
  f.frame([quote(ambiguous), fragment('接着这句。')], {member: A, rawId: 102});
  const [event] = await f.flush();
  assert.equal(event.addressing.quoteConflict, true);
  for (const {prompt} of f.calls.slice(-2)) {
    assert.equal(addressing(prompt)[0][3], 'unknown');
    assert.deepEqual(observedTargets(prompt), []);
  }
});

test('otherwise identical native mentions resolve exact durable speaker labels for two same-name members', async t => {
  const first = '我想去海边看落日。';
  const second = '我想去旧城看钟楼。';
  const question = '刚才提到的那个人想去哪儿？';
  const paired = [];
  for (const [index, selected] of [A, B].entries()) {
    const f = await fixture(t, {reply: true});
    f.frame([fragment(first)], {member: A});
    await f.flush();
    f.frame([fragment(second)], {member: B});
    await f.flush();
    f.frame([mention(ACCOUNT), mention(selected), fragment(question)], {member: C});
    await f.flush();
    const pair = f.calls.slice(-2);
    assert.deepEqual(pair.map(row => row.gate), [true, false]);
    for (const {prompt} of pair) {
      const labels = [memberLabel(prompt, first), memberLabel(prompt, second)];
      assert.notEqual(labels[0], labels[1]);
      assert.equal(input(prompt), question);
      assert.deepEqual(addressing(prompt), [[0, question.length, ['self', 'other'], 'none']]);
      assert.deepEqual(observedMentionTargets(prompt), [{row: 0, at: 1, speaker: labels[index]}]);
      assertPrivateMentionIdsAbsent(prompt);
      assert(!prompt.includes(NICKNAME));
    }
    assert(f.sockets.every(socket => !socket.requests.includes('get_msg')));
    paired.push(pair);
  }
  for (const index of [0, 1]) {
    const [a, b] = paired.map(pair => pair[index].prompt);
    assert.notDeepEqual(observedMentionTargets(a), observedMentionTargets(b));
    const withoutTargets = prompt => prompt.split('\n').filter(line => !line.startsWith('Observed mention targets ')).join('\n');
    assert.equal(withoutTargets(a), withoutTargets(b), 'the two requests differ only in the exact native mention target');
  }
});

test('batched mention evidence preserves row and native ordinal, including duplicates, only after public appearance', async t => {
  const f = await fixture(t, {reply: true, debounceMs: 45});
  const knownA = '我先说了海边散步。';
  const knownB = '这是乙第一条公开的聊天内容。';
  f.frame([fragment(knownA)], {member: A});
  await f.flush();
  const early = '这条排在乙出现之前。';
  const late = '这条排在乙出现之后。';
  const typed = '@' + NICKNAME + ' 只在正文里出现。';
  f.frame([mention(B), mention(A), fragment(early)], {member: C});
  f.frame([fragment(knownB)], {member: B});
  f.frame([mention(ACCOUNT), fragment(late), mention(B), mention('nickname'), mention('all'), mention(A), mention(B), mention(STRANGER)], {member: C});
  f.frame([fragment(typed)], {member: C});
  await f.flush();

  const pair = f.calls.filter(({prompt}) => input(prompt).startsWith(early));
  assert.deepEqual(pair.map(row => row.gate), [true, false]);
  for (const {prompt} of pair) {
    const body = input(prompt);
    assert.equal(body, [early, late, typed].join('\n\n'));
    const memberA = memberLabel(prompt, knownA), memberB = memberLabel(prompt, knownB);
    assert.deepEqual(addressing(prompt).map(([start, end, categories]) => [body.slice(start, end), categories]), [
      [early, ['other']], [late, ['self', 'other', 'unknown', 'everyone']], [typed, []],
    ]);
    assert.deepEqual(observedMentionTargets(prompt), [
      {row: 0, at: 1, speaker: memberA},
      {row: 1, at: 1, speaker: memberB}, {row: 1, at: 4, speaker: memberA}, {row: 1, at: 5, speaker: memberB},
    ]);
    assertPrivateMentionIdsAbsent(prompt);
  }

  f.frame([...Array.from({length: 12}, () => mention(ACCOUNT)), mention(A), fragment('提及证据在固定上限处截止。')], {member: C});
  await f.flush();
  for (const {prompt} of f.calls.slice(-2)) {
    assert.deepEqual(addressing(prompt)[0][2], ['self', 'other']);
    assert.deepEqual(observedMentionTargets(prompt), []);
    assertPrivateMentionIdsAbsent(prompt);
  }
});

test('verified mentions favor the newest positions without growing the ordinary group prompt budget', async t => {
  const f = await fixture(t, {reply: true, debounceMs: 45});
  const known = '我先给出一条可见的合成提案。';
  f.frame([fragment(known)], {member: B});
  await f.flush();
  for (let row = 0; row < 8; row++) {
    f.frame([...Array.from({length: 12}, () => mention(B)), fragment(String(row) + '文'.repeat(255))], {member: C});
  }
  await f.flush();
  const pair = f.calls.slice(-2);
  assert.deepEqual(pair.map(row => row.gate), [true, false]);
  for (const {prompt} of pair) {
    assert.equal(addressing(prompt).length, 8);
    assert(prompt.length <= 6000);
    const targets = observedMentionTargets(prompt);
    assert(JSON.stringify(targets).length <= 600);
    assert(targets.every(target => target.row >= 6));
    const speaker = memberLabel(prompt, known);
    assert.deepEqual(targets.filter(target => target.row === 7), Array.from({length: 12}, (_, at) => ({row: 7, at, speaker})));
    assertPrivateMentionIdsAbsent(prompt);
  }
});

test('a native mention can resolve after a same-role cold reopen but not from another group, role or forgotten projection', async t => {
  const f = await fixture(t, {reply: true});
  const known = '这是保留的合成图书馆话题。';
  const question = '这位成员之前聊过什么？';
  f.frame([fragment(known)], {member: B});
  await f.flush();
  const ask = async (group = GROUP) => {
    f.frame([mention(B), fragment(question)], {group, member: C});
    await f.flush();
    const pair = f.calls.slice(-2);
    assert.deepEqual(pair.map(row => row.gate), [true, false]);
    for (const {prompt} of pair) {
      assert.deepEqual(addressing(prompt)[0][2], ['other']);
      assertPrivateMentionIdsAbsent(prompt);
    }
    return pair;
  };
  for (const {prompt} of await ask(OTHER)) {
    assert.deepEqual(observedMentionTargets(prompt), []);
    assert(!prompt.includes(known));
  }
  const selectedPersona = f.route.persona;
  f.sockets.at(-1).terminate();
  await f.client.connect();
  await f.reopen(selectedPersona);
  for (const {prompt} of await ask()) {
    assert.deepEqual(observedMentionTargets(prompt), [{row: 0, at: 0, speaker: memberLabel(prompt, known)}]);
  }
  await f.reopen({...selectedPersona, characterId: 'codex-dragon'});
  for (const {prompt} of await ask()) {
    assert.deepEqual(observedMentionTargets(prompt), []);
    assert(!prompt.includes(known));
  }
  await f.reopen(selectedPersona);
  f.frame([fragment('记住：这是需要删除的合成成员偏好。')], {member: B});
  await f.flush();
  const actor = f.route.actor(GROUP, B);
  const fact = actor.store.facts(actor.scope, 1)[0];
  assert(fact);
  f.frame([fragment('忘记 ' + fact.id.slice(0, 8))], {member: B});
  await f.flush();
  for (const {prompt} of await ask()) {
    assert.deepEqual(observedMentionTargets(prompt), []);
    assert(!prompt.includes(known));
  }
});
