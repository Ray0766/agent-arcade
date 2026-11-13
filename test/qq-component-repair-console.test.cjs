'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),os=require('node:os');
const {randomUUID}=require('node:crypto');
const {QQComponents}=require('../src/bot/qq-components.cjs');
const VERSION='4.18.42',DIGEST='b'.repeat(64),ID=`napcat-shell-${VERSION}-${'a'.repeat(16)}`;
const bad=(code,extra={})=>Object.assign(Error('PRIVATE token/path/raw error'),{code,...extra});
const next=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const original=()=>({kind:'original',version:VERSION,verification:'mandatory-files-only'});
const damaged=()=>({kind:'prepared',version:VERSION,versionId:ID});
const selected=()=>({current:original(),previous:null,canRollback:false,digest:'c'.repeat(64),scope:'napcat-only',automaticStart:false});
function fixture(t){
  const calls=[],root=path.join(os.tmpdir(),'arcade-component-repair-console');
  const packages={root,inspect:async()=>{},stage:async()=>{}},prepared={root,packages,prepare:async()=>{},resolvePrepared:async()=>{},listPrepared:async()=>({items:[],issues:[]})};
  const selector={installationId:'d'.repeat(64),lockFile:path.join(root,'install.lock'),configLock:path.join(root,'configuration.edit'),prepared,
    status:()=>({...selected(),current:damaged(),previous:original(),canRollback:true,digest:DIGEST}),preview:async()=>assert.fail('Normal preview must not handle repair'),activate:async()=>assert.fail('No activation'),rollback:async()=>assert.fail('No normal rollback')};
  const runtime={componentStoreRoot:root,componentSelection:()=>selector};
  const console={runtime,epoch:0,busy:new Set(),closed:false,refreshRevision:0,refreshing:null,check(r,e){if(r!==this.runtime||e!==this.epoch||this.closed)throw bad('changed');},refresh:async()=>calls.push('refresh'),abortDirectory:()=>calls.push('abort-directory')};
  let ticket=null;
  const preview=()=>({operation:'repair',ticketId:randomUUID(),expectedDigest:DIGEST,expiresAt:Date.now()+120000,current:damaged(),target:original(),damage:'code_integrity_mismatch',preservesDamagedDirectory:true,clearsRollback:true,automaticStart:false,privatePath:'PRIVATE'});
  const receipt=()=>({committed:true,repaired:true,selection:selected(),damagedDirectoryPreserved:true,automaticStart:false,privatePath:'PRIVATE'});
  const repair={discardPreview(){ticket=null;calls.push('discard');},async preview(options){options.assertCurrent();assert(options.signal instanceof AbortSignal);calls.push('preview');return ticket=preview();},async repair(options){calls.push('repair');const prior=ticket;ticket=null;options.assertCurrent();if(!prior||prior.ticketId!==options.ticketId)throw bad('preview_required');return receipt();}};
  const manager=new QQComponents({console,repairFactory:options=>{calls.push('factory');assert.equal(options.selection,selector);return repair;}});t.after(()=>manager.close());
  const inspect=async()=>{const value=await manager.execute({action:'repair-preview'});return value.repairPreview;};
  const commit=preview=>manager.execute({action:'repair',ticketId:preview.ticketId,expectedDigest:preview.expectedDigest});
  return {calls,root,selector,runtime,console,prepared,repair,manager,preview,receipt,inspect,commit};
}
test('repair requests accept only a fixed action and one-use ticket/digest, with no file or process authority',async t=>{
  const f=fixture(t);
  for(const request of [{action:'repair-preview',path:'PRIVATE'},{action:'repair-preview',versionId:ID},{action:'repair'},{action:'repair',ticketId:randomUUID(),expectedDigest:DIGEST,force:true},{action:'repair',ticketId:'wrong',expectedDigest:DIGEST},{action:'repair',ticketId:randomUUID(),expectedDigest:'x'.repeat(64)},{action:'repair-dismiss',pid:10}])await assert.rejects(f.manager.execute(request),{code:'invalid_request'});
  assert.deepEqual(f.calls,[]);
});
test('explicit repair preserves bounded verification scope and confirms selection without a normal switch',async t=>{
  const f=fixture(t),preview=await f.inspect();assert.equal(preview.target.verification,'mandatory-files-only');assert.doesNotMatch(JSON.stringify(preview),/PRIVATE|privatePath/);
  assert.equal(f.manager.snapshot().repairPreview,undefined);assert(!JSON.stringify(f.manager.snapshot()).includes(preview.ticketId));
  await f.manager.execute({action:'status'});const result=await f.commit(preview);
  assert.equal(result.committed,true);assert.equal(result.repaired,true);assert.equal(result.selection.current.kind,'original');assert.equal(result.selection.previous,null);assert.equal(result.selection.canRollback,false);assert.equal(result.automaticStart,false);assert.equal(result.damagedDirectoryPreserved,true);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|privatePath|ticketId/);assert.deepEqual(f.manager.snapshot().lastRepair,result);
  const copy=f.manager.snapshot();copy.lastRepair.repaired=false;assert.equal(f.manager.snapshot().lastRepair.repaired,true);
  await assert.rejects(f.commit(preview),{code:'preview_required'});assert.equal(f.calls.filter(v=>v==='repair').length,1);assert.equal(f.console.busy.size,0);
});
test('a wrong ticket or digest consumes the pending confirmation without entering the writer',async t=>{
  const f=fixture(t);let preview=await f.inspect();await assert.rejects(f.commit({...preview,ticketId:randomUUID()}),{code:'preview_required'});await assert.rejects(f.commit(preview),{code:'preview_required'});
  preview=await f.inspect();await assert.rejects(f.commit({...preview,expectedDigest:'e'.repeat(64)}),{code:'preview_required'});await assert.rejects(f.commit(preview),{code:'preview_required'});assert(!f.calls.includes('repair'));
});
test('invalid preview identity, verification scope or expiry never opens confirmation',async t=>{
  const f=fixture(t);for(const change of [{target:{...original(),verification:'full-manifest'}},{current:original()},{target:{...original(),version:'4.18.43'}},{expiresAt:Date.now()-1},{expiresAt:Date.now()+600000},{automaticStart:true},{preservesDamagedDirectory:false},{clearsRollback:false},{ticketId:'invalid'},{damage:'any_error'}]){
    f.repair.preview=async()=>({...f.preview(),...change});await assert.rejects(f.inspect(),{code:'invalid_response'});assert.equal(f.manager.repairPreview,null);
  }
});
test('Node installations cannot instantiate a Shell repair handler',async t=>{
  const f=fixture(t);f.prepared.component='napcat-node';f.prepared.packages.component='napcat-node';await assert.rejects(f.inspect(),{code:'repair_unavailable'});assert(!f.calls.includes('factory'));
});
test('all component operations are excluded during repair and stopped-runtime guard is retained',async t=>{
  const f=fixture(t),gate=deferred();f.repair.preview=async options=>{await gate.promise;options.assertCurrent();return f.preview();};const pending=f.inspect();await next();assert(f.console.busy.has('qq-components'));assert.equal(f.manager.snapshot().phase,'checking_repair');
  await assert.rejects(f.manager.execute({action:'prepare'}),{code:'operation_in_progress'});assert.equal((await f.manager.execute({action:'status'})).state.busy,true);gate.resolve();await pending;assert.equal(f.console.busy.size,0);
  f.console.busy.add('some-account');await assert.rejects(f.inspect(),{code:'operation_in_progress'});f.console.busy.clear();
});
test('dismiss during preview aborts it and no late ticket survives',async t=>{
  const f=fixture(t),gate=deferred();f.repair.preview=async()=>{await gate.promise;return f.preview();};const pending=f.inspect();await next();assert.equal((await f.manager.execute({action:'repair-dismiss'})).cancelRequested,true);gate.resolve();await assert.rejects(pending,{code:'cancelled'});assert.equal(f.manager.repairPreview,null);
});
test('dismiss invalidates only repair and does not cancel unrelated preparation',async t=>{
  const f=fixture(t),preview=await f.inspect();await f.manager.execute({action:'repair-dismiss'});await assert.rejects(f.commit(preview),{code:'preview_required'});
  const gate=deferred();let signal;f.prepared.packages.stage=async options=>{signal=options.signal;await gate.promise;throw bad('network_failed');};const pending=f.manager.execute({action:'prepare'});await next();assert.equal((await f.manager.execute({action:'repair-dismiss'})).cancelRequested,false);assert.equal(signal.aborted,false);gate.resolve();await assert.rejects(pending,{code:'network_failed'});
});
test('cancel, scope replacement and selector replacement all invalidate a preview',async t=>{
  const f=fixture(t);let preview=await f.inspect();await f.manager.execute({action:'cancel'});await assert.rejects(f.commit(preview),{code:'preview_required'});
  preview=await f.inspect();f.console.epoch++;f.manager.snapshot();await assert.rejects(f.commit(preview),{code:'preview_required'});
  preview=await f.inspect();f.runtime.componentSelection=()=>({...f.selector});await assert.rejects(f.commit(preview),{code:'changed'});assert(!f.calls.includes('repair'));
});
test('late preview under a changed installation cannot be returned or retained',async t=>{
  const f=fixture(t),gate=deferred();f.repair.preview=async()=>{await gate.promise;return f.preview();};const pending=f.inspect();await next();f.console.epoch++;gate.resolve();await assert.rejects(pending,{code:'changed'});assert.equal(f.manager.repairPreview,null);
});
test('readback or refresh failure preserves a committed write and consumed ticket',async t=>{
  const f=fixture(t);let preview=await f.inspect();f.repair.repair=async()=>{throw bad('repair_readback_failed',{committed:true});};let result=await f.commit(preview);assert.equal(result.committed,true);assert.equal(result.repaired,false);assert.equal(result.selection,null);assert.equal(result.refreshIssue,'repair_readback_failed');assert.equal(f.manager.snapshot().lastRepair.committed,true);await assert.rejects(f.commit(preview),{code:'preview_required'});
  preview=await f.inspect();f.repair.repair=async()=>f.receipt();f.console.refresh=async()=>{throw bad('process_check_failed');};result=await f.commit(preview);assert.equal(result.committed,true);assert.equal(result.repaired,true);assert.equal(result.refreshIssue,'process_check_failed');
});
test('lock-cleanup warning cannot disguise an accepted component selection',async t=>{
  const f=fixture(t),preview=await f.inspect();f.repair.repair=async()=>({...f.receipt(),lockRecoveryIssue:'component_lock_retained'});const result=await f.commit(preview);assert.equal(result.committed,true);assert.equal(result.repaired,true);assert.equal(result.lockRecoveryIssue,'component_lock_retained');
});
test('a returned partial receipt retains its fixed readback issue after a known commit',async t=>{
  const f=fixture(t);let preview=await f.inspect();f.repair.repair=async()=>({...f.receipt(),selection:null,refreshIssue:'repair_readback_failed'});let result=await f.commit(preview);assert.equal(result.committed,true);assert.equal(result.repaired,false);assert.equal(result.selection,null);assert.equal(result.refreshIssue,'repair_readback_failed');
  preview=await f.inspect();f.repair.repair=async()=>({...f.receipt(),refreshIssue:'PRIVATE_RAW_ERROR'});result=await f.commit(preview);assert.equal(result.committed,true);assert.equal(result.repaired,true);assert.equal(result.refreshIssue,'components_failed');assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
  preview=await f.inspect();f.repair.repair=async()=>({...f.receipt(),selection:null,refreshIssue:'repair_readback_failed',lockRecoveryIssue:'component_lock_retained'});result=await f.commit(preview);assert.equal(result.committed,true);assert.equal(result.repaired,false);assert.equal(result.refreshIssue,'repair_readback_failed');assert.equal(result.lockRecoveryIssue,'component_lock_retained');
});
test('uncertain replacement returns an explicit unknown result, without replay or retained paths',async t=>{
  const f=fixture(t);let preview=await f.inspect();f.repair.repair=async()=>({committed:null,changeAttempted:true,code:'repair_commit_unconfirmed',privatePath:'PRIVATE'});let result=await f.commit(preview);assert.equal(result.committed,null);assert.equal(result.changeAttempted,true);assert.equal(result.issue,'repair_commit_unconfirmed');assert.equal(result.repaired,false);assert.equal(f.manager.snapshot().current,null);assert.deepEqual(f.manager.snapshot().lastRepair,result);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|ticketId|privatePath/);await assert.rejects(f.commit(preview),{code:'preview_required'});
  preview=await f.inspect();f.repair.repair=async()=>{throw bad('repair_commit_unconfirmed',{committed:null,changeAttempted:true});};result=await f.commit(preview);assert.equal(result.committed,null);
});
test('unrelated or incomplete committed selection cannot be described as a verified repair',async t=>{
  const f=fixture(t);for(const replacement of [ {...selected(),previous:damaged(),canRollback:true},{...selected(),current:damaged()},null]){const preview=await f.inspect();f.repair.repair=async()=>({...f.receipt(),selection:replacement});const result=await f.commit(preview);assert.equal(result.committed,true);assert.equal(result.repaired,false);assert.equal(result.selection,null);assert.equal(result.refreshIssue,'invalid_response');}
});
test('a close waits for an active writer and preserves a write that already happened',async t=>{
  const f=fixture(t),preview=await f.inspect(),gate=deferred();f.repair.repair=async()=>{await gate.promise;return f.receipt();};const pending=f.commit(preview);await next();let done=false;const closing=f.manager.close().then(()=>done=true);await next();assert.equal(done,false);gate.resolve();const result=await pending;await closing;assert.equal(result.committed,true);assert.equal(result.repaired,true);assert.equal(result.refreshIssue,'manager_closing');assert.equal(f.console.busy.size,0);
});
