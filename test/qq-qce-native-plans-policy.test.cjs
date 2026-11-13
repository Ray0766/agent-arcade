'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const P=require('../src/bot/qq-qce-native-plans-policy.cjs');
const {emptyOptions}=require('./helpers/qq-qce-native-plans-fixture.cjs');
const config={customOutputDir:null,customScheduledExportDir:null,currentExportsDir:'C:\\Synthetic\\exports',currentScheduledExportsDir:'C:\\Synthetic\\scheduled'};
const raw=()=>({id:'scheduled_synthetic',name:'Synthetic plan',enabled:true,peer:{chatType:1,peerUid:'u_synthetic',guildId:''},scheduleType:'daily',executeTime:'02:00',timeRangeType:'last-7-days',format:'JSON',options:{privateSynthetic:'PRIVATE_SYNTHETIC_OPTION'},outputDir:'C:\\Synthetic\\old'});
const draft=()=>({name:'Synthetic edit',target:null,scheduleType:'daily',executeTime:'02:00',cronExpression:null,timeRangeType:'last-7-days',customTimeRange:null,format:'JSON',options:emptyOptions(),output:{mode:'keep',path:null}});
test('typed native options preserve unknown members and deliberate optional absence',()=>{
 const old=raw(),v=draft();old.options.prettyFormat=true;v.options.showSearchBar={present:true,value:false};P.draft(v,false);const body=P.bodyFromDraft(v,old,null);assert.equal(body.enabled,false);assert.equal(body.options.privateSynthetic,old.options.privateSynthetic);assert.equal(body.options.showSearchBar,false);assert(!Object.hasOwn(body.options,'prettyFormat'));assert(!Object.hasOwn(body,'peer'));assert(!Object.hasOwn(body,'outputDir'));assert(!Object.hasOwn(body,'privateSynthetic'));
 const result=P.projectedAfter(body,old,config,null);assert.equal(result.output.effectivePath,old.outputDir);assert.equal(result.target.name,null);assert(!JSON.stringify(result).includes('PRIVATE_SYNTHETIC'));assert(!JSON.stringify(result).includes('u_synthetic'));
});
test('explicit custom output is bounded absolute Windows path; default resets and keep does not rewrite',()=>{
 const v=draft();v.output={mode:'custom',path:'D:\\Synthetic Export\\selected'};P.draft(v,false);assert.equal(P.bodyFromDraft(v,raw(),null).outputDir,v.output.path);
 for(const path of [null,'relative/path','C:\\Synthetic\\..\\outside','C:\\Synthetic\nsecret','\\\\?\\C:\\Synthetic'])assert.throws(()=>P.draft({...v,output:{mode:'custom',path}},false));
 v.output={mode:'default',path:null};assert.equal(P.projectedAfter(P.bodyFromDraft(v,raw(),null),raw(),config,null).output.effectivePath,config.currentScheduledExportsDir);assert.throws(()=>P.draft({...v,output:{mode:'keep',path:null}},true));
});
test('native formats, actual cron subset and relative-second bounds reject invented scheduling semantics',()=>{
 const v=draft();for(const change of [{format:'EXCEL'},{executeTime:'24:00'},{scheduleType:'custom',cronExpression:'0 2 * * 1-5'},{timeRangeType:'custom',customTimeRange:{startTime:-31622401,endTime:0}},{timeRangeType:'custom',customTimeRange:{startTime:-1,endTime:1}}])assert.throws(()=>P.draft({...v,...change},false));
 P.draft({...v,scheduleType:'custom',cronExpression:'0 2 * * 1,7',timeRangeType:'custom',customTimeRange:{startTime:-86400,endTime:0}},false);v.options.maxEmbedFileSizeBytes={present:true,value:33554433};assert.throws(()=>P.draft(v,false));
});
test('bounded legacy newline titles and unsupported definitions remain disable/remove-capable without raw projection',()=>{
 const r=P.record({...raw(),name:'Synthetic\nlegacy\u0000',format:'legacy-format',peer:{chatType:9,peerUid:'PRIVATE_SYNTHETIC_UID'}}),s=P.summary(r,randomUUID(),config);assert.equal(s.supported,false);assert.equal(s.canDisable,true);assert.equal(s.canRemove,true);assert.equal(s.name,'Syntheticlegacy');assert(!JSON.stringify(s).includes('PRIVATE_SYNTHETIC'));
 assert.equal(P.list({scheduledExports:[r]}).length,1);assert.throws(()=>P.list({scheduledExports:[r,r]}));assert.throws(()=>P.list({scheduledExports:Array.from({length:129},()=>r)}),{code:'native_plan_limit'});
});
test('history has strict five-count resource projection and no native paths/errors/IDs',()=>{
 const h={id:'history_synthetic',scheduledExportId:'scheduled_synthetic',executedAt:new Date().toISOString(),status:'partial',duration:5,messageCount:2,filePath:'C:\\Synthetic\\private.json',fileSize:12,error:'PRIVATE_SYNTHETIC_ERROR',resourceSummary:{attempted:2,alreadyAvailable:0,downloaded:1,failed:1,skipped:0,failedSamples:['PRIVATE_SYNTHETIC_PATH']}};
 const result=P.historyItem(h,h.scheduledExportId);assert.deepEqual(result.resourceSummary,{attempted:2,alreadyAvailable:0,downloaded:1,failed:1,skipped:0});assert(!/PRIVATE_SYNTHETIC|private\.json|history_synthetic/.test(JSON.stringify(result)));assert.equal(P.historyItem({...h,resourceSummary:{...h.resourceSummary,failed:-1}},h.scheduledExportId).resourceSummary,null);assert.throws(()=>P.historyItem(h,'another'),{code:'invalid_response'});
});
test('IPC rejects renderer authority injection and native queue validates bounded legacy names',()=>{
 const b={accountId:'synthetic-qce',panelId:randomUUID()};for(const key of ['nativePlanId','token','url','peer','outputDir'])assert.throws(()=>P.qceNativePlansRequest({...b,[key]:'synthetic'}));
 assert.deepEqual(P.ack('triggerAll',{triggered:[{id:'scheduled_synthetic',name:'old\nname'}],count:1}).queue,{count:1});assert.throws(()=>P.ack('triggerAll',{triggered:[],count:1}));
});
