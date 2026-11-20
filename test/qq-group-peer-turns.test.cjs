'use strict';

// Two actual managed companions, independent stores and OneBot clients.
// The socket ring and model responses are synthetic; no network is opened.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {setTimeout: delay} = require('node:timers/promises');
const {AccountManager} = require('../src/bot/account-manager.cjs');
const {BotService} = require('../src/bot/service.cjs');
const {QQClient} = require('../src/bot/qq.cjs');
const {createDeepSeekRunner} = require('../src/bot/deepseek-runner.cjs');
const {GroupPeerTurns} = require('../src/bot/group-peer-turns.cjs');

const A = '700001', B = '700002', OWNER = '700003', HUMAN = '700004';
const GROUP = '800001', OTHER = '800002';
const NAME = '同一个合成显示名';
const PEER_TEXT = '合成搭档接着说同一句话。';
const text = value => ({type: 'text', data: {text: value}});
const mention = account => ({type: 'at', data: {qq: account}});
const isGate = prompt => prompt.includes('Decide whether this character should answer');
const incomingText = prompt => prompt.match(/\nBEGIN (ARCADE_INPUT_\d+)\n([\s\S]*?)\nEND \1/u)[2];

async function until(predicate, message) {
  const deadline = Date.now() + 3500;
  while (!predicate()) {
    assert(Date.now() < deadline, message);
    await delay(3);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(finish => {resolve = finish;});
  return {promise, resolve};
}

async function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-qq-peer-turns-'));
  const now = Math.ceil(Date.now() / 1000) * 1000;
  const sockets = new Map(), services = new Map(), profiles = new Map(), expected = new Map();
  const sends = [], calls = [], relays = [], heldRelays = [], deferredModels = [];
  const humanCues = new Map();
  const state = {round: 0, peerWait: false, holdAfter: null, holdModel: null, cutoff: false};
  let nextId = 500, scheduled = 0, roundStart = 0, eventTime = now;

  const deliver = ({group, sender, id, message, nickname = NAME, target}) => {
    const socket = sockets.get(target), route = services.get(target).groupRoute;
    assert.equal(socket.readyState, 1);
    assert(route);
    if (!expected.has(route)) expected.set(route, new Set());
    expected.get(route).add(`${group}:${id}`);
    socket.frame({post_type: 'message', message_type: 'group', sub_type: 'normal', self_id: Number(target),
      user_id: Number(sender), sender: {user_id: Number(sender), nickname}, group_id: Number(group),
      message_id: id, time: eventTime / 1000, message,
    });
  };

  const relay = entry => {
    const target = entry.author === A ? B : A;
    if (sockets.get(target)?.readyState !== 1) return;
    const accepted = {group: entry.group, sender: entry.author, id: entry.id, message: entry.message,
      target, nickname: state.peerNickname || NAME,
    };
    relays.push(accepted);
    deliver(accepted);
  };

  class Bridge extends EventEmitter {
    constructor(account) {
      super();
      this.account = account;
      this.readyState = 0;
      sockets.set(account, this);
      queueMicrotask(() => {this.readyState = 1;this.emit('open');});
    }
    frame(value) {this.emit('message', JSON.stringify(value), false);}
    send(raw, callback) {
      const {action, echo, params} = JSON.parse(raw);
      const fixed = {
        get_login_info: {user_id: Number(this.account), nickname: NAME},
        get_status: {online: true, good: true},
        get_friend_list: [{user_id: Number(OWNER)}],
      };
      callback?.();
      if (Object.hasOwn(fixed, action)) {
        this.frame({status: 'ok', retcode: 0, echo, data: fixed[action]});
        return;
      }
      assert.equal(action, 'send_group_msg', 'peer turn limits must not query an external identity or message');
      const group = String(params.group_id);
      assert([GROUP, OTHER].includes(group));
      assert.deepEqual(params.message.map(segment => segment.type), ['reply', 'text']);
      assert.equal(params.message[1].data.text, PEER_TEXT);
      const entry = {round: state.round, group, author: this.account, id: ++nextId,
        replyTo: String(params.message[0].data.id), message: params.message,
      };
      sends.push(entry);
      this.frame({status: 'ok', retcode: 0, echo, data: {message_id: entry.id}});
      const index = sends.length - roundStart;
      if (index >= 7) {state.cutoff = true;return;}
      if (state.holdAfter === index) {heldRelays.push(entry);return;}
      scheduled++;
      setImmediate(() => {scheduled--;relay(entry);});
    }
    terminate() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit('close');
    }
    ping() {this.emit('pong');}
  }

  const manager = new AccountManager({root,
    vault: {isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: bytes => bytes.toString()},
    serviceFactory: options => {
      let service;
      service = new BotService({...options,
        deepseekRunnerFactory: runner => createDeepSeekRunner({...runner, fetchImpl: async (_url, request) => {
          const body = JSON.parse(request.body), prompt = body.messages.at(-1).content;
          assert.equal(body.tool_choice, 'none');
          assert.deepEqual(body.tools, []);
          const gate = isGate(prompt), input = incomingText(prompt), source = input === PEER_TEXT ? 'peer' : 'human';
          const account = service.config.qqAccountId;
          let answer;
          if (source === 'peer') answer = !state.peerWait;
          else {
            assert(humanCues.has(input), 'unexpected human input: ' + input);
            const cue = humanCues.get(input);
            const addressing = prompt.split('\n').find(line => line.startsWith('Group addressing from the bridge'));
            answer = cue === 'native' ? JSON.parse(addressing.split(' Data: ')[1]).some(row => row[2].includes('self')) : cue === account;
          }
          calls.push({round: state.round, account, gate, source, input, wait: gate && !answer});
          if (source === 'peer' && account === B && state.holdModel?.gate === gate) {
            const hold = state.holdModel;
            state.holdModel = null;
            hold.entered = true;
            await hold.release.promise;
          }
          const content = gate ? JSON.stringify({action: answer ? 'message' : 'wait', text: answer ? '合成接话理由' : ''}) : PEER_TEXT;
          return Response.json({choices: [{finish_reason: 'stop', message: {role: 'assistant', content}}]});
        }}),
        qqClientFactory: settings => new QQClient({...settings, now: () => eventTime, timeoutMs: 250, pollTimeoutMs: 8,
          socketFactory: () => new Bridge(service.config.qqAccountId),
        }),
      });
      return service;
    },
  });
  t.after(async () => {
    for (const hold of deferredModels) hold.release.resolve();
    await manager.close();
    assert([...sockets.values()].every(socket => socket.readyState === 3));
    fs.rmSync(root, {recursive: true, force: true});
  });
  for (const [index, account] of [A, B].entries()) {
    const service = index === 0 ? manager.current() : manager.add({name: '另一个本机档案'});
    profiles.set(account, manager.selectedId);
    services.set(account, service);
    service.configure({channel: 'qq', mode: 'deepseek', key: 'synthetic-model-key', qqUrl: `ws://127.0.0.1:${41441 + index}/`,
      qqAccountId: account, qqOwnerId: OWNER, qqToken: 'synthetic-connection-token',
      qqGroups: {enabled: true, groupIds: [GROUP, OTHER], proactive: false},
    });
    service.socialConfigure({enabled: true, proactiveMessages: false, qzonePosts: false});
    await manager.connect(manager.selectedId);
    assert.equal(service.status, 'connected', service.problem);
    service.groupRoute.flow = {debounceMs: 0, bubbleDelayMs: 0};
  }
  assert.deepEqual(manager.snapshot().accounts.map(entry => entry.accountId).sort(), [A, B]);

  const waitForDeliveries = () => until(() => [...expected].every(([route, ids]) => route.stopped || route.snapshot().incoming >= ids.size),
    'ordinary group route did not observe all fixture events');
  const settle = async () => {
    for (let index = 0; index < 12; index++) {
      await waitForDeliveries();
      const activity = sends.length + calls.length + relays.length;
      await Promise.all([...services.values()].flatMap(service =>
        [...(service.groupRoute?.actors.values() || [])].map(actor => actor.engine.whenIdle())));
      await new Promise(resolve => setImmediate(resolve));
      if (!scheduled && activity === sends.length + calls.length + relays.length) return;
    }
    assert.fail('the synthetic group did not settle');
  };

  const human = (group, input, {id = ++nextId, targets = [A, B], native, preferred = A} = {}) => {
    humanCues.set(input, native ? 'native' : preferred);
    const event = {group, id, sender: HUMAN, message: [...(native ? [mention(native)] : []), text(input)]};
    for (const target of targets) deliver({...event, target});
    return event;
  };
  const repeated = (event, targets, id = event.id) => {
    for (const target of targets) deliver({...event, id, target, nickname: '换个显示名也还是同一条消息'});
  };
  const nextRound = ({sameSecond = false} = {}) => {
    state.round++;roundStart = sends.length;state.holdAfter = null;
    if (!sameSecond) eventTime += 1000;
  };
  const releaseRelays = () => {for (const entry of heldRelays.splice(0)) relay(entry);};
  const holdPeerModel = gate => {
    const hold = {gate, entered: false, release: deferred()};
    state.holdModel = hold;
    deferredModels.push(hold);
    return hold;
  };
  return {manager, services, profiles, state, sends, calls, relays, heldRelays, settle, human, repeated, nextRound, releaseRelays, holdPeerModel};
}

