'use strict';
// Production main/client with owned loopback HTTP; account, vault and plans are synthetic.
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,TOKEN,PANEL,NEXT,until,deferred}=require('./helpers/qq-qce-main-fixture.cjs');
const options=()=>Object.fromEntries(['includeResourceLinks','includeSystemMessages','filterPureImageMessages','prettyFormat','preferGroupMemberName','skipFileDownload','embedResourcesAsDataUri','showSearchBar','enableVirtualScroll','skipDownloadResourceTypes','maxEmbedFileSizeBytes'].map(key=>[key,{present:false,value:null}]));
const rawPlan=(id='scheduled_1800000000000_native001')=>({id,name:'Synthetic native plan',peer:{chatType:1,peerUid:'u_SyntheticNativeFriend',guildId:''},scheduleType:'daily',executeTime:'09:00',timeRangeType:'last-7-days',format:'JSON',options:{prettyFormat:true,syntheticUnknownOption:'KEEP_PRIVATE'},outputDir:'C:\\Synthetic-QCE\\native-output',enabled:false,createdAt:'2026-11-07T00:00:00.000Z',updatedAt:'2026-11-07T00:00:00.000Z',nextRun:'2026-11-08T00:00:00.000Z',syntheticUnknownTop:'KEEP_PRIVATE'});
async function setup(t){
 const f=await fixture(t);await f.save();const native={plans:[rawPlan()],writes:[],histories:[],nextId:2};
 f.qce.state.handle=async(row,res,send)=>{
  const root='/api/scheduled-exports';
  if(row.path==='/api/friends?page=1&limit=100'){send({friends:[{uid:'u_SyntheticNativeFriend',uin:'200001',nick:'Synthetic target',remark:''}],totalCount:1,totalPages:1,currentPage:1,hasNext:false,hasPrev:false});return true;}
  if(!row.path.startsWith(root))return false;
  const tail=row.path.slice(root.length),parts=tail.split('/').filter(Boolean),id=parts[0]?decodeURIComponent(parts[0].split('?')[0]):null;
  const notFound=()=>{res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:false,error:{context:{code:'SCHEDULED_EXPORT_NOT_FOUND'},message:'Synthetic missing plan'},timestamp:'2026-11-07T00:00:00.000Z',requestId:randomUUID()}));};
  if(row.method==='GET'){
   if(!tail){send({scheduledExports:structuredClone(native.plans)});return true;}
   if(parts[1]?.startsWith('history')){send({history:structuredClone(native.histories.filter(h=>h.scheduledExportId===id))});return true;}
   const p=native.plans.find(p=>p.id===id);if(p)send(structuredClone(p));else notFound();return true;
  }
  native.writes.push(row);await native.beforeWrite?.(row);
  let response;
  if(row.method==='POST'&&!tail){const p={...row.body,id:`scheduled_1800000000000_native00${native.nextId++}`,createdAt:'2026-11-07T00:00:00.000Z',updatedAt:'2026-11-07T00:00:00.000Z',nextRun:'2026-11-08T00:00:00.000Z'};native.plans.push(p);response=structuredClone(p);}
  else if(tail==='/trigger-all'){const triggered=native.plans.filter(p=>row.body.includeDisabled||p.enabled).map(({id,name})=>({id,name}));response={triggered,count:triggered.length};}
  else{
   const index=native.plans.findIndex(p=>p.id===id);if(index<0){notFound();return true;}
   if(row.method==='PUT'){native.plans[index]={...native.plans[index],...row.body,updatedAt:'2026-11-07T00:01:00.000Z'};response=structuredClone(native.plans[index]);}
   else if(row.method==='DELETE'){native.plans.splice(index,1);response={message:'Synthetic removal acknowledgment'};}
   else if(parts[1]==='trigger'){
    await native.onTrigger?.(row);
    const h={id:'history_'+native.histories.length,scheduledExportId:id,executedAt:'2026-11-07T00:02:00.000Z',status:native.runStatus||'partial',messageCount:3,filePath:'C:\\Synthetic-QCE\\PRIVATE_HISTORY_FILE.json',fileSize:64,duration:12,error:'PRIVATE_HISTORY_ERROR',resourceSummary:{attempted:2,alreadyAvailable:0,downloaded:1,failed:1,skipped:0,failedSamples:['PRIVATE_RESOURCE_SAMPLE']}};
    native.histories.unshift(h);response=structuredClone(h);
   }else{res.statusCode=404;res.end();return true;}
  }
  if(native.loseAck){res.destroy();return true;}send(response);return true;
 };
 const read=async(input=f.input)=>{const r=await f.invoke('NativePlansRead',input);assert.equal(r.ok,true,JSON.stringify(r));return r.profile;};
 const inspect=async(index=0)=>{const p=await read(),r=await f.invoke('NativePlansInspect',{...f.input,observationId:p.observationId,planId:p.plans[index].planId});assert.equal(r.ok,true,JSON.stringify(r));return r.detail;};
 const preview=async(action='enable',detail=null,draft=null)=>{const d=detail||await inspect(),r=await f.invoke('NativePlansPreview',{...f.input,observationId:d.observationId,planId:d.plan.planId,action,draft});assert.equal(r.ok,true,JSON.stringify(r));return r.preview;};
 const confirm=async(p)=>{const r=await f.invoke('NativePlansConfirm',{...f.input,ticketId:p.ticketId});assert.equal(r.ok,true,JSON.stringify(r));return r.change;};
 return {...f,native,read,inspect,preview,confirm};
}

