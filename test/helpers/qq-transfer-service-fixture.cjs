'use strict';
// Real independent helper service + desktop modules; owned TLS, private temporary files only.
const fs=require('node:fs'),path=require('node:path'),tls=require('node:tls'),{randomUUID,randomBytes}=require('node:crypto');
const {fixture:serverFixture,TLS}=require('../../deploy/transfer-helper/test/fixture.cjs');
const {vault}=require('./qq-transfer-fixture.cjs');
const {QQTransferJobs}=require('../../src/bot/qq-transfer-jobs.cjs');
const {QQTransferLinks}=require('../../src/bot/qq-transfer-links.cjs');
const {QQTransferSession}=require('../../src/bot/qq-transfer-session.cjs');
const {QQTransferClient}=require('../../src/bot/qq-transfer-client.cjs');
const {validateRemoteOrigin,validateRemoteTrust}=require('../../src/bot/qq-remote-transport.cjs');
async function fixture(t,options={}){
 let serverCleanup;const f=await serverFixture({after:fn=>{serverCleanup=fn;}},options),local=path.join(f.root,'desktop');fs.mkdirSync(local);
 const state={context:1,requestCount:0,lookups:0,connects:0,uploadPath:path.join(local,'source.bin'),downloadPath:path.join(local,'saved.bin')};
 f.service.server.on('request',()=>state.requestCount++);
 const clientOptions={origin:`https://remote.arcade.invalid:${f.port}`,instanceId:f.config.instanceId,token:f.config.token,trust:{caPem:TLS.caPem},lookup:async()=>{state.lookups++;return [{address:'198.51.100.20',family:4}];},connect:config=>{state.connects++;const s=tls.connect({...config,host:'127.0.0.1',family:4});Object.defineProperty(s,'remoteAddress',{get:()=>config.host});return s;}};
 const vaultKey=randomBytes(32),crypto=vault(vaultKey),links=new QQTransferLinks({root:path.join(local,'links'),vault:crypto,validateOrigin:validateRemoteOrigin,validateTrust:validateRemoteTrust});
 const remoteId=randomUUID(),panelId=randomUUID(),link=links.create({remoteId,remoteRevision:randomUUID(),label:'Synthetic helper',origin:clientOptions.origin,instanceId:clientOptions.instanceId,trust:clientOptions.trust,token:clientOptions.token});
 let jobs,session;Object.assign(f,{local,state,clientOptions,links,link,crypto,vaultKey,base:{remoteId,panelId,helperId:link.helperId}});
 Object.defineProperties(f,{jobs:{get:()=>jobs},session:{get:()=>session}});
 f.newSession=()=>{jobs=new QQTransferJobs({root:path.join(local,'jobs'),vault:crypto});session=new QQTransferSession({links,jobs,captureContext:()=>({remoteId,panelId,revision:state.context}),verifyScope:async(c,o)=>{o.assertCurrent();return {verified:true};},pickUploadFiles:async()=>[state.uploadPath],pickDownloadFile:async()=>state.downloadPath,clientFactory:entry=>new QQTransferClient({...entry,lookup:clientOptions.lookup,connect:clientOptions.connect})});};
 f.open=async()=>{const r=await session.open({...f.base,revision:link.revision});f.viewId=r.viewId;return session.list({...f.base,viewId:r.viewId,rootId:'files',directoryId:null,operationId:randomUUID()});};
 f.reopen=async()=>{await session.close();jobs.close();f.newSession();return f.open();};
 f.preview=async(operation,entryIds=[])=>{const listing=await f.open();let selectionId=null;if(operation==='upload')selectionId=(await session.pickUpload({...f.base,viewId:f.viewId,operationId:randomUUID()})).selection.selectionId;return session.preview({...f.base,viewId:f.viewId,rootId:'files',directoryId:listing.directory.directoryId,operation,entryIds,selectionId,operationId:randomUUID()});};
 f.confirm=p=>session.confirm({...f.base,viewId:f.viewId,ticketId:p.preview.ticketId,expectedDigest:p.preview.expectedDigest,operationId:randomUUID()});
 t.after(async()=>{await session?.close();jobs?.close();await serverCleanup();});f.newSession();return f;
}
module.exports={fixture};
