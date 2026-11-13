'use strict';
// Integration fixtures: actual service/dispatcher/SQLite; synthetic transports,
// vault and executors. This does not establish provider or QQ account access.
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {BotService} = require('../src/bot/service.cjs');

const ANTHROPIC = 'private-anthropic-fixture-key';
const DEEPSEEK = 'private-deepseek-fixture-key';
const OPENAI = 'private-openai-fixture-key';
const QQ_TOKEN = 'private-onebot-fixture-token';
const WECHAT_TOKEN = 'private-wechat-fixture-token';
const OWNER = '12345678';
const vault = {isEncryptionAvailable: () => true, encryptString: value => Buffer.from(value), decryptString: value => value.toString()};
const tick = () => new Promise(resolve => setImmediate(resolve));
const until = async predicate => {
  const deadline = Date.now() + 4000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert(predicate(), 'integration fixture did not reach expected state');
};
class Client {
  constructor({channel, options, accountId = '87654321', first = []}) { Object.assign(this, {channel, options, accountId, first}); this.sent = []; this.closeCount = 0; this.connectCount = 0; this.polls = 0; }
  async connect() { this.connectCount++; }
  getUpdates(cursor, signal) {
    if (++this.polls === 1) return Promise.resolve({cursor: 'fixture-cursor', messages: this.first});
    return new Promise((resolve, reject) => {
      const abort = () => reject(Object.assign(Error('fixture aborted'), {code: 'aborted'}));
      if (signal.aborted) abort(); else signal.addEventListener('abort', abort, {once: true});
    });
  }
  async sendText(to, text, contextToken, id, signal) {
    assert(!signal.aborted, 'no send after disconnected');
    this.sent.push({to, text, contextToken}); return {id: 'receipt'};
  }
  close() { this.closeCount++; }
}
const message = (id = 'shared-id', extra = {}) => ({id, text: 'Run a synthetic task', contextToken: 'fixture-context', ...extra});

function fixture(t, options = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'arcade-multi-provider-'));
  const clients = [], runners = [], executions = [], services = [];
  let first = options.messages || [message()], accountId = '87654321';
  const clientFactory = channel => settings => {
    const client = new Client({channel, options: settings, accountId, first}); clients.push(client); return client;
  };
  const runnerFactory = mode => settings => {
    const record = {mode, options: settings, closed: 0}; runners.push(record);
    const execute = async request => {
      executions.push({mode, request});
      if (options.execute) return options.execute(request, record);
      return {sessionId: `${mode}-fixture-session`, outcome: 'reply_ended', text: `${mode} fixture response`};
    };
    execute.close = async () => { record.closed++; };
    return execute;
  };
  const make = () => {
    const service = new BotService({root, vault, clientFactory: clientFactory('wechat'), qqClientFactory: clientFactory('qq'),
      runnerFactory: runnerFactory('api'), codexRunnerFactory: runnerFactory('codex'), claudeProgramRunnerFactory: runnerFactory('claude'),
      nativeFactory: () => { throw Error('The program-mode fixture must not create a Channels bridge.'); }, deepseekRunnerFactory: runnerFactory('deepseek'), gptRunnerFactory: runnerFactory('gpt')});
    services.push(service); return service;
  };
  const service = make();
  service.configure({workspace: root, mode: 'api', key: ANTHROPIC});
  service.configure({mode: 'deepseek', key: DEEPSEEK, deepseekModel: 'deepseek-v4-pro',
    qqUrl: 'ws://127.0.0.1:3001', qqOwnerId: OWNER, qqToken: QQ_TOKEN});
  service.configure({mode:'gpt',key:OPENAI,gptModel:'gpt-6-astra'});
  service.persist({...service.secret, token: WECHAT_TOKEN, ownerId: OWNER});
  t.after(async () => {
    for (const item of services) await item.disconnect();
    const target = fs.realpathSync(root), base = fs.realpathSync(os.tmpdir());
    assert(target.startsWith(base + path.sep)); fs.rmSync(target, {recursive: true, force: true});
  });
  return {root, service, make, clients, runners, executions, setMessages: value => { first = value; }, setAccount: value => { accountId = value; }};
}

