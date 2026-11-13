'use strict';
// Production selector/helper/core, isolated tiny original tree; no QQ execution.
const fs=require('node:fs'),path=require('node:path'),{randomUUID,createHash}=require('node:crypto');
const {directories}=require('../../deploy/qq-supervisor/test/helpers.cjs');
const {managedRuntime}=require('../../deploy/qq-supervisor/test/runtime-fixture.cjs');
const {QQComponentSelection}=require('../../src/bot/qq-component-selection.cjs');
const {QQPendingUpdateRecovery}=require('../../src/bot/qq-pending-update-recovery.cjs');
const {QQPendingUpdateLockRecovery}=require('../../src/bot/qq-pending-update-lock-recovery.cjs');
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(t,{io=fs,host,existingConfig,existing=false,coreOptions={}}={}){
 const f=existingConfig?{config:existingConfig,cleanup:[]}:directories(t),r=managedRuntime(f.config,{existing}),descriptor=path.join(r.descriptor.installationRoot,'installation.json');
 if(!existing&&!fs.existsSync(descriptor))fs.writeFileSync(descriptor,JSON.stringify(r.descriptor));r.descriptor.descriptorSha256=hash(fs.readFileSync(descriptor));
 const processHost=host||r.host,selection=new QQComponentSelection({componentsRoot:r.descriptor.installationRoot,lockRoot:f.config.installation.lockRoot,preparedRoot:path.dirname(path.dirname(r.paths.codeRoot)),prepared:r.options.prepared,processHost,qqExe:r.paths.qqExe,managedInstallation:()=>structuredClone(r.descriptor)});
 const marker=path.join(r.paths.configDir,'napcat-update.json');if(!existing)fs.writeFileSync(marker,'SYNTHETIC_PLAN\0opaque');const state={mono:0},pending=new QQPendingUpdateRecovery({selection,io}),core=new QQPendingUpdateLockRecovery({selection,processHost,io,monotonic:()=>state.mono,...coreOptions});
 t.after(async()=>{await core.close();pending.close();await r.adapter.close();});
 const dead={pid:919999,createdAt:'2026-11-07T00:00:00.0000000Z',executable:process.execPath};
 const lock=(kind='installation',owner=dead)=>{const file=kind==='installation'?selection.lockFile:selection.lockFile+'.recover';fs.writeFileSync(file,JSON.stringify({schema:kind==='installation'?'qq_component_lock_v2':'qq_component_recovery_guard_v1',installationId:selection.installationId,owner,token:randomUUID(),at:new Date().toISOString()}));return file;};
 const preview=async(kind='installation')=>{const i=await core.inspect(),v=i.records.find(r=>r.kind===kind);return core.preview({recordId:v.recordId});};
 return {...f,r,selection,pending,core,marker,state,descriptor,host:processHost,dead,lock,preview,confirm:p=>core.confirm({ticketId:p.ticketId,expectedDigest:p.expectedDigest})};
}
module.exports={fixture,hash};
