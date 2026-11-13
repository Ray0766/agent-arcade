'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createHash}=require('node:crypto');
const {fixture,PANEL,NEXT,until,deferred}=require('./helpers/qq-qce-main-fixture.cjs');
async function setup(t){
 const f=await fixture(t);await f.save();const tasks=new Map(),data=Buffer.from('{"synthetic":"export bytes"}\n');
 const e={tasks,data,next:0,disconnectCreate:false,downloadCount:0};
 f.qce.state.handle=async(row,res,send)=>{
  if(row.path==='/api/friends?page=1&limit=100'){send({friends:[{uid:'u_SyntheticQceFriend',uin:'200001',nick:'Synthetic friend',remark:''}],totalCount:1,totalPages:1,currentPage:1,hasNext:false,hasPrev:false});return true;}
  if(row.path==='/api/groups?page=1&limit=100'){send({groups:[],totalCount:0,totalPages:0,currentPage:1,hasNext:false,hasPrev:false});return true;}
  if(row.path==='/api/messages/export'){
   const id=`export_1800000000000_test${++e.next}`,body=row.body,task={id,peer:body.peer,format:body.format,startTime:body.filter.startTime,endTime:body.filter.endTime,status:'running',progress:0,messageCount:0,fileName:'synthetic-export.json',sessionName:'Synthetic friend',createdAt:'2026-11-07T00:00:00.000Z',completedAt:null};tasks.set(id,task);
   if(e.disconnectCreate){res.destroy();return true;}if(e.createDelayMs)await new Promise(resolve=>setTimeout(resolve,e.createDelayMs));send({taskId:id,fileName:task.fileName,status:'running',messageCount:0,startTime:task.startTime,endTime:task.endTime,filePath:'PRIVATE_UNTRUSTED_PATH',downloadUrl:'https://example.invalid/do-not-use'});return true;
  }
  if(row.path.startsWith('/api/tasks/')){const id=row.path.split('/')[3],task=tasks.get(id);if(!task){res.statusCode=404;res.end();return true;}if(row.path.endsWith('/cancel')){task.status='cancelled';send({taskId:id,cancelled:true});}else send({...task});return true;}
  if(row.path.startsWith('/api/download-file?')){e.downloadCount++;e.downloadPath=new URL(row.path,'http://synthetic.invalid').searchParams.get('path');res.writeHead(200,{'content-type':'application/json','content-length':data.length});res.end(data);return true;}
  return false;
 };
 const read=()=>f.invoke('ExportRead',{...f.input,kind:'friends',page:1});
 const preview=async()=>{const r=await read();assert.equal(r.ok,true,JSON.stringify(r));const p=await f.invoke('ExportPreview',{...f.input,action:'create',observationId:r.profile.observationId,targetId:r.profile.targets[0].targetId,format:'JSON',range:{startTime:f.qce.state.now-3600000,endTime:f.qce.state.now},options:{includeSystemMessages:false,preferGroupMemberName:true,resources:{image:false,video:false,audio:false,file:false},htmlZip:false}});assert.equal(p.ok,true,JSON.stringify(p));return p.preview;};
 const create=async(expectedOutcome='accepted')=>{const p=await preview(),r=await f.invoke('ExportConfirm',{...f.input,ticketId:p.ticketId});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.change.outcome,expectedOutcome,JSON.stringify(r));assert.equal(r.change.taskRecorded,expectedOutcome==='accepted',JSON.stringify(r));return {p,r};};
 return Object.assign(f,{exports:e,exportRead:read,exportPreview:preview,exportCreate:create});
}
test('actual main export creates once, records ownership, verifies task and saves exact downloaded bytes',async t=>{
 const f=await setup(t),{p,r}=await f.exportCreate();assert.equal(r.change.outcome,'accepted');assert.equal(r.change.taskRecorded,true);
 const jobs=await f.invoke('ExportJobs');assert.equal(jobs.ok,true,JSON.stringify(jobs));assert.equal(jobs.jobs.length,1);assert.equal(jobs.jobs[0].operationId,p.operationId);
 const task=[...f.exports.tasks.values()][0];task.status='completed';task.progress=100;task.messageCount=2;task.completedAt='2026-11-07T00:01:00.000Z';
 const target=path.join(f.root,'chosen-export.json');f.state.pickSave=async()=>({canceled:false,filePath:target});
 const out=await f.invoke('ExportDownload',{...f.input,operationId:p.operationId});assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.download.saved,true);assert.equal(out.download.cleanupVerified,true);assert.equal(out.download.bytes,f.exports.data.length);
 assert.equal(out.download.sha256,createHash('sha256').update(fs.readFileSync(target)).digest('hex'));assert(fs.readFileSync(target).equals(f.exports.data));assert.equal(f.api.qceExportStages.size,0);
 const posts=f.qce.state.requests.filter(v=>v.path==='/api/messages/export');assert.equal(posts.length,1);assert(f.exports.downloadPath.endsWith(`agent-arcade-exports\\${p.operationId}\\synthetic-export.json`));
 assert.doesNotMatch(JSON.stringify(out),/chosen-export|PRIVATE_UNTRUSTED|example.invalid|u_SyntheticQceFriend/);assert.equal((await f.invoke('ExportConfirm',{...f.input,ticketId:p.ticketId})).ok,false);assert.equal(f.exports.next,1);
});
test('local job view preserves current target handles and performs no extra request',async t=>{
 const f=await setup(t),r=await f.exportRead(),before=f.qce.state.requests.length,j=await f.invoke('ExportJobs');assert.equal(j.ok,true);assert.equal(f.qce.state.requests.length,before);
 const p=await f.invoke('ExportPreview',{...f.input,action:'create',observationId:r.profile.observationId,targetId:r.profile.targets[0].targetId,format:'TXT',range:{startTime:f.qce.state.now-60000,endTime:f.qce.state.now},options:{includeSystemMessages:false,preferGroupMemberName:true,resources:{image:false,video:false,audio:false,file:false},htmlZip:false}});assert.equal(p.ok,true,JSON.stringify(p));assert.equal(f.exports.next,0);
});
test('lost create acknowledgement remains unknown without global adoption or automatic replay',async t=>{
 const f=await setup(t);f.exports.disconnectCreate=true;const {p,r}=await f.exportCreate('unknown');assert.equal(r.change.outcome,'unknown');assert.equal(r.change.taskRecorded,false);
 const jobs=await f.invoke('ExportJobs');assert.equal(jobs.jobs.length,1);assert.equal(jobs.jobs[0].canObserve,false);assert.equal(jobs.jobs[0].submission,'unknown');
 const before=f.qce.state.requests.length;assert.equal((await f.invoke('ExportObserve',{...f.input,operationId:p.operationId})).ok,false);assert.equal(f.qce.state.requests.length,before);assert.equal(f.exports.next,1);assert.equal(f.exports.tasks.size,1);
});
test('foreign task binding blocks download despite a known created ID',async t=>{
 const f=await setup(t),{p}=await f.exportCreate(),task=[...f.exports.tasks.values()][0];task.peer={chatType:1,peerUid:'u_ForeignSynthetic'};task.status='completed';task.progress=100;
 const r=await f.invoke('ExportDownload',{...f.input,operationId:p.operationId});assert.equal(r.ok,true);assert.equal(r.download.saved,false);assert.equal(r.download.code,'task_binding_changed');assert.equal(f.exports.downloadCount,0);assert.equal(f.state.pickerOptions,undefined);
});
test('explicit cancellation is one owned task request and does not claim all file writes stopped',async t=>{
 const f=await setup(t),{p}=await f.exportCreate(),preview=await f.invoke('ExportPreview',{...f.input,action:'cancel',operationId:p.operationId});assert.equal(preview.ok,true,JSON.stringify(preview));
 const r=await f.invoke('ExportConfirm',{...f.input,ticketId:preview.preview.ticketId});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.change.action,'cancel');assert.equal(r.change.cancelStopsAllWritesVerified,false);assert.equal(f.qce.state.requests.filter(v=>v.path.endsWith('/cancel')).length,1);
 await f.invoke('ExportClose');assert.equal(f.qce.state.requests.filter(v=>v.path.endsWith('/cancel')).length,1);
});

