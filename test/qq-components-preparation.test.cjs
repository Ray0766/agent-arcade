'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {QQComponents}=require('../src/bot/qq-components.cjs');
const ID='napcat-shell-4.18.42-0123456789abcdef',PID='11111111-1111-4111-8111-111111111111',TID='22222222-2222-4222-8222-222222222222',QID='33333333-3333-4333-8333-333333333333',DIGEST='a'.repeat(64);
const error=(code,extra={})=>Object.assign(Error('PRIVATE path token'),{code,...extra});
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const next=()=>new Promise(r=>setImmediate(r));
function fixture(t){
 const calls=[],root=path.resolve('work/synthetic-component-root');
 const entry={preparationId:PID,component:'napcat-shell',versionId:ID,version:'4.18.42',state:'recorded-incomplete',verification:'not-checked',privatePath:'PRIVATE'};
 const preview=()=>({...entry,operation:'preparation-recovery',ticketId:TID,expectedDigest:DIGEST,expiresAt:Date.now()+290000,fileCount:2,directoryCount:1,totalBytes:48,preservesDirectory:true,automaticRetry:false,automaticStart:false});
 const receipt=()=>({committed:true,recovered:true,quarantineId:PID,component:'napcat-shell',versionId:ID,preserved:true,automaticRetry:false,automaticStart:false,selectionChanged:false,privatePath:'PRIVATE'});
 const recovery={list:async()=>{calls.push('list');return {entries:[entry],issues:[]};},preview:async options=>{calls.push('preview');options.assertCurrent();return preview();},recover:async options=>{calls.push('recover');options.assertCurrent();return receipt();},discardPreview(){calls.push('discard');}};
 const prepared={root,component:'napcat-shell',packages:{root,component:'napcat-shell',inspect:async()=>{},stage:async()=>{}},preparationRecovery:recovery,prepare:async()=>{},listPrepared:async()=>({items:[],issues:[]}),resolvePrepared:async()=>{}};
 const selector={prepared,installationId:'fixture-installation',lockFile:'fixture-lock',configLock:'fixture-config',status:async()=>({current:{kind:'original',version:'4.18.42'},previous:null,digest:null,canRollback:false,scope:'napcat-only',automaticStart:false}),preview:async()=>{},activate:async()=>{},rollback:async()=>{}};
 const runtime={componentStoreRoot:root,componentSelection:()=>selector};const console={runtime,epoch:0,busy:new Set(),check(r,e){if(this.closed||r!==this.runtime||e!==this.epoch)throw error('changed');},abortDirectory(){calls.push('abort-directory');}};
 const manager=new QQComponents({console});t.after(()=>manager.close());
 const inspect=async()=>{await manager.execute({action:'preparation-list'});return manager.execute({action:'preparation-preview',preparationId:PID});};
 const confirm=()=>manager.execute({action:'preparation-recover',ticketId:TID,expectedDigest:DIGEST});
 return {manager,console,runtime,selector,prepared,recovery,entry,preview,receipt,calls,inspect,confirm};
}
test('preparation actions reject caller paths, engines, unknown identifiers and unexpected payload fields before I/O',async t=>{
 const f=fixture(t);for(const request of [{action:'preparation-list',path:'PRIVATE'},{action:'preparation-preview',preparationId:PID,component:'napcat-node'},{action:'preparation-preview',preparationId:[]},{action:'preparation-recover',ticketId:TID,expectedDigest:DIGEST,target:ID},{action:'preparation-recover',ticketId:TID,expectedDigest:[]},{action:'preparation-dismiss',preparationId:PID}])await assert.rejects(f.manager.execute(request),{code:'invalid_request'});
 assert.deepEqual(f.calls,[]);await assert.rejects(f.manager.execute({action:'preparation-preview',preparationId:PID}),{code:'preview_required'});assert(!f.calls.includes('preview'));
});
test('list and preview expose bounded metadata only; snapshot is silent and never rechecks files',async t=>{
 const f=fixture(t),result=await f.inspect();assert.equal(result.preparationPreview.preparationId,PID);assert.equal(result.preparationPreview.preservesDirectory,true);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|privatePath|state/);
 const calls=f.calls.length;for(let i=0;i<30;i++)f.manager.snapshot();assert.equal(f.calls.length,calls);assert.equal(f.manager.snapshot().preparationEntries[0].verification,'not-checked');assert.doesNotMatch(JSON.stringify(f.manager.snapshot()),/PRIVATE|ticketId|expectedDigest/);
});
test('duplicates, wrong component and oversized discovery are rejected as whole lists',async t=>{
 const f=fixture(t);for(const entries of [[f.entry,f.entry],[{...f.entry,component:'napcat-node'}],Array(257).fill(f.entry)]){f.recovery.list=async()=>({entries,issues:[]});await assert.rejects(f.manager.execute({action:'preparation-list'}),{code:'invalid_response'});}
});
test('preview validates exact listed identity, no automatic action, expiry and bounded counts',async t=>{
 const f=fixture(t);for(const patch of [{preparationId:QID},{versionId:ID.replace('0123','ffff')},{automaticRetry:true},{preservesDirectory:false},{expiresAt:Date.now()-1},{totalBytes:2**30},{fileCount:-1}]){await f.manager.execute({action:'preparation-list'});f.recovery.preview=async()=>({...f.preview(),...patch});await assert.rejects(f.manager.execute({action:'preparation-preview',preparationId:PID}),{code:'invalid_response'});await assert.rejects(f.confirm(),{code:'preview_required'});}
});
test('confirmation is single use, preserves selection and returns no archive path or implicit retry',async t=>{
 const f=fixture(t);await f.inspect();const result=await f.confirm();assert.equal(result.recovered,true);assert.equal(result.quarantineId,PID);assert.equal(result.selectionChanged,false);assert.equal(result.automaticRetry,false);assert.equal(result.automaticStart,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|ticketId/);await assert.rejects(f.confirm(),{code:'preview_required'});assert.equal(f.calls.filter(x=>x==='recover').length,1);assert.deepEqual(f.manager.snapshot().lastPreparationRecovery,result);
});
test('successful quarantine with list failure remains committed and cannot be submitted again',async t=>{
 const f=fixture(t);await f.inspect();f.recovery.list=async()=>{throw error('component_io_failed');};const result=await f.confirm();assert.equal(result.committed,true);assert.equal(result.recovered,true);assert.equal(result.refreshIssue,'component_io_failed');assert.equal(f.manager.snapshot().lastPreparationRecovery.committed,true);await assert.rejects(f.confirm(),{code:'preview_required'});
});
test('postcommit thrown failure is retained without asserting a fully verified quarantine',async t=>{
 const f=fixture(t);await f.inspect();f.recovery.recover=async()=>{throw error('preparation_recovery_failed',{committed:true,privatePath:'PRIVATE'});};const result=await f.confirm();assert.equal(result.committed,true);assert.equal(result.recovered,false);assert.equal(result.recoveryIssue,'preparation_recovery_failed');assert.equal(result.quarantineId,undefined);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
});
test('unknown rename outcome is retained and malformed receipts cannot claim success',async t=>{
 const f=fixture(t);for(const mode of ['throw','malformed']){await f.inspect();f.recovery.recover=async()=>{if(mode==='throw')throw error('preparation_commit_unconfirmed',{committed:null,changeAttempted:true});return {privatePath:'PRIVATE'};};const result=await f.confirm();assert.equal(result.committed,null);assert.equal(result.changeAttempted,true);assert.equal(result.recovered,false);assert.equal(f.manager.snapshot().lastPreparationRecovery.changeAttempted,true);await assert.rejects(f.confirm(),{code:'preview_required'});}
});
test('wrong component success receipt preserves commit but cannot report reviewed version as recovered',async t=>{
 const f=fixture(t);await f.inspect();f.recovery.recover=async()=>({...f.receipt(),component:'napcat-node'});const result=await f.confirm();assert.equal(result.committed,true);assert.equal(result.recovered,false);assert.equal(result.recoveryIssue,'invalid_response');
});
test('scope change during preview rejects late result and drops enumerated records',async t=>{
 const f=fixture(t),gate=deferred();await f.manager.execute({action:'preparation-list'});f.recovery.preview=async()=>{await gate.promise;return f.preview();};const pending=f.manager.execute({action:'preparation-preview',preparationId:PID}),rejected=assert.rejects(pending,{code:'changed'});await next();f.console.epoch++;assert.deepEqual(f.manager.snapshot().preparationEntries,[]);gate.resolve();await rejected;assert.equal(f.manager.preparationPreview,null);
});
test('selector identity change after preview prevents recover invocation',async t=>{
 const f=fixture(t);await f.inspect();f.selector.lockFile='replacement-lock';await assert.rejects(f.confirm(),{code:'preview_required'});assert(!f.calls.includes('recover'));
});
test('scoped dismiss cancels only preparation recovery, and close waits for active final settlement',async t=>{
 const f=fixture(t),gate=deferred();await f.manager.execute({action:'preparation-list'});let signal;f.recovery.preview=async options=>{signal=options.signal;await gate.promise;options.assertCurrent();return f.preview();};const pending=f.manager.execute({action:'preparation-preview',preparationId:PID}),rejected=assert.rejects(pending,{code:'cancelled'});await next();assert(f.console.busy.has('qq-components'));assert.equal((await f.manager.execute({action:'repair-dismiss'})).cancelRequested,false);assert.equal(signal.aborted,false);assert.equal((await f.manager.execute({action:'preparation-dismiss'})).cancelRequested,true);let settled=false;const closing=f.manager.close().then(()=>settled=true);await next();assert.equal(settled,false);gate.resolve();await rejected;await closing;assert.equal(f.console.busy.size,0);
});
test('cross-account console busy and setup preparation block recovery before helper calls',async t=>{
 const f=fixture(t);await f.manager.execute({action:'preparation-list'});f.console.busy.add('another-account');await assert.rejects(f.manager.execute({action:'preparation-preview',preparationId:PID}),{code:'operation_in_progress'});assert(!f.calls.includes('preview'));
});