function assertRound(f, group, initial, authors, {humanGates = 2, peerGates = 2, peerReplies = 2} = {}) {
  const sends = f.sends.filter(row => row.round === f.state.round);
  const calls = f.calls.filter(row => row.round === f.state.round);
  assert.deepEqual(sends.map(row => row.author), authors);
  assert(sends.every(row => row.group === group));
  assert.deepEqual(sends.map(row => row.replyTo), [String(initial.id), ...sends.slice(0, -1).map(row => String(row.id))]);
  assert.equal(calls.filter(row => row.source === 'human' && row.gate).length, humanGates);
  assert.equal(calls.filter(row => row.source === 'human' && !row.gate).length, 1);
  assert.equal(calls.filter(row => row.source === 'peer' && row.gate).length, peerGates);
  assert.equal(calls.filter(row => row.source === 'peer' && !row.gate).length, peerReplies);
  assert.equal(f.state.cutoff, false, 'the watchdog must never stop a correctly bounded peer exchange');
  return {sends, calls};
}

test('two verified companions naturally stop at two shared peer turns, with independent groups and fresh human input', async t => {
  const f = await fixture(t);
  const question = '普通的人类文字开启第一轮。';
  const initial = f.human(GROUP, question);
  await f.settle();
  const first = assertRound(f, GROUP, initial, [A, B, A]);
  assert(f.relays.some(event => event.group === GROUP && event.target === B && event.id === first.sends.at(-1).id),
    'the fourth candidate was delivered to the peer; it did not reach its gate');
  f.repeated(initial, [A, B]);
  await f.settle();
  assertRound(f, GROUP, initial, [A, B, A]);

  f.nextRound({sameSecond: true});
  const independent = f.human(OTHER, question, {id: initial.id});
  await f.settle();
  assertRound(f, OTHER, independent, [A, B, A]);

  f.nextRound();
  f.state.peerNickname = '连接不变时换了显示名';
  const fresh = f.human(GROUP, '后来的人类发言用 QQ 原生提及重新开题。', {native: B});
  await f.settle();
  assertRound(f, GROUP, fresh, [B, A, B]);
});