for (const channel of ['wechat', 'qq']) for (const mode of ['claude', 'codex', 'deepseek', 'gpt']) {
  test(`${channel} × ${mode}: selected transport/backend, separate credentials and durable response boundary`, async t => {
    const f = fixture(t), {service} = f;
    service.configure({channel, mode});
    const config = JSON.parse(fs.readFileSync(path.join(f.root, 'bot-config.json'), 'utf8'));
    assert.equal(config.mode, mode); assert.equal(config.channel, channel);
    const snapshot = JSON.stringify(service.snapshot());
    for (const secret of [ANTHROPIC, DEEPSEEK, OPENAI, QQ_TOKEN, WECHAT_TOKEN]) { assert(!snapshot.includes(secret)); assert(!JSON.stringify(config).includes(secret)); }
    await service.connect();
    await until(() => f.clients[0].sent.length === 1);
    const [client] = f.clients, [runner] = f.runners;
    assert.equal(client.channel, channel); assert.equal(client.options.token, channel === 'qq' ? QQ_TOKEN : WECHAT_TOKEN);
    assert.equal(client.options.ownerId, OWNER); assert.equal(runner.mode, mode);
    assert.equal(runner.options.key, mode === 'deepseek' ? DEEPSEEK : mode==='gpt'?OPENAI:undefined);
    assert.equal(runner.options.model, mode === 'deepseek' ? 'deepseek-v4-pro' : mode==='gpt'?'gpt-6-astra':undefined);
    if(mode==='claude'){assert.equal(service.snapshot().native,null);assert.deepEqual(Object.keys(runner.options).sort(),['persona','workspace']);}
    assert(!JSON.stringify(runner.options).includes(ANTHROPIC)); assert(!JSON.stringify(runner.options).includes(QQ_TOKEN));
    assert.equal(client.sent[0].to, OWNER); assert.equal(client.sent[0].contextToken, 'fixture-context');
    assert.equal(service.snapshot().tasks.tasks[0].state, 'reply_ended');
    assert.equal(service.journal.snapshot().storage, 'sqlite');
    assert.equal(service.journal.snapshot().recent[0].state, 'reply_ended');
    assert.throws(() => service.configure({mode: 'api'}), /Disconnect/);
    assert.throws(() => service.configure({channel: channel === 'qq' ? 'wechat' : 'qq'}), /Disconnect/);
    await service.disconnect(); assert.equal(client.closeCount, 1); assert.equal(runner.closed, 1);
    const reloaded = f.make(); assert.equal(reloaded.snapshot().channel, channel); assert.equal(reloaded.snapshot().mode, mode);
    assert.equal(reloaded.status, 'disconnected'); assert.equal(f.runners.length, 1, 'recreation never auto-connects');
  });
}

test('receipt namespace separates QQ from WeChat and QQ accounts, but mode changes never replay a task', async t => {
  const f = fixture(t), {service} = f;
  service.configure({channel: 'wechat', mode: 'codex'}); await service.connect();
  await until(() => f.executions.length === 1); await service.dispatcher.whenIdle(); await service.disconnect();
  service.configure({channel: 'qq', mode: 'deepseek'}); await service.connect();
  await until(() => f.executions.length === 2); await service.dispatcher.whenIdle(); await service.disconnect();
  service.configure({mode: 'claude'}); await service.connect(); await until(() => service.status === 'connected'); await tick();
  assert.equal(service.incomingCount, 0); assert.equal(f.executions.length, 2); await service.disconnect();
  f.setAccount('99999999'); await service.connect(); await until(() => f.executions.length === 3); await service.dispatcher.whenIdle(); await service.disconnect();
  const reloaded = f.make(); await reloaded.connect(); await until(() => reloaded.status === 'connected'); await tick();
  assert.equal(reloaded.incomingCount, 0); assert.equal(f.executions.length, 3); await reloaded.disconnect();
  service.configure({channel: 'wechat', mode: 'deepseek'}); await service.connect(); await until(() => service.status === 'connected'); await tick();
  assert.equal(service.incomingCount, 0); assert.equal(f.executions.length, 3);
});

test('QQ normalization prevents quoted permission and attachment text from starting any backend task', async t => {
  const f = fixture(t, {messages: [message('quote', {text: '同意 ABC123', quote: {id: 'old', text: ''}}),
    message('attachment', {text: 'write this', unsupported: 'qq_segments'})]});
  f.service.configure({channel: 'qq', mode: 'codex'}); await f.service.connect();
  await until(() => f.clients[0].sent.length === 2);
  assert.equal(f.executions.length, 0); assert.equal(f.service.incomingCount, 2);
  assert(f.clients[0].sent.every(x => x.to === OWNER));
  assert.match(f.clients[0].sent[0].text, /不会执行控制/); assert.match(f.clients[0].sent[1].text, /只处理文字/);
  assert(f.service.journal.snapshot().recent.every(x => x.state === 'rejected'));
});

for (const mode of ['claude', 'codex', 'deepseek', 'gpt']) test(`QQ disconnect aborts ${mode}, invalidates permission and closes executor/transport`, async t => {
  let signal, approval;
  const f = fixture(t, {execute: async request => {
    signal = request.signal;
    approval = await request.request({kind: 'permission', tool: 'Write', input: {path: 'fixture.txt', content: 'fixture'}, signal});
    return {outcome: signal.aborted ? 'cancelled' : 'reply_ended', text: 'fixture'};
  }});
  f.service.configure({channel: 'qq', mode}); await f.service.connect();
  await until(() => f.service.snapshot().tasks.pending.length === 1);
  await f.service.disconnect();
  assert.equal(signal.aborted, true); assert.equal(approval.allow, false);
  assert.equal(f.service.snapshot().tasks.pending.length, 0); assert.equal(f.service.snapshot().tasks.tasks[0].state, 'cancelled');
  assert.equal(f.runners[0].closed, 1); assert.equal(f.clients[0].closeCount, 1);
  const sent = f.clients[0].sent.length; await tick(); assert.equal(f.clients[0].sent.length, sent, 'no late result after disconnect');
});

