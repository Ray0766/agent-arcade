'use strict';
// Boundary tests use synthetic ownership evidence. Native process acceptance is
// kept in qq-shell-owner-live.test.cjs; TLS/SQLite below are real localhost.
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {SupervisorRuntime}=require('../../../src/qq-supervisor/runtime.cjs'),P=require('../../../src/qq-supervisor/policy.cjs');
const {directories,deferred,material,requestFor}=require('./helpers.cjs'),{createService}=require('../../../src/qq-supervisor/server.cjs');
function adapterFixture(t,{issue='pending_upstream_update'}={}){
 const f=directories(t),state={issue,binding:'a'.repeat(64),management:'owned',inspectCalls:0,discoverCalls:0,actions:[],gates:[],beforeInspect:null,beforeMutation:null,transform:null};
 const row=()=>({accountId:f.config.expectedQQ,management:state.management,processRunning:state.management==='owned',canStart:false,canStop:state.management==='owned',canRecover:state.management==='recoverable',recoveryRequired:state.management==='recoverable',reason:state.issue,configured:false});
 const manager={runs:new Map(),operations:new Map(),componentSelection:()=>({resolve:async()=>{throw Object.assign(Error('private component detail'),{code:state.issue});}}),discover:async()=>{state.discoverCalls++;throw Error('ordinary discover must not bypass blocked selection');},
  async inspectOwnerControl(accountId,options){state.inspectCalls++;assert.equal(accountId,f.config.expectedQQ);if(state.beforeInspect)await state.beforeInspect();options.assertCurrent();const result={row:row(),binding:state.binding,componentIssue:state.issue,configured:false};return state.transform?state.transform(result):result;},
  async close(){return {closed:true};}};
 for(const action of ['start','stop','recover'])manager[action]=async(accountId,options)=>{assert.equal(accountId,f.config.expectedQQ);state.gates.push(options.assertCurrent);if(state.beforeMutation)await state.beforeMutation();options.assertCurrent();state.actions.push(action);state.management=action==='stop'?'stopped':'owned';return {...row(),...(action==='recover'?{recovery:'adopted'}:{})};};
 const adapter=new SupervisorRuntime(f.config,{managerFactory:()=>manager});f.cleanup.push(()=>adapter.close());return {...f,state,manager,adapter};
}
for(const issue of ['pending_upstream_update','pending_update_recovery_required'])test(`blocked component exposes proved stop without start or ordinary resolution: ${issue}`,async t=>{
 const f=adapterFixture(t,{issue}),o=await f.adapter.observe();assert.equal(o.status.configured,false);assert.equal(o.status.canStop,true);assert.equal(o.status.canStart,false);assert.equal(o.status.reason,issue);assert.equal(o.status.qqOnline,'unknown');assert.match(o.binding,/^[a-f0-9]{64}$/);assert.notEqual(o.binding,f.state.binding);assert.equal(f.state.discoverCalls,0);assert.deepEqual(f.state.actions,[]);assert.doesNotMatch(JSON.stringify(o),/private|accountId|descriptor|[A-Z]:\\/);
});
test('unrelated selection errors and unsupported legacy manager never enter owner fallback',async t=>{
 const f=adapterFixture(t,{issue:'unsafe_lock'});await assert.rejects(f.adapter.observe(),{code:'unsafe_lock'});assert.equal(f.state.inspectCalls,0);f.state.issue='pending_upstream_update';delete f.manager.inspectOwnerControl;await assert.rejects(f.adapter.observe(),{code:'pending_upstream_update'});assert.equal(f.state.inspectCalls,0);
});
test('malformed owner evidence cannot enable fallback or export a wrong account',async t=>{
 const f=adapterFixture(t);for(const change of [v=>({...v,configured:true}),v=>({...v,componentIssue:'component_changed'}),v=>({...v,binding:'private path'}),v=>({...v,row:{...v.row,accountId:'12345002'}}),v=>({...v,row:{...v.row,canStart:true}})]){f.state.transform=change;await assert.rejects(f.adapter.observe(),{code:'runtime_failed'});}assert.equal(f.state.discoverCalls,0);assert.deepEqual(f.state.actions,[]);
});
test('close during asynchronous ownership observation prevents stale status',async t=>{
 const f=adapterFixture(t),gate=deferred();f.state.beforeInspect=()=>gate.promise;const read=f.adapter.observe();await new Promise(r=>setImmediate(r));await f.adapter.close();gate.resolve();await assert.rejects(read,{code:'closed'});assert.deepEqual(f.state.actions,[]);
});
test('stop and recover receive the original synchronous deadline guard through adapter',async t=>{
 const f=adapterFixture(t);for(const action of ['stop','recover']){const gate=deferred();f.state.beforeMutation=()=>gate.promise;let current=true;const guard=()=>{if(!current)P.fail('changed');};const result=f.adapter.execute(action,guard);await new Promise(r=>setImmediate(r));current=false;gate.resolve();await assert.rejects(result,{code:'changed'});assert.equal(f.state.gates.at(-1),guard);}assert.deepEqual(f.state.actions,[]);
});
test('fallback execution retains blocked configured state and explicit recovery outcome',async t=>{
 const f=adapterFixture(t);const stopped=await f.adapter.execute('stop',()=>{});assert.equal(stopped.result.configured,false);assert.equal(stopped.result.management,'stopped');assert.equal(stopped.result.canStart,false);assert.equal(stopped.recovery,null);const recovered=await f.adapter.execute('recover',()=>{});assert.equal(recovered.result.configured,false);assert.equal(recovered.result.management,'owned');assert.equal(recovered.recovery,'adopted');assert.deepEqual(f.state.actions,['stop','recover']);
});
test('empty run map cannot replace exact owner cleanup confirmation on close retry',async t=>{
 const f=adapterFixture(t);let attempts=0;f.manager.close=async()=>({closed:++attempts>1});assert.equal(f.manager.runs.size,0);await assert.rejects(f.adapter.close(),{code:'cleanup_unconfirmed'});assert.equal(f.adapter.closed,false);assert.deepEqual(await f.adapter.close(),{closed:true});assert.equal(attempts,2);assert.equal(f.adapter.closed,true);assert.deepEqual(await f.adapter.close(),{closed:true});assert.equal(attempts,2);assert.deepEqual(f.state.actions,[]);
});
test('real TLS ledger accepts proved stop while configured false and rejects start without invocation',async t=>{
 const f=adapterFixture(t),service=await createService({config:f.config,tls:material,runtimeFactory:()=>f.adapter});f.cleanup.push(()=>service.close());await service.listen();const request=requestFor(service.server.address().port,f.config);
 let observation=await request('GET','/v1/status');assert.equal(observation.status.configured,false);const denied=await request('POST','/v1/operations',{requestId:randomUUID(),observationId:observation.observationId,action:'start'});assert.equal(denied.operation.phase,'not_submitted');assert.equal(denied.operation.code,'pending_upstream_update');assert.deepEqual(f.state.actions,[]);
 observation=await request('GET','/v1/status');const input={requestId:randomUUID(),observationId:observation.observationId,action:'stop'},reply=await request('POST','/v1/operations',input);assert.equal(reply.operation.phase,'completed');assert.equal(reply.operation.result.configured,false);assert.equal(reply.operation.result.management,'stopped');assert.equal(reply.operation.result.canStart,false);assert.equal((await request('POST','/v1/operations',input)).operation.requestId,input.requestId);assert.deepEqual(f.state.actions,['stop']);assert.equal((await request('GET','/v1/operations/'+input.requestId)).operation.result.configured,false);
});
test('invisible owner replacement invalidates an observation before actual runtime invocation',async t=>{
 const f=adapterFixture(t),service=await createService({config:f.config,tls:material,runtimeFactory:()=>f.adapter});f.cleanup.push(()=>service.close());await service.listen();const request=requestFor(service.server.address().port,f.config),o=await request('GET','/v1/status');f.state.binding='b'.repeat(64);const next=await request('GET','/v1/status');assert.deepEqual(o.status,next.status);const reply=await request('POST','/v1/operations',{requestId:randomUUID(),observationId:o.observationId,action:'stop'});assert.equal(reply.operation.phase,'not_submitted');assert.equal(reply.operation.code,'changed');assert.deepEqual(f.state.actions,[]);
});
