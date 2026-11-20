'use strict';

// Production BotService, SQLite stores, QQClient and DeepSeek adapter. Only
// the bridge socket, vault and provider responses are synthetic.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {setTimeout: delay} = require('node:timers/promises');
const {BotService} = require('../src/bot/service.cjs');
const {QQClient} = require('../src/bot/qq.cjs');
const {createDeepSeekRunner} = require('../src/bot/deepseek-runner.cjs');

const ACCOUNT = '87654321', OWNER = '12345678', WRITER = '44443333', OTHER_WRITER = '44443334', READER = '44443335', MODERATOR = '45555666';
const GROUP = '55556666', OTHER = '77778888', NOW = 1800000000000;
const PRIVATE_TOPIC = '合成旧站青色雨棚';
const KEPT_TOPIC = '合成圆桌绿藤';
const OTHER_TOPIC = '合成石岸黄风铃';
const FIRST = '已接受的第一条合成消息。';
const LATER = '尚未提交的第二条合成消息。';
const text = value => ({type: 'text', data: {text: value}});
const quote = id => ({type: 'reply', data: {id: String(id)}});
const mention = qq => ({type: 'at', data: {qq}});
const isGate = prompt => prompt.includes('Decide whether this character should answer');
const incoming = prompt => prompt.match(/\nBEGIN (ARCADE_INPUT_\d+)\n([\s\S]*?)\nEND \1/u)[2];

async function until(predicate, label) {
  const deadline = Date.now() + 3500;
  while (!predicate()) {
    assert(Date.now() < deadline, label);
    await delay(3);
  }
}

function deferred() {
  let resolve;
  const promise = new Promise(finish => {resolve = finish;});
  return {promise, resolve};
}

async function fixture(t, {debounceMs = 0, bubbleDelayMs = 0} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-qq-recall-'));
  const sockets = [], services = [], wire = [], writes = [], requests = [], held = [];
  const state = {answer: false, hold: null, reply: '合成普通文字回复。'};
  let rawId = 500, receiptId = 5000;
  class Bridge extends EventEmitter {
    constructor() {
      super();
      this.readyState = 0;
      sockets.push(this);
      queueMicrotask(() => {this.readyState = 1;this.emit('open');});
    }
    frame(value) {this.emit('message', JSON.stringify(value), false);}
    send(raw, callback) {
      const {action, echo, params} = JSON.parse(raw);
      requests.push({action, params});
      callback?.();
      const responses = {get_login_info: {user_id: Number(ACCOUNT)}, get_status: {online: true, good: true},
        get_friend_list: [{user_id: Number(OWNER)}],
      };
      let data;
      if (action === 'send_group_msg') {
        assert.deepEqual(params.message.map(part => part.type), ['reply', 'text']);
        data = {message_id: ++receiptId};
        writes.push({group: String(params.group_id), replyTo: params.message[0].data.id,
          text: params.message[1].data.text, receipt: String(receiptId),
        });
      } else {
        assert(Object.hasOwn(responses, action), 'group recall must not perform extra native lookup: ' + action);
        data = responses[action];
      }
      setImmediate(() => {if (this.readyState === 1) this.frame({status: 'ok', retcode: 0, echo, data});});
    }
    terminate() {
      if (this.readyState === 3) return;
      this.readyState = 3;
      this.emit('close');
    }
    ping() {this.emit('pong');}
  }

  const create = () => {
    const service = new BotService({
      root,
      vault: {isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: bytes => bytes.toString()},
      qqClientFactory: settings => new QQClient({...settings, now: () => NOW, timeoutMs: 260, pollTimeoutMs: 12,
        socketFactory: () => new Bridge(),
      }),
      deepseekRunnerFactory: options => createDeepSeekRunner({...options, fetchImpl: async (_url, request) => {
        const body = JSON.parse(request.body), prompt = body.messages.at(-1).content, gate = isGate(prompt);
        assert.equal(body.tool_choice, 'none');
        assert.deepEqual(body.tools, []);
        const input = incoming(prompt);
        wire.push({gate, prompt, input});
        if (!gate && state.hold?.match(input)) {
          const current = state.hold;
          state.hold = null;
          current.signal = request.signal;
          await current.release.promise;
        }
        const content = gate ? JSON.stringify({action: state.answer ? 'message' : 'wait', text: state.answer ? '合成接话理由' : ''}) : state.reply;
        return Response.json({choices: [{finish_reason: 'stop', message: {role: 'assistant', content}}]});
      }}),
    });
    services.push(service);
    return service;
  };
  const initial = create();
  initial.configure({channel: 'qq', mode: 'deepseek', key: 'synthetic-local-model-key',
    qqAccountId: ACCOUNT, qqOwnerId: OWNER, qqToken: 'synthetic-local-bridge-token',
    qqGroups: {enabled: true, groupIds: [GROUP, OTHER], proactive: false},
  });
  initial.socialConfigure({enabled: true, proactiveMessages: false, qzonePosts: false});
  t.after(async () => {
    for (const entry of held) entry.release.resolve();
    for (const service of services) await service.disconnect();
    assert(sockets.every(socket => socket.readyState === 3));
    fs.rmSync(root, {recursive: true, force: true});
  });
  let service = initial;
  const connect = async () => {
    await service.connect();
    assert.equal(service.status, 'connected', service.problem);
    service.groupRoute.flow = {debounceMs, maxBatchMs: debounceMs, bubbleDelayMs};
  };
  await connect();
  const restart = async () => {await service.disconnect();service = create();await connect();return service;};
  const frame = ({id = ++rawId, group = GROUP, author = WRITER, message}) => {
    sockets.at(-1).frame({post_type: 'message', message_type: 'group', sub_type: 'normal', self_id: Number(ACCOUNT),
      user_id: Number(author), sender: {user_id: Number(author), nickname: '合成群成员'}, group_id: Number(group),
      time: NOW / 1000, message_id: id, message: typeof message === 'string' ? [text(message)] : message,
    });
    return id;
  };
  const recall = ({id, group = GROUP, author = WRITER, operator = author, self = ACCOUNT}) => {
    sockets.at(-1).frame({post_type: 'notice', notice_type: 'group_recall', ...(self === null ? {} : {self_id: Number(self)}),
      user_id: Number(author), operator_id: Number(operator), group_id: Number(group), message_id: id, time: NOW / 1000,
    });
  };
  const idle = () => Promise.all([...service.groupRoute.actors.values()].map(actor => actor.engine.whenIdle()));
  const observe = async (message, {drain = true, ...options} = {}) => {
    const start = wire.length;
    const id = frame({...options, message});
    await until(() => wire.slice(start).some(row => row.gate), 'the ordinary QQ gate did not run');
    if (drain) await idle();
    if (!state.answer) assert(!writes.some(row => row.replyTo === String(id) && row.group === (options.group || GROUP)));
    return wire.slice(start);
  };
  const hold = match => {
    const entry = {match, release: deferred(), signal: null};
    held.push(entry);
    state.hold = entry;
    return entry;
  };
  return {get service() {return service;}, state, frame, recall, hold, observe, idle, restart, wire, writes, requests};
}

