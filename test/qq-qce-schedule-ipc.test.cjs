'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,NEXT}=require('./helpers/qq-qce-main-fixture.cjs');
const recurrence={frequency:'daily',time:'09:00',timeZone:'Australia/Sydney',dstPolicy:{missing:'skip',repeated:'first'},missingMonthDay:'skip'};
const options={includeSystemMessages:false,preferGroupMemberName:true,resources:{image:false,video:false,audio:false,file:false},htmlZip:false};
const tickDetails=(result,f)=>JSON.stringify({busy:result.busy===true,initialized:result.initialized===true,outcome:result.run?.outcome??null,code:result.run?.code??null,posts:f.posts.length,qceRoutes:f.qce.state.requests.map(r=>r.path)});
async function setup(t){
 const f=await fixture(t);await f.save();const posts=[];
 f.qce.state.handle=async(row,res,send)=>{
  if(row.path==='/api/friends?page=1&limit=100'){send({friends:[{uid:'u_SyntheticScheduleFriend',uin:'200001',nick:'Synthetic scheduled friend',remark:''}],totalCount:1,totalPages:1,currentPage:1,hasNext:false,hasPrev:false});return true;}
  if(row.path==='/api/messages/export'){
   posts.push(row);if(f.qce.state.loseScheduleAck){res.destroy();return true;}
   send({taskId:`export_1800000000000_sch${posts.length}`,fileName:'synthetic-schedule.json',status:'running',messageCount:0,startTime:row.body.filter.startTime,endTime:row.body.filter.endTime});return true;
  }return false;
 };
 // This fixture advances its own synthetic clock explicitly. Retire the real
 // five-second timer so a loaded full-suite worker cannot race an explicit tick.
 const list=async()=>{const result=await f.invoke('ScheduleList');f.api.stopScheduleTimer();await f.api.qceScheduleRunner.pending;return result;},action=async(action,plan)=>{const p=await f.invoke('SchedulePreview',{...f.input,action,scheduleId:plan.scheduleId,revision:plan.revision});assert.equal(p.ok,true,JSON.stringify(p));const c=await f.invoke('ScheduleConfirm',{...f.input,ticketId:p.preview.ticketId});assert.equal(c.ok,true,JSON.stringify(c));return c.change;};
 const create=async()=>{
  const l=await list();assert.equal(l.ok,true,JSON.stringify(l));await f.api.qceScheduleRunner.tick();
  const r=await f.invoke('ScheduleRead',{...f.input,kind:'friends',page:1});assert.equal(r.ok,true,JSON.stringify(r));
  const p=await f.invoke('SchedulePreview',{...f.input,action:'create',observationId:r.profile.observationId,targetId:r.profile.targets[0].targetId,name:'Synthetic daily archive',recurrence,lookbackDays:7,format:'JSON',options});assert.equal(p.ok,true,JSON.stringify(p));
  const c=await f.invoke('ScheduleConfirm',{...f.input,ticketId:p.preview.ticketId});assert.equal(c.ok,true,JSON.stringify(c));assert.equal(c.change.outcome,'saved',JSON.stringify(c));return c.change.plan;
 };
 return {...f,posts,list,action,create};
}
test('main local plan list works offline without network or model credential changes',async t=>{
 const f=await setup(t);f.state.online=false;f.qce.state.online=false;f.console.state.instances[0].login.online=false;
 const before=[f.calls.length,f.qce.state.requests.length],secret=JSON.stringify(f.service.secret),result=await f.list();
 assert.equal(result.ok,true,JSON.stringify(result));assert.deepEqual(result.plans,[]);assert.equal(result.source,'local-encrypted-schedule-store');assert.deepEqual([f.calls.length,f.qce.state.requests.length],before);assert.equal(JSON.stringify(f.service.secret),secret);
});
test('actual main saves paused, enables explicitly and dispatches one scheduled export while minimized',async t=>{
 const f=await setup(t),p=await f.create();assert.equal(p.enabled,false);assert.equal(f.posts.length,0);
 const enabled=(await f.action('enable',p)).plan;assert.equal(enabled.enabled,true);f.win.minimized=true;f.win.visible=false;f.qce.state.now=enabled.nextAt+1000;
 const tick=await f.api.qceScheduleRunner.tick();assert.equal(tick.run?.outcome,'accepted',tickDetails(tick,f));assert.equal(f.posts.length,1);assert.equal(f.posts[0].body.filter.endTime,enabled.nextAt);assert.equal(f.posts[0].body.filter.endTime-f.posts[0].body.filter.startTime,7*86400000);
 await f.api.qceScheduleRunner.tick();assert.equal(f.posts.length,1);
 f.win.minimized=false;f.win.visible=true;const l=await f.list();assert.equal(l.ok,true,JSON.stringify(l));const r=await f.invoke('ScheduleRuns',{...f.input,scheduleId:p.scheduleId});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.runs[0].outcome,'accepted');
 const exports=await f.invoke('ExportJobs',{...f.input,panelId:NEXT});assert.equal(exports.ok,true,JSON.stringify(exports));assert.equal(exports.jobs[0].operationId,r.runs[0].operationId);assert.equal(exports.jobs[0].submission,'acknowledged');
 assert.doesNotMatch(JSON.stringify(r),/u_SyntheticScheduleFriend|Synthetic-QCE|token|peerUid/);
});

