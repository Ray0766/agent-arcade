'use strict';
// Synthetic identity/credential proof; real ephemeral loopback HTTP only.
const http=require('node:http');
const {randomUUID}=require('node:crypto');
const {QQQCESecurityClient}=require('../../src/bot/qq-qce-security-client.cjs');
const {QQQCESecuritySession}=require('../../src/bot/qq-qce-security-session.cjs');
const P=require('../../src/bot/qq-qce-security-policy.cjs');
const ACCOUNT='100001',TOKEN='S'.repeat(40);
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function fixture(t){
 const state={account:ACCOUNT,online:true,version:'5.5.77',mode:'plugin',rules:['127.0.0.1','::1'],disabled:false,currentClientIP:'127.0.0.1',configPath:'C:\\Synthetic-QCE\\security.json',displayHost:'127.0.0.1',requests:[],writeMode:'ok',apply:true,enforce:false,now:1800000000000,mono:100,verifyCalls:0};
 const server=http.createServer(async(req,res)=>{try{
  let body='';for await(const part of req)body+=part;const row={method:req.method,path:req.url,body:body?JSON.parse(body):null,headers:{...req.headers}};state.requests.push(row);await state.before?.(row,res);
  const send=data=>{res.setHeader('Content-Type','application/json; charset=utf-8');res.end(JSON.stringify({success:true,data,timestamp:'2026-11-07T00:00:00.000Z',requestId:randomUUID()}));};
  const error=(status=500,code='SYNTHETIC_FAILURE')=>{res.statusCode=status;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({success:false,error:{message:'PRIVATE_SYNTHETIC_ERROR',context:{code}},timestamp:'2026-11-07T00:00:00.000Z',requestId:randomUUID()}));};
  if(await state.handle?.(row,res,send,error))return;
  if(state.enforce&&row.path!=='/security-status'&&!P.allowsLoopback({rules:state.rules,disabled:state.disabled})){error(403,'IP_NOT_ALLOWED');return;}
  if(row.method==='GET'){
   await state.onGet?.(row,res);
   if(row.path==='/api/system/info')send({version:state.version,mode:state.mode,napcat:{online:state.online,selfInfo:{uin:state.account,nick:'PRIVATE_SYNTHETIC_NICK'}}});
   else if(row.path==='/api/security/ip-whitelist')send({allowedIPs:state.rules,disabled:state.disabled,isDocker:false,configPath:state.configPath,currentClientIP:state.currentClientIP});
   else if(row.path==='/security-status')send({hasConfig:true,tokenExpired:false,publicIP:state.displayHost,createdAt:'2026-11-07T00:00:00.000Z',lastAccess:new Date().toISOString(),requiresAuth:true,serverIP:state.displayHost,isDocker:false,ipWhitelistDisabled:state.disabled,allowedIPs:state.rules,currentClientIP:state.currentClientIP,configPath:state.configPath});
   else error(404);return;
  }
  let data;
  if(row.path==='/api/security/ip-whitelist'&&row.method==='POST'){if(state.apply&&!state.rules.includes(row.body.ip))state.rules.push(row.body.ip);data={message:'Synthetic added',allowedIPs:[...state.rules]};}
  else if(row.path==='/api/security/ip-whitelist'&&row.method==='DELETE'){const index=state.rules.indexOf(row.body.ip);if(index<0){error(404,'IP_NOT_FOUND');return;}if(state.apply)state.rules.splice(index,1);data={message:'Synthetic removed',allowedIPs:[...state.rules]};}
  else if(row.path==='/api/security/ip-whitelist/toggle'&&row.method==='PUT'){if(state.apply)state.disabled=row.body.disabled;data={message:'Synthetic changed',disabled:state.disabled};}
  else if(row.path==='/api/server/host'&&row.method==='POST'){if(state.apply)state.displayHost=row.body.host==='0.0.0.0'?'127.0.0.1':row.body.host;data={message:'Synthetic display host',serverAddresses:{local:'http://127.0.0.1:40653',...(state.displayHost!=='127.0.0.1'?{external:`http://${state.displayHost}:40653`}:{})}};}
  else{error(404);return;}
  await state.onWrite?.(row,res);
  if(state.writeMode==='disconnect'){res.destroy();return;}if(state.writeMode==='timeout')return;if(state.writeMode==='error'){error();return;}
  if(state.writeMode==='malformed'){send({message:'Synthetic malformed'});return;}send(data);
 }catch{res.destroy();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 // Trusted test seam maps only the fixed production address to this owned server.
 const request=(options,callback)=>http.request({...options,port:server.address().port},callback),clientOptions={token:TOKEN,request,timeoutMs:250},client=new QQQCESecurityClient(clientOptions);t.after(()=>client.close());
 const input={accountId:'synthetic-qce',panelId:randomUUID()},binding={...input,qqAccountId:ACCOUNT,contextKey:'synthetic-security-context',credentialRevision:randomUUID(),workScope:'synthetic-work-scope',profile:{},runtime:{},installation:{},componentVersion:'4.18.42',pluginVersion:'5.5.77',pluginStatus:'active'},endpoint={host:'127.0.0.1',port:40653,token:TOKEN,endpointId:'synthetic-owned-listener',ownershipVerified:true},created=[];
 const sessionOptions={capture:value=>({...binding,panelId:value.panelId}),verifyContext:async(b,options)=>{state.verifyCalls++;await state.verify?.(b,options);return {verified:true,endpoint:{...endpoint}};},clientFactory:options=>{const c=new QQQCESecurityClient({...clientOptions,...options});created.push(c);return c;},now:()=>state.now,monotonic:()=>state.mono};
 const session=new QQQCESecuritySession(sessionOptions);t.after(()=>session.close());
 const preview=async(action='addRule',value='192.0.2.7')=>{const r=await session.read(input);return session.preview({...input,observationId:r.profile.observationId,action,value});};
 const writes=()=>state.requests.filter(row=>row.method!=='GET');return {state,server,request,clientOptions,client,input,binding,endpoint,sessionOptions,session,created,preview,writes};
}
module.exports={fixture,ACCOUNT,TOKEN,flush,deferred};