function observedQuote(prompt) {
  const line = prompt.split('\n').find(item => item.startsWith('Observed quote targets '));
  return line ? JSON.parse(line.slice(line.indexOf(': [') + 2)) : [];
}

function observedMentions(prompt) {
  const line = prompt.split('\n').find(item => item.startsWith('Observed mention targets '));
  return line ? JSON.parse(line.slice(line.indexOf(': [') + 2)) : [];
}

test('the authenticated exact group and original author recall aborts an in-flight formal answer without a send', async t => {
  const f = await fixture(t);
  f.state.answer = true;
  f.state.reply = '准备提及' + PRIVATE_TOPIC;
  const held = f.hold(input => input.includes(PRIVATE_TOPIC));
  const id = f.frame({id: 700, message: '请在' + PRIVATE_TOPIC + '等候。'});
  await until(() => held.signal, 'the formal provider request was not in flight');
  f.recall({id, operator: MODERATOR});
  f.recall({id, operator: MODERATOR});
  await until(() => held.signal.aborted, 'the exact recall must cancel the old model request');
  held.release.resolve();
  await f.idle();
  assert.deepEqual(f.writes, []);

  f.state.answer = false;
  const [later] = await f.observe([quote(id), text('刚才哪里见？')], {author: READER});
  assert.equal(later.gate, true);
  assert(!later.prompt.includes(PRIVATE_TOPIC));
  assert.deepEqual(observedQuote(later.prompt), []);

  f.state.answer = true;
  f.state.reply = '回答同一成员的新消息。';
  const fresh = f.hold(input => input.includes(KEPT_TOPIC));
  const freshId = f.frame({id: 701, message: '换个话题，聊聊' + KEPT_TOPIC + '。'});
  await until(() => fresh.signal, 'the next answer for the same member did not start');
  f.recall({id, operator: MODERATOR});
  f.state.answer = false;
  await f.observe('确认重复通知已通过。', {group: OTHER, author: READER, drain: false});
  assert.equal(fresh.signal.aborted, false);
  fresh.release.resolve();
  await f.idle();
  assert.deepEqual(f.writes.map(row => [row.replyTo, row.text]), [[String(freshId), '回答同一成员的新消息。']]);
});

