'use strict';
// Synthetic QCE protocol server, real loopback HTTP and temporary encrypted-record test vault.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),http=require('node:http');
const {randomUUID,createHash}=require('node:crypto');
const {QQQCEExportSession}=require('../../src/bot/qq-qce-export-session.cjs');
const {QQQCEExportClient,MIME}=require('../../src/bot/qq-qce-export-client.cjs');
const {QCEExportJobs}=require('../../src/bot/qq-qce-export-jobs.cjs');
const {QQRemoteFileStage}=require('../../src/bot/qq-remote-file-stage.cjs');
const TOKEN='SyntheticQceExportToken'.padEnd(40,'X'),ACCOUNT='100001',FRIEND='100002',GROUP='100003';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(r=>setImmediate(r));
async function fixture(t,extra={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-qce-export-')),input={accountId:'synthetic-qce',panelId:randomUUID()};
 const binding={...input,qqAccountId:ACCOUNT,contextKey:'synthetic-export-context',credentialRevision:randomUUID(),workScope:'a'.repeat(64),profile:{},runtime:{},installation:{},componentVersion:'4.18.42',pluginVersion:'5.5.77',pluginStatus:'active'};
 const state={now:Date.now(),mono:0,requests:[],writes:[],tasks:new Map(),paths:{customOutputDir:null,customScheduledExportDir:null,currentExportsDir:'C:\\SyntheticQCE\\exports',currentScheduledExportsDir:'C:\\SyntheticQCE\\scheduled'},friends:[{uid:'u_synthetic_friend',uin:FRIEND,nick:'Synthetic friend',remark:null}],groups:[{groupCode:GROUP,groupName:'Synthetic group'}],before:null,mode:null,identity:ACCOUNT,version:'5.5.77',fileBytes:Buffer.from('synthetic export\u0000bytes'),saved:[],nextTask:1,verify:null};
 const send=(res,data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({success:status===200,data,timestamp:new Date().toISOString(),requestId:'synthetic-export-http'}));};
 const server=http.createServer(async(req,res)=>{try{
  const chunks=[];for await(const c of req)chunks.push(c);const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null,url=new URL(req.url,'http://127.0.0.1');const row={method:req.method,path:url.pathname,query:Object.fromEntries(url.searchParams),body};state.requests.push(row);if(req.headers.authorization!==`Bearer ${TOKEN}`){send(res,{},401);return;}if(state.before)await state.before(row,req,res);if(res.writableEnded||res.destroyed)return;
  if(url.pathname==='/api/system/info')send(res,{mode:'plugin',version:state.version,napcat:{online:true,selfInfo:{uin:state.identity}}});
  else if(url.pathname==='/api/config')send(res,state.paths);
  else if(['/api/friends','/api/groups'].includes(url.pathname)){const kind=url.pathname.split('/').at(-1),all=state[kind],page=Number(url.searchParams.get('page')),totalPages=Math.ceil(all.length/100);send(res,{[kind]:all.slice((page-1)*100,page*100),totalCount:all.length,currentPage:page,totalPages,hasNext:page<totalPages,hasPrev:page>1});}
  else if(url.pathname==='/api/messages/export'&&req.method==='POST'){
   state.writes.push(row);const id=`export_${state.now}_${(state.nextTask++).toString(36)}`,ext={JSON:'json',TXT:'txt',HTML:'html',EXCEL:'xlsx'}[body.format],fileName=`synthetic-export.${ext}`;
   const task={id,peer:body.peer,sessionName:'Synthetic target',status:'running',progress:0,format:body.format,messageCount:0,fileName,downloadUrl:'https://untrusted.invalid/do-not-follow',createdAt:new Date(state.now).toISOString(),startTime:body.filter.startTime,endTime:body.filter.endTime};state.tasks.set(id,task);
   if(state.mode==='create-disconnect'){res.destroy();return;}if(state.mode==='create-malformed'){send(res,{taskId:id,fileName:'../unsafe',status:'running'});return;}
   send(res,{taskId:id,fileName,downloadUrl:task.downloadUrl,filePath:path.win32.join(body.options.outputDir,fileName),status:'running',messageCount:0,startTime:task.startTime,endTime:task.endTime});
  }else if(/^\/api\/tasks\/[^/]+\/cancel$/.test(url.pathname)&&req.method==='POST'){state.writes.push(row);const id=url.pathname.split('/')[3],task=state.tasks.get(id);if(!task){send(res,{},500);return;}if(!['completed','cancelled','failed'].includes(task.status)){task.status='cancelled';task.completedAt=new Date(state.now).toISOString();if(state.mode==='cancel-disconnect'){res.destroy();return;}send(res,{taskId:id,cancelled:true});}else send(res,{taskId:id,cancelled:false,status:task.status});}
  else if(/^\/api\/tasks\/[^/]+$/.test(url.pathname)){const task=state.tasks.get(url.pathname.split('/')[3]);send(res,task||{},task?200:500);}
  else if(url.pathname==='/api/download-file'){const ext=path.win32.extname(url.searchParams.get('path'));res.writeHead(200,{'Content-Type':MIME[ext]||'application/octet-stream','Content-Length':state.fileBytes.length});res.end(state.fileBytes);}
  else send(res,{},404);
 }catch{if(!res.destroyed)send(res,{},500);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const request=(opts,cb)=>http.request({...opts,port:server.address().port},cb);
 const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('SYNTHETIC-VAULT:'+s),decryptString:b=>{const s=b.toString(),prefix='SYNTHETIC-VAULT:';if(!s.startsWith(prefix))throw Error('synthetic vault invalid');return s.slice(prefix.length);}};
 // Fixed synthetic test container, not OS encryption acceptance.
 const jobs=new QCEExportJobs({root:path.join(root,'journal'),vault,now:()=>state.now}),clients=[],stages=new Set();
 const saveDownload=async(opts,receive)=>{opts.assertCurrent();const target=path.join(root,`saved-${state.saved.length}-${opts.suggestedName}`),stage=new QQRemoteFileStage();stages.add(stage);try{const sink=await stage.createSink(target,opts),result=await receive(sink);await stage.close();stages.delete(stage);state.saved.push(target);return {...result,cleanupVerified:true};}catch(e){try{await stage.close();stages.delete(stage);}catch{e.code='file_cleanup_unconfirmed';}throw e;}};
 const sessionOptions={capture:()=>({...binding}),verifyContext:async(b,o)=>{o.assertCurrent();if(state.verify)await state.verify(b,o);o.assertCurrent();return {verified:true,endpoint:{host:'127.0.0.1',port:40653,token:TOKEN,endpointId:'synthetic-export-endpoint',ownershipVerified:true}};},jobs,clientFactory:o=>{const c=new QQQCEExportClient({...o,request});clients.push(c);return c;},saveDownload,now:()=>state.now,monotonic:()=>state.mono,...extra};
 const session=new QQQCEExportSession(sessionOptions);
 t.after(async()=>{await session.close();for(const stage of stages)await stage.close();jobs.close();server.closeAllConnections();await new Promise(r=>server.close(r));if(path.dirname(root)!==os.tmpdir()||!path.basename(root).startsWith('arcade-qce-export-'))throw Error('fixture cleanup scope');fs.rmSync(root,{recursive:true,force:true});});
 const options={includeSystemMessages:true,preferGroupMemberName:true,resources:{image:false,video:false,audio:false,file:false},htmlZip:false};
 async function preview(format='JSON'){const read=await session.read({...input,kind:'friends',page:1});return session.preview({...input,action:'create',observationId:read.profile.observationId,targetId:read.profile.targets[0].targetId,format,range:{startTime:state.now-3600000,endTime:state.now},options:{...options,resources:{...options.resources},htmlZip:format==='HTML'}});}
 const complete=operationId=>{const r=jobs.get({accountId:binding.accountId,qqAccountId:binding.qqAccountId,workScope:binding.workScope,credentialRevision:binding.credentialRevision},operationId),task=state.tasks.get(r.taskId);Object.assign(task,{status:'completed',progress:100,messageCount:2,completedAt:new Date(state.now).toISOString()});return task;};
 return {state,input,binding,session,sessionOptions,jobs,clients,request,server,root,TOKEN,preview,complete,options,saveDownload,sha:bytes=>createHash('sha256').update(bytes).digest('hex')};
}
module.exports={fixture,deferred,flush,TOKEN,ACCOUNT,FRIEND,GROUP};