test('selected DeepSeek key is required even when Anthropic credentials exist; Codex needs neither', async t => {
  const f = fixture(t); f.service.persist({...f.service.secret, deepseekKey: undefined});
  f.service.configure({channel: 'qq', mode: 'deepseek'}); await assert.rejects(f.service.connect(), /selected provider/);
  assert.equal(f.runners.length, 0); assert.equal(f.clients.length, 0);
  f.service.persist({...f.service.secret, key: undefined}); f.service.configure({mode: 'codex'});
  await f.service.connect(); await until(() => f.executions.length === 1);
  assert.equal(f.runners[0].options.key, undefined);
});

test('GPT requires its own key and preserves other credentials and model choices across restarts', async t => {
  const f=fixture(t),{service}=f;
  service.persist({...service.secret,openaiKey:undefined});service.configure({channel:'qq',mode:'gpt'});
  assert.equal(service.snapshot().hasKey,false);
  await assert.rejects(service.connect(),/selected provider/);
  assert.equal(f.clients.length,0);assert.equal(f.runners.length,0);
  service.configure({key:OPENAI,gptModel:'gpt-6.1-sol'});
  assert.equal(service.secret.key,ANTHROPIC);assert.equal(service.secret.deepseekKey,DEEPSEEK);
  const restored=f.make();assert.equal(restored.snapshot().hasKey,true);assert.equal(restored.snapshot().gptModel,'gpt-6.1-sol');
  assert.equal(restored.snapshot().deepseekModel,'deepseek-v4-pro');assert.equal(restored.status,'disconnected');
  assert.throws(()=>restored.configure({gptModel:'unavailable-model',key:'uncommitted-fixture-key'}),/available GPT/);
  assert.equal(restored.secret.openaiKey,OPENAI);
  await restored.connect();await until(()=>f.executions.length===1);
  assert.equal(f.runners[0].options.key,OPENAI);assert.equal(f.runners[0].options.model,'gpt-6.1-sol');
  assert(!JSON.stringify(f.runners[0].options).includes(DEEPSEEK));
  await restored.forget();assert.equal(restored.snapshot().hasKey,false);assert.deepEqual(restored.secret,{});
});


test('Claude program mode needs no provider key and cannot accept one, while saved API credentials stay separate', async t => {
  const f=fixture(t),{service}=f;
  service.persist({...service.secret,key:undefined,deepseekKey:undefined,openaiKey:undefined});
  service.configure({channel:'qq',mode:'claude'});
  assert.equal(service.snapshot().hasKey,false);
  assert.throws(()=>service.configure({key:'uncommitted-fixture-key'}),/does not use an API key/);
  assert.equal(service.secret.key,undefined);
  await service.connect();await until(()=>f.clients[0].sent.length===1);
  assert.equal(f.runners[0].mode,'claude');assert.equal(service.nativeLaunch,undefined);
  assert.equal(service.snapshot().native,null);
  assert.deepEqual(Object.keys(f.runners[0].options).sort(),['persona','workspace']);
});

for(const channel of ['wechat','qq']) test(`${channel} × Claude program: permission stays explicit and /new resets the exact conversation`,async t=>{
  const f=fixture(t,{messages:[],execute:async request=>{
    if(request.prompt==='Synthetic write'){
      const decision=await request.request({kind:'permission',tool:'Write',input:{file_path:'fixture.txt',content:'fixture'},signal:request.signal});
      return {sessionId:'program-session-1',outcome:'reply_ended',text:decision.allow?'Synthetic write allowed':'Synthetic write denied'};
    }
    return {sessionId:request.resume||'program-session-2',outcome:'reply_ended',text:'Synthetic chat reply'};
  }}),{service}=f;
  service.configure({channel,mode:'claude'});await service.connect();
  const dispatcher=service.dispatcher;
  await dispatcher.receive(message('write',{text:'Synthetic write'}));
  await until(()=>dispatcher.pending.size===1);
  const pending=dispatcher.snapshot().pending[0];
  assert.equal(f.executions.length,1);assert.equal(f.clients[0].sent.filter(x=>x.text==='Synthetic write allowed').length,0);
  await dispatcher.receive(message('allow',{text:`同意 ${pending.alias}`}));await dispatcher.whenIdle();
  assert(f.clients[0].sent.some(x=>x.text==='Synthetic write allowed'));
  await dispatcher.receive(message('followup',{text:'Synthetic followup'}));await dispatcher.whenIdle();
  assert.equal(f.executions[1].request.resume,'program-session-1');
  await dispatcher.receive(message('new',{text:'/new'}));await dispatcher.whenIdle();
  await dispatcher.receive(message('new-chat',{text:'Synthetic new chat'}));await dispatcher.whenIdle();
  assert.equal(f.executions[2].request.resume,undefined);
  assert.equal(service.snapshot().tasks.tasks.at(-1).state,'reply_ended');
});
