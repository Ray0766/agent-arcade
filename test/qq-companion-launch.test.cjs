'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {QQCompanionLaunch,qqCompanionLaunchRequest,qqCompanionLaunchResult}=require('../src/bot/qq-companion-launch.cjs');
const {fixture,stopped,running,deferred,error,PROFILE,QQ}=require('./helpers/qq-companion-launch-fixture.cjs');

test('local inspection and strict requests do not start, connect or accept authority injection',async t=>{
  const f=fixture(t),result=f.coordinator.inspect({accountId:PROFILE});assert.equal(result.available,true);assert.equal(result.qqAccountId,QQ);assert.equal(f.state.refreshes+f.state.starts+f.state.connects,0);
  for(const extra of [{qqAccountId:QQ},{url:'http://127.0.0.1'},{token:'synthetic-do-not-use'},{background:true}])assert.throws(()=>qqCompanionLaunchRequest({...f.input(),...extra}),{code:'invalid_request'});
  const output=await qqCompanionLaunchResult({accountId:PROFILE},()=>{throw Error('PRIVATE_FAILURE');});assert.deepEqual(output,{ok:false,accountId:PROFILE,code:'operation_failed'});
});
test('stopped -> owned online -> guarded connect once; the operation UUID cannot replay',async t=>{
  const f=fixture(t),input=f.input(),result=await f.coordinator.launch(input);assert.equal(result.outcome,'connected');assert.equal(result.qqRunning,true);assert.equal(result.connectionVerified,true);assert.equal(result.startAttempted,true);assert.equal(result.qqStopped,false);assert.equal(result.testMessageSent,false);
  assert.deepEqual([f.state.starts,f.state.connects],[1,1]);assert.throws(()=>f.coordinator.launch(input),{code:'changed'});assert.deepEqual(f.state.phases,['checking','starting','connecting',null]);
  assert(f.state.guards.some(row=>row.phase==='preflight'));assert(f.state.guards.some(row=>row.phase==='connecting'&&row.connection.phase==='connecting'));
});
test('already owned online skips start while login-required never connects or requests QR',async t=>{
  for(const state of ['online','login_required']){const f=fixture(t);f.state.row=running(state);const r=await f.coordinator.launch(f.input());assert.equal(r.startAttempted,false);assert.equal(f.state.starts,0);assert.equal(r.outcome,state==='online'?'connected':'login_required');assert.equal(f.state.connects,state==='online'?1:0);}
});
test('external, recovery, malformed, duplicate or wrong-account observations cannot start or claim',async t=>{
  for(const kind of ['external','recovery','malformed','duplicate','wrong']){
    const f=fixture(t);if(kind==='external')f.state.row={...running(),management:'external'};if(kind==='recovery')f.state.row={...stopped(),recoveryRequired:true};if(kind==='malformed')f.state.row={...stopped(),canStart:undefined};if(kind==='wrong')f.state.row={...running(),login:{...running().login,accountId:'234567890'}};
    if(kind==='duplicate')f.coordinator.refresh=async()=>({instances:[stopped(),stopped()]});const r=await f.coordinator.launch(f.input());assert.equal(r.connectionVerified,false);assert.equal(f.state.starts+f.state.connects,0);assert.equal(r.outcome,kind==='wrong'?'account_mismatch':'blocked');
  }
});
test('offline login is checked serially within 60 monotonic seconds and never starts twice',async t=>{
  const f=fixture(t);f.state.row=running('offline');const r=await f.coordinator.launch(f.input());assert.equal(r.outcome,'timed_out');assert.equal(r.code,'login_timeout');assert.equal(f.state.time,60000);assert.equal(f.state.starts+f.state.connects,0);assert.equal(f.state.sleeps.length,30);assert.equal(f.state.refreshes,30);
});
test('online response received after waiting deadline does not start a new connection',async t=>{
  const f=fixture(t);f.state.row=running('initializing');f.coordinator.refresh=async()=>{f.state.refreshes++;if(f.state.refreshes===2){f.state.time=60001;f.state.row=running();}return f.snapshot();};const r=await f.coordinator.launch(f.input());assert.equal(r.outcome,'timed_out');assert.equal(f.state.connects,0);
});
test('same-view double click and stale cancel cannot touch the active request',async t=>{
  const held=deferred(),entered=deferred(),f=fixture(t);f.coordinator.refresh=async()=>{entered.resolve();await held.promise;return f.snapshot();};const input=f.input(),pending=f.coordinator.launch(input);await entered.promise;
  assert.throws(()=>f.coordinator.launch(f.input()),{code:'operation_in_progress'});const cancel=await f.coordinator.cancel(f.input());assert.equal(cancel.cancelled,false);held.resolve();assert.equal((await pending).outcome,'connected');
});
test('cancel before queued work starts produces zero reads, spawn or connection',async t=>{
  const f=fixture(t),input=f.input(),pending=f.coordinator.launch(input),cancel=f.coordinator.cancel(input);assert.equal((await pending).outcome,'cancelled');assert.equal((await cancel).settled,true);assert.equal(f.state.refreshes+f.state.starts+f.state.connects,0);
});
test('held pre-spawn cancellation waits for its callback and passes the final guard',async t=>{
  const entered=deferred(),held=deferred(),f=fixture(t);f.coordinator.start=async(_cap,options)=>{entered.resolve();await held.promise;options.assertCurrent();f.state.starts++;return {state:f.snapshot()};};const input=f.input(),pending=f.coordinator.launch(input);await entered.promise;let settled=false;const cancel=f.coordinator.cancel(input).then(r=>{settled=true;return r;});await Promise.resolve();assert.equal(settled,false);held.resolve();const r=await pending;await cancel;assert.equal(r.outcome,'cancelled');assert.equal(r.qqRunning,null);assert.equal(f.state.starts+f.state.connects,0);
});
test('cancel after a received spawn observation preserves running QQ and never connects or stops',async t=>{
  const entered=deferred(),held=deferred(),f=fixture(t);f.coordinator.start=async()=>{f.state.starts++;f.state.row=running();entered.resolve();await held.promise;return {state:f.snapshot()};};const input=f.input(),pending=f.coordinator.launch(input);await entered.promise;const cancel=f.coordinator.cancel(input);held.resolve();const r=await pending;await cancel;assert.equal(r.outcome,'cancelled');assert.equal(r.qqRunning,true);assert.equal(r.qqStopped,false);assert.equal(f.state.connects,0);
});
test('unknown start stops the sequence, even when a later observation might be online',async t=>{
  const f=fixture(t);f.coordinator.start=async()=>{f.state.starts++;f.state.row=running();throw error('start_unverified');};const r=await f.coordinator.launch(f.input());assert.equal(r.outcome,'unknown');assert.equal(r.qqRunning,null);assert.equal(r.code,'start_unverified');assert.deepEqual([f.state.refreshes,f.state.starts,f.state.connects],[1,1,0]);
});
test('scope replacement after awaited refresh prevents all subsequent effects',async t=>{
  const f=fixture(t);f.coordinator.refresh=async()=>{f.state.current=false;return f.snapshot();};const r=await f.coordinator.launch(f.input());assert.equal(r.outcome,'blocked');assert.equal(r.code,'changed');assert.equal(f.state.starts+f.state.connects,0);
});
test('a running process disappearing while waiting is never automatically restarted',async t=>{
  const f=fixture(t);f.state.row=running('reconnecting');f.coordinator.sleep=async ms=>{f.state.time+=ms;f.state.row=stopped();};const r=await f.coordinator.launch(f.input());assert.equal(r.code,'runtime_not_running');assert.equal(f.state.starts+f.state.connects,0);
});
test('connect cancelled at its service guard cannot claim success, but received known success survives late cancel',async t=>{
  for(const received of [false,true]){const f=fixture(t),held=deferred(),entered=deferred();f.state.row=running();f.coordinator.connect=async(cap,options)=>{options.assertCurrent({phase:'preflight',generation:0,controller:null});f.state.connects++;entered.resolve();await held.promise;if(!received)options.assertCurrent({phase:'connecting',generation:1,controller:{}});return {accountId:cap.accountId,qqAccountId:cap.qqAccountId,status:'connected'};};const input=f.input(),pending=f.coordinator.launch(input);await entered.promise;const cancel=f.coordinator.cancel(input);held.resolve();const r=await pending;await cancel;assert.equal(r.outcome,received?'connected':'cancelled');assert.equal(r.connectionVerified,received);assert.equal(f.state.connects,1);}
});
test('malformed connection acknowledgement remains unknown without repetition or exception text',async t=>{
  const f=fixture(t);f.state.row=running();f.coordinator.connect=async()=>{f.state.connects++;return {status:'connected',accountId:PROFILE,qqAccountId:'234567890',secret:'PRIVATE'};};const r=await f.coordinator.launch(f.input());assert.equal(r.outcome,'unknown');assert.equal(r.connectionVerified,false);assert.equal(f.state.connects,1);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|token|path|http/);
});
test('closeCurrent awaits owned work, allows a fresh invocation, and permanent close prevents queued work',async t=>{
  const f=fixture(t),entered=deferred(),held=deferred();f.coordinator.refresh=async()=>{entered.resolve();await held.promise;return f.snapshot();};const pending=f.coordinator.launch(f.input());await entered.promise;let closed=false;const close=f.coordinator.closeCurrent().then(r=>{closed=true;return r;});await Promise.resolve();assert.equal(closed,false);held.resolve();assert.deepEqual(await close,{closed:true});assert.equal((await pending).outcome,'cancelled');f.coordinator.refresh=f.options.refresh;assert.equal((await f.coordinator.launch(f.input())).outcome,'connected');await f.coordinator.close();assert.throws(()=>f.coordinator.launch(f.input()),{code:'manager_closing'});
});
test('an asynchronous private guard is rejected rather than treated as an authorization',()=>{
  const f=fixture();const coordinator=new QQCompanionLaunch({...f.options,capture:()=>({accountId:PROFILE,qqAccountId:QQ,contextKey:'a'.repeat(64),assertCurrent:async()=>{}})});assert.throws(()=>coordinator.launch(f.input()),{code:'changed'});
});
test('Console forwards exact optional start guard only to start and preserves legacy calls',async()=>{
  const {QQConsole}=require('../src/bot/qq-console.cjs'),calls=[],runtime={instance(){},start:async(...args)=>{calls.push(args);return {};},stop:async(...args)=>calls.push(args)};
  const manager=Object.assign(Object.create(QQConsole.prototype),{runtime,epoch:1,busy:new Set(),clients:new Map(),refreshRevision:0,refreshing:null,check(){},abortDirectory(){},refresh:async()=>({instances:[]})});
  const options={signal:new AbortController().signal,assertCurrent:()=>{}};await manager.perform('start',{accountId:QQ},undefined,options);assert.equal(calls[0][1],options);await manager.perform('start',{accountId:QQ});assert.equal(calls[1][1],undefined);await manager.perform('stop',{accountId:QQ});assert.deepEqual(calls[2],[QQ]);await assert.rejects(manager.perform('stop',{accountId:QQ},undefined,options),{code:'invalid_config'});assert.equal(calls.length,3);
});
