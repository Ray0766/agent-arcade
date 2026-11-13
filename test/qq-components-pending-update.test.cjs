'use strict';
// Production coordinator with isolated helper responses; no account or native runtime.
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path');
const {QQComponents}=require('../src/bot/qq-components.cjs');
const RID='a'.repeat(64),DIGEST='b'.repeat(64),TICKET='11111111-1111-4111-8111-111111111111',OID='22222222-2222-4222-8222-222222222222';
const problem=(code,extra={})=>Object.assign(Error('PRIVATE path and update content'),{code,...extra});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture(t,{component='napcat-shell'}={}){
 const root=path.resolve('work/synthetic-pending-root'),calls=[];
 const row={recordId:RID,state:'pending-update',bytes:30,privatePath:'PRIVATE'};
 const listing=()=>({supported:true,component,verification:'not-checked',records:[row],issue:null,privateContent:'PRIVATE'});
 const preview=()=>({operation:row.state==='pending-update'?'disable-pending-update':'reconcile-pending-update',recordId:RID,ticketId:TICKET,expectedDigest:DIGEST,expiresAt:Date.now()+290000,component,version:'4.18.42',verification:'full-manifest',bytes:30,disablesPlan:row.state==='pending-update',preservesOriginal:true,rollsBackCode:false,automaticStart:false,privatePath:'PRIVATE'});
 const receipt=()=>({committed:true,disabled:true,retained:true,recordId:RID,operationId:OID,automaticStart:false,rollsBackCode:false,privatePath:'PRIVATE'});
 const helper={async list(){calls.push('list');return listing();},async preview(options){calls.push('preview');options.assertCurrent();return preview();},async confirm(options){calls.push('confirm');options.assertCurrent();return receipt();},discardPreview(){calls.push('discard');},close(){calls.push('close');}};
 const prepared={root,component,packages:{root,component,inspect:async()=>{},stage:async()=>{}},prepare:async()=>{},resolvePrepared:async()=>{},listPrepared:async()=>({items:[],issues:[]})};
 const selector={prepared,installationId:'synthetic-installation',lockFile:'synthetic-lock',configLock:'synthetic-config',status:async()=>({current:{kind:'prepared',version:'4.18.42',versionId:`${component}-4.18.42-0123456789abcdef`},previous:null,digest:null,canRollback:false,scope:component==='napcat-shell'?'napcat-only':'qq-node-runtime',automaticStart:false}),preview:async()=>{},activate:async()=>{},rollback:async()=>{}};
 const runtime={componentStoreRoot:root,componentSelection:()=>selector},console={runtime,epoch:0,busy:new Set(),refreshRevision:0,check(r,e){if(this.closed||r!==this.runtime||e!==this.epoch)throw problem('changed');},abortDirectory(){calls.push('abort-directory');}};
 const manager=new QQComponents({console,pendingUpdateFactory:options=>{assert.equal(options.selection,selector);return helper;}});t.after(()=>manager.close());
 const list=()=>manager.execute({action:'pending-list'}),inspect=async()=>{await list();return manager.execute({action:'pending-preview',recordId:RID});},confirm=()=>manager.execute({action:'pending-confirm',ticketId:TICKET,expectedDigest:DIGEST});
 return {manager,console,runtime,selector,prepared,helper,calls,row,listing,preview,receipt,list,inspect,confirm};
}

test('pending update requests reject paths, extra fields and malformed capabilities before helper access',async t=>{
 const f=fixture(t);for(const request of [{action:'pending-list',path:'PRIVATE'},{action:'pending-preview',recordId:'../file'},{action:'pending-preview',recordId:RID,target:'PRIVATE'},{action:'pending-confirm',ticketId:TICKET,expectedDigest:DIGEST,source:'PRIVATE'},{action:'pending-dismiss',recordId:RID}])await assert.rejects(f.manager.execute(request),{code:'invalid_request'});assert.deepEqual(f.calls,[]);
 await assert.rejects(f.confirm(),{code:'pending_update_preview_required'});assert(!f.calls.includes('confirm'));
});

