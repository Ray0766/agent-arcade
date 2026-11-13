'use strict';
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {load}=require('./qq-passkey-production-modules.cjs');
const {fixture:shellFixture}=load('test/helpers/qq-shell-owner-fixture.cjs');
const A=load('test/helpers/qq-supervisor-app-fixture.cjs');
const {SupervisorRuntime}=load('src/qq-supervisor/runtime.cjs');
const {SupervisorNativePasskeys}=load('src/qq-supervisor/native-passkeys.cjs');
const {OfflineNativePasskeys}=load('src/bot/qq-native-passkey-maintenance.cjs');
const {createService}=load('src/qq-supervisor/server.cjs');
const {QQSupervisorLinks}=load('src/bot/qq-supervisor-links.cjs'),{QQSupervisorPanel}=load('src/bot/qq-supervisor-panel.cjs'),{QQSupervisorClient}=load('src/bot/qq-supervisor-client.cjs');
const WEBUI='https://webui.arcade.invalid';
const rows=()=>[1,2].map(n=>({id:Buffer.from(`synthetic_credential_${n}`).toString('base64url'),publicKey:Buffer.from(`synthetic_key_${n}`).toString('base64url'),counter:n,transports:[n===1?'internal':'usb']}));
async function fixture(t,{enabled=true,declared=false,hook=()=>{}}={}){
 const after=[],f=shellFixture({after:fn=>after.push(fn)}),stateDir=path.join(f.base,'supervisor');fs.mkdirSync(stateDir);const appRoot=path.join(f.base,'app');fs.mkdirSync(appRoot);let service,panel;const clients=[];
 t.after(async()=>{try{await panel?.close();for(const c of clients)await c.close();await service?.close();}finally{for(const fn of after.reverse())await fn();}});
 const file=path.join(f.configDir,'passkey.json');fs.writeFileSync(file,JSON.stringify({'napcat-user':rows()}));
 const config={instanceId:randomUUID(),expectedQQ:f.account,stateDir,token:A.TOKEN,installation:{componentStoreRoot:f.root,lockRoot:f.lockRoot,setupId:f.setupId},...(enabled===null?{}:{passkeys:{enabled,origin:WEBUI,recoveryRouteDeclared:declared}})};
 const runtime=new SupervisorRuntime(config,{managerFactory:()=>f.runtime});let adapter;
 service=await createService({config,tls:A.material,runtimeFactory:()=>runtime,nativePasskeysFactory:(c,o)=>(adapter=new SupervisorNativePasskeys(c,{...o,helperFactory:opts=>new OfflineNativePasskeys({...opts,hook})}))});await service.listen();const origin=`https://remote.arcade.invalid:${service.server.address().port}`;
 const options={origin,trust:{caPem:A.material.caPem},instanceId:config.instanceId,expectedQQ:f.account,token:A.TOKEN,lookup:async()=>[{address:A.REMOTE,family:4}],connect:A.mappedSocket};
 const client=new QQSupervisorClient(options);clients.push(client);const links=new QQSupervisorLinks({root:appRoot,vault:A.vault}),parent={remoteId:randomUUID(),panelId:randomUUID(),remoteRevision:randomUUID(),expectedQQ:f.account,origin:WEBUI,parentGeneration:1,contextKey:{synthetic:true}},base={remoteId:parent.remoteId,panelId:parent.panelId};
 const entry=links.create({remoteId:parent.remoteId,remoteRevision:parent.remoteRevision,expectedQQ:f.account,label:'Synthetic Passkey service',origin,instanceId:config.instanceId,trust:options.trust,token:A.TOKEN});
 const makePanel=(nextLinks=links,clientFactory)=>{const p=new QQSupervisorPanel({links:nextLinks,captureParent:()=>structuredClone(parent),clientFactory:clientFactory||((e)=>{const c=new QQSupervisorClient({...e,lookup:options.lookup,connect:options.connect});clients.push(c);return c;})});return p;};
 panel=makePanel();await panel.list(base);const ref={...base,supervisorId:entry.supervisorId};
 return {...f,defer:fn=>after.push(fn),file,config,service,runtime,adapter,client,options,links,appRoot,parent,base,entry,ref,panel,makePanel,clients,vault:A.vault,WEBUI,
 async preview(){const r=await panel.nativePasskeyRead(ref),i=r.inspection.inventory;return panel.nativePasskeyPreview({...ref,action:'revoke',recordId:i.credentials[0].credentialHandle,observationId:i.observationId});},
 async rawPreview(){const l=await client.nativePasskeyList(),i=l.inspection.inventory,p=await client.nativePasskeyPreview({action:'revoke',recordId:i.credentials[0].credentialHandle,observationId:i.observationId});return p.preview;},
 async rawConfirm(p){return client.nativePasskeyConfirm({requestId:randomUUID(),action:p.action,recordId:p.recordId,ticketId:p.ticketId,expectedDigest:p.expectedDigest});}};
}
module.exports={fixture,rows,WEBUI,load};
