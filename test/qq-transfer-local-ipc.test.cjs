'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {fixture,open,job,hold,tick,PANEL,LOCAL}=require('./helpers/qq-transfer-local-main-fixture.cjs');
const B={panelId:PANEL,localId:LOCAL};
async function archive(f,item){
 const p=await f.invoke('Preview',{...B,operation:'archive',jobId:item.jobId,observationId:item.observationId});assert.equal(p.ok,true,JSON.stringify(p));
 return f.invoke('Confirm',{...B,ticketId:p.preview.ticketId,expectedDigest:p.preview.expectedDigest});
}
test('actual main exposes eight fixed local record IPC routes through preload',t=>{
 const f=fixture(t),preload=fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8');
 const names=[...f.handlers.keys()].filter(name=>name.startsWith('arcade:qqTransferLocal'));
 assert.equal(names.length,8);for(const name of names)assert(preload.includes(`'${name}'`));
});
test('actual main can list, archive, inspect and forget an orphan without remote registration or auth',{skip:require('./helpers/platform-skip.cjs').ownedIpcSkip()},async t=>{
 const f=fixture(t),original=job(f),listed=await open(f);assert.equal(listed.ok,true,JSON.stringify(listed));
 assert.equal(listed.active.length,1);assert.equal(listed.active[0].binding,'missing');assert.equal(listed.active[0].canArchive,true);
 assert.equal(listed.active[0].job.saved,null);assert.equal(listed.active[0].job.published,null);
 const changed=await archive(f,listed.active[0]);assert.equal(changed.ok,true,JSON.stringify(changed));assert.equal(changed.change.committed,true);
 const ended=f.api.jobs().getEnded(original.jobId);assert.deepEqual(ended.job,original);
 const check=await f.invoke('Check',{...B,operationId:changed.operationId});assert.equal(check.ok,true);assert.equal(check.observation.outcome,'archive-observed');
 const list=await f.invoke('List');assert.equal(list.active.length,0);assert.equal(list.ended.length,1);
 const p=await f.invoke('Preview',{...B,operation:'forget-ended',jobId:original.jobId,observationId:list.ended[0].observationId});assert.equal(p.ok,true);
 const forgotten=await f.invoke('Confirm',{...B,ticketId:p.preview.ticketId,expectedDigest:p.preview.expectedDigest});assert.equal(forgotten.ok,true,JSON.stringify(forgotten));assert.equal(forgotten.change.committed,true);
 assert.equal(f.api.jobs().listEnded().length,0);assert.equal(fs.readFileSync(original.source.source,'utf8'),'source retained');assert.equal(fs.readFileSync(original.target.target,'utf8'),'target retained');
 for(const output of [listed,changed,check,list,p,forgotten,f.api.fullSnapshot()])assert.doesNotMatch(JSON.stringify(output),/PRIVATE_|private-helper|rootId|credentialRevision|pendingRotation/);
 assert.equal(f.state.network,0);assert.equal(f.state.pickers,0);
});
test('actual main validates renderer origin, rejects arbitrary paths and retains the current child',async t=>{
 const f=fixture(t);job(f);await open(f);
 await assert.rejects(f.invoke('List',B,{sender:{},senderFrame:{}}),/Untrusted sender/);
 for(const patch of [{remoteId:randomUUID()},{path:'C:\\PRIVATE_PATH'},{url:'https://invalid.example'},{token:'PRIVATE_TOKEN'}])assert.equal((await f.invoke('List',{...B,...patch})).ok,false);
 assert.equal((await f.invoke('List')).ok,true);assert.equal(f.state.network,0);
});
test('local pane list and close leave the original network transfer owner intact',async t=>{
 const f=fixture(t);job(f);await f.remote('List');const session=f.api.transfer().session;
 let pauses=0,closes=0;const priorPause=session.pauseLocalJob,priorClose=session.closeCurrent;
 session.pauseLocalJob=()=>{pauses++;throw Error('Should not pause');};session.closeCurrent=async()=>{closes++;return {closed:true};};
 assert.equal((await f.invoke('List')).ok,true);assert.equal((await f.invoke('Close')).closed,true);assert.equal(pauses,0);assert.equal(closes,0);
 session.pauseLocalJob=priorPause;session.closeCurrent=priorClose;
});
test('same-parent replacement child rejects stale close, and changed selected companion invalidates preview',async t=>{
 const f=fixture(t);job(f);await open(f);const next={...B,localId:randomUUID()},listed=await f.invoke('List',next);assert.equal(listed.ok,true);
 assert.equal((await f.invoke('Close')).closed,true);assert.equal((await f.invoke('List',next)).ok,true);
 const fresh=await f.invoke('List',next),p=await f.invoke('Preview',{...next,operation:'archive',jobId:fresh.active[0].jobId,observationId:fresh.active[0].observationId});assert.equal(p.ok,true);
 f.accounts.selectedId='second';f.api.observe();const r=await f.invoke('Confirm',{...next,ticketId:p.preview.ticketId,expectedDigest:p.preview.expectedDigest});assert.equal(r.ok,false);assert.equal(f.api.jobs().list().length,1);
});
test('parent close settles local work and a stale parent close does not affect its replacement',async t=>{
 const f=fixture(t);job(f);await open(f);assert.equal((await f.remote('RegistryClose')).closed,true);assert.equal((await f.invoke('List')).ok,false);
 const next={panelId:randomUUID(),localId:randomUUID()};await f.remote('List',{panelId:next.panelId});assert.equal((await f.invoke('List',next)).ok,true);
 await f.remote('RegistryClose',{panelId:PANEL});assert.equal((await f.invoke('List',next)).ok,true);
});
test('local binding description uses metadata and preserves missing, changed and unavailable distinctions',t=>{
 const f=fixture(t),j=job(f);const remote=f.api.remote().registry,links=f.api.transfer().links;
 const oldR=remote.list,oldL=links.list;
 const r={remoteId:j.scope.remoteId,revision:j.scope.remoteRevision,pendingRotation:null},h={...j.scope,revision:j.scope.helperRevision};
 remote.list=()=>({state:'ready',items:[r]});links.list=()=>({state:'ready',items:[h]});assert.equal(f.api.describe(j.scope),'current');
 h.credentialRevision=randomUUID();assert.equal(f.api.describe(j.scope),'changed');h.credentialRevision=j.scope.credentialRevision;
 r.pendingRotation={outcome:'unknown'};assert.equal(f.api.describe(j.scope),'changed');r.pendingRotation=null;
 links.list=()=>({state:'ready',items:[]});assert.equal(f.api.describe(j.scope),'missing');links.list=()=>({state:'locked',items:[]});assert.equal(f.api.describe(j.scope),'unavailable');
 remote.list=oldR;links.list=oldL;assert.equal(f.state.network,0);
});
test('shutdown awaits local mutation before closing journal and validates positive cleanup',async t=>{
 const f=fixture(t);await open(f);const local=f.api.local(),jobs=f.api.jobs(),gate=hold();
 const oldClose=local.close,oldJobs=jobs.close;let entered=false,journal=0,valid=false;
 local.close=async()=>{entered=true;await gate.promise;return valid?{closed:true}:{closed:false};};jobs.close=function(){journal++;return oldJobs.call(this);};
 const closing=f.api.closeRemoteManagement({permanent:true});await tick();assert.equal(entered,true);assert.equal(journal,0);gate.resolve();await assert.rejects(closing,e=>e.code==='remote_cleanup_unconfirmed');assert.equal(journal,0);
 valid=true;await f.api.closeRemoteManagement({permanent:true});assert.equal(journal,1);local.close=oldClose;
});