test('native management uses fixed verified connection, one-use enable and private identifiers',async t=>{
 const f=await setup(t),secrets=JSON.stringify(f.service.secret),p=await f.preview();assert.equal(p.scope.futureQQBound,false);assert.equal(f.native.writes.length,0);
 const r=await f.confirm(p);assert.equal(r.outcome,'accepted');assert.equal(r.observation.state,'match');assert.equal(r.effects.durablePersistenceVerified,false);
 assert.deepEqual(f.native.writes.map(x=>[x.method,x.path,x.body]),[['PUT','/api/scheduled-exports/scheduled_1800000000000_native001',{enabled:true}]]);
 assert.equal((await f.invoke('NativePlansConfirm',{...f.input,ticketId:p.ticketId})).ok,false);assert.equal(f.native.writes.length,1);
 assert(f.calls.some(x=>x.path==='/api/Plugin/List'));assert(f.state.nativeProofs>=3);assert(f.qce.state.requests.every(x=>x.authorization==='Bearer '+TOKEN));
 assert.doesNotMatch(JSON.stringify(r),/scheduled_1800|u_SyntheticNative|KEEP_PRIVATE/);assert.equal(JSON.stringify(f.service.secret),secrets);assert.equal(f.pollingClosed,0);
});

test('create reads current targets, keeps full custom output choice and explicitly saves paused',async t=>{
 const f=await setup(t),profile=await f.read(),target=await f.invoke('NativePlansTargets',{...f.input,kind:'friend',page:1});assert.equal(target.ok,true,JSON.stringify(target));
 const draft={name:'Synthetic new plan',target:{observationId:target.targets.observationId,targetId:target.targets.items[0].targetId},scheduleType:'custom',executeTime:'09:00',cronExpression:'0 9 * * 1,7',timeRangeType:'custom',customTimeRange:{startTime:-7200,endTime:0},format:'HTML',options:options(),output:{mode:'custom',path:'C:\\Synthetic-QCE\\explicit-native'}};
 draft.options.skipDownloadResourceTypes={present:true,value:['image','video','audio','file']};draft.options.showSearchBar={present:true,value:false};
 const p=await f.invoke('NativePlansPreview',{...f.input,observationId:profile.observationId,planId:null,action:'create',draft});assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.preview.enabledAfter,false);
 const r=await f.confirm(p.preview);assert.equal(r.outcome,'accepted');assert.equal(typeof r.planId,'string');const sent=f.native.writes[0].body;
 assert.equal(sent.enabled,false);assert.deepEqual(sent.peer,{chatType:1,peerUid:'u_SyntheticNativeFriend',guildId:''});assert.equal(sent.outputDir,draft.output.path);assert.equal(sent.cronExpression,draft.cronExpression);assert.deepEqual(sent.customTimeRange,draft.customTimeRange);assert.equal(sent.options.showSearchBar,false);
});