test('discovery/preview expose no record contents or paths and passive snapshots never re-read files',async t=>{
 const f=fixture(t),value=await f.inspect();assert.equal(value.pendingUpdatePreview.verification,'full-manifest');assert.doesNotMatch(JSON.stringify(value),/PRIVATE|privatePath/);const n=f.calls.length;for(let i=0;i<20;i++)f.manager.snapshot();assert.equal(f.calls.length,n);assert.doesNotMatch(JSON.stringify(f.manager.snapshot()),/PRIVATE|ticketId|expectedDigest/);
});

test('listing rejects duplicates, excessive records, wrong engine and unrecognized state',async t=>{
 const f=fixture(t);for(const patch of [{records:[f.row,f.row]},{records:Array(33).fill(f.row)},{component:'napcat-node'},{records:[{...f.row,state:'healthy'}]},{records:[{...f.row,bytes:2097153}]}]){f.helper.list=async()=>({...f.listing(),...patch});await assert.rejects(f.list(),{code:'invalid_response'});}
});

test('unsupported original installation has no confirmation path',async t=>{
 const f=fixture(t);f.helper.list=async()=>({...f.listing(),supported:false,issue:'pending_update_unsupported'});assert.equal((await f.list()).pendingUpdates.supported,false);await assert.rejects(f.manager.execute({action:'pending-preview',recordId:RID}),{code:'pending_update_preview_required'});assert(!f.calls.includes('preview'));
});

test('preview rejects a changed record, weak verification, automatic action and invalid expiry',async t=>{
 const f=fixture(t);for(const patch of [{recordId:'c'.repeat(64)},{verification:'mandatory-files-only'},{automaticStart:true},{rollsBackCode:true},{disablesPlan:false},{expiresAt:Date.now()-1},{bytes:-1}]){await f.list();f.helper.preview=async()=>({...f.preview(),...patch});await assert.rejects(f.manager.execute({action:'pending-preview',recordId:RID}),{code:'invalid_response'});await assert.rejects(f.confirm(),{code:'pending_update_preview_required'});}
});

test('Shell and Node confirmation is once-only, retains exact record identity and publishes a safe outcome',async t=>{
 for(const component of ['napcat-shell','napcat-node']){const f=fixture(t,{component});await f.inspect();const {pendingUpdateResult:r}=await f.confirm();assert.equal(r.disabled,true);assert.equal(r.retained,true);assert.equal(r.recordId,RID);assert.equal(r.operationId,OID);assert.equal(r.automaticStart,false);assert.equal(r.rollsBackCode,false);assert.doesNotMatch(JSON.stringify(r),/PRIVATE|ticketId/);await assert.rejects(f.confirm(),{code:'pending_update_preview_required'});assert.equal(f.calls.filter(s=>s==='confirm').length,1);assert.deepEqual(f.manager.snapshot().lastPendingUpdate,r);}
});

test('a changed installation binding prevents stale confirmation before helper mutation',async t=>{
 const f=fixture(t);await f.inspect();f.selector.lockFile='changed-lock';await assert.rejects(f.confirm(),{code:'pending_update_preview_required'});assert(!f.calls.includes('confirm'));
});

test('late discovery and preview cannot update a replacement installation',async t=>{
 for(const action of ['list','preview']){const f=fixture(t),gate=deferred();if(action==='preview')await f.list();f.helper[action]=async()=>{await gate.promise;return action==='list'?f.listing():f.preview();};const operation=action==='list'?f.list():f.manager.execute({action:'pending-preview',recordId:RID});const rejection=assert.rejects(operation,{code:'changed'});await tick();f.console.epoch++;assert.equal(f.manager.snapshot().pendingUpdates,null);gate.resolve();await rejection;assert.equal(f.manager.pendingUpdatePreview,null);}
});