test('readback-incomplete receipt preserves verified IDs and the fixed recovery warning',async t=>{
 const f=fixture(t);await f.inspect();f.recovery.recover=async()=>({...f.receipt(),recovered:false,recoveryIssue:'preparation_readback_failed'});const result=await f.confirm();assert.equal(result.committed,true);assert.equal(result.recovered,false);assert.equal(result.quarantineId,PID);assert.equal(result.recoveryIssue,'preparation_readback_failed');
});

test('a different valid quarantine UUID cannot claim recovery of the previewed directory',async t=>{
 const f=fixture(t);await f.inspect();f.recovery.recover=async()=>({...f.receipt(),quarantineId:QID});const result=await f.confirm();assert.equal(result.committed,true);assert.equal(result.recovered,false);assert.equal(result.recoveryIssue,'invalid_response');assert.equal(result.quarantineId,undefined);
});

test('recovery helper must share the runtime lock namespace and preserve its fixed refusal codes',async t=>{
 const f=fixture(t);f.runtime.lockRoot=path.resolve('work/fixture-custom-lock');f.recovery.lockRoot=path.resolve('work/wrong-lock');await assert.rejects(f.manager.execute({action:'preparation-list'}),{code:'invalid_response'});f.recovery.lockRoot=f.runtime.lockRoot;
 for(const code of ['preparation_proof_unavailable','preparation_publishing','preparation_complete','preparation_selected','reference_unverified','preparation_readback_failed']){await f.manager.execute({action:'preparation-list'});f.recovery.preview=async()=>{throw error(code);};await assert.rejects(f.manager.execute({action:'preparation-preview',preparationId:PID}),e=>e.code===code&&!e.message.includes('PRIVATE'));}
});