test('a delayed copy on the second bridge with a different raw id cannot replenish exhausted peer gates', async t => {
  const f = await fixture(t);
  f.state.holdAfter = 3;
  const initial = f.human(GROUP, '同一条真人消息在两个合成桥接里有不同编号。', {targets: [A]});
  await f.settle();
  assertRound(f, GROUP, initial, [A, B, A], {humanGates: 1});
  assert.equal(f.heldRelays.length, 1);
  const delayed = initial.id + 1000;
  f.repeated(initial, [B], delayed);
  await f.settle();
  assertRound(f, GROUP, initial, [A, B, A]);
  f.releaseRelays();
  await f.settle();
  assertRound(f, GROUP, initial, [A, B, A]);
});

test('changing only the genuine native mention in the same second can start a fresh topic', async t => {
  const f = await fixture(t);
  const question = '这条人类正文完全相同。';
  const initial = f.human(GROUP, question, {native: A});
  await f.settle();
  assertRound(f, GROUP, initial, [A, B, A]);
  f.nextRound({sameSecond: true});
  const redirected = f.human(GROUP, question, {native: B});
  await f.settle();
  assertRound(f, GROUP, redirected, [B, A, B]);
});

test('a local peer gate may choose silence and is never forced to send', async t => {
  const f = await fixture(t);
  f.state.peerWait = true;
  const initial = f.human(GROUP, '合成真人发言，模型随后自行选择等待。');
  await f.settle();
  const {calls} = assertRound(f, GROUP, initial, [A], {peerGates: 1, peerReplies: 0});
  assert.deepEqual(calls.filter(row => row.source === 'peer').map(row => [row.account, row.wait]), [[B, true]]);
});

