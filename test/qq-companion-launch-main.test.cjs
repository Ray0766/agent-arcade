'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {createFixture,defer,ACCOUNT}=require('./helpers/qq-companion-launch-main.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){for(let i=0;i<200;i++){if(fn())return;await tick();}assert.fail('Fixture condition not reached');}
async function fixture(t){const f=await createFixture();t.after(()=>f.close());return f;}
const request=()=>({accountId:'primary',operationId:randomUUID()});
test('actual main shortcut reuses saved API credentials without a workspace or model prompt',async t=>{
  const f=await fixture(t),inspect=await f.invoke('qqCompanionLaunchInspect',{accountId:'primary'});assert.equal(inspect.available,true);assert.equal(f.refreshes,0);
  const result=await f.invoke('qqCompanionLaunch',request());assert.equal(result.outcome,'connected');assert.equal(result.connectionVerified,true);assert.equal(result.startAttempted,false);assert.equal(result.testMessageSent,false);assert.equal(f.connections,1);assert.equal(f.modelCalls,0);assert.equal(f.manager.snapshot().accounts[0].accountId,ACCOUNT);
  assert.deepEqual(fs.readFileSync(path.join(f.root,'bot-config.json')),f.configBytes);assert.deepEqual(fs.readFileSync(path.join(f.root,'bot-vault.json')),f.vaultBytes);
  assert(f.requests.every(row=>['get_login_info','get_status','get_friend_list'].includes(row.action)));
});
test('stopped runtime starts once under its own busy guard before the original identity connector',async t=>{
  const f=await fixture(t);Object.assign(f.row,{management:'stopped',processRunning:false,canStart:true,login:{state:'stopped'}});
  const req=request(),out=await f.invoke('qqCompanionLaunch',req);assert.equal(out.outcome,'connected');assert.equal(f.starts,1);assert.equal(f.proofCalls,1);
  assert.equal((await f.invoke('qqCompanionLaunch',req)).ok,false);assert.equal(f.starts,1);
});
test('wrong actual identity or absent owner friend cannot claim a connected companion',async t=>{
  for(const change of [f=>f.replyAccount='100002',f=>f.ownerFriend=false]){const f=await fixture(t);change(f);const out=await f.invoke('qqCompanionLaunch',request());assert.notEqual(out.outcome,'connected');assert.equal(f.manager.claims.size,0);assert.equal(f.modelFactories,0);assert.equal(f.modelCalls,0);}
});
test('fresh proof awaits retain selection, saved secret, character, installation and visibility',async t=>{
  for(const change of [f=>f.manager.selectedId='changed',f=>f.service.secret={...f.service.secret},f=>f.service.socialConfigure({name:'Synthetic replacement'}),f=>f.console.installationSettings.current={kind:'legacy'},f=>f.win.visible=false]){
    const f=await fixture(t),hold=defer();f.proofHold=hold;const pending=f.invoke('qqCompanionLaunch',request());await until(()=>f.proofCalls===1);change(f);hold.resolve();const out=await pending;assert.notEqual(out.outcome,'connected');assert.equal(f.connections,0);
  }
});
test('actual hide and minimize handlers cancel held pre-spawn without stopping QQ',async t=>{
  for(const action of ['hide','minimize']){const f=await fixture(t),hold=defer();f.startHold=hold;Object.assign(f.row,{management:'stopped',processRunning:false,canStart:true,login:{state:'stopped'}});
    const pending=f.invoke('qqCompanionLaunch',request());await until(()=>f.console.busy.size===1);f[action]();hold.resolve();const out=await pending;assert.equal(out.outcome,'cancelled');assert.equal(out.qqStopped,false);assert.equal(f.starts,0);assert.equal(f.connections,0);}
});
test('trusted conflicting action waits for cancellation before changing account context',async t=>{
  const f=await fixture(t),hold=defer();f.refreshHold=hold;const req=request(),pending=f.invoke('qqCompanionLaunch',req);await until(()=>f.refreshes===1);
  let selected=false;f.api.register('accountSelect',()=>{selected=true;});
  await assert.rejects(f.invoke('accountSelect','primary',{sender:{},senderFrame:{}}),/Untrusted sender/);assert.equal(f.api.launch.active.controller.signal.aborted,false);
  const select=f.invoke('accountSelect','primary');await tick();assert.equal(f.api.launch.active.controller.signal.aborted,true);assert.equal(selected,false);hold.resolve();await select;assert.equal(selected,true);assert.equal((await pending).outcome,'cancelled');assert.equal(f.connections,0);
});
test('read-only status and a stale cancel do not cancel the current operation',async t=>{
  const f=await fixture(t),hold=defer();f.proofHold=hold;const req=request(),pending=f.invoke('qqCompanionLaunch',req);await until(()=>f.proofCalls===1);
  f.api.register('qqRuntimeRefresh',()=>({read:true}));await f.invoke('qqRuntimeRefresh',undefined);
  const stale=await f.invoke('qqCompanionLaunchCancel',request());assert.equal(stale.cancelled,false);assert.equal(f.api.launch.active.controller.signal.aborted,false);hold.resolve();assert.equal((await pending).outcome,'connected');
});
test('strict launch IPC returns safe fixed errors and never leaks raw configuration',async t=>{
  const f=await fixture(t);for(const value of [null,{}, {...request(),key:'secret'}, {...request(),operationId:'bad'}]){const out=await f.invoke('qqCompanionLaunch',value);assert.equal(out.ok,false);assert.equal(out.code,'invalid_request');}
  assert.equal(f.refreshes,0);assert.equal(f.modelCalls,0);
});
test('actual main quit retires held launch before account/runtime cleanup',async t=>{
  const f=await fixture(t),hold=defer();f.refreshHold=hold;let accountsClosed=false,runtimeClosed=false;
  const close=f.manager.close.bind(f.manager);f.manager.close=async()=>{assert.equal(f.api.launch.snapshot(),null);accountsClosed=true;return close();};f.console.close=async()=>{assert.equal(f.api.launch.snapshot(),null);runtimeClosed=true;};
  const pending=f.invoke('qqCompanionLaunch',request());await until(()=>f.refreshes===1);const shutdown=f.quit();await tick();assert.equal(f.api.launch.active.controller.signal.aborted,true);assert.equal(accountsClosed,false);assert.equal(runtimeClosed,false);
  hold.resolve();await shutdown;assert.equal((await pending).outcome,'cancelled');assert.equal(f.api.cleanedUp,true);assert.equal(accountsClosed,true);assert.equal(runtimeClosed,true);assert.equal(f.connections,0);
});
