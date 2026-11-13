'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {QQNodeRepairPanel,validateNodeRepairRequest}=require('../src/bot/qq-node-repair-panel.cjs');
const {QQComponents}=require('../src/bot/qq-components.cjs');
const next=()=>new Promise(r=>setImmediate(r)),deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {resolve,reject,promise};};
const digest='a'.repeat(64),setupId=randomUUID(),operationId=randomUUID();
const scope=()=>({installations:[{installationId:digest,setupId,instanceDirectoryCount:2}],knownRegisteredProfiles:[{profileId:'fixture-owner',label:'Fixture'}],enumeration:'component-store',allWithinStoreVerified:true,outsideStoreMetadataEnumerated:false});
const component=()=>({component:'napcat-node',version:'4.18.42',versionId:'napcat-node-4.18.42-77397ac38d66f463'});
const limits={maxInstallations:32,maxInstancesPerInstallation:32,maxProcesses:4096,maxEntries:10000,maxDepth:16,maxFileBytes:134217728,maxTreeBytes:536870912,maxManifestBytes:2097152,maxHistoryRecords:16,maxHistoryBytes:8589934592,previewTTL:300000};
const inspected=()=>({observationId:randomUUID(),...component(),state:'missing',source:{state:'not-staged',archiveBytes:124162399},scope:scope(),stopped:'verified',metadata:{descriptorVerified:true,manifestVerified:true},canPrepare:true,reason:null,pending:[],history:[],retention:{records:0,bytes:0,maxRecords:16,maxBytes:8589934592},limits,rawPath:'SECRET'});
const preview=()=>({operation:'node-code-repair',operationId,ticketId:randomUUID(),expectedDigest:digest,expiresAt:Date.now()+300000,...component(),scope:scope(),damage:'code_missing',source:{verification:'full-pinned-archive-and-manifest',archiveBytes:124162399,fileCount:8,totalBytes:100},previousTree:'absent',effects:{replacesCode:true,retainsOriginalTreeIfPresent:true,changesDescriptors:false,changesPreparedManifest:false,writesAccountData:false,changesWorkPaths:false,versionChange:false,automaticStop:false,automaticStart:false},privateManifest:'SECRET'});
const success=()=>({operationId,operation:'node-code-repair',committed:true,liveCode:'same-version-verified',oldTreeRetained:false,readback:'full-manifest',recoveryRequired:false,cleanupVerified:true,descriptorBytesUnchanged:true,manifestBytesUnchanged:true,dataPathsUnchanged:true,accountDataVerification:'not-read',automaticStart:false,automaticStop:false,versionChange:false,code:null,secret:'SECRET'});
function fixture(t){
 let selected='first';const calls=[];
 const console={closed:false,runtime:null,epoch:1,selectionDigest:digest,componentStoreRoot:'fixture-root',busy:new Set(),abortDirectory:()=>calls.push('abort-directory'),captureNodeRepairSelection:({contextKey,knownRegisteredProfiles})=>({setupId,descriptorSha256:digest,selectionDigest:console.selectionDigest,epoch:console.epoch,contextKey,knownRegisteredProfiles}),refreshAfterNodeRepair:async()=>calls.push('refresh'),canInspectNodeRepair:()=>true,check:()=>assert.fail('Healthy runtime check is unavailable')};
 let options;const helper={inspect:async()=>{calls.push('inspect');return inspected();},preview:async()=>{calls.push('prepare');return preview();},confirm:async input=>{input.assertCurrent();calls.push('confirm');return success();},close:async()=>{calls.push('close');return {closed:true};}};
 const panel=new QQNodeRepairPanel({console,captureUI:()=>({key:selected,profiles:[]}),create:input=>{options=input;return helper;}});
 t.after(()=>panel.close());const panelId=randomUUID(),send=(action,value={})=>panel.execute({action,panelId,...value});
 return {console,helper,panel,panelId,send,calls,options:()=>options,switch:()=>selected='second'};
}
test('repair-only strict IPC rejects paths, missing owner and unknown recovery decisions before backend I/O',()=>{
 for(const value of [null,[],{action:'node-repair-inspect'}, {action:'node-repair-inspect',panelId:randomUUID(),root:'SECRET'}, {action:'node-repair-reconcile-preview',panelId:randomUUID(),operationId:randomUUID(),decision:'force'}, {action:'node-repair-confirm',panelId:randomUUID(),ticketId:randomUUID(),expectedDigest:'bad'}])assert.throws(()=>validateNodeRepairRequest(value),{code:'invalid_request'});
});
test('missing runtime can inspect verified metadata without healthy-check/download; private extras never cross boundary',async t=>{
 const f=fixture(t),r=await f.send('node-repair-inspect');assert.equal(r.nodeRepair.state,'missing');assert.deepEqual(f.calls,['abort-directory','inspect']);assert.equal(f.options().root,'fixture-root');assert.equal(f.options().captureSelection().setupId,setupId);assert.doesNotMatch(JSON.stringify(r),/SECRET|rawPath/);assert.equal(f.panel.snapshot(),null);assert.equal(f.console.busy.size,0);
});
test('one-use preview binds operation type and a malformed mutating result remains unknown',async t=>{
 const f=fixture(t),i=await f.send('node-repair-inspect'),p=(await f.send('node-repair-preview',{observationId:i.nodeRepair.observationId})).nodeRepairPreview;
 assert.doesNotMatch(JSON.stringify(p),/SECRET|privateManifest/);
 await assert.rejects(f.send('node-repair-retire-confirm',{ticketId:p.ticketId,expectedDigest:p.expectedDigest}),{code:'preview_required'});
 f.helper.confirm=async()=>({committed:true,secret:'SECRET'});
 const r=(await f.send('node-repair-confirm',{ticketId:p.ticketId,expectedDigest:p.expectedDigest})).nodeRepairResult;
 assert.equal(r.committed,true);assert.equal(r.liveCode,'unverified');assert.equal(r.recoveryRequired,true);assert.equal(r.manifestBytesUnchanged,null);assert.equal(r.operationId,operationId);assert.equal(r.code,'invalid_response');assert(!f.calls.includes('refresh'));
 await assert.rejects(f.send('node-repair-confirm',{ticketId:p.ticketId,expectedDigest:p.expectedDigest}),{code:'preview_required'});assert.doesNotMatch(JSON.stringify(f.panel.snapshot()),/SECRET|ticketId/);
});
test('owned confirmation refreshes original runtime only after full proof and never on original-restored',async t=>{
 const f=fixture(t),i=await f.send('node-repair-inspect'),p=(await f.send('node-repair-preview',{observationId:i.nodeRepair.observationId})).nodeRepairPreview;
 assert.equal((await f.send('node-repair-confirm',{ticketId:p.ticketId,expectedDigest:p.expectedDigest})).nodeRepairResult.committed,true);assert(f.calls.includes('refresh'));
});
test('another account/setup operation blocks repair before backend construction',async t=>{
 const f=fixture(t);f.console.busy.add('another-account');await assert.rejects(f.send('node-repair-inspect'),{code:'operation_in_progress'});assert.equal(f.options(),undefined);assert.deepEqual([...f.console.busy],['another-account']);
});
test('old panel dismissal cannot close or cancel a replacement',async t=>{
 const f=fixture(t);await f.send('node-repair-inspect');await f.send('node-repair-dismiss');const newer=randomUUID();await f.panel.execute({action:'node-repair-inspect',panelId:newer});const count=f.calls.filter(x=>x==='close').length;
 assert.deepEqual(await f.send('node-repair-dismiss'),{closed:true,matched:false});assert.equal(f.calls.filter(x=>x==='close').length,count);assert.equal(f.panel.session.panelId,newer);
});
test('selection change observed during preparation cancels and closes the exact helper, retaining its guard until settled',async t=>{
 const f=fixture(t);const i=await f.send('node-repair-inspect'),gate=deferred();let signal;f.helper.preview=async input=>{signal=input.signal;await gate.promise;return preview();};
 const running=f.send('node-repair-preview',{observationId:i.nodeRepair.observationId}),rejected=assert.rejects(running,{code:'cancelled'});await next();assert(f.console.busy.has('qq-components'));
 f.switch();f.panel.observe();assert(signal.aborted);assert(f.console.busy.has('qq-components'));assert(!f.calls.includes('close'));gate.resolve();await rejected;await next();assert(f.calls.includes('close'));assert.equal(f.panel.session,null);assert.equal(f.console.busy.size,0);
});
test('closing waits for actual operation completion; a late committed result is retained',async t=>{
 const f=fixture(t),i=await f.send('node-repair-inspect'),p=(await f.send('node-repair-preview',{observationId:i.nodeRepair.observationId})).nodeRepairPreview,gate=deferred();
 f.helper.confirm=async()=>{await gate.promise;return success();};const running=f.send('node-repair-confirm',{ticketId:p.ticketId,expectedDigest:p.expectedDigest});await next();let closed=false;const closing=f.send('node-repair-dismiss').then(x=>{closed=true;return x;});await next();assert.equal(closed,false);gate.resolve();const r=await running;assert.equal(r.nodeRepairResult.committed,true);assert.equal(r.nodeRepairResult.refreshCode,'cancelled');await closing;assert.equal(closed,true);assert(!f.calls.includes('refresh'));
});
test('unconfirmed helper cleanup retains its owner for deliberate retry',async t=>{
 const f=fixture(t);await f.send('node-repair-inspect');let attempts=0;f.helper.close=async()=>{if(++attempts===1)throw Object.assign(Error('SECRET'),{code:'node_repair_cleanup_unconfirmed'});return {closed:true};};
 await assert.rejects(f.send('node-repair-dismiss'),{code:'node_repair_cleanup_unconfirmed'});assert.equal(f.panel.session.panelId,f.panelId);assert(f.panel.session.revoked);
 await assert.rejects(f.panel.execute({action:'node-repair-inspect',panelId:randomUUID()}),{code:'operation_in_progress'});await f.send('node-repair-dismiss');assert.equal(f.panel.session,null);assert.equal(attempts,2);
});