test('a wrong-group, wrong-author or unauthenticated recall leaves a correctly scoped held answer eligible', async t => {
  const f = await fixture(t);
  const id = 711;
  await f.observe('另一个群里碰巧用了同一个编号。', {id, group: OTHER});
  f.state.answer = true;
  f.state.reply = '确实回复到' + PRIVATE_TOPIC;
  const held = f.hold(input => input.includes(PRIVATE_TOPIC));
  f.frame({id, message: '请问' + PRIVATE_TOPIC + '在哪里？'});
  await until(() => held.signal, 'the ordinary answer was not in flight');
  f.recall({id, group: OTHER});
  f.recall({id, author: OTHER_WRITER, operator: MODERATOR});
  f.recall({id, self: null});

  // A distinct actor receives a real later event while the original answer is
  // held, so checking the signal does not rely on sleeping after the notices.
  f.state.answer = false;
  await f.observe('确认两个群仍能收到后续消息。', {group: OTHER, author: READER, drain: false});
  assert.equal(held.signal.aborted, false);
  held.release.resolve();
  await f.idle();
  assert.deepEqual(f.writes.map(row => [row.group, row.replyTo, row.text]), [[GROUP, String(id), '确实回复到' + PRIVATE_TOPIC]]);
  const [later] = await f.observe('最近群里提到哪里？', {author: READER});
  assert(later.prompt.includes(PRIVATE_TOPIC));
});

test('moderator recall of the exact author survives a cold reopen without removing adjacent or other group messages', async t => {
  const f = await fixture(t);
  const id = 721;
  await f.observe('应当撤回的消息：' + PRIVATE_TOPIC, {id});
  await f.observe('同一位成员的另一条消息：' + KEPT_TOPIC, {id: 722});
  await f.observe('另一群的同号消息：' + OTHER_TOPIC, {id, group: OTHER});
  const before = f.service;
  const reopened = await f.restart();
  assert.notEqual(reopened, before);
  // This connection has no transport observation of the old ID. The exact
  // original author can still be established from retained public history.
  f.recall({id, author: OTHER_WRITER, operator: MODERATOR});
  f.recall({id, operator: MODERATOR});
  f.recall({id, operator: MODERATOR});
  const verify = async () => {
    const [same] = await f.observe([quote(id), text('这条撤回引用里有什么？')], {author: READER});
    assert(!same.prompt.includes(PRIVATE_TOPIC));
    assert(same.prompt.includes(KEPT_TOPIC));
    assert(!same.prompt.includes(OTHER_TOPIC));
    assert.deepEqual(observedQuote(same.prompt), []);
    const [cross] = await f.observe([quote(id), text('另一群同号引用里是什么？')], {group: OTHER, author: READER});
    assert(cross.prompt.includes(OTHER_TOPIC));
    assert(!cross.prompt.includes(PRIVATE_TOPIC));
    assert(!cross.prompt.includes(KEPT_TOPIC));
    assert(observedQuote(cross.prompt).some(row => row.text.includes(OTHER_TOPIC)));
  };
  await verify();
  assert.notEqual(await f.restart(), reopened);
  f.frame({id, message: '桥接重放的原消息：' + PRIVATE_TOPIC});
  await verify();
  assert.deepEqual(f.writes, []);
  assert(f.requests.every(row => row.action !== 'get_msg'));
});

test('recall of one member source cancels a batched answer and retains the unaffected segment for future turns', async t => {
  const f = await fixture(t, {debounceMs: 60});
  f.state.answer = true;
  f.state.reply = '合成旧批次答案不应发出。';
  const held = f.hold(input => input.includes(PRIVATE_TOPIC) && input.includes(KEPT_TOPIC));
  const recalled = f.frame({id: 801, message: '先聊' + PRIVATE_TOPIC + '。'});
  const kept = f.frame({id: 802, message: '再聊' + KEPT_TOPIC + '。'});
  await until(() => held.signal, 'the two messages did not become one real batched model request');
  f.recall({id: recalled});
  await until(() => held.signal.aborted, 'recall must cancel a task anchored to either batched segment');
  held.release.resolve();
  await f.idle();
  assert.deepEqual(f.writes, []);
  f.state.answer = false;
  const [next] = await f.observe([quote(kept), text('那条保留的消息讲了什么？')], {author: READER});
  assert(next.prompt.includes(KEPT_TOPIC));
  assert(!next.prompt.includes(PRIVATE_TOPIC));
  assert(observedQuote(next.prompt).some(row => row.text.includes(KEPT_TOPIC)));
});

