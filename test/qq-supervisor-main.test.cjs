'use strict';
const test=require('./helpers/platform-skip.cjs').ownedIpcTest,assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {fixture,add,base,hold,until,PANEL}=require('./helpers/qq-supervisor-main-fixture.cjs');
const TOKEN='synthetic-supervisor-only-access-token-00000000000000001';
const registration=()=>({label:'Synthetic process supervisor',origin:'https://supervisor.arcade.invalid',instanceId:randomUUID(),token:TOKEN,caSelectionId:null,spkiSha256:null,replace:null});
async function setup(t){const f=fixture(t),row=await add(f),b=base(row);assert.equal((await f.invoke('qqSupervisorList',b)).ok,true);return {f,row,b};}

test('actual main saves a separate encrypted control link while QQ WebUI is disconnected',async t=>{
  const {f,row,b}=await setup(t),out=await f.invoke('qqSupervisorCreate',{...b,registration:registration()});
  assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.link.expectedQQ,row.expectedQQ);assert.equal(out.link.remoteRevision,row.revision);assert.equal(out.link.credentialState,'saved');
  assert.equal(f.state.network,0);assert.equal(f.api.remote().session.session,null);
  assert.doesNotMatch(JSON.stringify(out),/synthetic-supervisor-only|synthetic-webui-never|caPem/);
  assert.doesNotMatch(fs.readFileSync(path.join(f.root,'qq-supervisor-links.json'),'utf8'),/synthetic-supervisor-only|supervisor\.arcade/);
  assert.equal(fs.existsSync(path.join(f.root,'bot-vault.json')),false);
  assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/supervisor\.arcade|synthetic-supervisor-only/);
});

test('supervisor main IPC rejects foreign frames and arbitrary command fields',async t=>{
  const {f,b}=await setup(t);
  await assert.rejects(f.invoke('qqSupervisorList',b,{sender:{},senderFrame:{}}),/Untrusted sender/);
  for(const value of [{...b,command:'run.exe'},{...b,path:'C:\\arbitrary'},{...b,expectedQQ:'1000002'},null]){
    const out=await f.invoke('qqSupervisorList',value);assert.equal(out.ok,false);assert.equal(out.error.code,'invalid_request');
  }
  assert.equal(f.state.network,0);
  const preload=fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8');
  const methods=[...f.handlers.keys()].filter(key=>key.startsWith('arcade:qqSupervisor'));
  const expected=['List','Create','Forget','PickCA','Read','Preview','Confirm','RecoveryRead','RecoveryPreview','RecoveryConfirm','LockRead','LockPreview','LockConfirm','ComponentRepairRead','ComponentRepairPreview','ComponentRepairConfirm','ComponentRepairDiscard','ProfileBackupRead','ProfileBackupPreview','ProfileBackupConfirm','NativePasskeyRead','NativePasskeyPreview','NativePasskeyConfirm','OrphanRead','OrphanPreview','OrphanConfirm','OrphanDiscard','Query','EndRecovery','Dismiss','Close'].map(name=>'arcade:qqSupervisor'+name);
  assert.deepEqual(methods.sort(),expected.sort());for(const method of methods)assert(preload.includes(`'${method}'`),method);
});

test('actual parent replacement closes the child before its saved binding changes',async t=>{
  const {f,row,b}=await setup(t),out=await f.invoke('qqSupervisorCreate',{...b,registration:registration()});assert.equal(out.ok,true);
  const changed=await f.invoke('qqRemoteUpdate',{...b,revision:row.revision,patch:{label:'Renamed synthetic remote'}});assert.equal(changed.ok,true,JSON.stringify(changed));
  assert.equal(f.api.supervisor().panel,null);
  assert.equal((await f.invoke('qqSupervisorRead',{...b,supervisorId:out.link.supervisorId})).ok,false);assert.equal(f.state.network,0);
  const listed=await f.invoke('qqSupervisorList',b);assert.equal(listed.ok,true);assert.equal(listed.items.length,1);assert.equal(listed.items[0].remoteRevision,row.revision);
});

