'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BotService}=require('../src/bot/service.cjs');
// Fixture vault, transport, and executor only. This is not OS crypto or live acceptance.
function fixture(t,clientFactory){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-bot-'));
  const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const service=new BotService({root,vault,clientFactory,qrEncoder:async()=> 'data:image/png;base64,fixture',runnerFactory:()=>async()=>({outcome:'reply_ended',text:'fixture reply',sessionId:'fixture-session'})});
  t.after(async()=>{await service.disconnect();assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  return {service,root,vault};
}

test('persona preferences are captured once per connection for API and native factories',async t=>{
  const {service,root}=fixture(t,()=>({getUpdates:(_cursor,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})),sendText:async()=>{}}));
  let selected={enabled:false,selection:'sprout'},reads=0,apiPersona,nativePersona;
  service.personaOptions=()=>{reads++;return selected;};
  service.runnerFactory=options=>{apiPersona=options.persona;return async()=>({outcome:'reply_ended',text:'fixture'});};
  service.nativeFactory=async options=>{nativePersona=options.persona;return {command:'fixture',cleanup:()=>{}};};
  service.configure({workspace:root,key:'fixture-key-invalid'});service.secret.token='fixture';service.secret.ownerId='owner';
  await service.connect();assert.deepEqual(apiPersona,{enabled:false,selection:'sprout'});assert.equal(reads,1);
  selected.enabled=true;selected.selection='default';assert.deepEqual(apiPersona,{enabled:false,selection:'sprout'});
  await service.disconnect();service.configure({mode:'native'});await service.connect();
  assert.deepEqual(nativePersona,{enabled:true,selection:'default'});assert.equal(reads,2);
  await service.disconnect();assert.throws(()=>new BotService({root,vault:service.vault,personaOptions:'not-a-function'}),/Persona options/);
});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
test('fixture: forgotten credentials cannot be restored by a late login response',async t=>{
  const response=deferred(),entered=deferred();
  const {service,root}=fixture(t,()=>({startLogin:async()=>({qrcode:'fixture',qrContent:'fixture'}),pollLogin:()=>{entered.resolve();return response.promise;}}));
  const login=service.login();await entered.promise;await service.forget();
  response.resolve({status:'confirmed',token:'fixture-token',ownerId:'fixture-owner',baseUrl:'https://ilinkai.weixin.qq.com'});await login;
  assert.equal(service.snapshot().paired,false);assert.equal(service.snapshot().qr,null);assert.equal(fs.existsSync(path.join(root,'bot-vault.json')),false);
});
test('fixture: OS encryption unavailable refuses persistent API key storage',t=>{
  const {service,root,vault}=fixture(t,()=>({}));vault.isEncryptionAvailable=()=>false;
  assert.throws(()=>service.configure({key:'fixture-key-invalid'}),/encryption/);
  assert.equal(fs.existsSync(path.join(root,'bot-vault.json')),false);
  assert.equal(service.snapshot().hasKey,false);
});
test('fixture: snapshot excludes API key and WeChat credentials; pairing alone never auto-connects',async t=>{
  const {service,root}=fixture(t,()=>({startLogin:async()=>({qrcode:'fixture',qrContent:'fixture'}),pollLogin:async()=>({status:'confirmed',token:'private-token-fixture',ownerId:'private-owner-fixture',baseUrl:'https://ilinkai.weixin.qq.com'})}));
  service.configure({key:'private-api-key-fixture',workspace:root,budget:0.5});await service.login();
  const value=service.snapshot();assert.equal(value.status,'disconnected');assert.equal(value.hasKey,true);assert.equal(value.paired,true);
  assert.doesNotMatch(JSON.stringify(value),/private-/);
  const reloaded=new BotService({root,vault:service.vault});assert.equal(reloaded.status,'disconnected');assert.equal(reloaded.snapshot().hasKey,true);
});
test('fixture: unsupported phone verification stops pairing with an actionable message',async t=>{
  const {service}=fixture(t,()=>({startLogin:async()=>({qrcode:'fixture',qrContent:'fixture'}),pollLogin:async()=>({status:'need_verifycode'})}));
  await service.login();assert.equal(service.status,'disconnected');assert.match(service.problem,/phone verification/);
});
test('fixture: expired WeChat authorization stops polling and cancels dispatch',async t=>{
  let polls=0;const {service,root}=fixture(t,()=>({getUpdates:async()=>{polls++;throw Object.assign(Error('fixture'),{code:'session_expired'});}}));
  service.configure({key:'fixture-key-invalid',workspace:root});service.secret.token='fixture';service.secret.ownerId='fixture';
  await service.connect();await service.loop;assert.equal(polls,1);assert.equal(service.status,'disconnected');assert.match(service.problem,/expired/);
});
test('fixture: reconnect and configuration wait until previous execution actually stops',async t=>{
  const {service}=fixture(t,()=>({})),stopped=deferred();
  service.status='connected';service.dispatcher={stop(){},whenIdle:()=>stopped.promise};
  const disconnect=service.disconnect();assert.equal(service.status,'disconnecting');
  await assert.rejects(service.connect(),/previous task/);assert.throws(()=>service.configure({budget:1}),/Disconnect/);
  stopped.resolve();await disconnect;assert.equal(service.status,'disconnected');
});
test('fixture: an online empty poll is not an inbound message; failed sends are not accepted replies',async t=>{
  const first=deferred(),second=deferred();let polls=0,sends=0;
  const {service,root}=fixture(t,()=>({getUpdates:()=>++polls===1?first.promise:second.promise,sendText:async()=>{if(++sends===1)throw Error('fixture send failure');}}));
  service.configure({key:'fixture-key-invalid',workspace:root});service.secret.token='fixture';service.secret.ownerId='fixture';
  await service.connect();first.resolve({cursor:'fixture',messages:[]});
  await new Promise(r=>setImmediate(r));assert.equal(service.status,'connected');assert.equal(service.snapshot().incomingCount,0);assert.equal(service.snapshot().outgoingAccepted,0);
  second.resolve({cursor:'fixture-next',messages:[{id:'fixture-1',text:'Fixture task',contextToken:'fixture-context'}]});
  await until(()=>sends===1);await service.dispatcher.whenIdle();
  assert.equal(service.snapshot().incomingCount,1);assert.equal(service.snapshot().outgoingAccepted,0);assert.equal(sends,1);
  await service.dispatcher.receive({id:'fixture-2',text:'Another fixture task',contextToken:'fixture-context'});await service.dispatcher.whenIdle();
  assert.equal(service.snapshot().outgoingAccepted,1);assert.equal(sends,2);
  await service.disconnect();assert.equal(service.status,'disconnected');
});
test('fixture: API/native selection persists without deleting the API key and native never calls the SDK',async t=>{
  let sdkCalls=0,cleaned=0;
  const {service,root}=fixture(t,()=>({getUpdates:(_cursor,signal)=>new Promise((resolve,reject)=>{signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});}),sendText:async()=>{}}));
  service.runnerFactory=()=>{sdkCalls++;throw Error('SDK must not start in native mode');};
  service.nativeFactory=async()=>({command:'fixture-native-command',cleanup:()=>cleaned++});
  service.configure({key:'fixture-key-invalid',workspace:root});service.secret.token='fixture';service.secret.ownerId='fixture';
  service.configure({mode:'native'});assert.equal(service.snapshot().hasKey,true);
  await service.connect();assert.equal(sdkCalls,0);assert.equal(service.snapshot().native.command,'fixture-native-command');
  assert.throws(()=>service.configure({mode:'api'}),/Disconnect/);
  assert(!JSON.stringify(service.snapshot()).includes(service.dispatcher.token));
  await service.disconnect();assert.equal(cleaned,1);service.configure({mode:'api'});assert.equal(service.snapshot().hasKey,true);
  const reloaded=new BotService({root,vault:service.vault});assert.equal(reloaded.snapshot().mode,'api');assert.equal(reloaded.snapshot().hasKey,true);
});
test('fixture: late disconnect cannot clean a newer native launch configuration',async t=>{
  const {service}=fixture(t,()=>({})),stopped=deferred(),cleaned=[];let stops=0;
  service.status='connected';service.dispatcher={stop:()=>++stops===1?stopped.promise:Promise.resolve(),whenIdle:()=>Promise.resolve()};
  const old={cleanup:()=>cleaned.push('old')},next={cleanup:()=>cleaned.push('new')};service.nativeLaunch=old;
  const first=service.disconnect();await service.disconnect();service.nativeLaunch=next;service.generation++;
  stopped.resolve();await first;assert.equal(service.nativeLaunch,next);assert(!cleaned.includes('new'));
  service.nativeLaunch=null;
});
test('fixture: native preparation succeeds with no saved API key',async t=>{
  const {service,root}=fixture(t,()=>({getUpdates:(_cursor,signal)=>new Promise((resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true})),sendText:async()=>{}}));
  let prepared=0;service.nativeFactory=async()=>{prepared++;return {command:'fixture-command',cleanup(){}};};
  service.configure({workspace:root,mode:'native'});service.secret.token='fixture';service.secret.ownerId='fixture';
  assert.equal(service.snapshot().hasKey,false);await service.connect();assert.equal(prepared,1);assert.equal(service.snapshot().native.command,'fixture-command');
  await service.disconnect();
});

