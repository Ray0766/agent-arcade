'use strict';
// Actual main / preload / panel ownership. Synthetic profile and credentials only.
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {fixture,add,base,hold,until}=require('./helpers/qq-supervisor-main-fixture.cjs');

async function setup(t,options={}){
 const f=fixture(t,options),row=await add(f),b=base(row);
 assert.equal((await f.invoke('qqSupervisorList',b)).ok,true);
 const saved=await f.invoke('qqSupervisorCreate',{...b,registration:{label:'Synthetic recovery control',origin:'https://supervisor.arcade.invalid',instanceId:randomUUID(),token:'synthetic-recovery-main-token-000000000000000000000001',caSelectionId:null,spkiSha256:null,replace:null}});
 assert.equal(saved.ok,true,JSON.stringify(saved));
 return {f,row,b,ref:{...b,supervisorId:saved.link.supervisorId}};
}

test('actual recovery IPC rejects extra filesystem authority and foreign frames before a client is constructed',async t=>{
 const {f,b,ref}=await setup(t);
 const requests=[
  ['qqSupervisorRecoveryRead',ref],
  ['qqSupervisorRecoveryPreview',{...ref,inspectionId:randomUUID(),recordId:'a'.repeat(64),action:'disable'}],
  ['qqSupervisorRecoveryConfirm',{...b,ticketId:randomUUID()}]
 ];
 for(const [method,request]of requests){
  await assert.rejects(f.invoke(method,request,{sender:{},senderFrame:{}}),/Untrusted sender/);
  for(const field of ['path','command','expectedQQ','installation']){
   const rejected=await f.invoke(method,{...request,[field]:'synthetic-forbidden-authority'});
   assert.equal(rejected.ok,false,method);assert.equal(rejected.error.code,'invalid_request',method);
  }
 }
 assert.equal(f.state.network,0);
 assert.equal(f.api.remote().session.session,null);
});

test('minimizing the actual main retires recovery ownership and restore requires reopening',async t=>{
 const {f,b,ref}=await setup(t);
 f.state.minimized=true;f.events.minimize();await f.api.closeRemoteManagement();
 assert.equal((await f.invoke('qqSupervisorRecoveryRead',ref)).ok,false);
 f.state.minimized=false;
 assert.equal((await f.invoke('qqSupervisorRecoveryRead',ref)).ok,false);
 assert.equal(f.state.network,0);
 // A restored window is usable: explicit reopening restores local ownership.
 assert.equal((await f.invoke('qqRemoteList',{panelId:b.panelId})).ok,true);
 assert.equal((await f.invoke('qqSupervisorList',b)).ok,true);
 assert.equal(f.api.supervisor().panel.panelId,b.panelId);
 assert.equal(f.state.network,0);
});

test('actual selected-companion change blocks all recovery operations without inspecting AI credentials',async t=>{
 const {f,b,ref}=await setup(t);
 f.accounts.selectedId='second';f.api.observe();
 for(const [method,request]of [
  ['qqSupervisorRecoveryRead',ref],
  ['qqSupervisorRecoveryPreview',{...ref,inspectionId:randomUUID(),recordId:'b'.repeat(64),action:'reconcile'}],
  ['qqSupervisorRecoveryConfirm',{...b,ticketId:randomUUID()}]
 ])assert.equal((await f.invoke(method,request)).ok,false);
 assert.equal(f.state.network,0);
});

test('actual parent replacement invalidates recovery requests but retains saved control registration',async t=>{
 const {f,row,b,ref}=await setup(t);
 const changed=await f.invoke('qqRemoteUpdate',{...b,revision:row.revision,patch:{label:'Synthetic changed parent'}});
 assert.equal(changed.ok,true,JSON.stringify(changed));
 assert.equal((await f.invoke('qqSupervisorRecoveryRead',ref)).ok,false);
 const listed=await f.invoke('qqSupervisorList',b);
 assert.equal(listed.ok,true);assert.equal(listed.items.length,1);
 assert.equal(listed.items[0].remoteRevision,row.revision);
 assert.equal((await f.invoke('qqSupervisorRecoveryRead',ref)).ok,false);
 assert.equal(f.state.network,0);
});

async function networkSetup(t,options={}){
 const appFixture=require('./helpers/qq-supervisor-app-fixture.cjs');
 const host=await appFixture.fixture(t,{expectedQQ:'1000001',recovery:true,...options});
 const f=fixture(t,{clientFactory:host.clientFactory}),row=await add(f),b=base(row);
 assert.equal((await f.invoke('qqSupervisorList',b)).ok,true);
 const caFile=path.join(f.root,'synthetic-recovery-ca.pem');fs.writeFileSync(caFile,appFixture.material.caPem);
 f.state.picker=hold();f.state.picker.resolve({canceled:false,filePaths:[caFile]});
 const ca=await f.invoke('qqSupervisorPickCA',b);assert.equal(ca.ok,true,JSON.stringify(ca));
 const saved=await f.invoke('qqSupervisorCreate',{...b,registration:{label:'Synthetic TLS recovery',origin:host.clientOptions.origin,instanceId:host.config.instanceId,token:appFixture.TOKEN,caSelectionId:ca.ca.selectionId,spkiSha256:null,replace:null}});
 assert.equal(saved.ok,true,JSON.stringify(saved));assert.equal(host.network.length,0);
 return {f,host,row,b,ref:{...b,supervisorId:saved.link.supervisorId}};
}
async function review(s){
 const inspected=await s.f.invoke('qqSupervisorRecoveryRead',s.ref);
 assert.equal(inspected.ok,true,JSON.stringify(inspected));const row=inspected.inspection.records[0];
 const preview=await s.f.invoke('qqSupervisorRecoveryPreview',{...s.ref,inspectionId:inspected.inspection.inspectionId,recordId:row.recordId,action:row.state==='review-required'?'reconcile':'disable'});
 assert.equal(preview.ok,true,JSON.stringify(preview));return preview.preview;
}