test('a relayed peer message with a new raw id cannot spend another gate on the same receiver', async t => {
  const f = await fixture(t);
  f.state.peerWait = true;
  const initial = f.human(GROUP, '第一条已确认的搭档回复会被两个本地编号重复报告。');
  await f.settle();
  assertRound(f, GROUP, initial, [A], {peerGates: 1, peerReplies: 0});
  const accepted = f.relays.find(event => event.sender === A && event.target === B);
  assert(accepted);
  f.repeated(accepted, [B], accepted.id + 2000);
  await f.settle();
  assertRound(f, GROUP, initial, [A], {peerGates: 1, peerReplies: 0});
});

test('an exhausted group stays closed to an accepted peer message delayed until the sender disconnects', async t => {
  const f = await fixture(t);
  f.state.holdAfter = 3;
  const initial = f.human(GROUP, '这次由第二位本机搭档回答。', {native: B});
  await f.settle();
  assertRound(f, GROUP, initial, [B, A, B]);
  assert.equal(f.heldRelays[0]?.author, B);
  await f.services.get(B).disconnect();
  const binding = f.manager.snapshot().accounts.find(entry => entry.id === f.profiles.get(B));
  assert.equal(binding.accountId, '');
  assert.equal(binding.qqBinding.accountId, B);
  f.releaseRelays();
  await f.settle();
  assertRound(f, GROUP, initial, [B, A, B]);
});

test('a newer human input invalidates a pending peer decision or unsent formal reply from the earlier topic', async t => {
  for (const gate of [true, false]) await t.test(gate ? 'held decision' : 'held formal reply', async t => {
    const f = await fixture(t);
    const hold = f.holdPeerModel(gate);
    const initial = f.human(GROUP, '第一条真人消息会产生一个待处理的搭档回合。');
    await until(() => hold.entered, 'the peer model stage did not start');
    assert.deepEqual(f.sends.map(row => row.replyTo), [String(initial.id)]);
    const updated = '新的真人消息更改主题，两边这次都等待。';
    f.human(GROUP, updated, {preferred: null});
    await until(() => f.calls.filter(row => row.input === updated && row.gate).length === 2, 'the newer human event did not reach both bridges');
    hold.release.resolve();
    await f.settle();
    assert.deepEqual(f.sends.map(row => row.replyTo), [String(initial.id)]);
    assert.deepEqual(f.calls.filter(row => row.source === 'peer').map(row => row.gate), gate ? [true] : [true, false]);
    assert.equal(f.state.cutoff, false);
  });
});

test('old or expired human anchors cannot make peer turns eligible again', () => {
  let now = 1700000000000;
  const turns = new GroupPeerTurns(() => now);
  const human = (createdAt, groupEventKey) => turns.observeHuman({groupId: GROUP, createdAt, groupEventKey: groupEventKey.repeat(64)});
  const peer = (createdAt, groupEventKey) => turns.peerTurn({groupId: GROUP, createdAt, groupEventKey: groupEventKey.repeat(64)}, 'fixture');
  human(now, 'a');
  assert.equal(peer(now - 1, 'b').spend(), false);
  const active = peer(now, 'b');
  assert.equal(active.spend(), true);
  human(now - 1, 'c');
  assert.equal(active.current(), true);
  assert.equal(peer(now, 'd').spend(), true);
  assert.equal(peer(now, 'e').spend(), false);

  const old = now;
  now += 5 * 60 * 1000 + 1;
  assert.equal(active.current(), false);
  human(old, 'f');
  assert.equal(peer(now, 'e').spend(), false);
  human(now, 'f');
  assert.equal(peer(now, 'e').spend(), true);
});
