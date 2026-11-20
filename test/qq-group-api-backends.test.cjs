'use strict';

// Exercise native ordinary QQ routing and production API adapters using only
// an in-process OneBot socket and intercepted HTTP requests.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {EventEmitter} = require('node:events');
const {setTimeout: delay} = require('node:timers/promises');
const Anthropic = require('@anthropic-ai/sdk');
const {AccountManager} = require('../src/bot/account-manager.cjs');
const {QQClient} = require('../src/bot/qq.cjs');
const {createRunner} = require('../src/bot/runner.cjs');
const {MODEL: CLAUDE_MODEL} = require('../src/bot/claude-direct-runner.cjs');
const {createGPTRunner, DEFAULT_MODEL: GPT_MODEL} = require('../src/bot/gpt-runner.cjs');
const {createGeminiRunner, DEFAULT_MODEL: GEMINI_MODEL} = require('../src/bot/gemini-runner.cjs');
const {createDoubaoRunner, DEFAULT_MODEL: DOUBAO_MODEL} = require('../src/bot/doubao-runner.cjs');

const ACCOUNT = '87654321', OWNER = '12345678', MEMBER = '44443333', GROUP = '55556666', OTHER = '77778888';
const NOW = 1800000000000;
const KEY = 'synthetic-only-group-api-key';
const PRIVATE_ERROR = 'SECRET_PROVIDER_ERROR_DETAIL';
const REPLY = '这是合成的普通群回复。';
const UNSAFE = '这段伴随意外工具调用的合成文字不可发送。';
const ARGUMENTS = {path: 'not-created.txt', content: 'synthetic only'};
const GATE_MESSAGE = JSON.stringify({action: 'message', text: '合成接话理由'});
const GATE_WAIT = JSON.stringify({action: 'wait', text: ''});
const GATE_PREFIX = 'Decide whether this character should answer';
const claude = (value, stop_reason = 'end_turn', extra = []) => ({
  id: 'msg_synthetic', type: 'message', role: 'assistant', model: CLAUDE_MODEL, stop_reason, stop_sequence: null,
  content: [{type: 'text', text: value}, ...extra], usage: {input_tokens: 12, output_tokens: 9},
});
const claudeTool = {type: 'tool_use', id: 'toolu_synthetic', name: 'Write', input: ARGUMENTS};
const gptMessage = value => ({id: 'msg_synthetic', type: 'message', role: 'assistant', content: [{type: 'output_text', text: value}]});
const gpt = output => ({status: 'completed', output});
const gemini = parts => ({candidates: [{finishReason: 'STOP', content: {role: 'model', parts}}]});
const doubao = (value, stop = 'stop', extra = {}) => ({choices: [{finish_reason: stop, message: {role: 'assistant', content: value, ...extra}}]});

const adapters = {
  api: {factory: 'runnerFactory', make: (options, fetch) => createRunner({...options, agentSdk: false,
    clientFactory: client => new Anthropic({...client, fetch}),
  }), url: 'https://api.anthropic.com/v1/messages', model: CLAUDE_MODEL, prompt: body => body.messages[0].content,
    reply: value => claude(value),
    toolReplies: [claude(UNSAFE, 'tool_use'), claude(UNSAFE, 'end_turn', [claudeTool])],
  },
  gpt: {factory: 'gptRunnerFactory', make: (options, fetchImpl) => createGPTRunner({...options, fetchImpl}),
    url: 'https://api.openai.com/v1/responses', model: GPT_MODEL, prompt: body => body.input.at(-1).content,
    reply: value => gpt([gptMessage(value)]),
    toolReplies: [gpt([gptMessage(UNSAFE), {id: 'fc_synthetic', type: 'function_call', call_id: 'call_synthetic',
      name: 'Write', arguments: JSON.stringify(ARGUMENTS),
    }])],
  },
  gemini: {factory: 'geminiRunnerFactory', make: (options, fetchImpl) => createGeminiRunner({...options, fetchImpl}),
    url: `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent`,
    prompt: body => body.contents.at(-1).parts[0].text, reply: value => gemini([{text: value}]),
    toolReplies: [gemini([{text: UNSAFE}, {functionCall: {id: 'call_synthetic', name: 'Write', args: ARGUMENTS}}])],
  },
  doubao: {factory: 'doubaoRunnerFactory', make: (options, fetchImpl) => createDoubaoRunner({...options, fetchImpl}),
    url: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions', model: DOUBAO_MODEL, prompt: body => body.messages.at(-1).content,
    reply: value => doubao(value), toolReplies: [doubao(UNSAFE, 'tool_calls', {tool_calls: [
      {id: 'call_synthetic', type: 'function', function: {name: 'Write', arguments: JSON.stringify(ARGUMENTS)}},
    ]})],
  },
};