test('actual main reaches recovery over HTTPS when ordinary process status is blocked and confirms only once',async t=>{
 const s=await networkSetup(t),{f,host,b,ref}=s;
 host.runtime.observe=async()=>{throw Object.assign(Error('Synthetic pending marker'),{code:'pending_upstream_update'});};
 assert.equal((await f.invoke('qqSupervisorRead',ref)).ok,false);
 const preview=await review(s);
 assert.equal(preview.kind,'pending-update');assert.equal(Object.hasOwn(preview,'expectedDigest'),false);
 assert.deepEqual(host.recovery.state.calls,[]);
 const input={...b,ticketId:preview.ticketId},done=await f.invoke('qqSupervisorRecoveryConfirm',input);
 assert.equal(done.ok,true,JSON.stringify(done));assert.equal(done.recoveryChange.outcome,'accepted');
 assert.equal(done.recoveryChange.operation.result.disabled,true);assert.equal(done.recoveryChange.pending,false);
 assert.equal((await f.invoke('qqSupervisorRecoveryConfirm',input)).ok,false);
 assert.deepEqual(host.recovery.state.calls,['disable']);assert.deepEqual(host.runtime.state.calls,[]);
 assert.equal(host.network.filter(v=>v.path==='/v1/status').length,1);
 assert.equal(host.network.filter(v=>v.path==='/v1/pending-update-recovery/confirmations').length,1);
 assert.equal(f.api.remote().session.session,null);
});

test('actual main retains a completed reconciliation whose original plan remains active',async t=>{
 const s=await networkSetup(t),{f,host,b}=s;
 host.recovery.state.recordState='review-required';host.recovery.state.resultMode='original';
 const preview=await review(s);assert.equal(preview.action,'reconcile');
 const done=await f.invoke('qqSupervisorRecoveryConfirm',{...b,ticketId:preview.ticketId});
 assert.equal(done.ok,true,JSON.stringify(done));const change=done.recoveryChange;
 assert.equal(change.outcome,'accepted');assert.equal(change.operation.phase,'completed');
 assert.equal(change.operation.result.committed,true);assert.equal(change.operation.result.disabled,false);assert.equal(change.operation.result.retained,false);
 assert.notEqual(change.requestId,change.operation.result.preservationId);
 assert.equal(change.observation.records[0].state,'pending-update');
 assert.deepEqual(host.runtime.state.calls,[]);
});

test('actual main keeps an unknown recovery pending across process actions and ends it only with a retained receipt',async t=>{
 const s=await networkSetup(t),{f,host,b,ref}=s;
 host.recovery.state.resultMode='unknown';const preview=await review(s);
 const done=await f.invoke('qqSupervisorRecoveryConfirm',{...b,ticketId:preview.ticketId});
 assert.equal(done.ok,true,JSON.stringify(done));assert.equal(done.recoveryChange.outcome,'unknown');assert.equal(done.recoveryChange.pending,true);
 const blocked=await f.invoke('qqSupervisorPreview',{...ref,action:'start'});
 assert.equal(blocked.ok,false);assert.equal(blocked.error.code,'operation_unresolved');
 // A later empty inspection is not historical success and must not clear it.
 host.recovery.state.recordState=null;
 const read=await f.invoke('qqSupervisorRecoveryRead',ref);assert.equal(read.ok,true);assert.equal(read.link.pending.kind,'pending-update');
 const query=await f.invoke('qqSupervisorQuery',ref);assert.equal(query.ok,true,JSON.stringify(query));
 assert.equal(query.recoveryQuery.operation.phase,'unknown');assert.equal(query.recoveryQuery.canEndRecovery,true);
 const count=host.network.length;
 const ended=await f.invoke('qqSupervisorEndRecovery',{...ref,requestId:query.recoveryQuery.requestId});
 assert.equal(ended.ok,true,JSON.stringify(ended));assert.equal(ended.historyCount,1);assert.equal(host.network.length,count);
 assert.deepEqual(host.recovery.state.calls,['disable']);assert.deepEqual(host.runtime.state.calls,[]);
 const entry=f.api.supervisor().links.capture(ref.supervisorId);
 assert.equal(entry.pending,null);assert.equal(entry.history.length,1);
 assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/synthetic_supervisor_app_token|preservationId|recordId/);
});

test('closing the actual parent stops the local wait but a received recovery settles and is queryable after reopening',async t=>{
 const s=await networkSetup(t),{f,host,b,ref}=s,preview=await review(s);
 host.recovery.state.held=hold();
 const pending=f.invoke('qqSupervisorRecoveryConfirm',{...b,ticketId:preview.ticketId});
 await until(()=>host.recovery.state.calls.length===1);
 const closed=await f.invoke('qqRemoteRegistryClose',{panelId:b.panelId});assert.equal(closed.ok,true,JSON.stringify(closed));
 await pending;assert.equal(host.recovery.state.recordState,'pending-update');
 host.recovery.state.held.resolve();await until(()=>host.recovery.state.recordState===null);
 assert.equal((await f.invoke('qqRemoteList',{panelId:b.panelId})).ok,true);
 assert.equal((await f.invoke('qqSupervisorList',b)).ok,true);
 const query=await f.invoke('qqSupervisorQuery',ref);assert.equal(query.ok,true,JSON.stringify(query));
 assert.equal(query.recoveryQuery.operation.phase,'completed');assert.equal(query.recoveryQuery.pending,false);
 assert.deepEqual(host.recovery.state.calls,['disable']);assert.deepEqual(host.runtime.state.calls,[]);
});
