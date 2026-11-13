'use strict';
// Production protocol client/session over owned HTTP; synthetic native records,
// credential, endpoint ownership and QQ identity. No real scheduler is started.
const http=require('node:http'),{randomUUID}=require('node:crypto');
const {QQQCENativePlansClient}=require('../../src/bot/qq-qce-native-plans-client.cjs');
const {QQQCENativePlansSession}=require('../../src/bot/qq-qce-native-plans-session.cjs');
const P=require('../../src/bot/qq-qce-native-plans-policy.cjs');
const ACCOUNT='100001',FRIEND='100002',GROUP='100003',TOKEN='SyntheticNativePlansToken'.padEnd(40,'X');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};},flush=()=>new Promise(r=>setImmediate(r));
const emptyOptions=()=>Object.fromEntries(P.OPTION_KEYS.map(k=>[k,{present:false,value:null}]));
async function fixture(t,extra={}){
 const state={now:Date.now(),mono:0,identity:ACCOUNT,online:true,version:'5.5.77',requests:[],writes:[],plans:new Map(),histories:new Map(),nextId:1,paths:{customOutputDir:null,customScheduledExportDir:null,currentExportsDir:'C:\\SyntheticQCE\\exports',currentScheduledExportsDir:'C:\\SyntheticQCE\\scheduled'},friends:[{uid:'u_synthetic_friend',uin:FRIEND,nick:'Synthetic friend',remark:null}],groups:[{groupCode:GROUP,groupName:'Synthetic group'}],writeMode:'ok',apply:true,before:null,afterWrite:null,verify:null,runStatus:'success'};
 function addPlan(overrides={}){const id=`scheduled_${state.now}_${(state.nextId++).toString(36)}`,date=new Date(state.now).toISOString(),row={id,name:'Synthetic shared plan',peer:{chatType:1,peerUid:'u_synthetic_friend',guildId:''},scheduleType:'daily',executeTime:'02:00',cronExpression:null,timeRangeType:'last-7-days',customTimeRange:null,format:'JSON',options:{syntheticPrivateOption:'PRIVATE_SYNTHETIC_OPTION'},outputDir:'',enabled:false,createdAt:date,updatedAt:date,nextRun:new Date(state.now+86400000).toISOString(),syntheticPrivateField:'PRIVATE_SYNTHETIC_FIELD',...structuredClone(overrides)};state.plans.set(row.id,row);return row;}
 const server=http.createServer(async(req,res)=>{try{const chunks=[];for await(const c of req)chunks.push(c);const url=new URL(req.url,'http://127.0.0.1'),row={method:req.method,path:url.pathname,query:Object.fromEntries(url.searchParams),body:chunks.length?JSON.parse(Buffer.concat(chunks).toString()):null,headers:{...req.headers}};state.requests.push(row);
  const send=data=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({success:true,data,timestamp:new Date().toISOString(),requestId:'synthetic-native-http'}));},error=(code='SYNTHETIC_ERROR',status=500)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify({success:false,error:{message:'PRIVATE_SYNTHETIC_FAILURE',context:{code}},timestamp:new Date().toISOString(),requestId:'synthetic-native-http'}));};
  if(req.headers.authorization!==`Bearer ${TOKEN}`){error('INVALID_TOKEN',403);return;}if(await state.before?.(row,res,send,error)||res.writableEnded||res.destroyed)return;
  if(row.method==='GET'){
   if(row.path==='/api/system/info')send({mode:'plugin',version:state.version,napcat:{online:state.online,selfInfo:{uin:state.identity}}});
   else if(row.path==='/api/config')send(state.paths);
   else if(['/api/friends','/api/groups'].includes(row.path)){const kind=row.path.endsWith('friends')?'friends':'groups',all=state[kind],page=Number(row.query.page),totalPages=Math.ceil(all.length/100);send({[kind]:all.slice((page-1)*100,page*100),totalCount:all.length,totalPages,currentPage:page,hasNext:page<totalPages,hasPrev:page>1});}
   else if(row.path==='/api/scheduled-exports')send({scheduledExports:[...state.plans.values()]});
   else{const pieces=row.path.split('/'),id=decodeURIComponent(pieces[3]||'');if(pieces[4]==='history')send({history:(state.histories.get(id)||[]).slice(-Number(row.query.limit||50)).reverse()});else{const plan=state.plans.get(id);if(plan)send(plan);else error('SCHEDULED_EXPORT_NOT_FOUND');}}return;
  }
  state.writes.push(row);let data;
  if(row.path==='/api/scheduled-exports'&&row.method==='POST'){data=addPlan(row.body);}
  else if(row.path==='/api/scheduled-exports/trigger-all'&&row.method==='POST'){const targets=[...state.plans.values()].filter(v=>row.body.includeDisabled||v.enabled);data={triggered:targets.map(v=>({id:v.id,name:v.name})),count:targets.length};}
  else{const pieces=row.path.split('/'),id=decodeURIComponent(pieces[3]||''),old=state.plans.get(id);if(!old){error('SCHEDULED_EXPORT_NOT_FOUND');return;}
   if(row.method==='PUT'){data={...old,...structuredClone(row.body),id:old.id,createdAt:old.createdAt,updatedAt:new Date(state.now).toISOString()};if(state.apply)state.plans.set(id,data);}
   else if(row.method==='DELETE'){if(state.apply)state.plans.delete(id);data={message:'Synthetic removed'};}
   else if(row.method==='POST'&&pieces[4]==='trigger'){await state.triggerGate?.promise;data={id:`history_${state.now}_${(state.nextId++).toString(36)}`,scheduledExportId:id,executedAt:new Date(state.now).toISOString(),status:state.runStatus,messageCount:2,filePath:'C:\\SyntheticQCE\\scheduled\\synthetic.json',fileSize:12,error:'PRIVATE_SYNTHETIC_ERROR',duration:80,resourceSummary:{attempted:1,alreadyAvailable:0,downloaded:1,failed:0,skipped:0,failedSamples:['PRIVATE_SYNTHETIC_PATH']}};state.histories.set(id,[...(state.histories.get(id)||[]),data]);}
   else{error();return;}
  }
  await state.afterWrite?.(row,res,data);if(state.writeMode==='disconnect'){res.destroy();return;}if(state.writeMode==='timeout')return;if(state.writeMode==='error'){error();return;}if(state.writeMode==='malformed'){send({message:'Synthetic incomplete response'});return;}send(data);
 }catch{res.destroy();}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const request=(opts,cb)=>http.request({...opts,port:server.address().port},cb),clientOptions={token:TOKEN,request,timeoutMs:250,triggerTimeoutMs:2000},client=new QQQCENativePlansClient(clientOptions);
 const input={accountId:'synthetic-qce',panelId:randomUUID()},binding={...input,qqAccountId:ACCOUNT,contextKey:'synthetic-native-context',credentialRevision:randomUUID(),workScope:'synthetic-native-work',profile:{},runtime:{},installation:{},componentVersion:'4.18.42',pluginVersion:'5.5.77',pluginStatus:'active'},endpoint={host:'127.0.0.1',port:40653,token:TOKEN,endpointId:'synthetic-owned-native-listener',ownershipVerified:true},clients=[];
 const sessionOptions={capture:value=>({...binding,panelId:value.panelId}),verifyContext:async(b,o)=>{await state.verify?.(b,o);o.assertCurrent();return {verified:true,endpoint:{...endpoint}};},clientFactory:o=>{const c=new QQQCENativePlansClient({...clientOptions,...o});clients.push(c);return c;},now:()=>state.now,monotonic:()=>state.mono,...extra},session=new QQQCENativePlansSession(sessionOptions);
 t.after(async()=>{await session.close();client.close();server.closeAllConnections();await new Promise(r=>server.close(r));});
 const draft=target=>({name:'Synthetic new plan',target,scheduleType:'daily',executeTime:'02:00',cronExpression:null,timeRangeType:'last-7-days',customTimeRange:null,format:'JSON',options:emptyOptions(),output:{mode:'default',path:null}});
 async function createPreview(overrides={}){const read=await session.read(input),target=await session.targets({...input,kind:'friend',page:1});return session.preview({...input,observationId:read.profile.observationId,action:'create',planId:null,draft:{...draft({observationId:target.targets.observationId,targetId:target.targets.items[0].targetId}),...overrides}});}
 async function planPreview(action='run',overrides={}){const read=await session.read(input),plan=read.profile.plans[0],detail=await session.inspect({...input,observationId:read.profile.observationId,planId:plan.planId});return session.preview({...input,observationId:detail.detail.observationId,action,planId:plan.planId,draft:action==='update'?{...draft(null),options:detail.detail.definition.options,output:{mode:'keep',path:null},...overrides}:null});}
 return {state,input,binding,endpoint,client,clientOptions,request,server,session,sessionOptions,clients,addPlan,draft,createPreview,planPreview,emptyOptions,writes:()=>state.writes};
}
module.exports={fixture,ACCOUNT,FRIEND,GROUP,TOKEN,deferred,flush,emptyOptions};
