'use strict';
// Real temporary SQLite and loopback HTTP; all identities, tokens and data synthetic.
const path=require('node:path');
const {fixture:exportFixture,deferred,flush}=require('./qq-qce-export-fixture.cjs');
const {QCEScheduleStore}=require('../../src/bot/qq-qce-schedule-store.cjs');
const {QQQCEScheduleRunner}=require('../../src/bot/qq-qce-schedule-runner.cjs');
const {QQQCEScheduleSession}=require('../../src/bot/qq-qce-schedule-session.cjs');
const P=require('../../src/bot/qq-qce-schedule-policy.cjs');
const recurrence=()=>({frequency:'daily',time:'12:00',timeZone:'UTC',dstPolicy:{missing:'skip',repeated:'first'},missingMonthDay:'skip'});
async function fixture(t,extra={}){
 const cleanup=[],f=await exportFixture({after:fn=>cleanup.push(fn)});f.state.now=Date.parse('2026-11-07T10:00:00.000Z');
 const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('SYNTHETIC-SCHEDULE:'+s),decryptString:b=>{const s=b.toString(),prefix='SYNTHETIC-SCHEDULE:';if(!s.startsWith(prefix))throw Error('synthetic test container');return s.slice(prefix.length);}};
 const storeOptions={root:path.join(f.root,'schedules'),vault,now:()=>f.state.now},store=new QCEScheduleStore(storeOptions);
 const runnerOptions={store,jobs:f.jobs,capture:v=>({...f.binding,panelId:v.panelId}),verifyContext:f.sessionOptions.verifyContext,clientFactory:f.sessionOptions.clientFactory,now:()=>f.state.now,...extra.runner};
 const runner=new QQQCEScheduleRunner(runnerOptions),sessionOptions={captureLocal:()=>({...f.binding}),captureNetwork:f.sessionOptions.capture,verifyContext:f.sessionOptions.verifyContext,store,runner,clientFactory:f.sessionOptions.clientFactory,now:()=>f.state.now,monotonic:()=>f.state.mono,...extra.session},session=new QQQCEScheduleSession(sessionOptions);
 t.after(async()=>{await session.close();await runner.close();store.close();for(const fn of cleanup)await fn();});
 const definition=()=>P.validateDefinition({name:'Synthetic schedule',target:{kind:'friend',peer:{chatType:1,peerUid:'u_synthetic_friend'},name:'Synthetic friend',number:'100002'},targetPage:1,configBaseline:{...f.state.paths},recurrence:recurrence(),lookbackDays:1,format:'JSON',options:f.options});
 async function preview(action='create',plan=null){
  if(['create','edit'].includes(action)){const r=await session.read({...f.input,kind:'friends',page:1});return session.preview({...f.input,action,observationId:r.profile.observationId,targetId:r.profile.targets[0].targetId,name:'Synthetic schedule',recurrence:recurrence(),lookbackDays:1,format:'JSON',options:f.options,...(plan?{scheduleId:plan.scheduleId,revision:plan.revision}:{})});}
  await session.list(f.input);return session.preview({...f.input,action,scheduleId:plan.scheduleId,revision:plan.revision});
 }
 const create=()=>store.create(P.fullScope(f.binding),definition());
 return {...f,session,sessionOptions,store,storeOptions,runner,runnerOptions,definition,preview,create,scope:()=>P.fullScope(f.binding)};
}
module.exports={fixture,deferred,flush,recurrence};
