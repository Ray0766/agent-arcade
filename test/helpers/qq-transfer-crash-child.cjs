'use strict';
// Deliberate child exit fixture: only explicit newly-created test roots and public test TLS.
const fs=require('node:fs'),path=require('node:path'),tls=require('node:tls'),{randomUUID}=require('node:crypto');
const {QQTransferSession}=require('../../src/bot/qq-transfer-session.cjs');
const {QQTransferClient}=require('../../src/bot/qq-transfer-client.cjs');
const {QQTransferJobs}=require('../../src/bot/qq-transfer-jobs.cjs');
const {QQTransferLinks}=require('../../src/bot/qq-transfer-links.cjs');
const {validateRemoteOrigin,validateRemoteTrust}=require('../../src/bot/qq-remote-transport.cjs');
const {vault}=require('./qq-transfer-fixture.cjs');
(async()=>{const c=JSON.parse(fs.readFileSync(process.argv[2],'utf8')),crypto=vault(Buffer.from(c.syntheticVaultKey,'hex'));
 const links=new QQTransferLinks({root:path.join(c.local,'links'),vault:crypto,validateOrigin:validateRemoteOrigin,validateTrust:validateRemoteTrust}),jobs=new QQTransferJobs({root:path.join(c.local,'jobs'),vault:crypto});
 const session=new QQTransferSession({links,jobs,captureContext:()=>({remoteId:c.base.remoteId,panelId:c.base.panelId,revision:1}),verifyScope:async()=>({verified:true}),pickUploadFiles:async()=>[c.source],pickDownloadFile:async()=>c.target,
 clientFactory:entry=>{const client=new QQTransferClient({...entry,lookup:async()=>[{address:'198.51.100.20',family:4}],connect:config=>{const socket=tls.connect({...config,host:'127.0.0.1',family:4});Object.defineProperty(socket,'remoteAddress',{get:()=>config.host});return socket;}}),method=c.kind==='download'?'downloadRange':'uploadChunk',old=client[method].bind(client);let calls=0;client[method]=async(...args)=>{const r=await old(...args);calls++;if(c.kind==='download'&&calls===1)fs.writeSync(1,'first-range-read\n');if(calls===(c.kind==='download'?2:1))process.exit(86);return r;};return client;}});
 const opened=await session.open({...c.base,revision:c.revision});
 if(c.kind==='download')fs.writeSync(1,'session-open\n');
 const b={...c.base,viewId:opened.viewId},listing=await session.list({...b,rootId:'files',directoryId:null,operationId:randomUUID()}),selected=c.kind==='download'?null:await session.pickUpload({...b,operationId:randomUUID()}),p=await session.preview({...b,rootId:'files',directoryId:listing.directory.directoryId,operation:c.kind==='download'?'download':'upload',selectionId:selected?.selection.selectionId??null,entryIds:c.kind==='download'?[listing.entries.find(e=>e.name==='download-source.bin').entryId]:[],operationId:randomUUID()});
 if(c.kind==='download')fs.writeSync(1,'preview-ready\n');
 await session.confirm({...b,ticketId:p.preview.ticketId,expectedDigest:p.preview.expectedDigest,operationId:randomUUID()});throw Error('Expected deliberate exit did not happen');
})().catch(()=>{process.exit(87);});
