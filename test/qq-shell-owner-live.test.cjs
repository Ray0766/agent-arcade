'use strict';
// Actual Windows processes. Synthetic prepared metadata; no QQ implementation.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{spawn}=require('node:child_process');
const {fixture,hash,same}=require('./helpers/qq-shell-owner-live-fixture.cjs');
const options={skip:process.platform!=='win32',timeout:180000};
function retained(f,marker,lock){assert(fs.readFileSync(f.marker).equals(marker));if(lock)assert(fs.readFileSync(f.selection.lockFile).equals(lock));assert.equal(fs.readFileSync(path.join(f.descriptor.qqDataDir,'sentinel'),'utf8'),'DATA_UNCHANGED');}
async function absent(f,rows){assert.equal((await f.observer.inspect(rows.map(x=>x.pid))).length,0);}
async function finish(t,f){await f.close();assert.equal(f.evidence.created.length,f.evidence.independentlyAbsent.length);t.diagnostic(JSON.stringify({actualWindows:true,syntheticPreparedMetadata:true,realQQOperations:0,...f.evidence}));}
test('real same-manager marker-blocked tree stops once without changing the update record',options,async t=>{
 const f=await fixture(t),rows=await f.start(),lease=JSON.parse(fs.readFileSync(f.leasePath));assert.equal(lease.version,2);assert.equal(lease.engine,'managed-shell');fs.appendFileSync(path.join(f.codeRoot,'napcat.mjs'),'\nPRIVATE_COMPONENT_CHANGE_AFTER_START\n');const marker=f.addMarker();
 // This case has no foreign component owner. A live-manager component lock
 // would correctly block; the ordinary installation lock was already released.
 const observation=await f.manager.inspectOwnerControl(f.config.expectedQQ);assert.equal(observation.configured,false);assert.equal(observation.row.canStart,false);assert.equal(observation.row.canStop,true);
 const result=await f.manager.stop(f.config.expectedQQ);assert.equal(result.management,'stopped');assert.equal(result.canStart,false);await absent(f,rows);assert.equal(fs.existsSync(f.leasePath),false);retained(f,marker);
 await finish(t,f);
});
test('real crashed manager leaves surviving launcher and child: explicit adopt then separate stop',options,async t=>{
 const f=await fixture(t,{detached:true}),w=await f.worker();assert.equal(w.ready.leaseVersion,2);const before=JSON.parse(fs.readFileSync(f.leasePath)),marker=f.addMarker(),lock=f.addDeadComponentLock(w.proof);await w.crash();const live=await f.observer.inspect(w.ready.rows.map(x=>x.pid));assert.equal(live.length,2,'must exercise surviving tree, never accept dead clear instead');
 const next=f.reload(),observation=await next.manager.inspectOwnerControl(f.config.expectedQQ);assert.equal(observation.row.canRecover,true);assert.equal(observation.row.canStart,false);assert.equal(next.manager.runs.size,0);const adopted=await next.manager.recover(f.config.expectedQQ);assert.equal(adopted.recovery,'adopted');assert.equal(adopted.canStop,true);assert.equal(adopted.canStart,false);const after=JSON.parse(fs.readFileSync(f.leasePath));assert.deepEqual(after.spawnManager,before.spawnManager);assert.deepEqual(after.binding,before.binding);assert.notEqual(after.token,before.token);assert.equal((await f.observer.inspect(live.map(x=>x.pid))).length,2);retained(f,marker,lock);
 const stopped=await next.manager.stop(f.config.expectedQQ);assert.equal(stopped.management,'stopped');assert.equal(stopped.canStart,false);await absent(f,live);assert.equal(fs.existsSync(f.leasePath),false);retained(f,marker,lock);await finish(t,f);
});
test('default production launch after manager exit leaves an incomplete tree and refuses adoption',options,async t=>{
 const f=await fixture(t),w=await f.worker(),marker=f.addMarker();await w.crash();const live=await f.observer.inspect(w.ready.rows.map(x=>x.pid)),lease=fs.readFileSync(f.leasePath),root=JSON.parse(lease).runtime;assert.equal(live.length,1,'records actual default launch lifetime, not detached lifetime');assert.equal(live.some(x=>x.pid===root.pid),false,'launcher must be absent for this orphan-child case');const next=f.reload();await assert.rejects(next.manager.recover(f.config.expectedQQ),e=>{f.evidence.defaultOrphanRefusalCode=e.code;return e.code==='orphaned_children';});assert(fs.readFileSync(f.leasePath).equals(lease));assert.equal((await f.observer.inspect(live.map(x=>x.pid))).length,1);retained(f,marker);Object.assign(f.evidence,{leaseRetainedBeforeTestCleanup:true,markerRetainedBeforeTestCleanup:true,productOrphanCleanupExercised:false});
 await f.observer.stop(live);f.evidence.testObserverStoppedOrphan=true;await absent(f,live);assert.equal((await next.manager.recover(f.config.expectedQQ)).recovery,'cleared');retained(f,marker);await finish(t,f);
});
test('real fully dead tree after manager crash clears only its exact bound account lease',options,async t=>{
 const f=await fixture(t,{detached:true}),w=await f.worker(),marker=f.addMarker(),lock=f.addDeadComponentLock(w.proof);await f.observer.stop(w.ready.rows);await absent(f,w.ready.rows);await w.crash();const next=f.reload(),before=fs.readFileSync(f.leasePath),lease=JSON.parse(before);assert.equal(lease.version,2);
 // Bounded observations use only the production calls already made below.
 // Keep an original refusal visible: no extra query, retry or weakened check.
 const ids=new Set([w.proof.pid,...w.ready.rows.map(row=>row.pid)]),observations=[];
 const project=row=>({pid:row.pid,parentPid:row.parentPid,createdAt:row.createdAt,name:row.name,executableSha256:hash(String(row.executable||'').toLowerCase())});
 for(const method of ['snapshot','inspect']){
  const original=next.manager.host[method].bind(next.manager.host);
  next.manager.host[method]=async(...args)=>{try{const rows=await original(...args);observations.push({method,requested:method==='inspect'?args[0]:null,total:rows.length,rows:rows.filter(row=>ids.has(row.pid)||ids.has(row.parentPid)).slice(0,32).map(project)});if(observations.length>32)observations.shift();return rows;}catch(error){observations.push({method,code:error.code||'unknown'});if(observations.length>32)observations.shift();throw error;}};
 }
 let recoveryError=null;
 try{const result=await next.manager.recover(f.config.expectedQQ);assert.equal(result.recovery,'cleared');assert.equal(result.processRunning,false);assert.equal(result.canStart,false);assert.equal(fs.existsSync(f.leasePath),false);retained(f,marker,lock);await finish(t,f);}catch(error){recoveryError=error.code||error.name;throw error;}
 finally{t.diagnostic(JSON.stringify({kind:'dead-tree-existing-observations',productionCallsOnly:true,recoveryError,proofs:[lease.runtime,...(lease.runtimeTree||[])].map(project),manager:project(w.proof),observations}));}
});
test('same code, QQ executable and account do not let another installation adopt a surviving tree',options,async t=>{
 const f=await fixture(t,{detached:true}),otherConfig=f.createOtherInstallation(),w=await f.worker(),marker=f.addMarker();await w.crash();const old=fs.readFileSync(f.leasePath),other=f.reload(otherConfig);fs.writeFileSync(other.marker,'OTHER_SYNTHETIC_MARKER');assert.equal(other.codeRoot,f.codeRoot);assert.equal(other.descriptor.qq.file,f.descriptor.qq.file);assert.notEqual(other.descriptor.installationId,f.descriptor.installationId);
 await assert.rejects(other.manager.recover(f.config.expectedQQ),e=>{f.evidence.foreignInstallationRefusalCode=e.code;return e.code==='ownership_lost';});assert(fs.readFileSync(f.leasePath).equals(old));assert.equal((await f.observer.inspect(w.ready.rows.map(x=>x.pid))).length,2);assert.equal(other.manager.runs.size,0);
 const next=f.reload();assert.equal((await next.manager.recover(f.config.expectedQQ)).recovery,'adopted');await next.manager.stop(f.config.expectedQQ);await absent(f,w.ready.rows);retained(f,marker);await finish(t,f);
});
test('an ordinary private QQ-named process at the same path is never adopted or terminated',options,async t=>{
 const f=await fixture(t,{detached:true}),w=await f.worker(),marker=f.addMarker();await w.crash();const foreign=spawn(f.descriptor.qq.file,[],{windowsHide:true,stdio:'ignore',detached:true});await new Promise((resolve,reject)=>{foreign.once('spawn',resolve);foreign.once('error',reject);});const proof=f.remember(await f.observer.inspect([foreign.pid]))[0];assert(proof);const next=f.reload(),before=hash(fs.readFileSync(f.leasePath));await assert.rejects(next.manager.recover(f.config.expectedQQ),e=>{f.evidence.externalProcessRefusalCode=e.code;return e.code==='external_qq_unknown';});assert.equal(hash(fs.readFileSync(f.leasePath)),before);const foreignAfter=(await f.observer.inspect([foreign.pid]))[0];assert(same(foreignAfter,proof));f.evidence.foreignPreserved.push(proof.pid);assert.equal((await f.observer.inspect(w.ready.rows.map(x=>x.pid))).length,2);
 await f.observer.stop([proof]);await absent(f,[proof]);assert.equal((await next.manager.recover(f.config.expectedQQ)).recovery,'adopted');await next.manager.stop(f.config.expectedQQ);await absent(f,w.ready.rows);retained(f,marker);await finish(t,f);
});
test('actual native Stop preserves a production-helper two-link marker and two-link journal',options,async t=>{
 const {QQPendingUpdateRecovery}=require('../src/bot/qq-pending-update-recovery.cjs'),f=await fixture(t),marker=f.addMarker(),io=Object.create(fs);let linked=false;
 io.linkSync=(from,to)=>{fs.linkSync(from,to);if(from===f.marker){linked=true;throw Object.assign(Error('synthetic post-link interruption'),{code:'EIO'});}};
 const pending=new QQPendingUpdateRecovery({selection:f.selection,io});let ready;
 try{const listed=await pending.list(),preview=await pending.preview({recordId:listed.records[0].recordId}),interrupted=await pending.confirm({ticketId:preview.ticketId,expectedDigest:preview.expectedDigest});assert.equal(interrupted.committed,null);assert.equal(interrupted.code,'pending_update_unconfirmed');assert.equal(linked,true);ready=pending.captureLockRecoveryProof();}finally{pending.close();}
 const history=path.join(f.descriptor.configDir,'.agent-arcade-pending-updates'),pendingPath=path.join(history,'pending.json'),record=JSON.parse(fs.readFileSync(pendingPath)),intent=path.join(history,record.operationId,'intent.json'),retainedPath=path.join(history,record.operationId,'plan.bin');
 assert.equal(fs.statSync(f.marker,{bigint:true}).nlink,2n);assert.equal(fs.statSync(pendingPath,{bigint:true}).nlink,2n);assert.equal(fs.statSync(pendingPath,{bigint:true}).ino,fs.statSync(intent,{bigint:true}).ino);assert.equal(fs.statSync(f.marker,{bigint:true}).ino,fs.statSync(retainedPath,{bigint:true}).ino);
 // The helper only generated this journal while stopped. Temporarily move our
 // private records aside, start normally, then restore the same inodes to
 // simulate pending-state arrival. Do not claim the helper permits live writes.
 const savedMarker=path.join(f.dir,'parked-marker'),savedHistory=path.join(f.dir,'parked-history');for(const file of [f.marker,history,savedMarker,savedHistory])assert(path.resolve(file).toLowerCase().startsWith(path.resolve(f.dir).toLowerCase()+path.sep));fs.renameSync(f.marker,savedMarker);fs.renameSync(history,savedHistory);const rows=await f.start();fs.renameSync(savedHistory,history);fs.renameSync(savedMarker,f.marker);
 const files=[f.marker,pendingPath,intent,retainedPath],snap=files.map(file=>({file,bytes:fs.readFileSync(file),ino:fs.statSync(file,{bigint:true}).ino,nlink:fs.statSync(file,{bigint:true}).nlink}));const ordinary=await f.manager.discover();assert.equal(ordinary.configured,false);const view=await f.manager.inspectOwnerControl(f.config.expectedQQ);assert.equal(view.componentIssue,'pending_update_recovery_required');assert.equal(view.row.canStop,true);assert.equal(view.row.canStart,false);assert.equal((await f.manager.stop(f.config.expectedQQ)).management,'stopped');await absent(f,rows);
 for(const item of snap){assert(fs.readFileSync(item.file).equals(item.bytes));const stat=fs.statSync(item.file,{bigint:true});assert.equal(stat.ino,item.ino);assert.equal(stat.nlink,item.nlink);}const verify=new QQPendingUpdateRecovery({selection:f.selection});try{assert.equal(verify.captureLockRecoveryProof().rows[0].record.value.operationId,ready.rows[0].record.value.operationId);}finally{verify.close();}retained(f,marker);Object.assign(f.evidence,{actualProductionHelperJournal:true,simulatedArrivalByTemporaryRecordRelocation:true,markerLinks:2,journalLinks:2,allFourRecordBytesAndInodesUnchanged:true});await finish(t,f);
});