test('scheduled identity read tolerates delay beyond the low-level timeout fixture budget',async t=>{
 const f=await setup(t),p=await f.create(),enabled=(await f.action('enable',p)).plan;
 let delayed=false;f.qce.state.before=async row=>{if(!delayed&&row.path==='/api/system/info'){delayed=true;await new Promise(resolve=>setTimeout(resolve,250));}};
 f.win.minimized=true;f.win.visible=false;f.qce.state.now=enabled.nextAt+1000;
 const result=await f.api.qceScheduleRunner.tick(),diagnostic=tickDetails(result,f);
 assert.equal(delayed,true,diagnostic);assert.equal(result.run?.outcome,'accepted',diagnostic);assert.equal(f.posts.length,1,diagnostic);
 await f.api.qceScheduleRunner.tick();assert.equal(f.posts.length,1);
});
test('explicit run once creates one owned export and consumed confirmation cannot repeat it',async t=>{
 const f=await setup(t),p=await f.create(),preview=await f.invoke('SchedulePreview',{...f.input,action:'run',scheduleId:p.scheduleId,revision:p.revision});assert.equal(preview.ok,true,JSON.stringify(preview));
 const r=await f.invoke('ScheduleConfirm',{...f.input,ticketId:preview.preview.ticketId});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.change.outcome,'accepted');assert.equal(f.posts.length,1);
 assert.equal((await f.invoke('ScheduleConfirm',{...f.input,ticketId:preview.preview.ticketId})).ok,false);assert.equal(f.posts.length,1);
});
test('missing create reply remains unknown and a repeated tick does not resend that occurrence',async t=>{
 const f=await setup(t),p=await f.create(),enabled=(await f.action('enable',p)).plan;f.qce.state.loseScheduleAck=true;f.qce.state.now=enabled.nextAt+500;
 await f.api.qceScheduleRunner.tick();await f.api.qceScheduleRunner.tick();assert.equal(f.posts.length,1);
 const r=await f.invoke('ScheduleRuns',{...f.input,scheduleId:p.scheduleId});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.runs[0].outcome,'unknown');
});
test('QQ offline permits local pause and remove with no new QCE request',async t=>{
 const f=await setup(t),p=await f.create(),enabled=(await f.action('enable',p)).plan;
 f.state.online=false;f.qce.state.online=false;f.console.state.instances[0].login.online=false;await f.list();const before=[f.calls.length,f.qce.state.requests.length];
 const paused=(await f.action('disable',enabled)).plan;assert.equal(paused.enabled,false);assert.equal((await f.action('remove',paused)).outcome,'removed');assert.deepEqual([f.calls.length,f.qce.state.requests.length],before);assert.equal((await f.list()).plans.length,0);
});
test('foreground request cannot opt into background identity or supply raw destination/path',async t=>{
 const f=await setup(t),before=f.qce.state.requests.length;
 for(const extra of [{background:true},{peer:{chatType:1,peerUid:'u_injected'}},{outputDir:'C:\\synthetic-injected'}])assert.equal((await f.invoke('ScheduleList',{...f.input,...extra})).ok,false);
 assert.equal(f.qce.state.requests.length,before);f.win.minimized=true;assert.equal((await f.list()).ok,false);
 await assert.rejects(async()=>f.invoke('ScheduleList',f.input,{sender:{},senderFrame:{}}),/Untrusted sender/);
});
test('closing a schedule panel keeps its enabled plan but does not dispatch immediately',async t=>{
 const f=await setup(t),p=await f.create();await f.action('enable',p);const before=f.posts.length;
 const r=await f.invoke('ScheduleClose');assert.equal(r.closed,true);assert.equal(f.posts.length,before);assert.equal((await f.list()).plans[0].enabled,true);
});
test('switching the selected companion retires its panel without disabling its authorized schedule',async t=>{
 const f=await setup(t),p=await f.create(),enabled=(await f.action('enable',p)).plan;
 await f.handlers.get('arcade:accountSelect')(f.event,'other');assert.equal((await f.list()).ok,false);
 f.qce.state.now=enabled.nextAt+1000;await f.api.qceScheduleRunner.tick();assert.equal(f.posts.length,1);
});
test('actual QQ mismatch prevents background export despite a configured matching profile',async t=>{
 const f=await setup(t),p=await f.create(),enabled=(await f.action('enable',p)).plan;f.state.account='300001';f.qce.state.now=enabled.nextAt+1000;
 await f.api.qceScheduleRunner.tick();assert.equal(f.posts.length,0);const r=await f.invoke('ScheduleRuns',{...f.input,scheduleId:p.scheduleId});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.runs[0].outcome,'not_submitted');
});
test('history entrance retires the previous plugin view and old close cannot retire its replacement',async t=>{
 const f=await setup(t);assert.equal((await f.invoke('Read')).ok,true);assert.equal(f.api.qceSession.accountId,'whale');
 const r=await f.invoke('ScheduleRuns',{...f.input,panelId:NEXT,scheduleId:null});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(f.api.qceSession.accountId,null);assert.equal(f.api.qceScheduleSession.panelId,NEXT);
 assert.equal((await f.invoke('ScheduleClose')).closed,true);assert.equal(f.api.qceScheduleSession.panelId,NEXT);
});
test('preload exposes only eight fixed schedule methods with no scheduler flag or private config method',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),exposed={},calls=[];
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>exposed[name]=value},ipcRenderer:{invoke:(...args)=>calls.push(args)}})});
 const suffixes=['List','Read','Preview','Confirm','Runs','ForgetRun','Dismiss','Close'],input={accountId:'whale'};
 assert.deepEqual(Object.keys(exposed.arcade).filter(k=>k.startsWith('qqQceSchedule')),suffixes.map(s=>'qqQceSchedule'+s));for(const s of suffixes)exposed.arcade['qqQceSchedule'+s](input);assert.equal(calls.length,8);assert(calls.every(([,v])=>v===input));
});