async function until(predicate) {
  const deadline = Date.now() + 3700;
  while (!predicate()) {
    assert(Date.now() < deadline, 'the expected group HTTP request was never emitted');
    await delay(3);
  }
}

function inspectRequest(mode, body) {
  if (mode === 'api') {
    assert(!Object.hasOwn(body, 'tools'));
    assert(!Object.hasOwn(body, 'tool_choice'));
    assert.equal(body.messages.length, 1);
  } else {
    assert.deepEqual(body.tools, []);
    if (mode === 'gemini') assert.equal(body.toolConfig.functionCallingConfig.mode, 'NONE');
    else assert.equal(body.tool_choice, 'none');
  }
  if (mode === 'gpt' || mode === 'gemini') assert.equal(body.store, false);
  assert(!body.stream);
}

async function fixture(t, mode) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-qq-group-api-backends-'));
  const adapter = adapters[mode], sockets = [], wire = [], outbound = [], unexpected = [];
  const state = {responses: []};
  let sourceId = 700, receiptId = 9000;

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
      const requests = {get_login_info: {user_id: Number(ACCOUNT)}, get_status: {online: true, good: true},
        get_friend_list: [{user_id: Number(OWNER)}],
      };
      callback?.();
      let data;
      if (action === 'send_group_msg') {
        data = {message_id: ++receiptId};
        outbound.push({params, receipt: String(receiptId)});
      } else if (Object.hasOwn(requests, action)) data = requests[action];
      else {
        unexpected.push(action);
        this.frame({status: 'failed', retcode: 100, echo});
        return;
      }
      this.frame({status: 'ok', retcode: 0, echo, data});
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
    qqClientFactory: options => new QQClient({...options, now: () => NOW, timeoutMs: 250, pollTimeoutMs: 10,
      socketFactory: () => new Bridge(),
    }),
    [adapter.factory]: options => adapter.make(options, async (url, init) => {
      const body = JSON.parse(init.body), prompt = adapter.prompt(body);
      wire.push({url: String(url), method: init.method, body, prompt, gate: prompt.includes(GATE_PREFIX)});
      const result = state.responses.shift();
      if (!result) throw Error('unexpected second provider request');
      return result instanceof Response ? result : Response.json(result);
    }),
  });
  t.after(async () => {
    await manager.close();
    assert(sockets.every(socket => socket.readyState === 3));
    fs.rmSync(root, {recursive: true, force: true});
  });
  const service = manager.current();
  service.configure({channel: 'qq', mode, key: KEY, qqAccountId: ACCOUNT, qqOwnerId: OWNER,
    qqToken: 'synthetic-ordinary-bridge-token', qqGroups: {enabled: true, groupIds: [GROUP, OTHER], proactive: false},
  });
  service.socialConfigure({enabled: true, proactiveMessages: false, qzonePosts: false});
  await manager.connect(manager.selectedId);
  assert.equal(service.status, 'connected', service.problem);
  assert.equal(manager.snapshot().accounts[0].accountId, ACCOUNT);
  const route = service.groupRoute;
  route.flow = {debounceMs: 0, bubbleDelayMs: 0};

  const run = async (message, responses, group = GROUP) => {
    const id = ++sourceId, offset = wire.length, writes = outbound.length;
    const context = route.publicContext(group, route.characterFor(group));
    const actor = route.actor(group, MEMBER);
    const existingActions = new Set(actor.store.actions(actor.scope, 20).map(row => row.id));
    const existingPublic = new Set(context.view().filter(row => row.kind === 'character').map(row => row.id));
    state.responses = responses;
    sockets.at(-1).frame({post_type: 'message', message_type: 'group', sub_type: 'normal', self_id: Number(ACCOUNT),
      user_id: Number(MEMBER), sender: {user_id: Number(MEMBER), nickname: '合成群成员'}, group_id: Number(group),
      time: NOW / 1000, message_id: id,
      message: [{type: 'at', data: {qq: ACCOUNT}}, {type: 'text', data: {text: message}}],
    });
    await until(() => wire.length > offset);
    await actor.engine.whenIdle();
    assert.deepEqual(state.responses, []);
    assert.deepEqual(unexpected, []);
    const requests = wire.slice(offset);
    for (const {url, method, body, prompt} of requests) {
      assert.equal(new URL(url).pathname, new URL(adapter.url).pathname);
      assert.equal(new URL(url).origin, new URL(adapter.url).origin);
      assert.equal(method.toUpperCase(), 'POST');
      if (adapter.model) assert.equal(body.model, adapter.model);
      inspectRequest(mode, body);
      assert(prompt.includes(message));
      assert(!prompt.includes(PRIVATE_ERROR));
      assert(!JSON.stringify(body).includes(KEY));
    }
    const task = actor.engine.snapshot().tasks.find(row => row.inboundId === `in:group:${group}:${id}`);
    assert(task);
    assert(!fs.existsSync(path.join(actor.root, 'workspace', ARGUMENTS.path)));
    return {id, group, requests, task, sends: outbound.slice(writes),
      actions: actor.store.actions(actor.scope, 20).filter(row => !existingActions.has(row.id)),
      publicRows: context.view().filter(row => row.kind === 'character' && !existingPublic.has(row.id)),
    };
  };
  return {run, service, adapter};
}

