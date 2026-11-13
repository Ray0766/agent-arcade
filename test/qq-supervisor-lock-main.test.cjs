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
  ['qqSupervisorLockRead',ref],
  ['qqSupervisorLockPreview',{...ref,inspectionId:randomUUID(),recordId:'a'.repeat(64)}],
  ['qqSupervisorLockConfirm',{...b,ticketId:randomUUID()}]
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

test('minimizing the actual main retires component-lock ownership and restore requires reopening',async t=>{
 const {f,b,ref}=await setup(t);
 f.state.minimized=true;f.events.minimize();await f.api.closeRemoteManagement();
 assert.equal((await f.invoke('qqSupervisorLockRead',ref)).ok,false);
 f.state.minimized=false;
 assert.equal((await f.invoke('qqSupervisorLockRead',ref)).ok,false);
 assert.equal(f.state.network,0);
 // A restored window is usable: explicit reopening restores local ownership.
 assert.equal((await f.invoke('qqRemoteList',{panelId:b.panelId})).ok,true);
 assert.equal((await f.invoke('qqSupervisorList',b)).ok,true);
 assert.equal(f.api.supervisor().panel.panelId,b.panelId);
 assert.equal(f.state.network,0);
});

test('actual selected-companion change blocks all component-lock operations without inspecting AI credentials',async t=>{
 const {f,b,ref}=await setup(t);
 f.accounts.selectedId='second';f.api.observe();
 for(const [method,request]of [
  ['qqSupervisorLockRead',ref],
  ['qqSupervisorLockPreview',{...ref,inspectionId:randomUUID(),recordId:'b'.repeat(64)}],
  ['qqSupervisorLockConfirm',{...b,ticketId:randomUUID()}]
 ])assert.equal((await f.invoke(method,request)).ok,false);
 assert.equal(f.state.network,0);
});

test('actual parent replacement invalidates recovery requests but retains saved control registration',async t=>{
 const {f,row,b,ref}=await setup(t);
 const changed=await f.invoke('qqRemoteUpdate',{...b,revision:row.revision,patch:{label:'Synthetic changed parent'}});
 assert.equal(changed.ok,true,JSON.stringify(changed));
 assert.equal((await f.invoke('qqSupervisorLockRead',ref)).ok,false);
 const listed=await f.invoke('qqSupervisorList',b);
 assert.equal(listed.ok,true);assert.equal(listed.items.length,1);
 assert.equal(listed.items[0].remoteRevision,row.revision);
 assert.equal((await f.invoke('qqSupervisorLockRead',ref)).ok,false);
 assert.equal(f.state.network,0);
});