test('missing positive helper close receipt keeps the same panel available for cleanup retry',async t=>{
 for(const receipt of [undefined,null,{},false]){
  const f=fixture(t);await f.send('node-repair-inspect');let valid=false;
  f.helper.close=async()=>valid?{closed:true}:receipt;
  await assert.rejects(f.send('node-repair-dismiss'),{code:'node_repair_cleanup_unconfirmed'});
  assert.equal(f.panel.session.panelId,f.panelId);assert.equal(f.panel.session.revoked,true);
  valid=true;await f.send('node-repair-dismiss');assert.equal(f.panel.session,null);
 }
});

test('component close requires the repair owner positive receipt and allows exact retry',async t=>{
 const f=fixture(t),manager=new QQComponents({console:f.console,nodeRepairFactory:()=>f.helper});let valid=false;
 manager.nodeRepair.close=async()=>valid?{closed:true}:undefined;
 await assert.rejects(manager.close(),{code:'node_repair_cleanup_unconfirmed'});
 valid=true;assert.equal((await manager.close()).closed,true);
});
test('component dispatcher exposes repair-only status for missing runtime and leaves all normal writes strict',async t=>{
 const f=fixture(t),manager=new QQComponents({console:f.console,nodeRepairFactory:()=>f.helper});t.after(()=>manager.close());
 const s=await manager.execute({action:'status'});assert.equal(s.state.component,'napcat-node');assert.equal(s.state.nodeRepairAvailable,true);
 const r=await manager.execute({action:'node-repair-inspect',panelId:f.panelId});assert.equal(r.nodeRepair.state,'missing');
 await assert.rejects(manager.execute({action:'prepare'}),{code:'components_failed'});
});
