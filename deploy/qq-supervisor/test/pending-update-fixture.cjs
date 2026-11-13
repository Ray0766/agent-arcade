'use strict';
// Actual service/selector/helper/NTFS. Small original component input is synthetic.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {directories,material,requestFor}=require('./helpers.cjs'),{managedRuntime}=require('./runtime-fixture.cjs');
const {createService}=require('../../../src/qq-supervisor/server.cjs'),{SupervisorPendingUpdate}=require('../../../src/qq-supervisor/pending-update.cjs'),{QQPendingUpdateRecovery}=require('../../../src/bot/qq-pending-update-recovery.cjs');
const BASE='/v1/pending-update-recovery';
async function fixture(t,{io=fs,options={},marker=true}={}){const f=directories(t);f.config.recovery={pendingUpdateRecords:true};const state={mono:0},r=managedRuntime(f.config),markerPath=path.join(r.paths.configDir,'napcat-update.json'),bytes=Buffer.from('SYNTHETIC_OPAQUE_PLAN\0not JSON; never follow source/target');if(marker)fs.writeFileSync(markerPath,bytes);
 const pendingUpdateFactory=(config,args)=>new SupervisorPendingUpdate(config,{...args,helperFactory:args=>new QQPendingUpdateRecovery({...args,io})});
 let service;const open=async()=>{service=await createService({config:f.config,tls:material,runtimeFactory:()=>r.adapter,pendingUpdateFactory,monotonic:()=>state.mono,...options});await service.listen();return service;};await open();f.cleanup.push(()=>service.close());
 const request=(...args)=>requestFor(service.server.address().port,f.config)(...args);
 const inspect=async()=>{const x=await request('GET',BASE+'/records');if(!x.ok)throw Object.assign(Error(x.code),{code:x.code});return x.inspection;};
 const preview=async(action)=>{const i=await inspect(),row=i.records[0];return request('POST',BASE+'/previews',{inspectionId:i.inspectionId,recordId:row.recordId,action:action||(row.state==='review-required'?'reconcile':'disable')});};
 const input=p=>({requestId:randomUUID(),action:p.action,recordId:p.recordId,ticketId:p.ticketId,expectedDigest:p.expectedDigest});
 return {...f,r,state,io,markerPath,bytes,pendingUpdateFactory,request,inspect,preview,input,get service(){return service;},confirm:p=>request('POST',BASE+'/confirmations',input(p)),BASE};
}
module.exports={fixture,BASE};