test('main export creation tolerates a bounded response delay before task cancellation preview',async t=>{
 const f=await setup(t);f.exports.createDelayMs=250;const p=await f.exportPreview(),r=await f.invoke('ExportConfirm',{...f.input,ticketId:p.ticketId}),preview=await f.invoke('ExportPreview',{...f.input,action:'cancel',operationId:p.operationId});
 const diagnostic=JSON.stringify({createOK:r.ok,outcome:r.change?.outcome??null,taskRecorded:r.change?.taskRecorded??null,code:r.change?.code??r.code??null,cancelPreviewOK:preview.ok,cancelPreviewCode:preview.code??null,createRequests:f.exports.next});
 assert.equal(r.change?.outcome,'accepted',diagnostic);assert.equal(r.change.taskRecorded,true,diagnostic);assert.equal(preview.ok,true,diagnostic);assert.equal(f.exports.next,1);
});
test('picker cancellation neither downloads nor publishes a local file',async t=>{
 const f=await setup(t),{p}=await f.exportCreate(),task=[...f.exports.tasks.values()][0];task.status='completed';task.progress=100;
 f.state.pickSave=async()=>({canceled:true});const r=await f.invoke('ExportDownload',{...f.input,operationId:p.operationId});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.download.cancelled,true);assert.equal(r.download.saved,false);assert.equal(f.exports.downloadCount,0);assert.equal(f.api.qceExportStages.size,0);
});
test('hide while picker is open prevents network/download after it returns',async t=>{
 const f=await setup(t),{p}=await f.exportCreate(),task=[...f.exports.tasks.values()][0];task.status='completed';task.progress=100;const gate=deferred();let entered=false;
 const target=path.join(f.root,'must-not-exist.json');f.state.pickSave=async()=>{entered=true;await gate.promise;return {canceled:false,filePath:target};};
 const pending=f.invoke('ExportDownload',{...f.input,operationId:p.operationId});await until(()=>entered);f.emit('hide');gate.resolve();const r=await pending;assert(r.ok===false||r.download.saved===false);assert.equal(f.exports.downloadCount,0);assert.equal(fs.existsSync(target),false);
});
test('old export panel cannot close a replacement credential view and arbitrary paths cannot enter IPC',async t=>{
 const f=await setup(t);await f.invoke('ExportJobs');const next={...f.input,panelId:NEXT};const status=await f.invoke('Status',next);assert.equal(status.ok,true);await f.invoke('ExportClose');assert.equal(f.api.localPanel().panelId,NEXT);
 for(const extra of [{taskId:'export_1800000000000_other'},{path:'C:\\Synthetic-Unowned'},{url:'https://example.invalid/'},{token:'S'.repeat(40)}])assert.equal((await f.invoke('ExportRead',{...f.input,kind:'friends',page:1,...extra})).ok,false);assert.equal(f.exports.next,0);
});
test('failed local cleanup retains its owner and delays journal close until a verified retry',async t=>{
 const f=await setup(t);await f.invoke('ExportJobs');let fail=true,closed=0;const stage={async close(){if(fail)throw Object.assign(Error('Synthetic cleanup failure'),{code:'file_cleanup_unconfirmed'});closed++;return {closed:true};}};
 const owner={stage,accountId:f.input.accountId};f.api.qceExportStages.add(owner);await assert.rejects(f.api.closePluginPanels({permanent:true}),{code:'file_cleanup_unconfirmed'});assert.equal(f.api.qceExportStages.has(owner),true);assert.equal(f.api.jobs().closed,false);
 fail=false;await f.api.closePluginPanels({permanent:true});assert.equal(closed,1);assert.equal(f.api.qceExportStages.size,0);assert.equal(f.api.jobs().closed,true);
});
test('an invalid transfer receipt after file publication is unknown rather than falsely unsaved',async t=>{
 const f=await fixture(t);await f.save();const target=path.join(f.root,'published-before-invalid-receipt.json'),capture=f.api.captureQCE(f.input);f.state.pickSave=async()=>({canceled:false,filePath:target});
 await assert.rejects(f.api.saveQCEExportDownload({capture,signal:new AbortController().signal,assertCurrent:()=>{},suggestedName:'synthetic.json',archive:false},async sink=>{await sink.write(Buffer.from('{}'));await sink.finish();return {saved:true,bytes:2,sha256:'invalid',archiveVerified:false};}),e=>e.code==='file_download_unknown'&&e.saved===null);
 assert.equal(fs.readFileSync(target,'utf8'),'{}');assert.equal(f.api.qceExportStages.size,0);assert.equal(f.qce.state.requests.length,0);
});
test('credential rotation retains only removable local history and cannot query the former task',async t=>{
 const f=await setup(t),{p}=await f.exportCreate(),status=await f.invoke('Status');await f.invoke('SaveCredential',{...f.input,expectedRevision:status.credential.revision,token:'R'.repeat(40)});
 const before=f.qce.state.requests.length,jobs=await f.invoke('ExportJobs');assert.equal(jobs.ok,true);assert.equal(jobs.jobs.length,1);assert.equal(jobs.jobs[0].bindingCurrent,false);assert.equal(jobs.jobs[0].canObserve,false);
 assert.equal((await f.invoke('ExportObserve',{...f.input,operationId:p.operationId})).ok,false);assert.equal(f.qce.state.requests.length,before);
 const removed=await f.invoke('ExportForget',{...f.input,operationId:p.operationId,revision:jobs.jobs[0].revision});assert.equal(removed.forgotten,true);assert.equal(f.exports.tasks.size,1);assert.equal(f.qce.state.requests.length,before);
});
test('invalid saved receipt cannot override unknown publication when cleanup also fails',async t=>{
 const f=await fixture(t);await f.save();const capture=f.api.captureQCE(f.input),target=path.join(f.root,'invalid-and-cleanup.json');f.state.pickSave=async()=>({canceled:false,filePath:target});let owner,close;
 await assert.rejects(f.api.saveQCEExportDownload({capture,signal:new AbortController().signal,assertCurrent:()=>{},suggestedName:'synthetic.json',archive:false},async sink=>{
  owner=sink.stage;close=owner.close.bind(owner);owner.close=async()=>{throw Error('Synthetic cleanup failure');};await sink.write(Buffer.from('{}'));await sink.finish();return {saved:true,bytes:999,sha256:'invalid',archiveVerified:false};
 }),e=>e.code==='file_cleanup_unconfirmed'&&e.saved===null&&e.bytes===2&&e.sha256===createHash('sha256').update('{}').digest('hex'));
 assert.equal(f.api.qceExportStages.size,1);owner.close=close;await f.api.closePluginPanels();assert.equal(f.api.qceExportStages.size,0);
});
test('cleanup failure preserves unknown publication and the owned stage for a later cleanup',async t=>{
 const f=await fixture(t);await f.save();const capture=f.api.captureQCE(f.input),target=path.join(f.root,'cleanup-unknown.json');f.state.pickSave=async()=>({canceled:false,filePath:target});let owner,originalClose;
 await assert.rejects(f.api.saveQCEExportDownload({capture,signal:new AbortController().signal,assertCurrent:()=>{},suggestedName:'synthetic.json',archive:false},async sink=>{
  owner=sink.stage;originalClose=owner.close.bind(owner);owner.close=async()=>{throw Object.assign(Error('Synthetic cleanup failure'),{code:'file_cleanup_unconfirmed'});};await sink.write(Buffer.from('{}'));await sink.finish();throw Object.assign(Error('Synthetic response lost after publication'),{saved:null,bytes:2,sha256:createHash('sha256').update('{}').digest('hex'),code:'file_download_unknown'});
 }),e=>e.code==='file_cleanup_unconfirmed'&&e.saved===null&&e.bytes===2);
 assert.equal(fs.readFileSync(target,'utf8'),'{}');assert.equal(f.api.qceExportStages.size,1);owner.close=originalClose;await f.api.closePluginPanels();assert.equal(f.api.qceExportStages.size,0);
});
test('preload exposes only the nine fixed export methods',()=>{
 const exposed={},calls=[],input={accountId:'synthetic-whale',panelId:PANEL};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld(name,v){exposed[name]=v;}},ipcRenderer:{invoke:(...v)=>calls.push(v)}})});
 const names=['Read','Jobs','Preview','Confirm','Observe','Download','Forget','Dismiss','Close'].map(k=>'qqQceExport'+k);assert.deepEqual(Object.keys(exposed.arcade).filter(k=>k.startsWith('qqQceExport')),names);for(const name of names)exposed.arcade[name](input);assert.equal(calls.length,9);assert(calls.every(([,v])=>v===input));
});
