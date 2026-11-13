'use strict';
// Synthetic QCE protocol fixture. No installed plugin or real credential is used.
const http=require('node:http');
const {randomUUID}=require('node:crypto');
const {QQQCEClient}=require('../../src/bot/qq-qce-client.cjs');
const {QQQCESession}=require('../../src/bot/qq-qce-session.cjs');
const ACCOUNT='100001',TOKEN='S'.repeat(40);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function fixture(t){
 const state={account:ACCOUNT,online:true,version:'5.5.77',mode:'plugin',paths:{customOutputDir:null,customScheduledExportDir:null,currentExportsDir:'C:\\Synthetic-QCE\\exports',currentScheduledExportsDir:'C:\\Synthetic-QCE\\scheduled'},requests:[],writeMode:'ok',apply:true,now:1800000000000,mono:100,verifyCalls:0};
 const server=http.createServer(async(req,res)=>{try{
  let body='';for await(const part of req)body+=part;const row={method:req.method,path:req.url,body:body?JSON.parse(body):null,authorization:req.headers.authorization};state.requests.push(row);await state.before?.(row,res);
  const send=data=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({success:true,data,timestamp:'2026-11-07T00:00:00.000Z',requestId:randomUUID()}));};
  if(await state.handle?.(row,res,send))return;
  if(row.path==='/api/system/info'&&row.method==='GET')send({version:state.version,mode:state.mode,napcat:{online:state.online,selfInfo:{uin:state.account,nick:'PRIVATE_SYNTHETIC_NICK'}}});
  else if(row.path==='/api/config'&&row.method==='GET'){await state.onGet?.(row);send({...state.paths,secret:'SYNTHETIC_UNEXPOSED_FIELD'});}
  else if(row.path==='/api/config'&&row.method==='PUT'){
   if(state.apply){for(const [field,value]of Object.entries(row.body)){state.paths[field]=value;state.paths[field==='customOutputDir'?'currentExportsDir':'currentScheduledExportsDir']=value||'C:\\Synthetic-QCE\\default';}}
   await state.onPut?.(row,res);
   if(state.writeMode==='disconnect'){res.destroy();return;}
   if(state.writeMode==='timeout')return;
   if(state.writeMode==='error'){res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:false,error:{message:'SYNTHETIC_PRIVATE_STACK'},timestamp:'2026-11-07T00:00:00.000Z',requestId:randomUUID()}));return;}
   if(state.writeMode==='malformed'){res.setHeader('Content-Type','application/json');res.end('{bad');return;}
   send({...state.paths,message:'Synthetic handler response'});
  }else{res.statusCode=404;res.end();}
 }catch{res.destroy();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 // Only this trusted fixture maps the fixed production port to an ephemeral loopback listener.
 const request=(options,callback)=>http.request({...options,port:server.address().port},callback);
 const clientOptions={token:TOKEN,request,timeoutMs:150},client=new QQQCEClient(clientOptions);t.after(()=>client.close());
 const input={accountId:'synthetic-qce',panelId:randomUUID()};
 const binding={...input,qqAccountId:ACCOUNT,contextKey:'synthetic-context-1',credentialRevision:randomUUID(),workScope:'synthetic-work-scope',profile:{},runtime:{},installation:{},componentVersion:'4.18.42',pluginVersion:'5.5.77',pluginStatus:'active'};
 const endpoint={host:'127.0.0.1',port:40653,token:TOKEN,endpointId:'synthetic-owned-listener',ownershipVerified:true},created=[];
 const sessionOptions={capture:value=>({...binding,panelId:value.panelId}),verifyContext:async(b,options)=>{state.verifyCalls++;await state.verify?.(b,options);return {verified:true,endpoint:{...endpoint}};},clientFactory:options=>{const c=new QQQCEClient({...clientOptions,...options});created.push(c);return c;},now:()=>state.now,monotonic:()=>state.mono};
 const session=new QQQCESession(sessionOptions);t.after(()=>session.close());
 const preview=async(field='customOutputDir',value='C:\\Synthetic-QCE\\next')=>{const r=await session.read(input);return session.preview({...input,observationId:r.profile.observationId,field,value});};
 const writes=()=>state.requests.filter(row=>row.method==='PUT');
 return {state,server,request,clientOptions,client,input,binding,endpoint,sessionOptions,session,created,preview,writes};
}
module.exports={fixture,ACCOUNT,TOKEN,flush,deferred};