test('published preparation with gate-close failure is not relabeled a failed write or selection change',async t=>{
 const f=fixture(t);let prepareCalls=0,resolveCalls=0;f.prepared.packages.stage=async()=>({version:'4.18.42',sha256:'0123456789abcdef'+'0'.repeat(48)});f.prepared.prepare=async()=>{prepareCalls++;throw error('recovery_gate_close_failed',{committed:true});};f.prepared.resolvePrepared=async()=>{resolveCalls++;return {version:'4.18.42',versionId:ID,source:{sha256:'0123456789abcdef'+'0'.repeat(48)},fileCount:2,totalBytes:8};};
 const result=await f.manager.execute({action:'prepare'});assert.equal(result.preparationCommitted,true);assert.equal(result.preparationIssue,'recovery_gate_close_failed');assert.equal(result.prepared.verified,true);assert.equal(result.committed,undefined);assert.equal(result.selection,undefined);assert.equal(prepareCalls,1);assert.equal(resolveCalls,1);
 f.prepared.resolvePrepared=async()=>{throw error('prepared_invalid');};const failed=await f.manager.execute({action:'prepare'});assert.equal(failed.preparationCommitted,true);assert.equal(failed.prepared,null);assert.equal(failed.verificationIssue,'prepared_invalid');assert.equal(prepareCalls,2);
});
test('formal writer recovery joins the coordinator and preserves actual temporary files',{skip:require('./helpers/platform-skip.cjs').ownedIpcSkip()},async t=>{
 const fs=require('node:fs'),os=require('node:os'),{QQPreparationRecovery}=require('../src/bot/qq-component-preparation-recovery.cjs'),f=fixture(t),root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-preparation-console-')),lockRoot=path.join(root,'locks');
 t.after(()=>{assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});f.runtime.componentStoreRoot=root;f.runtime.lockRoot=lockRoot;f.prepared.root=root;f.prepared.packages.root=root;let live=true;
 const helper=new QQPreparationRecovery({root,lockRoot,packages:{verify:async()=>assert.fail('No download or archive read')},processHost:{inspect:async()=>live?[{pid:process.pid,createdAt:'2026-01-01T00:00:00Z',executable:process.execPath}]:[]}});f.prepared.preparationRecovery=helper;
 const source={tag:'v4.18.42',assetId:123,size:8,sha256:'0123456789abcdef'+'0'.repeat(48)},dir=path.join(root,'qq-component-versions','napcat-shell',ID),bytes=Buffer.from('synthetic retained bytes');
 await assert.rejects(helper.runWriter({version:'4.18.42',versionId:ID,source},async writer=>{fs.mkdirSync(dir,{recursive:true});writer.allocated(dir,{files:[{path:'fixture.txt',size:bytes.length}],directories:[]});fs.mkdirSync(path.join(dir,'code'));fs.writeFileSync(path.join(dir,'code','fixture.txt'),bytes);throw Error('synthetic interrupted writer');}),/synthetic interrupted/);live=false;
 const list=await f.manager.execute({action:'preparation-list'});assert.equal(list.preparationEntries.length,1);const id=list.preparationEntries[0].preparationId;const {preparationPreview:p}=await f.manager.execute({action:'preparation-preview',preparationId:id});const result=await f.manager.execute({action:'preparation-recover',ticketId:p.ticketId,expectedDigest:p.expectedDigest});assert.equal(result.committed,true);assert.equal(result.recovered,true);assert.equal(result.quarantineId,id);assert.deepEqual(fs.readFileSync(path.join(helper.quarantine,id,'code','fixture.txt')),bytes);assert.equal(fs.existsSync(dir),false);assert.deepEqual(f.manager.snapshot().preparationEntries,[]);assert.equal(result.selectionChanged,false);
});

test('explicit status reread dismisses the old preview while passive snapshot polling does not',async t=>{
 const f=fixture(t);await f.inspect();assert(f.manager.preparationPreview);f.manager.snapshot();assert(f.manager.preparationPreview);await f.manager.execute({action:'status'});assert.equal(f.manager.preparationPreview,null);await assert.rejects(f.confirm(),{code:'preview_required'});assert(!f.calls.includes('recover'));
});