test('dismiss is scoped, cancels pending validation and close awaits its settlement',async t=>{
 const f=fixture(t),gate=deferred();await f.list();let signal;f.helper.preview=async options=>{signal=options.signal;await gate.promise;options.assertCurrent();return f.preview();};const work=f.manager.execute({action:'pending-preview',recordId:RID}),rejected=assert.rejects(work,{code:'cancelled'});await tick();assert(f.console.busy.has('qq-components'));assert.equal((await f.manager.execute({action:'preparation-dismiss'})).cancelRequested,false);assert.equal(signal.aborted,false);assert.equal((await f.manager.execute({action:'pending-dismiss'})).cancelRequested,true);let closed=false;const closing=f.manager.close().then(()=>closed=true);await tick();assert.equal(closed,false);gate.resolve();await rejected;await closing;assert.equal(f.console.busy.size,0);
});

test('another component/QQ operation blocks validation and mutation',async t=>{
 const f=fixture(t);await f.list();f.console.busy.add('another-account');await assert.rejects(f.manager.execute({action:'pending-preview',recordId:RID}),{code:'operation_in_progress'});assert(!f.calls.includes('preview'));f.console.busy.clear();await f.inspect();f.console.busy.add('qq-setup');await assert.rejects(f.confirm(),{code:'operation_in_progress'});assert(!f.calls.includes('confirm'));
});

test('committed readback or discovery failures do not become unchanged or allow replay',async t=>{
 const f=fixture(t);await f.inspect();f.helper.confirm=async()=>({...f.receipt(),code:'pending_update_cleanup_unconfirmed'});f.helper.list=async()=>{throw problem('component_io_failed');};const {pendingUpdateResult:r}=await f.confirm();assert.equal(r.committed,true);assert.equal(r.disabled,true);assert.equal(r.code,'pending_update_cleanup_unconfirmed');assert.equal(r.refreshIssue,'component_io_failed');await assert.rejects(f.confirm(),{code:'pending_update_preview_required'});
});

test('thrown committed and unknown outcomes retain their truthful boundary',async t=>{
 for(const committed of [true,null]){const f=fixture(t);await f.inspect();f.helper.confirm=async()=>{throw problem('pending_update_readback_failed',{committed,changeAttempted:true});};const {pendingUpdateResult:r}=await f.confirm();assert.equal(r.committed,committed);assert.equal(r.disabled,null);assert.equal(r.retained,null);assert.equal(r.code,'pending_update_readback_failed');assert.doesNotMatch(JSON.stringify(r),/PRIVATE/);await assert.rejects(f.confirm(),{code:'pending_update_preview_required'});}
});

test('malformed or inconsistent success receipts remain unknown',async t=>{
 for(const patch of [{recordId:'c'.repeat(64)},{operationId:'invalid'},{automaticStart:true},{disabled:true,retained:false},{committed:false,disabled:true},{committed:true,disabled:false}]){const f=fixture(t);await f.inspect();f.helper.confirm=async()=>({...f.receipt(),...patch});const {pendingUpdateResult:r}=await f.confirm();assert.equal(r.committed,null);assert.equal(r.disabled,null);assert.equal(r.retained,null);assert.equal(r.code,'invalid_response');}
});

test('explicit reconcile records an untouched source without claiming it was disabled or replaying it',async t=>{
 const f=fixture(t);f.row.state='review-required';const {pendingUpdatePreview:p}=await f.inspect();assert.equal(p.operation,'reconcile-pending-update');assert.equal(p.disablesPlan,false);let confirmed=0;f.helper.confirm=async()=>{confirmed++;return {...f.receipt(),disabled:false,retained:false};};const {pendingUpdateResult:r}=await f.confirm();assert.equal(r.committed,true);assert.equal(r.disabled,false);assert.equal(r.retained,false);assert.equal(confirmed,1);
});

test('explicit status refresh invalidates a preview while passive polling preserves it',async t=>{
 const f=fixture(t);await f.inspect();f.manager.snapshot();assert(f.manager.pendingUpdatePreview);await f.manager.execute({action:'status'});assert.equal(f.manager.pendingUpdatePreview,null);await assert.rejects(f.confirm(),{code:'pending_update_preview_required'});
});
