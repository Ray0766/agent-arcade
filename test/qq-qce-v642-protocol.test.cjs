'use strict';
// Original contract fixtures for fixed 6.4.2. Real HTTP/SQLite; no plugin/QQ/model.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const P=require('../src/bot/qq-qce-policy.cjs'),E=require('../src/bot/qq-qce-export-policy.cjs'),N=require('../src/bot/qq-qce-native-plans-policy.cjs');
const {validateNativeCron}=require('../src/bot/qq-qce-native-cron.cjs');
const {QCEExportJobs}=require('../src/bot/qq-qce-export-jobs.cjs');
const {QCEScheduleConnection}=require('../src/bot/qq-qce-schedule-runner.cjs');
const folders=require('./helpers/qq-qce-fixture.cjs'),exportsFixture=require('./helpers/qq-qce-export-fixture.cjs'),native=require('./helpers/qq-qce-native-plans-fixture.cjs');
const {fixed,exporting,plans}=require('./helpers/qq-qce-v642-fixture.cjs');
test('identity requires one captured version and exact online QQ, never guesses from response',()=>{
 const value={mode:'plugin',version:'6.4.2',napcat:{online:true,selfInfo:{uin:'100001'}}};
 assert.equal(P.identity(value,'100001','6.4.2').version,'6.4.2');
 assert.throws(()=>P.identity(value,'100001'),{code:'qce_version_unsupported'});
 assert.throws(()=>P.identity(value,'100002','6.4.2'),{code:'qq_mismatch'});
 assert.throws(()=>P.identity({...value,mode:'standalone'},'100001','6.4.2'),{code:'qce_version_unsupported'});
});
test('6.4.2 folders read effective paths and save only the selected field',async t=>{
 const f=fixed(await folders.fixture(t)),p=await f.preview(),r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});
 assert.equal(f.session.session.client.version,'6.4.2');assert.equal(r.change.outcome,'accepted');assert.equal(r.change.observation.state,'match');assert.deepEqual(Object.keys(f.writes()[0].body),['customOutputDir']);assert.equal(f.state.paths.customScheduledExportDir,null);
});
test('6.4.2 partial configuration write remains unknown despite matching readback',async t=>{
 const f=fixed(await folders.fixture(t)),p=await f.preview();f.state.writeMode='error';const r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'unknown');assert.equal(r.change.observation.state,'match');assert.equal(f.writes().length,1);assert.equal(r.change.effects.durablePersistenceVerified,false);
});
test('version changed after preview retires the old ticket without writing',async t=>{
 const f=fixed(await folders.fixture(t)),p=await f.preview();f.binding.pluginVersion='5.5.77';await assert.rejects(f.session.confirm({...f.input,ticketId:p.preview.ticketId}),{code:'changed'});assert.equal(f.writes().length,0);
});
test('6.4.2 queued create, exact task observation and full-task cancellation',async t=>{
 const f=await exporting(t),p=await f.preview(),created=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(created.change.outcome,'accepted');assert.equal(created.change.observation.task.status,'queued');
 const cancel=await f.session.preview({...f.input,action:'cancel',operationId:p.preview.operationId}),r=await f.session.confirm({...f.input,ticketId:cancel.preview.ticketId});assert.equal(r.change.outcome,'accepted');assert.equal(r.change.observation.task.status,'cancelled');assert.equal(r.change.cancelStopsAllWritesVerified,false);assert.equal(f.state.writes.length,2);
});
test('6.4.2 wrong-object cancellation response is unknown, no retry or replacement adoption',async t=>{
 const f=await exporting(t),p=await f.preview();await f.session.confirm({...f.input,ticketId:p.preview.ticketId});const cancel=await f.session.preview({...f.input,action:'cancel',operationId:p.preview.operationId});f.state.mode='wrong-cancel-peer';const r=await f.session.confirm({...f.input,ticketId:cancel.preview.ticketId});assert.equal(r.change.outcome,'unknown');assert.equal(r.change.observation.task.status,'cancelled');assert.equal(f.state.writes.length,2);assert.throws(()=>f.session.confirm({...f.input,ticketId:cancel.preview.ticketId}),{code:'stale_ticket'});
});
test('6.4.2 lost create response persists unknown and does not manufacture task identity',async t=>{
 const f=await exporting(t),p=await f.preview();f.state.mode='create-disconnect';const r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'unknown');const records=f.jobs.list(E.scope(f.binding));assert.equal(records.length,1);assert.equal(records[0].scope.pluginVersion,'6.4.2');assert.equal(records[0].taskId,null);assert.equal(f.state.writes.length,1);
});
test('old and 6.4.2 journal records reopen without cross-version task access',async t=>{
 const f=await exporting(t),p=await f.preview();await f.session.confirm({...f.input,ticketId:p.preview.ticketId});const s=E.scope(f.binding),old={...s};delete old.pluginVersion;
 const v=f.jobs.get(s,p.preview.operationId);assert.throws(()=>f.jobs.get(old,v.operationId),{code:'qce_jobs_changed'});assert.equal(E.publicJob(v,{...f.binding,pluginVersion:'5.5.77'}).canObserve,false);
 f.jobs.close();const reopened=new QCEExportJobs({root:path.join(f.root,'journal'),vault:f.jobs.vault,now:()=>f.state.now});try{assert.equal(reopened.get(s,v.operationId).taskId,v.taskId);assert.equal(reopened.list(old).length,1);assert.throws(()=>reopened.get(old,v.operationId),{code:'qce_jobs_changed'});}finally{reopened.close();}
});
test('6.4.2 native plans omit only inapplicable null fields and keep existing unknown fields',async t=>{
 const f=await plans(t),p=await f.createPreview(),r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'accepted');const body=f.writes()[0].body;assert.equal(Object.hasOwn(body,'cronExpression'),false);assert.equal(Object.hasOwn(body,'customTimeRange'),false);assert.equal(body.enabled,false);
 const raw=[...f.state.plans.values()][0];raw.options.keepMe='synthetic';const edit=await f.planPreview('update',{name:'Revised'}),changed=await f.session.confirm({...f.input,ticketId:edit.preview.ticketId});assert.equal(changed.change.outcome,'accepted');assert.equal(f.writes().at(-1).body.options.keepMe,'synthetic');
});
test('6.4.2 trigger-all reads triggeredCount and remains only a queue receipt',async t=>{
 const f=await plans(t);f.addPlan({enabled:true});f.addPlan({enabled:false});const r=await f.session.read(f.input),p=f.session.preview({...f.input,observationId:r.profile.observationId,action:'triggerAll',planId:null,draft:{includeDisabled:false}}),result=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(result.change.outcome,'accepted');assert.deepEqual(result.change.queue,{count:1});assert.equal(result.change.execution,null);assert.equal(result.change.observation.state,'unavailable');
});
test('6.4.2 native cron rejects u32 overflow and empty expansion while preserving old grammar',()=>{
 for(const value of ['0 0 */32 * *','0 */4294967296 * * *']){assert.equal(validateNativeCron(value),value);assert.throws(()=>validateNativeCron(value,'6.4.2'),{code:'invalid_cron'});}
 for(const value of ['0 */4294967295 * * *','0 0 */32,1 * *'])assert.equal(validateNativeCron(value,'6.4.2'),value);
});
test('6.4.2 custom invalid cron cannot acquire a native mutation ticket',async t=>{
 const f=await plans(t);await assert.rejects(f.createPreview({scheduleType:'custom',cronExpression:'0 0 */32 * *'}),{code:'invalid_cron'});assert.equal(f.writes().length,0);
});
test('6.4.2 retains full-list capacity rejection and never truncates native shared plans',async t=>{
 const f=await plans(t);for(let i=0;i<129;i++)f.addPlan();await assert.rejects(f.session.read(f.input),{code:'native_plan_limit'});assert.equal(f.writes().length,0);
});
test('captured 6.4.2 does not silently run an old Arcade automatic schedule',async()=>{
 let verifyCalls=0;const binding={pluginVersion:'6.4.2'},c=new QCEScheduleConnection({binding,capture:()=>binding,verifyContext:()=>{verifyCalls++;},clientFactory:()=>{},signal:new AbortController().signal,assertCurrent:()=>{}});c.check=()=>{};await assert.rejects(c.verify(),{code:'qce_version_unsupported'});assert.equal(verifyCalls,0);
});
