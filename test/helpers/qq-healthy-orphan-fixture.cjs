'use strict';
// Private temporary Windows files + explicit synthetic process inventory.
// No compiler, native process host, QQ, user configuration or model is invoked.
const fs=require('node:fs'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {fixture:core}=require('./qq-shell-owner-fixture.cjs');
const {SupervisorOrphanCleanup}=require('../../src/qq-supervisor/orphan-cleanup.cjs');
const {createService}=require('../../src/qq-supervisor/server.cjs');
const {QQSupervisorClient}=require('../../src/bot/qq-supervisor-client.cjs');
const {QQSupervisorLinks}=require('../../src/bot/qq-supervisor-links.cjs');
const {QQSupervisorPanel}=require('../../src/bot/qq-supervisor-panel.cjs');
const H=require('../../deploy/qq-supervisor/test/helpers.cjs'),A=require('./qq-supervisor-app-fixture.cjs');
const ACCOUNT='12345001',config={expectedQQ:ACCOUNT,recovery:{orphanCleanup:true}};
async function orphan(t,{pending=false}={}){
 const f=core(t);await f.runtime.start(f.account);const lease=f.deadManager();f.state.rows=f.state.rows.filter(v=>v.pid!==lease.runtime.pid);if(pending)f.marker();
 const manager=f.fresh(),clock={mono:0},adapter=new SupervisorOrphanCleanup(config,{runtime:{manager},monotonic:()=>clock.mono});t.after(()=>adapter.close());
 return {...f,lease,manager,adapter,clock};
}
async function preview(f){const i=await f.adapter.inspect();if(i.state!=='available')throw Error('Expected a synthetic orphan candidate');return f.adapter.preview({inspectionId:i.inspectionId});}
const input=p=>({requestId:randomUUID(),ticketId:p.ticketId,expectedDigest:p.expectedDigest,action:p.action});
async function confirm(f,p){const request=input(p);f.adapter.take(request);return f.adapter.confirm(request);}
async function wire(t,f,{forceV1=false,beforeListen}={}){
 const d=H.directories(t),c={...d.config,recovery:{orphanCleanup:true}},state={forceV1,requests:[]};
 if(beforeListen)await beforeListen(d,c);
 const runtime={...H.runtime(),manager:f.manager},service=await createService({config:c,tls:H.material,runtimeFactory:()=>runtime});
 service.server.prependListener('request',(req,res)=>{state.requests.push({method:req.method,path:req.url});if(!state.forceV1||!req.url.startsWith('/v1/orphan-cleanup/'))return;const end=res.end;res.end=function(bytes,...args){if(bytes){const original=Buffer.from(bytes),body=JSON.parse(String(bytes));if(body.orphanProtocol)body.orphanProtocol='agent-arcade-qq-supervisor-orphan-cleanup/1';bytes=Buffer.from(JSON.stringify(body));if(bytes.length!==original.length)throw Error('Synthetic version envelope must preserve framing');}return end.call(this,bytes,...args);};});
 await service.listen();d.cleanup.push(()=>service.close());
 const clientOptions={origin:'https://remote.arcade.invalid:'+service.server.address().port,trust:{caPem:H.material.caPem},instanceId:c.instanceId,expectedQQ:ACCOUNT,token:H.TOKEN,lookup:async()=>[{address:A.REMOTE,family:4}],connect:A.mappedSocket};
 const client=new QQSupervisorClient(clientOptions);d.cleanup.push(()=>client.close());
 return {...d,config:c,service,runtime,client,state,clientOptions,request:H.requestFor(service.server.address().port,c)};
}
async function desktop(t,f,options={}){
 const w=await wire(t,f,options),root=path.join(w.dir,'desktop');fs.mkdirSync(root);
 const links=new QQSupervisorLinks({root,vault:A.vault}),parent={remoteId:randomUUID(),panelId:randomUUID(),remoteRevision:randomUUID(),expectedQQ:ACCOUNT,parentGeneration:1,contextKey:'synthetic-healthy-orphan'},base={remoteId:parent.remoteId,panelId:parent.panelId};
 const entry=links.create({remoteId:parent.remoteId,remoteRevision:parent.remoteRevision,expectedQQ:ACCOUNT,label:'Synthetic healthy orphan',origin:w.clientOptions.origin,instanceId:w.config.instanceId,token:H.TOKEN,trust:w.clientOptions.trust});
 const factory=options.clientFactory||((e)=>new QQSupervisorClient({...e,lookup:w.clientOptions.lookup,connect:w.clientOptions.connect})),makePanel=(store=links)=>new QQSupervisorPanel({links:store,captureParent:()=>({...parent}),clientFactory:factory});
 const panel=makePanel();w.cleanup.push(()=>panel.close());await panel.list(base);const ref={...base,supervisorId:entry.supervisorId};
 return {...w,root,links,parent,base,entry,panel,ref,makePanel,vault:A.vault,async preview(){const r=await panel.orphanRead(ref);return (await panel.orphanPreview({...ref,inspectionId:r.inspection.inspectionId})).preview;}};
}
module.exports={orphan,preview,input,confirm,wire,desktop,ACCOUNT};