test('recall before the gate keeps the unrecalled queued question, its observable addressing and the exact reply anchor', async t => {
  const cases = [
    {remove: 0, answer: true, name: 'first recalled, second answered'},
    {remove: 1, answer: true, name: 'second recalled, first answered'},
    {remove: 1, answer: false, name: 'the survivor can settle silently'},
  ];
  for (const {remove, answer, name} of cases) await t.test(name, async t => {
    const f = await fixture(t);
    const entries = [
      {author: READER, priorId: 901, priorText: '这位群友先说了海盐面包。', id: 911, body: '第一个排队问题用合成青色标记。'},
      {author: OTHER_WRITER, priorId: 902, priorText: '另一位群友先说了乌龙蛋糕。', id: 912, body: '第二个排队问题用合成橙色标记。'},
    ];
    for (const {author, priorId, priorText} of entries) await f.observe(priorText, {id: priorId, author});

    f.service.groupRoute.flow = {debounceMs: 650, maxBatchMs: 950, bubbleDelayMs: 0};
    f.state.answer = answer;
    f.state.reply = '只回答仍然存在的合成问题。';
    const offset = f.wire.length;
    for (const {id, priorId, author, body} of entries) {
      f.frame({id, message: [quote(priorId), mention(ACCOUNT), mention(author), text(body)]});
    }
    const actor = () => [...f.service.groupRoute.actors.values()].find(item => item.binding.senderId === WRITER);
    await until(() => actor()?.engine.queue.at(-1)?.messageCount === 2, 'both member questions must still be queued');
    assert.equal(actor().engine.current, null);
    assert.equal(f.wire.length, offset, 'the queued questions have made zero provider requests');
    assert.deepEqual(f.writes, []);

    const recalled = entries[remove], survivor = entries[1 - remove];
    f.recall({id: recalled.id});
    await until(() => f.wire.length > offset, 'the surviving queued question never reached its gate');
    await f.idle();
    const calls = f.wire.slice(offset);
    assert.deepEqual(calls.map(call => call.gate), answer ? [true, false] : [true]);
    for (const {prompt} of calls) {
      assert.equal(incoming(prompt), survivor.body);
      assert(!prompt.includes(recalled.body));
      const addressing = prompt.split('\n').find(line => line.startsWith('Group addressing from the bridge'));
      assert(addressing);
      assert.deepEqual(JSON.parse(addressing.slice(addressing.lastIndexOf('Data: ') + 6)), [
        [0, survivor.body.length, ['self', 'other'], 'other'],
      ]);
      const quoted = observedQuote(prompt);
      assert.equal(quoted.length, 1);
      const {speaker} = quoted[0];
      assert.match(speaker, /^[a-f0-9]{16}$/);
      assert.deepEqual(quoted, [{row: 0, speaker, text: survivor.priorText}]);
      assert.deepEqual(observedMentions(prompt), [{row: 0, at: 1, speaker}]);
      for (const secret of [ACCOUNT, WRITER, READER, OTHER_WRITER]) assert(!prompt.includes(secret));
    }
    if (answer) {
      assert.deepEqual(f.writes.map(row => [row.group, row.replyTo, row.text]), [[GROUP, String(survivor.id), f.state.reply]]);
      assert(actor().store.actions(actor().scope, 20).some(row => row.state === 'sent' && row.receipt === f.writes[0].receipt));
    } else assert.deepEqual(f.writes, []);
    assert(f.requests.every(row => row.action !== 'get_msg'));
  });
});

test('recall leaves the first genuinely accepted bubble receipt and cancels all still-unsubmitted bubbles', async t => {
  const f = await fixture(t, {bubbleDelayMs: 1000});
  f.state.answer = true;
  f.state.reply = FIRST + '\n\n' + LATER;
  const anchor = f.frame({id: 811, message: '请用两条回复谈' + PRIVATE_TOPIC + '。'});
  const actor = () => f.service.groupRoute.actor(GROUP, WRITER);
  const delivery = () => actor().engine.current?.bubbleDelivery;
  await until(() => f.writes.length === 1 && delivery()?.accepted === 1, 'the first bubble did not receive a concrete acceptance');
  f.recall({id: anchor});
  await f.idle();
  assert.deepEqual(f.writes.map(row => row.text), [FIRST]);
  assert(actor().store.actions(actor().scope, 20).some(row => row.state === 'sent' && row.receipt === f.writes[0].receipt));
  f.state.answer = false;
  const [later] = await f.observe('还会引用那条已撤回的话吗？', {author: READER});
  assert(!later.prompt.includes(PRIVATE_TOPIC));
  assert(!later.prompt.includes(LATER));
});