function assertNoSend(result, phases, state) {
  assert.deepEqual(result.requests.map(row => row.gate), phases);
  assert.deepEqual(result.sends, []);
  assert.deepEqual(result.actions, []);
  assert.deepEqual(result.publicRows, []);
  assert.equal(result.task.outcome, state);
}

function assertSuccess(result) {
  assert.deepEqual(result.requests.map(row => row.gate), [true, false]);
  assert.equal(result.sends.length, 1);
  const [sent] = result.sends;
  assert.equal(sent.params.group_id, Number(result.group));
  assert.deepEqual(sent.params.message, [{type: 'reply', data: {id: String(result.id)}}, {type: 'text', data: {text: REPLY}}]);
  assert.equal(result.task.outcome, 'reply_ended');
  assert.equal(result.task.bubbleDelivery.accepted, 1);
  assert.deepEqual(result.actions.map(row => [row.state, row.receipt, row.text]), [['sent', sent.receipt, REPLY]]);
  assert.deepEqual(result.publicRows.map(row => row.text), [REPLY]);
}

function assertIssues(f, expected) {
  const groups = f.service.snapshot().qq.groups;
  assert.deepEqual(groups.providerIssues, expected);
  const serialized = JSON.stringify(groups);
  assert(!serialized.includes(PRIVATE_ERROR));
  assert(!serialized.includes(KEY));
  assert(!serialized.includes(UNSAFE));
}

test('packaged Claude QQ formal replies refuse a tool stop or mixed tool content', async t => {
  const f = await fixture(t, 'api');
  for (const response of f.adapter.toolReplies) {
    const result = await f.run('普通群聊不执行涉及文件的返回值。', [f.adapter.reply(GATE_MESSAGE), response]);
    assertNoSend(result, [true, false], 'error');
  }
});

const refusal = () => Response.json({type: 'error', error: {type: 'authentication_error', message: PRIVATE_ERROR}}, {status: 401});
const throttle = () => Response.json({type: 'error', error: {type: 'rate_limit_error', message: PRIVATE_ERROR}}, {
  status: 429, headers: {'retry-after': '0'},
});

