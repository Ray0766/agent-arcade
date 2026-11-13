'use strict';
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {QQTransferJobs}=require('../src/bot/qq-transfer-jobs.cjs');
const {QQTransferLocal,transferLocalResult,projectLocalResult}=require('../src/bot/qq-transfer-local.cjs');
const {vault}=require('./helpers/qq-transfer-fixture.cjs');
const P=require('../src/bot/qq-transfer-client.cjs');
function deferred(){let resolve;return {promise:new Promise(r=>resolve=r),resolve};}
function input(){return {jobId:randomUUID(),kind:'upload',name:'synthetic.bin',state:'prepared',scope:{remoteId:randomUUID(),remoteRevision:randomUUID(),helperId:randomUUID(),helperRevision:randomUUID(),origin:'https://transfer.example.test',instanceId:randomUUID(),rootId:'files',trustRevision:randomUUID(),credentialRevision:randomUUID()},totalBytes:3,completedBytes:0,sha256:P.sha('abc'),archive:false,published:false,saved:false,cleanupPending:false,source:{file:'synthetic-private-source'},target:{directoryId:randomUUID(),name:'synthetic.bin'},remote:null,pending:{kind:'create',operationId:randomUUID(),from:0,to:0,state:'prepared'},expiresAt:Date.now()+86400000,code:null};}
function setup(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-local-records-')),crypto=vault(),jobs=new QQTransferJobs({root:path.join(root,'jobs'),vault:crypto}),base={panelId:randomUUID(),localId:randomUUID()},state={generation:1,mono:1,binding:'missing',owner:null};
 const local=new QQTransferLocal({jobs,captureContext:()=>({panelId:base.panelId,parentGeneration:state.generation,contextKey:'synthetic-local-only'}),describeBinding:()=>state.binding,getJobOwner:()=>state.owner,now:Date.now,monotonic:()=>state.mono,...options});
 t.after(async()=>{state.owner=null;await local.close();await jobs.settleRetirementCleanup();jobs.close();fs.rmSync(root,{recursive:true,force:true});});
 const f={root,crypto,jobs,local,base,state};f.preview=async(jobId,operation='archive')=>{const r=await local.detail({...base,bucket:operation==='archive'?'active':'ended',jobId});return local.preview({...base,operation,jobId,observationId:r.item.observationId});};f.confirm=p=>local.confirm({...base,ticketId:p.preview.ticketId,expectedDigest:p.preview.expectedDigest});return f;
}
test('offline orphan unknown record archives complete encrypted evidence and forgetting leaves all files intact',async t=>{
 const f=setup(t),file=path.join(f.root,'keep.bin');fs.writeFileSync(file,Buffer.from([0,255,42]));const original=f.jobs.create({...input(),state:'cleanup_required',cleanupPending:true,published:null,source:{file},pending:{kind:'finalize',operationId:randomUUID(),from:0,to:0,state:'attempted'}});
 const listed=await f.local.list(f.base);assert.equal(listed.active[0].binding,'missing');assert.equal(listed.active[0].canArchive,true);assert.equal(listed.active[0].job.canReconcile,false);assert(!JSON.stringify(listed).includes(file));
 const p=await f.preview(original.jobId),r=await f.confirm(p);assert.equal(r.change.committed,true);assert.deepEqual(f.jobs.getEnded(original.jobId).job,original);assert.equal(f.local.check({...f.base,operationId:r.operationId}).observation.outcome,'archive-observed');
 assert.equal(projectLocalResult({...f.base,ticketId:p.preview.ticketId,expectedDigest:p.preview.expectedDigest},'confirm',r).change.committed,true);
 const fp=await f.preview(original.jobId,'forget-ended'),fr=await f.confirm(fp);assert.equal(fr.change.committed,true);assert.equal(f.local.check({...f.base,operationId:fr.operationId}).observation.outcome,'absence-observed');assert.deepEqual(fs.readFileSync(file),Buffer.from([0,255,42]));assert.equal(f.jobs.listEnded().length,0);
});
test('one-use ticket, monotonic deadline, record revision and late owner block writes',async t=>{
 const f=setup(t),j=f.jobs.create(input());await f.local.list(f.base);const p=await f.preview(j.jobId);f.state.mono+=300001;await assert.rejects(f.confirm(p),{code:'transfer_expired'});await assert.rejects(f.confirm(p),{code:'changed'});
 const p2=await f.preview(j.jobId);await f.jobs.withJob(j.jobId,{},l=>l.save({...l.read(),code:'cancelled'}));await assert.rejects(f.confirm(p2),{code:'transfer_scope_changed'});
 const p3=await f.preview(j.jobId);f.state.owner={jobId:j.jobId,ownerId:randomUUID(),operationId:randomUUID(),active:true,cleanupRequired:false};await assert.rejects(f.confirm(p3),{code:'transfer_busy'});assert.equal(f.jobs.listEnded().length,0);f.state.owner=null;
});
test('old local close and invalid read cannot revoke a new local preview',async t=>{
 const f=setup(t),j=f.jobs.create(input());await f.local.list(f.base);const old={...f.base};f.base.localId=randomUUID();await f.local.list(f.base);const p=await f.preview(j.jobId);assert.equal((await f.local.closeOwned(old)).closed,true);await assert.rejects(f.local.list({...f.base,remoteId:randomUUID()}),{code:'invalid_request'});assert.equal((await f.confirm(p)).change.committed,true);
});
test('exact Close while old owner cleanup is held revokes pending open',async t=>{
 const f=setup(t);await f.local.list(f.base);const held=deferred(),ready=deferred(),settle=f.jobs.settleRetirementCleanup.bind(f.jobs);let once=true;f.jobs.settleRetirementCleanup=async()=>{if(once){once=false;ready.resolve();await held.promise;}return settle();};const next={...f.base,localId:randomUUID()},opening=f.local.list(next);await ready.promise;await f.local.closeOwned(next);held.resolve();await assert.rejects(opening,{code:'changed'});assert.equal(f.local.current,null);
});
test('parent change invalidates a ticket without using a helper or silently pausing',async t=>{
 const f=setup(t,{pauseJobOwner:()=>{throw Error('must not call');}}),j=f.jobs.create(input());await f.local.list(f.base);const p=await f.preview(j.jobId);f.state.generation++;assert.deepEqual(f.local.observe(),{current:false});await assert.rejects(f.confirm(p),{code:'changed'});assert.equal(f.jobs.get(j.jobId).revision,j.revision);await f.local.closeCurrent();
});
test('known owner observation is exact across future attempts and Pause waits original work',async t=>{
 const held=deferred(),ready=deferred();let calls=0;const f=setup(t,{pauseJobOwner:async owner=>{calls++;ready.resolve();await held.promise;assert.equal(owner.ownerId,f.state.owner.ownerId);f.state.owner=null;return {paused:true,cleanupVerified:true};}}),j=f.jobs.create(input());f.state.owner={jobId:j.jobId,ownerId:randomUUID(),operationId:randomUUID(),active:true,cleanupRequired:false};const listed=await f.local.list(f.base),old=listed.active[0];assert.equal(old.canArchive,false);assert.equal(calls,0);assert.throws(()=>f.local.preview({...f.base,operation:'archive',jobId:j.jobId,observationId:old.observationId}),{code:'transfer_busy'});
 f.state.owner={...f.state.owner,ownerId:randomUUID(),operationId:randomUUID()};await assert.rejects(f.local.pause({...f.base,jobId:j.jobId,observationId:old.observationId}),{code:'changed'});assert.equal(calls,0);const item=f.local.detail({...f.base,bucket:'active',jobId:j.jobId}).item;const work=f.local.pause({...f.base,jobId:j.jobId,observationId:item.observationId});await ready.promise;let closed=false;const closing=f.local.closeCurrent().then(()=>closed=true);await new Promise(r=>setImmediate(r));assert.equal(closed,false);held.resolve();await assert.rejects(work,{code:'changed'});await closing;assert.equal(calls,1);
});
test('local mutation uses actual same-job OS gate; other active job does not block offline listing',async t=>{
 const f=setup(t),j=f.jobs.create(input()),other=new QQTransferJobs({root:path.join(f.root,'jobs'),vault:f.crypto});const held=deferred(),ready=deferred(),work=other.withJob(j.jobId,{},async()=>{ready.resolve();await held.promise;});await ready.promise;try{await f.local.list(f.base);const p=await f.preview(j.jobId);await assert.rejects(f.confirm(p),{code:'transfer_busy'});assert.equal(f.jobs.listEnded().length,0);}finally{held.resolve();await work;other.close();}
});
test('malformed post-commit response stays unknown; explicit check only observes the archived revision',async t=>{
 const f=setup(t),j=f.jobs.create(input());await f.local.list(f.base);let calls=0;const archive=f.jobs.archive.bind(f.jobs);f.jobs.archive=async(...args)=>{calls++;await archive(...args);return {committed:true,privatePath:'must not project'};};const p=await f.preview(j.jobId),r=await f.confirm(p);assert.equal(r.change.committed,null);assert.equal(r.change.endedPresent,null);assert.equal(f.local.check({...f.base,operationId:r.operationId}).observation.outcome,'archive-observed');assert.equal(calls,1);assert(!JSON.stringify(r).includes('privatePath'));
});
test('Check rejects mixed pre-archive and post-archive reads instead of claiming the original is present',async t=>{
 const f=setup(t),j=f.jobs.create(input());await f.local.list(f.base);const p=await f.preview(j.jobId),r=await f.confirm(p),get=f.jobs.get.bind(f.jobs);f.jobs.get=id=>id===j.jobId?structuredClone(j):get(id);assert.throws(()=>f.local.check({...f.base,operationId:r.operationId}),{code:'changed'});f.jobs.get=get;assert.equal(f.local.check({...f.base,operationId:r.operationId}).observation.outcome,'archive-observed');
});
test('strict wrapper suppresses private result fields and raw error text',async t=>{
 const f=setup(t),j=f.jobs.create(input()),r=await f.local.list(f.base);assert.equal((await transferLocalResult(f.base,'list',()=>r)).ok,true);const bad=structuredClone(r);bad.active[0].job.source={file:'private'};assert.equal((await transferLocalResult(f.base,'list',()=>bad)).code,'invalid_response');const error=await transferLocalResult(f.base,'list',()=>{throw Error('private credential example');});assert.equal(error.code,'transfer_unknown');assert(!JSON.stringify(error).includes('credential'));const item=r.active[0];assert.equal(item.job.jobId,j.jobId);
});
test('contradictory unchanged receipts cannot report not committed after archive or forget',async t=>{
 const f=setup(t),j=f.jobs.create(input());await f.local.list(f.base);
 for(const operation of ['archive','forget-ended']){const p=await f.preview(j.jobId,operation),r=await f.confirm(p),contradictory=structuredClone(r);contradictory.change.committed=false;assert.throws(()=>projectLocalResult({...f.base,ticketId:p.preview.ticketId,expectedDigest:p.preview.expectedDigest},'confirm',contradictory),{code:'invalid_response'});assert.equal(r.change.committed,true);}
});
test('Close retries retained store gate cleanup and never repeats the archive transaction',async t=>{
 const f=setup(t),j=f.jobs.create(input());await f.local.list(f.base);const p=await f.preview(j.jobId),r=await f.confirm(p);assert.equal(r.change.committed,true);const settle=f.jobs.settleRetirementCleanup.bind(f.jobs);let deny=true,calls=0;f.jobs.settleRetirementCleanup=async()=>{calls++;if(deny)throw Object.assign(Error('synthetic cleanup failure'),{code:'transfer_cleanup_unconfirmed'});return settle();};await assert.rejects(f.local.closeCurrent(),{code:'transfer_cleanup_unconfirmed'});assert(f.local.current);deny=false;assert.equal((await f.local.closeCurrent()).closed,true);assert.equal(f.jobs.listEnded().length,1);assert.equal(calls,2);
});