async function networkSetup(t){
 const app=require('./helpers/qq-supervisor-app-fixture.cjs'),host=await app.fixture(t,{expectedQQ:'1000001',locks:true,recovery:true});
 const f=fixture(t,{clientFactory:host.clientFactory}),row=await add(f),b=base(row);
 assert.equal((await f.invoke('qqSupervisorList',b)).ok,true);
 const caFile=path.join(f.root,'synthetic-lock-ca.pem');fs.writeFileSync(caFile,app.material.caPem);
 f.state.picker=hold();f.state.picker.resolve({canceled:false,filePaths:[caFile]});
 const ca=await f.invoke('qqSupervisorPickCA',b);assert.equal(ca.ok,true,JSON.stringify(ca));
 const saved=await f.invoke('qqSupervisorCreate',{...b,registration:{label:'Synthetic lock TLS',origin:host.clientOptions.origin,instanceId:host.config.instanceId,token:app.TOKEN,caSelectionId:ca.ca.selectionId,spkiSha256:null,replace:null}});
 assert.equal(saved.ok,true,JSON.stringify(saved));assert.equal(host.network.length,0);
 return {f,host,b,ref:{...b,supervisorId:saved.link.supervisorId}};
}
async function review({f,ref}){
 const read=await f.invoke('qqSupervisorLockRead',ref);assert.equal(read.ok,true,JSON.stringify(read));const row=read.inspection.records[0];
 const out=await f.invoke('qqSupervisorLockPreview',{...ref,inspectionId:read.inspection.inspectionId,recordId:row.recordId});assert.equal(out.ok,true,JSON.stringify(out));return out.preview;
}
test('actual main reaches typed lock recovery when Status is blocked and sends one exact confirmation',async t=>{
 const s=await networkSetup(t),{f,host,b,ref}=s;host.runtime.observe=async()=>{throw Object.assign(Error('Synthetic marker'),{code:'pending_upstream_update'});};
 assert.equal((await f.invoke('qqSupervisorRead',ref)).ok,false);const preview=await review(s);assert.equal(preview.kind,'component-lock');assert.equal(Object.hasOwn(preview,'expectedDigest'),false);
 assert.equal(host.locks.state.calls.length,0);const request={...b,ticketId:preview.ticketId},result=await f.invoke('qqSupervisorLockConfirm',request);
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.lockChange.operation.phase,'completed');assert.equal(result.lockChange.operation.result.lockCleared,true);assert.equal(result.lockChange.operation.result.pendingUpdateRecoveryRequired,true);
 assert.equal((await f.invoke('qqSupervisorLockConfirm',request)).ok,false);assert.equal(host.locks.state.calls.length,1);assert.deepEqual(host.runtime.state.calls,[]);assert.deepEqual(host.recovery.state.calls,[]);
 assert.equal(host.network.filter(r=>r.path==='/v1/status').length,1);assert.equal(host.network.filter(r=>r.path==='/v1/pending-update-locks/confirmations').length,1);assert.equal(f.api.remote().session.session,null);
});
test('a completed no-clear receipt stays false through main and never becomes ready-to-start',async t=>{
 const s=await networkSetup(t),{f,host,b}=s;host.locks.state.resultMode='unchanged';const p=await review(s),r=await f.invoke('qqSupervisorLockConfirm',{...b,ticketId:p.ticketId});
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.lockChange.outcome,'accepted');assert.equal(r.lockChange.operation.phase,'completed');assert.equal(r.lockChange.operation.result.lockCleared,false);assert.equal(r.lockChange.operation.result.committed,false);assert.equal(r.lockChange.operation.result.pendingUpdateRecoveryRequired,true);assert.equal(Object.hasOwn(r.lockChange,'readyToStart'),false);
});
test('unknown lock result blocks all three families and local End keeps the full original receipt',async t=>{
 const s=await networkSetup(t),{f,host,b,ref}=s;host.locks.state.resultMode='unknown';const p=await review(s),r=await f.invoke('qqSupervisorLockConfirm',{...b,ticketId:p.ticketId});assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.lockChange.pending,true);
 assert.equal((await f.invoke('qqSupervisorPreview',{...ref,action:'start'})).error.code,'operation_unresolved');
 const read=await f.invoke('qqSupervisorRecoveryRead',ref);assert.equal(read.ok,true);const record=read.inspection.records[0];assert.equal((await f.invoke('qqSupervisorRecoveryPreview',{...ref,inspectionId:read.inspection.inspectionId,recordId:record.recordId,action:'disable'})).error.code,'operation_unresolved');
 host.locks.state.rows=[];const changed=await f.invoke('qqSupervisorLockRead',ref);assert.equal(changed.link.pending.kind,'component-lock');const q=await f.invoke('qqSupervisorQuery',ref);assert.equal(q.ok,true,JSON.stringify(q));assert.equal(q.lockQuery.operation.phase,'unknown');assert.equal(q.lockQuery.canEndRecovery,true);
 const requests=host.network.length,end=await f.invoke('qqSupervisorEndRecovery',{...ref,requestId:q.lockQuery.requestId});assert.equal(end.ok,true,JSON.stringify(end));assert.equal(host.network.length,requests);
 const saved=f.api.supervisor().links.capture(ref.supervisorId);assert.equal(saved.pending,null);assert.equal(saved.history[0].pending.kind,'component-lock');assert.deepEqual(saved.history[0].operation,q.lockQuery.operation);assert.equal(host.locks.state.calls.length,1);assert.deepEqual(host.runtime.state.calls,[]);
});
test('closing parent during accepted lock work preserves remote ownership and query after reopening',async t=>{
 const s=await networkSetup(t),{f,host,b,ref}=s,p=await review(s);host.locks.state.held=hold();const confirmation=f.invoke('qqSupervisorLockConfirm',{...b,ticketId:p.ticketId});await until(()=>host.locks.state.calls.length===1);
 const closed=await f.invoke('qqRemoteRegistryClose',{panelId:b.panelId});assert.equal(closed.ok,true,JSON.stringify(closed));await confirmation;
 host.locks.state.held.resolve();await until(()=>host.locks.state.rows.length===0);
 assert.equal((await f.invoke('qqRemoteList',{panelId:b.panelId})).ok,true);assert.equal((await f.invoke('qqSupervisorList',b)).ok,true);const query=await f.invoke('qqSupervisorQuery',ref);assert.equal(query.ok,true,JSON.stringify(query));assert.equal(query.lockQuery.operation.phase,'completed');assert.equal(query.lockQuery.pending,false);assert.equal(host.locks.state.calls.length,1);
});