for (const mode of ['api', 'gpt']) test(`${mode}: quiet and HTTP errors stay unsent, and successful text has an exact ordinary QQ receipt`, async t => {
  const f = await fixture(t, mode);
  const {reply} = f.adapter;
  assertSuccess(await f.run('这里应该发一条的合成回复。', [reply(GATE_MESSAGE), reply(REPLY)]));
  assertIssues(f, []);
  assertNoSend(await f.run('第二群遇到接话接口错误。', [refusal()], OTHER), [true], 'error');
  assertIssues(f, [{groupId: OTHER, phase: 'gate', code: 'credentials'}]);
  assertNoSend(await f.run('第一群正常决定等待。', [reply(GATE_WAIT)]), [true], 'skipped');
  assertIssues(f, [{groupId: OTHER, phase: 'gate', code: 'credentials'}]);
  assertNoSend(await f.run('第二群遇到正式回复接口错误。', [reply(GATE_MESSAGE), refusal()], OTHER), [true, false], 'error');
  assertIssues(f, [{groupId: OTHER, phase: 'reply', code: 'credentials'}]);
  assertNoSend(await f.run('第二群接话正常但尚未恢复正式回复。', [reply(GATE_WAIT)], OTHER), [true], 'skipped');
  assertIssues(f, [{groupId: OTHER, phase: 'reply', code: 'credentials'}]);
  assertSuccess(await f.run('第二群后续消息应该恢复。', [reply(GATE_MESSAGE), reply(REPLY)], OTHER));
  assertIssues(f, []);
});

test('packaged Claude QQ reports an actual SDK 429 once per stage and a valid wait clears its gate issue', async t => {
  const f = await fixture(t, 'api');
  const {reply} = f.adapter;
  assertNoSend(await f.run('本次接话服务限流。', [throttle()]), [true], 'error');
  assertIssues(f, [{groupId: GROUP, phase: 'gate', code: 'rate_limited'}]);
  assertNoSend(await f.run('新消息的接话判断正常等待。', [reply(GATE_WAIT)]), [true], 'skipped');
  assertIssues(f, []);
  assertNoSend(await f.run('本次正式回复服务限流。', [reply(GATE_MESSAGE), throttle()]), [true, false], 'error');
  const first = {groupId: GROUP, phase: 'reply', code: 'rate_limited'};
  const second = {...first, groupId: OTHER};
  assertIssues(f, [first]);
  assertNoSend(await f.run('另一个群遇到相同正式回复限流。', [reply(GATE_MESSAGE), throttle()], OTHER), [true, false], 'error');
  assertIssues(f, [first, second]);
  assert.match(f.service.snapshot().qq.groups.problem, new RegExp('QQ群 '+GROUP+'.*429'));
  assert.match(f.service.snapshot().qq.groups.problem, new RegExp('QQ群 '+OTHER+'.*429'));
  assertSuccess(await f.run('新消息完成正式回复。', [reply(GATE_MESSAGE), reply(REPLY)]));
  assertIssues(f, [second]);
  assertSuccess(await f.run('另一个群也恢复。', [reply(GATE_MESSAGE), reply(REPLY)], OTHER));
  assertIssues(f, []);
});

for (const mode of ['gpt', 'gemini', 'doubao']) test(`${mode}: tool-bearing formal output stays out of QQ and the accepted projection`, async t => {
  const f = await fixture(t, mode);
  const {reply, toolReplies} = f.adapter;
  assertNoSend(await f.run('群里的合成请求不执行任何工具。', [reply(GATE_MESSAGE), ...toolReplies]), [true, false], 'error');
  if (mode !== 'gpt') {
    assertNoSend(await f.run('正式回复阶段服务限流。', [reply(GATE_MESSAGE), throttle()]), [true, false], 'error');
    assertIssues(f, [{groupId: GROUP, phase: 'reply', code: 'rate_limited'}]);
    assertSuccess(await f.run('群里回到普通文字。', [reply(GATE_MESSAGE), reply(REPLY)]));
    assertIssues(f, []);
  }
});