test('typed update retains private top-level and unknown option fields while pausing the plan',async t=>{
 const f=await setup(t);f.native.plans[0].enabled=true;const detail=await f.inspect(),definition=detail.definition;
 const draft={name:'Synthetic changed plan',target:null,scheduleType:definition.scheduleType,executeTime:'10:30',cronExpression:definition.cronExpression,timeRangeType:definition.timeRangeType,customTimeRange:definition.customTimeRange,format:definition.format,options:structuredClone(definition.options),output:{mode:'keep',path:null}};
 draft.options.prettyFormat={present:true,value:false};const r=await f.confirm(await f.preview('update',detail,draft));assert.equal(r.outcome,'accepted');
 const sent=f.native.writes[0].body;assert.equal(sent.enabled,false);assert.equal(sent.options.syntheticUnknownOption,'KEEP_PRIVATE');assert.equal(sent.options.prettyFormat,false);assert.equal(Object.hasOwn(sent,'peer'),false);assert.equal(Object.hasOwn(sent,'outputDir'),false);assert.equal(f.native.plans[0].syntheticUnknownTop,'KEEP_PRIVATE');
});

test('single run returns native partial history without creating a manual-download identity',async t=>{
 const f=await setup(t),r=await f.confirm(await f.preview('run'));assert.equal(r.outcome,'accepted');assert.equal(r.execution.status,'partial');assert.equal(r.execution.file.present,true);assert.equal(r.execution.file.bytes,64);assert.equal(r.queue,null);
 assert.doesNotMatch(JSON.stringify(r),/PRIVATE_HISTORY|PRIVATE_RESOURCE|scheduled_1800|taskId|downloadUrl/);
 const d=await f.inspect(),h=await f.invoke('NativePlansHistory',{...f.input,observationId:d.observationId,planId:d.plan.planId,limit:50});assert.equal(h.ok,true,JSON.stringify(h));assert.equal(h.history.items[0].status,'partial');assert.equal(h.history.hasPagination,false);
 assert.equal(f.native.writes.length,1);assert(f.qce.state.requests.some(x=>x.path.endsWith('/history?limit=50')));
});

test('remove previews an absent resulting plan and acknowledges removal without claiming cancellation',async t=>{
 const f=await setup(t),p=await f.preview('remove');assert.equal(p.after,null);assert.equal(p.enabledAfter,null);assert.equal(p.effects.cancelsRunning,false);assert.equal(p.effects.cancelsQueued,false);assert.equal(p.effects.mayReappearAfterRemoval,true);
 const r=await f.confirm(p);assert.equal(r.outcome,'accepted');assert.equal(r.observation.state,'absent');assert.equal(f.native.plans.length,0);assert.equal(f.native.writes.length,1);assert.equal(f.native.writes[0].method,'DELETE');assert.equal(r.effects.durablePersistenceVerified,false);
});

test('run-all permits the explicitly authorized dynamic eligible set and only acknowledges its queue',async t=>{
 const f=await setup(t);f.native.plans[0].enabled=true;const profile=await f.read();
 const p=await f.invoke('NativePlansPreview',{...f.input,observationId:profile.observationId,planId:null,action:'triggerAll',draft:{includeDisabled:false}});assert.equal(p.ok,true,JSON.stringify(p));assert.equal(p.preview.triggerAll.selection,'all-eligible-at-server-receipt');assert.equal(p.preview.triggerAll.observedCount,1);
 f.native.beforeWrite=row=>{if(row.path.endsWith('/trigger-all'))f.native.plans.push({...rawPlan('scheduled_1800000000000_native099'),enabled:true});};
 const r=await f.confirm(p.preview);assert.equal(r.outcome,'accepted');assert.equal(r.queue.count,2);assert.equal(r.execution,null);assert.deepEqual(f.native.writes[0].body,{includeDisabled:false});assert.equal(f.native.writes.length,1);
});

test('lost create acknowledgment never adopts the new shared record or automatically retries',async t=>{
 const f=await setup(t),profile=await f.read(),target=await f.invoke('NativePlansTargets',{...f.input,kind:'friend',page:1});
 const draft={name:'Synthetic uncertain creation',target:{observationId:target.targets.observationId,targetId:target.targets.items[0].targetId},scheduleType:'daily',executeTime:'09:00',cronExpression:null,timeRangeType:'last-7-days',customTimeRange:null,format:'JSON',options:options(),output:{mode:'default',path:null}};
 const p=await f.invoke('NativePlansPreview',{...f.input,observationId:profile.observationId,planId:null,action:'create',draft});assert.equal(p.ok,true,JSON.stringify(p));f.native.loseAck=true;
 const r=await f.confirm(p.preview);assert.equal(r.outcome,'unknown');assert.equal(r.planId,null);assert.equal(f.native.plans.length,2);assert.equal(f.native.writes.length,1);
 assert.equal((await f.invoke('NativePlansConfirm',{...f.input,ticketId:p.preview.ticketId})).ok,false);assert.equal(f.native.writes.length,1);
});

