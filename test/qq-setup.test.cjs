'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {BotService} = require('../src/bot/service.cjs');
const {napCatConnection, qqGuide} = require('../src/bot/qq-setup.cjs');

// Synthetic vault and clients; these establish lifecycle boundaries, not QQ access.
const vault = {isEncryptionAvailable: () => true, encryptString: s => Buffer.from(s), decryptString: b => b.toString()};
const info = {accountId:'87654321',nickname:'Fixture AI',online:true,ownerIsFriend:true};
function fixture(t, inspect = async () => info) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'arcade-qq-setup-'));
  const state = {clients:0,closes:0,runners:0};
  const service = new BotService({root,vault,
    qqClientFactory: () => {state.clients++;return {inspect,connect:async()=>{},close:async()=>{state.closes++;}};},
    codexRunnerFactory: () => {state.runners++;throw Error('A setup check must not create an AI runner.');},
  });
  service.configure({channel:'qq',mode:'codex',qqOwnerId:'12345678'});
  t.after(async()=>{await service.disconnect();service.journal.close?.();assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  return {service,root,state};
}

test('QQ token preparation is idempotent, not published or written into nonsecret config', t => {
  const {service,root,state} = fixture(t);
  service.prepareQQ();const token=service.qqSetupToken();
  assert.match(token,/^[a-f0-9]{64}$/);
  assert.equal(service.snapshot().qq.hasToken,true);
  assert(!JSON.stringify(service.snapshot()).includes(token));
  assert(!fs.readFileSync(path.join(root,'bot-config.json'),'utf8').includes(token));
  service.prepareQQ();assert.equal(service.qqSetupToken(),token);
  assert.equal(state.clients,0);assert.equal(state.runners,0);
  service.configure({qqToken:'existing-onebot-token-fixture'});service.prepareQQ();
  assert.equal(service.qqSetupToken(),'existing-onebot-token-fixture');
});

test('QQ config export is a single localhost server with literal token, never a full config overwrite', () => {
  const token='fixture-quote-"-backslash-\\';
  const result=JSON.parse(napCatConnection('ws://127.0.0.1:3002/',token));
  assert.deepEqual(result,{name:'agent-arcade',enable:true,host:'127.0.0.1',port:3002,
    messagePostFormat:'array',reportSelfMessage:false,token,enableForcePushEvent:true,debug:false,heartInterval:30000});
  assert.equal(JSON.parse(napCatConnection('ws://[::1]:3001/',token)).host,'::1');
  assert.throws(()=>napCatConnection('wss://127.0.0.1:3001/',token),/TLS/);
  assert.throws(()=>napCatConnection('ws://example.com:3001/',token));
  assert.throws(()=>napCatConnection('ws://127.0.0.1:3001/','short'));
  assert.match(qqGuide('download'),/^https:\/\/github.com\/NapNeko\/NapCatQQ-Desktop\//);
  for(const kind of ['https://example.com','__proto__',null,{},'file:///C:/'])assert.throws(()=>qqGuide(kind));
});

test('QQ connection test needs no model key/project; closes its client and never starts dispatch', async t => {
  const {service,state,root}=fixture(t);service.prepareQQ();
  const result=await service.testQQ();
  assert.equal(result.status,'disconnected');assert.equal(result.qq.check.state,'checked');
  assert.equal(result.qq.check.accountId,info.accountId);assert.equal(result.qq.check.online,true);
  assert.equal(result.qq.check.ownerIsFriend,true);assert.equal(result.tasks,null);
  assert.equal(result.incomingCount,0);assert.equal(result.outgoingAccepted,0);
  assert.equal(state.clients,1);assert.equal(state.closes,1);assert.equal(state.runners,0);
  const restored=new BotService({root,vault});assert.equal(restored.snapshot().qq.check,null);
  restored.journal.close?.();
  service.configure({mode:'deepseek'});assert.equal(service.snapshot().qq.check.state,'checked');
  service.configure({qqOwnerId:'11223344'});assert.equal(service.snapshot().qq.check,null);
});

test('QQ check rejects configuration/connect races and disconnect suppresses a late successful probe', async t => {
  let release;const pending=new Promise(resolve=>{release=resolve;});
  const {service,state}=fixture(t,()=>pending);service.prepareQQ();
  const probe=service.testQQ();assert.equal(service.status,'checking');
  assert.throws(()=>service.configure({qqOwnerId:'11223344'}),/Disconnect/);
  assert.throws(()=>service.prepareQQ(),/disconnect/);
  assert.throws(()=>service.qqSetupToken(),/disconnect/);
  assert.throws(()=>service.testQQ(),/disconnect/);
  await assert.rejects(service.connect(),/wait/);
  const disconnect=service.disconnect();release(info);await Promise.all([probe,disconnect]);
  assert.equal(service.status,'disconnected');assert.equal(service.snapshot().qq.check,null);
  assert.equal(state.closes,1);assert.equal(state.runners,0);
});

test('QQ failed probe reports a bounded cause, hides arbitrary transport error and remains retryable', async t => {
  let fail=true;
  const {service,state}=fixture(t,async()=>{if(fail)throw Object.assign(Error('private bridge token and raw headers'),{code:'unauthorized'});return info;});
  service.prepareQQ();await service.testQQ();
  assert.equal(service.snapshot().qq.check.code,'unauthorized');
  assert.match(service.snapshot().problem,/same token/);
  assert.doesNotMatch(JSON.stringify(service.snapshot()),/private bridge token/);
  fail=false;await service.testQQ();assert.equal(service.snapshot().qq.check.state,'checked');
  assert.equal(service.problem,'');assert.equal(state.closes,2);
  await service.forget();assert.equal(service.snapshot().qq.check,null);assert.equal(service.snapshot().qq.hasToken,false);
});

for(const [field,code] of [['online','account_offline'],['ownerIsFriend','owner_not_friend']]) {
  test(`QQ refuses task receiving when preflight explicitly reports ${field}=false`,async t=>{
    const {service,root,state}=fixture(t,async()=>({...info,[field]:false}));service.prepareQQ();
    service.configure({workspace:root});await service.connect();
    assert.equal(service.status,'disconnected');assert.equal(service.snapshot().qq.check[field],false);
    assert.equal(state.runners,0);assert.equal(state.closes,1);assert(service.problem);
    assert.equal(service.snapshot().tasks,null);
  });
}

test('QQ setup actions require the selected channel and available OS encryption',t=>{
  const {service}=fixture(t);service.vault={...vault,isEncryptionAvailable:()=>false};
  assert.throws(()=>service.prepareQQ(),/encryption/);assert.equal(service.snapshot().qq.hasToken,false);
  assert.throws(()=>service.qqSetupConfig(),/token/);assert.throws(()=>service.testQQ(),/token/);
  service.configure({channel:'wechat'});assert.throws(()=>service.prepareQQ(),/Select QQ/);
});

test('QQ service refuses unknown online preflight without creating an AI runner',async t=>{
  const {service,root,state}=fixture(t,async()=>({...info,online:null}));service.prepareQQ();service.configure({workspace:root});
  await service.connect();assert.equal(service.status,'disconnected');assert.equal(state.runners,0);
  assert.match(service.problem,/尚未核实 QQ 在线状态/);assert.doesNotMatch(service.problem,/扫码/);
});

test('QQ explicit login expiry stops polling and keeps an actionable sanitized reason',async t=>{
  const {service}=fixture(t);let polls=0;const controller=new AbortController();service.controller=controller;
  await service.poll({getUpdates:async()=>{polls++;throw Object.assign(Error('SECRET raw bridge error'),{code:'login_required'});}},controller.signal,null,service.generation,{channel:'qq'});
  assert.equal(polls,1);assert.equal(service.status,'disconnected');
  assert.match(service.snapshot().problem,/当前登录已失效.*本人在 NapCat/);assert.doesNotMatch(service.problem,/SECRET/);
});

for(const code of ['disconnected','account_offline'])test(`QQ ${code} retries finitely with distinct instructions`,async t=>{
  const {service}=fixture(t),controller=new AbortController(),messages=[];service.controller=controller;
  t.mock.timers.enable({apis:['setTimeout']});
  service.onChange=()=>messages.push(service.problem);
  let polls=0;
  const run=service.poll({getUpdates:async()=>{polls++;throw Object.assign(Error('SECRET transport error'),{code});}},controller.signal,null,service.generation,{channel:'qq'});
  for(let n=0;n<6;n++){await new Promise(resolve=>setImmediate(resolve));t.mock.timers.tick(32000);}
  await run;
  assert.equal(polls,5);assert.equal(service.status,'disconnected');assert.doesNotMatch(messages.join('\n'),/SECRET/);
  if(code==='disconnected'){
    assert(messages.some(message=>message.includes('正在自动重连')));
    assert.match(service.problem,/已暂停自动重连.*点击“连接”/);assert.doesNotMatch(messages.join('\n'),/扫码|重新登录/);
  }else{
    assert(messages.some(message=>message.includes('正在等待 NapCat 恢复')));
    assert.match(service.problem,/QQ 当前离线.*仅显示待扫码时/);assert.doesNotMatch(messages.join('\n'),/当前登录已失效/);
  }
});
