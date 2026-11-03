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
  const deadline=Date.now()+2000;while(service.snapshot().outgoingAccepted<1&&Date.now()<deadline)await new Promise(r=>setTimeout(r,10));
  assert.equal(service.snapshot().incomingCount,1);assert.equal(service.snapshot().outgoingAccepted,1);assert.equal(sends,2);
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