test('hidden main retires a native CA selection without reading a late path',async t=>{
  const {f,b}=await setup(t);f.state.picker=hold();const pending=f.invoke('qqSupervisorPickCA',b);await until(()=>f.state.picks===1);
  f.state.visible=false;f.events.hide();f.state.picker.resolve({canceled:false,filePaths:[path.join(f.root,'must-never-read.pem')]});
  assert.equal((await pending).ok,false);await f.api.closeRemoteManagement();assert.equal(f.api.supervisor().panel,null);assert.equal(f.state.network,0);
});

test('changing selected companion invalidates the supervisor owner, without inspecting its AI key',async t=>{
  const {f,b}=await setup(t);f.accounts.selectedId='second';f.api.observe();
  assert.equal((await f.invoke('qqSupervisorCreate',{...b,registration:registration()})).ok,false);assert.equal(f.state.network,0);
});

test('a delayed stale-parent close cannot close a newly opened supervisor page',async t=>{
  const {f,row,b}=await setup(t),next=randomUUID();assert.equal((await f.invoke('qqSupervisorClose',b)).ok,true);
  assert.equal((await f.invoke('qqRemoteList',{panelId:next})).ok,true);
  assert.equal((await f.invoke('qqSupervisorList',{panelId:next,remoteId:row.remoteId})).ok,true);
  assert.equal((await f.invoke('qqSupervisorClose',{...b,panelId:PANEL})).ok,true);
  assert.equal(f.api.supervisor().panel.panelId,next);assert.equal(f.state.network,0);
});

test('parent mutation waits for an already retired supervisor operation to settle',async t=>{
  const {f,row,b}=await setup(t);f.state.picker=hold();const picking=f.invoke('qqSupervisorPickCA',b);await until(()=>f.state.picks===1);
  const retiring=f.api.supervisor().closeCurrent();assert.equal(f.api.supervisor().panel,null);
  let updated=false;const update=f.invoke('qqRemoteUpdate',{...b,revision:row.revision,patch:{label:'After cleanup'}}).then(result=>{updated=true;return result;});
  await new Promise(resolve=>setTimeout(resolve,20));assert.equal(updated,false);
  f.state.picker.resolve({canceled:true,filePaths:[]});assert.equal((await picking).ok,false);await retiring;
  assert.equal((await update).ok,true);assert.equal(f.state.network,0);
});

test('actual main uses the production HTTPS client and service for explicit process operations',async t=>{
  const appFixture=require('./helpers/qq-supervisor-app-fixture.cjs');
  const host=await appFixture.fixture(t,{expectedQQ:'1000001'});
  const f=fixture(t,{clientFactory:host.clientFactory}),row=await add(f),b=base(row);
  assert.equal((await f.invoke('qqSupervisorList',b)).ok,true);
  const caFile=path.join(f.root,'synthetic-supervisor-ca.pem');fs.writeFileSync(caFile,appFixture.material.caPem);
  f.state.picker=hold();f.state.picker.resolve({canceled:false,filePaths:[caFile]});
  const ca=await f.invoke('qqSupervisorPickCA',b);assert.equal(ca.ok,true,JSON.stringify(ca));
  const saved=await f.invoke('qqSupervisorCreate',{...b,registration:{...registration(),origin:host.clientOptions.origin,instanceId:host.config.instanceId,token:appFixture.TOKEN,caSelectionId:ca.ca.selectionId}});
  assert.equal(saved.ok,true,JSON.stringify(saved));assert.equal(host.network.length,0);
  const ref={...b,supervisorId:saved.link.supervisorId},read=await f.invoke('qqSupervisorRead',ref);
  assert.equal(read.ok,true,JSON.stringify(read));assert.equal(read.status.management,'stopped');assert.equal(read.status.qqOnline,'unknown');
  for(const action of ['start','stop']){
    const preview=await f.invoke('qqSupervisorPreview',{...ref,action});assert.equal(preview.ok,true,JSON.stringify(preview));
    const request={...b,ticketId:preview.preview.ticketId},done=await f.invoke('qqSupervisorConfirm',request);
    assert.equal(done.ok,true,JSON.stringify(done));assert.equal(done.change.outcome,'accepted');assert.equal(done.change.pending,false);assert.equal(done.change.observation.qqOnline,'unknown');
    assert.equal((await f.invoke('qqSupervisorConfirm',request)).ok,false);
  }
  assert.deepEqual(host.runtime.state.calls,['start','stop']);assert.equal(f.api.remote().session.session,null);
  assert.equal(host.network.filter(r=>r.method==='POST').length,2);
});