const until = async predicate => {
  const deadline = Date.now() + 3000;
  while (!predicate() && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
  assert(predicate(), 'fixture condition was not reached');
};
const abortPoll = signal => new Promise((resolve, reject) => {
  if (signal.aborted) reject(Error('aborted'));
  else signal.addEventListener('abort', () => reject(Error('aborted')), { once: true });
});

test('durable receipt suppresses replay after service recreation and switching API to native', async t => {
  let batchReady = deferred(), calls = 0;
  const factory = () => ({ getUpdates: (_cursor, signal) => ++calls === 1 ? batchReady.promise : abortPoll(signal), sendText: async () => {} });
  const { service, root, vault } = fixture(t, factory);
  let runs = 0; service.runnerFactory = () => async () => { runs++; return { outcome: 'reply_ended', text: 'fixture' }; };
  service.configure({ key: 'fixture-key-invalid', workspace: root }); service.persist({ ...service.secret, token: 'fixture', ownerId: 'owner' });
  await service.connect(); batchReady.resolve({ cursor: 'fixture', messages: [{ id: 'stable-message', text: 'Do a fixture task', contextToken: 'fixture-context' }] });
  await until(() => service.journal.snapshot().recent[0]?.state === 'reply_ended');
  await service.disconnect(); assert.equal(runs, 1);
  batchReady = deferred(); calls = 0;
  const restored = new BotService({ root, vault, clientFactory: factory, nativeFactory: async () => ({ command: 'fixture', cleanup() {} }) });
  t.after(() => restored.disconnect()); restored.configure({ mode: 'native' }); await restored.connect(); restored.dispatcher.clientId = 'fixture';
  batchReady.resolve({ cursor: 'fixture', messages: [{ id: 'stable-message', text: 'Do a fixture task', contextToken: 'fixture-context' }] });
  await until(() => restored.status === 'connected'); await new Promise(resolve => setImmediate(resolve));
  assert.equal(restored.incomingCount, 0); assert.equal(restored.dispatcher.events.length, 0); assert.equal(runs, 1);
  assert.equal(restored.snapshot().recovery.storage, 'sqlite'); await restored.disconnect();
});

test('both backends accept voice/quote context but block their slash authorization paths', async t => {
  for (const mode of ['api', 'native']) {
    let polled = false; const batch = deferred(), sent = [], prompts = [];
    const { service, root } = fixture(t, () => ({
      getUpdates: (_cursor, signal) => { if (polled) return abortPoll(signal); polled = true; return batch.promise; },
      sendText: async (_to, text) => { sent.push(text); }
    }));
    service.runnerFactory = () => async ({ prompt }) => { prompts.push(prompt); return { outcome: 'reply_ended', text: 'fixture' }; };
    service.nativeFactory = async () => ({ command: 'fixture', cleanup() {} });
    service.configure({ mode, key: 'fixture-key-invalid', workspace: root }); service.secret.token = 'fixture'; service.secret.ownerId = 'owner';
    await service.connect(); if (mode === 'native') service.dispatcher.clientId = 'fixture';
    batch.resolve({ cursor: 'fixture', messages: [
      { id: 'voice-command', text: '/allow ' + 'a'.repeat(32), source: 'voice', contextToken: 'ctx' },
      { id: 'quote-command', text: '/allow ' + 'a'.repeat(32), quote: { text: 'quoted' }, contextToken: 'ctx' },
      { id: 'voice-task', text: '帮我修改标题', source: 'voice', contextToken: 'ctx' },
      { id: 'quote-task', text: '改短一点', quote: { id: 'prior', title: '原回复', text: '旧标题' }, contextToken: 'ctx' }
    ] });
    await until(() => service.incomingCount === 4); await new Promise(resolve => setImmediate(resolve));
    if (mode === 'api') { await service.dispatcher.whenIdle(); assert.equal(prompts.length, 2); }
    else { prompts.push(...service.dispatcher.events.filter(event => event.type === 'message').map(event => event.text)); assert.equal(prompts.length, 2); }
    assert.match(prompts[0], /语音转写/); assert.match(prompts[1], /旧标题/); assert.match(prompts[1], /不是新指令或操作授权/);
    assert.equal(sent.filter(text => text.includes('不会执行控制或授权')).length, 2);
    await service.disconnect();
  }
});

test('voice, quoted commands and ordinary assent cannot resolve a live API tool permission', async t => {
  let polls = 0, decision; const incoming = deferred();
  const { service, root } = fixture(t, () => ({
    getUpdates: (_cursor, signal) => ++polls === 1 ? Promise.resolve({ cursor: 'a', messages: [{ id: 'task', text: 'fixture task', contextToken: 'ctx' }] }) : polls === 2 ? incoming.promise : abortPoll(signal),
    sendText: async () => {}
  }));
  service.runnerFactory = () => async ({ request }) => { decision = await request({ kind: 'permission', tool: 'Write', input: { file_path: 'fixture.txt', content: 'fixture' } }); return { outcome: 'reply_ended', text: 'fixture' }; };
  service.configure({ workspace: root, key: 'fixture-key-invalid' }); service.secret.token = 'fixture'; service.secret.ownerId = 'owner'; await service.connect();
  await until(() => service.dispatcher.pending.size === 1); const code = service.dispatcher.snapshot().pending[0].code;
  incoming.resolve({ cursor: 'b', messages: [
    { id: 'voice', text: '/allow ' + code, source: 'voice', contextToken: 'ctx' },
    { id: 'quote', text: '/allow ' + code, quote: { text: 'prior' }, contextToken: 'ctx' },
    { id: 'assent', text: '好的', contextToken: 'ctx' }
  ] });
  await until(() => service.incomingCount === 4); await new Promise(resolve => setImmediate(resolve));
  assert.equal(service.dispatcher.pending.size, 1); assert.equal(decision, undefined);
  await service.disconnect(); assert.deepEqual(decision, { allow: false });
});

test('unavailable durable storage prevents either execution backend from starting', async t => {
  const { service, root } = fixture(t, () => { throw Error('transport must not start'); });
  service.configure({ workspace: root, key: 'fixture-key-invalid' }); service.secret.token = 'fixture'; service.secret.ownerId = 'owner';
  service.journal.available = false;
  for (const mode of ['api', 'native']) { service.configure({ mode }); await assert.rejects(service.connect(), /storage is unavailable/); }
  assert.equal(service.status, 'disconnected');
});

test('rejected input remains visible on desktop after an empty poll and failed WeChat return', async t => {
  let polls = 0, executions = 0, sends = 0;
  const { service, root } = fixture(t, () => ({
    getUpdates: (_cursor, signal) => {
      polls++;
      if (polls === 1) return Promise.resolve({ cursor: 'a', messages: [{ id: 'missing-voice', text: '', source: 'voice', unsupported: 'voice_without_text', contextToken: 'ctx' }] });
      if (polls === 2) return Promise.resolve({ cursor: 'b', messages: [] });
      return abortPoll(signal);
    },
    sendText: async () => { sends++; throw Error('PRIVATE_TRANSPORT_DETAIL'); }
  }));
  service.runnerFactory = () => async () => { executions++; return { outcome: 'reply_ended', text: 'not expected' }; };
  service.configure({ workspace: root, key: 'fixture-key-invalid' }); service.secret.token = 'fixture'; service.secret.ownerId = 'owner';
  await service.connect(); await until(() => polls >= 2);
  const value = service.snapshot(); assert.equal(value.status, 'connected');
  assert.match(value.problem, /没有附带转写文字/); assert.match(value.problem, /未能回传到微信/);
  assert.doesNotMatch(value.problem, /PRIVATE_/); assert.equal(executions, 0); assert.equal(sends, 1); assert.equal(value.outgoingAccepted, 0);
  assert.equal(value.recovery.recent[0].state, 'rejected'); await service.disconnect();
});

function managedFixture(t){
  const sent=[],launches=[],calls=[];
  const {service,root}=fixture(t,()=>({getUpdates:(_cursor,signal)=>abortPoll(signal),sendText:async(_to,text)=>sent.push(text)}));
  let state={status:'idle',owned:false,sessionId:null,canResume:false};
  const manager={snapshot:()=>({...state}),getResumeSessionId:()=>state.sessionId,refresh:async()=>state,
    start:async launch=>{calls.push('start');state={status:'running',owned:true,sessionId:launch.sessionId,canResume:false};},
    stop:async()=>{calls.push('stop');state={...state,status:'stopped',owned:false,canResume:true};}};
  service.nativeProcessFactory=()=>manager;
  service.nativeFactory=async options=>{const launch={sessionId:options.resumeSessionId||'11111111-1111-4111-8111-111111111111',resume:!!options.resumeSessionId,command:'fixture',cleanup:()=>{}};launches.push(launch);return launch;};
  service.configure({workspace:root,mode:'native'});service.secret.token='fixture';service.secret.ownerId='owner';
  return {service,manager,sent,calls,launches};
}

test('managed native: quiet chat, explicit stop, and exact-session resume keep WeChat paired',async t=>{
  const {service,sent,calls,launches}=managedFixture(t);await service.connect();await service.startNative();
  const broker=service.dispatcher;broker.clientId='fixture-client';
  await broker.receive({id:'task',text:'fixture task',contextToken:'ctx'});assert.deepEqual(sent,[]);assert.equal(broker.events.length,1);
  await broker.receive({id:'stop',text:'停止',contextToken:'ctx'});
  assert.deepEqual(calls,['start','stop']);assert.equal(broker.closed,false);assert.equal(broker.paused,true);assert.equal(broker.clientId,'');assert.equal(broker.events.length,0);assert.equal(broker.records.size,0);
  assert.match(sent.at(-1),/已停止这次 Claude/);assert.equal(service.snapshot().native.process.canResume,true);assert.notEqual(service.status,'disconnected');
  await broker.receive({id:'stop-duplicate',text:'停止',contextToken:'ctx'});assert.match(sent.at(-1),/已经停止/);assert.deepEqual(calls,['start','stop']);
  await broker.receive({id:'resume',text:'恢复会话',contextToken:'ctx'});
  assert.deepEqual(calls,['start','stop','start']);assert.equal(launches.at(-1).resume,true);assert.equal(launches.at(-1).sessionId,launches.at(-2).sessionId);assert.equal(broker.paused,false);assert.match(sent.at(-1),/之前未处理的消息不会重放/);
  await service.disconnect();assert.deepEqual(calls,['start','stop','start','stop']);
});

test('managed stop never reports success before process exit; failed stop remains unconfirmed',async t=>{
  const {service,manager,sent}=managedFixture(t);await service.connect();await service.startNative();
  const barrier=deferred();manager.stop=()=>barrier.promise;
  const stopping=service.dispatcher.receive({id:'stop',text:'停止',contextToken:'ctx'});
  await new Promise(r=>setImmediate(r));assert(!sent.some(text=>text.includes('已停止')));
  await assert.rejects(service.startNative({resume:true}),/正在处理/);
  barrier.resolve();await stopping;assert.match(sent.at(-1),/已停止/);
  manager.stop=async()=>{throw Error('private process detail');};
  await service.dispatcher.receive({id:'stop-again',text:'停止',contextToken:'ctx'});
  assert.doesNotMatch(sent.at(-1),/已停止|private process/);assert.equal(service.dispatcher.paused,true);
});

test('disconnect waits for in-flight managed launch and then stops only the owned process',async t=>{
  const {service,manager,calls}=managedFixture(t),opening=deferred(),entered=deferred();
  const start=manager.start;manager.start=async launch=>{entered.resolve();await opening.promise;return start(launch);};
  await service.connect();const launching=service.startNative();const rejected=assert.rejects(launching,/连接已结束/);await entered.promise;
  const disconnecting=service.disconnect();assert.equal(service.status,'disconnecting');assert.deepEqual(calls,[]);
  opening.resolve();await rejected;await disconnecting;assert.deepEqual(calls,['start','stop']);assert.equal(service.status,'disconnected');
});

test('manually started native process remains outside application stop ownership',async t=>{
  const {service,calls,sent}=managedFixture(t);await service.connect();service.dispatcher.clientId='manual';
  await service.dispatcher.receive({id:'manual-stop',text:'/cancel',contextToken:'ctx'});
  assert.deepEqual(calls,[]);assert.match(sent.at(-1),/无法确认它已停止/);assert.equal(service.dispatcher.paused,true);
});

test('early native exit is detected without waiting for MCP attachment, then a new session is possible',async t=>{
  const {service,manager,calls}=managedFixture(t);await service.connect();await service.startNative();
  const snapshot=manager.snapshot,refresh=manager.refresh;manager.refresh=async()=>{await manager.stop();manager.snapshot=()=>{const state=snapshot();return state.status==='stopped'?{...state,status:'exited'}:state;};manager.refresh=refresh;};
  await service.refreshNative();assert.equal(service.snapshot().native.process.status,'exited');assert.equal(service.dispatcher.paused,true);assert.equal(service.dispatcher.closed,false);
  assert.match(service.problem,/Claude 已退出/);assert.deepEqual(calls,['start','stop']);
  await service.startNative({resume:false});assert.equal(service.dispatcher.paused,false);assert.deepEqual(calls,['start','stop','start']);
});

test('native stop waits for an in-flight process check rather than racing process ownership',async t=>{
  const {service,manager,calls}=managedFixture(t),checking=deferred(),entered=deferred();
  await service.connect();await service.startNative();manager.refresh=async()=>{entered.resolve();await checking.promise;};
  const probe=service.refreshNative();await entered.promise;const stopping=service.stopNative();await new Promise(r=>setImmediate(r));assert.deepEqual(calls,['start']);
  checking.resolve();await probe;await stopping;assert.deepEqual(calls,['start','stop']);
});

test('resume while original Claude is awaiting startup confirmation preserves its launch and channel',async t=>{
  const {service,launches,calls}=managedFixture(t);await service.connect();await service.startNative();
  const active=service.nativeLaunch;let cleaned=0;active.cleanup=()=>{cleaned++;};
  await assert.rejects(service.startNative({resume:true}),/原终端完成启动/);
  assert.equal(service.nativeLaunch,active);assert.equal(cleaned,0);assert.equal(launches.length,2);assert.equal(service.dispatcher.paused,false);assert.equal(service.dispatcher.command,'fixture');assert.deepEqual(calls,['start']);
});

test('verified owned Claude may wait for startup confirmation beyond five minutes without replaying input',async t=>{
  const {service,calls}=managedFixture(t);await service.connect();
  const broker=service.dispatcher,connectionStatus=service.status;let now=1000;broker.now=()=>now;
  await service.startNative();
  await broker.receive({id:'before-ready',text:'Do not queue this input',contextToken:'ctx'});
  for(let i=0;i<4;i++){now+=120000;await service.refreshNative();broker.checkLease();assert.equal(broker.closed,false);}
  assert.deepEqual(calls,['start']);assert.equal(service.status,connectionStatus);assert.equal(broker.events.length,0);
  broker.clientId='fixture-client';broker.lastSeen=now;
  await broker.receive({id:'before-ready',text:'Do not replay this input',contextToken:'ctx'});assert.equal(broker.events.length,0);
  now+=90001;await service.refreshNative();broker.checkLease();
  await until(()=>service.status==='disconnected');assert.deepEqual(calls,['start','stop'],'Attached heartbeat failure still stops the owned process');
});

test('unknown, starting, and unowned native processes cannot renew the startup wait',async t=>{
  for(const state of [{status:'unknown',owned:true},{status:'starting',owned:true},{status:'running',owned:false}]){
    const {service,manager}=managedFixture(t);await service.connect();
    const broker=service.dispatcher;let now=1000;broker.now=()=>now;await service.startNative();
    const original=manager.snapshot;manager.snapshot=()=>({...original(),...state});
    now+=240000;await service.refreshNative();assert.equal(broker.createdAt,1000);
    now+=60001;broker.checkLease();assert.equal(broker.closed,true);
    await until(()=>service.status==='disconnected');
  }
});

test('a process probe finishing after disconnect cannot renew the revoked startup wait',async t=>{
  const {service,manager,calls}=managedFixture(t);await service.connect();
  const broker=service.dispatcher;let now=1000;broker.now=()=>now;await service.startNative();
  const checking=deferred(),entered=deferred();manager.refresh=async()=>{entered.resolve();await checking.promise;};
  now+=120000;const probe=service.refreshNative();await entered.promise;
  const disconnecting=service.disconnect();checking.resolve();await probe;await disconnecting;
  assert.equal(broker.createdAt,1000);assert.equal(broker.closed,true);assert.deepEqual(calls,['start','stop']);
});