test('current QQ change after native preview prevents a write',async t=>{
 for(const change of [f=>f.state.account='300001',f=>f.qce.state.account='300001',f=>f.console.epoch++]){
  const f=await setup(t),p=await f.preview();change(f);const r=await f.invoke('NativePlansConfirm',{...f.input,ticketId:p.ticketId});assert(r.ok===false||r.change.submission==='not_submitted',JSON.stringify(r));assert.equal(f.native.writes.length,0);
 }
});

test('missing native owner follow-ups do not retire a different valid plugin view',async t=>{
 const f=await setup(t),settings=await f.invoke('Read');assert.equal(settings.ok,true);const observationId=randomUUID(),planId=randomUUID();
 for(const [suffix,value]of [['Inspect',{observationId,planId}],['Targets',{kind:'friend',page:1}],['History',{observationId,planId,limit:50}]])assert.equal((await f.invoke('NativePlans'+suffix,{...f.input,...value})).ok,false);
 assert.equal(f.api.qceSession.accountId,'whale');assert.equal(f.api.qceNativePlansSession.accountId,null);assert.equal(f.native.writes.length,0);
});

test('invalid native read cannot retire its valid preview or accept endpoint/background authority',async t=>{
 const f=await setup(t),p=await f.preview(),before=f.qce.state.requests.length;
 for(const extra of [{background:true},{host:'example.invalid'},{nativeId:'scheduled_1800000000000_native001'},{token:TOKEN},{path:'/api/scheduled-exports'}])assert.equal((await f.invoke('NativePlansRead',{...f.input,...extra})).ok,false);
 await assert.rejects(f.invoke('NativePlansRead',f.input,{sender:{},senderFrame:f.event.senderFrame}));assert.equal(f.qce.state.requests.length,before);
 assert.equal((await f.confirm(p)).outcome,'accepted');
});

test('hide during pending native owner handoff prevents a late session and HTTP request',async t=>{
 const f=await setup(t),gate=deferred(),original=f.api.pluginAdminSession.closeCurrent.bind(f.api.pluginAdminSession);let entered=false;
 f.api.pluginAdminSession.closeCurrent=async()=>{entered=true;await original();await gate.promise;};
 const pending=f.invoke('NativePlansRead');await until(()=>entered);f.win.visible=false;f.emit('hide');gate.resolve();assert.equal((await pending).ok,false);assert.equal(f.api.qceNativePlansSession.accountId,null);assert.equal(f.qce.state.requests.length,0);
});

test('replacement native panel survives old close and credential status retires it without network',async t=>{
 const f=await setup(t);await f.read();await f.read({...f.input,panelId:NEXT});await f.invoke('NativePlansClose');assert.equal(f.api.qceNativePlansSession.panelId,NEXT);
 const before=f.qce.state.requests.length,status=await f.invoke('Status');assert.equal(status.ok,true);assert.equal(f.api.qceNativePlansSession.accountId,null);assert.equal(f.qce.state.requests.length,before);assert.equal(f.pollingClosed,0);
});

test('preload exposes exactly eight typed native-plan methods without a generic endpoint',()=>{
 const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),exposed={},calls=[];
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(name,value)=>exposed[name]=value},ipcRenderer:{invoke:(...args)=>calls.push(args)}})});
 const suffixes=['Read','Inspect','Targets','Preview','Confirm','History','Dismiss','Close'],input={accountId:'whale',panelId:PANEL};
 assert.deepEqual(Object.keys(exposed.arcade).filter(k=>k.startsWith('qqQceNativePlans')),suffixes.map(s=>'qqQceNativePlans'+s));for(const s of suffixes)exposed.arcade['qqQceNativePlans'+s](input);assert.equal(calls.length,8);assert(calls.every(([,v])=>v===input));
});
