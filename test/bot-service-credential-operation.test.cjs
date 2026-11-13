'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BotService}=require('../src/bot/service.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const busy={code:'credentials_busy'};
// Fresh synthetic profiles and injected inert close gates; no real vault,
// account, socket, model, or operating-system credential store is used.
function fixture(t,options={}){
  const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'arcade-credential-operation-')),gates=[];let encryptions=0;
  const vault={isEncryptionAvailable:()=>true,encryptString:value=>{encryptions++;return Buffer.from(value);},decryptString:value=>value.toString()};
  const service=new BotService({root,vault,...options});
  const hold=()=>{const gate=deferred();gates.push(gate);return gate;};
  t.after(async()=>{for(const gate of gates)gate.resolve();await service.disconnect();const exact=fs.realpathSync(root);assert(exact.startsWith(base+path.sep)&&path.basename(exact).startsWith('arcade-credential-operation-'));fs.rmSync(exact,{recursive:true,force:true});});
  return {service,root,hold,encryptions:()=>encryptions};
}
test('forget owns credential editing despite a second disconnect; other profiles remain independent',async t=>{
  let clients=0;const f=fixture(t,{clientFactory:()=>{clients++;return {};}}),other=fixture(t),s=f.service,gate=f.hold();
  s.configure({key:'synthetic-original-model-key',channel:'qq'});const before=fs.readFileSync(s.file),calls=f.encryptions();
  s.friendRequests={close:()=>gate.promise};const pending=s.forget();await s.disconnect();assert.equal(s.status,'disconnected');
  for(const action of [()=>s.configure({key:'synthetic-replacement-model-key'}),()=>s.configure({budget:2}),()=>s.persist({...s.secret,key:'synthetic-direct-key'}),()=>s.persistConfiguration(s.config,s.secret),()=>s.prepareQQ(),()=>s.qqSetupToken(),()=>s.testQQ()])assert.throws(action,busy);
  await assert.rejects(s.forget(),busy);await assert.rejects(s.connect(),busy);
  assert.equal(f.encryptions(),calls);assert.deepEqual(fs.readFileSync(s.file),before);assert.equal(clients,0);
  other.service.configure({key:'synthetic-other-profile-model-key'});assert.equal(other.service.snapshot().hasKey,true);
  gate.resolve();await pending;assert.equal(fs.existsSync(s.file),false);
  s.configure({key:'synthetic-new-model-key-after-forget'});assert.equal(s.snapshot().hasKey,true);assert.equal(other.service.snapshot().hasKey,true);
});
test('failed cleanup releases the forget gate and retains the existing credential bytes',async t=>{
  const f=fixture(t),s=f.service,gate=f.hold();s.configure({key:'synthetic-original-model-key'});const before=fs.readFileSync(s.file);
  s.friendRequests={close:()=>gate.promise};const pending=s.forget(),rejected=assert.rejects(pending,/synthetic cleanup failed/);
  assert.throws(()=>s.configure({budget:2}),busy);gate.reject(Error('synthetic cleanup failed'));await rejected;
  assert.deepEqual(fs.readFileSync(s.file),before);await s.disconnect();s.configure({key:'synthetic-new-model-key-after-failure'});assert.equal(s.snapshot().hasKey,true);
});
test('forget can clear a locked vault and does not permanently lock ordinary configuration',async t=>{
  const f=fixture(t),s=f.service;s.configure({key:'synthetic-original-model-key'});s.lockCredentials();
  // Preserve the pre-existing rule: nonsensitive settings remain editable when locked.
  s.configure({budget:2});await s.forget();assert.equal(fs.existsSync(s.file),false);assert.equal(s.snapshot().credentialState,'empty');
  s.configure({key:'synthetic-new-model-key-after-clear'});assert.equal(s.snapshot().hasKey,true);
});
test('an unguarded connect waiting for idle ASR cleanup cannot start a client during forget',async t=>{
  let clients=0;const f=fixture(t,{clientFactory:()=>{clients++;return {};}}),s=f.service,idle=f.hold(),inbox=f.hold();
  s.configure({key:'synthetic-model-key',workspace:f.root});s.persist({...s.secret,token:'synthetic-login-token',ownerId:'synthetic-owner'});
  s.inboundVoiceIdle={close:()=>idle.promise};const connecting=s.connect(),rejected=assert.rejects(connecting,busy);
  s.friendRequests={close:()=>inbox.promise};const forgetting=s.forget();idle.resolve();await rejected;assert.equal(clients,0);
  inbox.resolve();await forgetting;assert.equal(s.snapshot().paired,false);
});
test('unguarded connect rechecks after transport connect before inspection or model construction',async t=>{
  let inspections=0,models=0;const connected=deferred(),entered=deferred();
  const f=fixture(t,{qqClientFactory:()=>({accountId:'100001',connect:()=>{entered.resolve();return connected.promise;},inspect:async()=>{inspections++;return {online:true,ownerIsFriend:true};},close(){}}),runnerFactory:()=>{models++;return async()=>({});}}),s=f.service,gate=f.hold();
  s.configure({key:'synthetic-model-key',workspace:f.root,channel:'qq',qqOwnerId:'200002',qqAccountId:'100001',qqToken:'synthetic-onebot-token'});
  const connecting=s.connect();await entered.promise;s.friendRequests={close:()=>gate.promise};const forgetting=s.forget();
  connected.resolve();await connecting;assert.equal(inspections,0);assert.equal(models,0);
  gate.resolve();await forgetting;assert.equal(s.status,'disconnected');assert.equal(s.snapshot().hasKey,false);
});
test('login rechecks after its disconnect await before creating a login client',async t=>{
  let clients=0;const f=fixture(t,{clientFactory:()=>{clients++;return {};}}),s=f.service,first=f.hold(),second=f.hold();
  s.friendRequests={close:()=>first.promise};const login=s.login(),rejected=assert.rejects(login,busy);
  s.friendRequests={close:()=>second.promise};const forgetting=s.forget();await assert.rejects(s.login(),busy);
  first.resolve();await rejected;assert.equal(clients,0);second.resolve();await forgetting;assert.equal(s.qr,null);
});
test('login cannot revive after a newer forget has fully finished',async t=>{
  let clients=0;const f=fixture(t,{clientFactory:()=>{clients++;return {startLogin:async()=>{throw Error('synthetic client must not start');}};}}),s=f.service,gate=f.hold();
  s.friendRequests={close:()=>gate.promise};const login=s.login();const rejected=assert.rejects(login,{code:'changed'});
  await s.forget();gate.resolve();await rejected;assert.equal(clients,0);assert.equal(s.qr,null);
});
test('connect cannot inspect the old transport after a newer forget has fully finished',async t=>{
  let inspections=0;const connected=deferred(),entered=deferred();
  const f=fixture(t,{qqClientFactory:()=>({accountId:'100001',connect:()=>{entered.resolve();return connected.promise;},inspect:async()=>{inspections++;return {online:true,ownerIsFriend:true};},close(){}})}),s=f.service;
  s.configure({key:'synthetic-model-key',workspace:f.root,channel:'qq',qqOwnerId:'200002',qqAccountId:'100001',qqToken:'synthetic-onebot-token'});
  const connecting=s.connect();await entered.promise;await s.forget();connected.resolve();await connecting;assert.equal(inspections,0);assert.equal(s.snapshot().hasKey,false);
});
