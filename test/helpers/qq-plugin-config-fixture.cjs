'use strict';
// Original protocol fixture: synthetic HTTP responses, no installed plugin.
const http=require('node:http'),{randomUUID}=require('node:crypto');
const {NapCatWebUI}=require('../../src/bot/napcat-webui.cjs');
const {QQPluginConfig}=require('../../src/bot/qq-plugin-config.cjs');
const {QQPluginConfigSession}=require('../../src/bot/qq-plugin-config-session.cjs');
const {PLUGIN,CLEANER,CLEANER_KEYS}=require('../../src/bot/qq-plugin-config-policy.cjs');
const ACCOUNT='100001',OWNER='900001',flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const field=(key,type,extra={})=>({key,type,label:`Synthetic ${key}`,...extra});
function schema(){return [field('_html_synthetic','html',{default:'<script>PRIVATE_HTML_NEVER_RENDERED</script>'}),field('prefix','string',{default:'#example'}),field('enableReply','boolean',{default:true}),field('apiUrl','string',{reactive:true,default:''}),field('theme','select',{default:'light',options:['light','dark','auto'].map(value=>({label:`Synthetic ${value}`,value}))}),field('features','multi-select',{default:['version'],options:['version','status','debug'].map(value=>({label:`Synthetic ${value}`,value}))}),field('description','string',{default:'Synthetic notes'})];}
async function fixture(t,{pluginId=PLUGIN}={}){
 const state={account:ACCOUNT,online:true,manager:true,plugin:{id:PLUGIN,name:'Synthetic builtin',version:'1.0.0',status:'active'},schema:schema(),config:{prefix:'#example',enableReply:true,description:'Synthetic notes',apiUrl:'PRIVATE_REACTIVE_VALUE',apiEndpoints:['PRIVATE_ENDPOINT'],privateState:{secret:'synthetic-private-plugin-token',sequence:[1,null,false]}},supportReactive:true,requests:[],now:1800000000000,mono:100,current:true,writeMode:'ok',apply:true};
 if(pluginId===CLEANER){state.plugin={id:CLEANER,name:'Synthetic cleaner',version:'1.2.0',status:'active'};state.config={defaultOptions:{...Object.fromEntries(CLEANER_KEYS.filter(key=>key!=='retainDays').map(key=>[key,key!=='enableNapCatData'])),retainDays:7,privateOption:'synthetic-private-cleaner-option'},scheduleTasks:[{id:'synthetic-task',accounts:['PRIVATE_ACCOUNT'],options:{enableFile:false},enabled:false}],privateState:{secret:'synthetic-private-cleaner-token'}};}
 const getRoute=pluginId===CLEANER?'/api/Plugin/ext/napcat-plugin-cleaner/config':`/api/Plugin/Config?id=${PLUGIN}`,writeRoute=pluginId===CLEANER?'/api/Plugin/ext/napcat-plugin-cleaner/config/options':'/api/Plugin/Config';
 const server=http.createServer(async(req,res)=>{try{let raw='';for await(const chunk of req)raw+=chunk;const row={method:req.method,path:req.url,body:raw?JSON.parse(raw):null,authorization:req.headers.authorization};state.requests.push(row);await state.before?.(row);const send=data=>res.end(JSON.stringify({code:0,data}));
  if(row.path==='/api/auth/login'){await state.auth?.();send({Credential:'syntheticConfigCredential'});return;}
  if(row.path==='/api/QQLogin/CheckLoginStatus')send({isLogin:true,isOffline:false,loginPhase:'logged_in'});
  else if(row.path==='/api/QQLogin/GetQQLoginInfo')send({uin:state.account,online:state.online});
  else if(row.path==='/api/Plugin/List')send({pluginManagerNotFound:!state.manager,plugins:state.manager&&state.plugin?[state.plugin]:[]});
  else if(row.path===getRoute&&row.method==='GET'){await state.onGet?.(row);send(pluginId===CLEANER?state.config:{schema:state.schema,config:state.config,supportReactive:state.supportReactive});}
  else if(row.path===writeRoute&&row.method==='POST'){if(state.apply){if(pluginId===CLEANER)Object.assign(state.config.defaultOptions,JSON.parse(JSON.stringify(row.body)));else state.config=JSON.parse(JSON.stringify(row.body.config));}await state.onWrite?.(row);if(state.writeMode==='timeout')return;if(state.writeMode==='disconnect'){res.destroy();return;}if(state.writeMode==='rejected'){res.end(JSON.stringify({code:-1,message:'PRIVATE_SETTER_FAILURE'}));return;}if(state.writeMode==='malformed'){res.end('{bad');return;}if(pluginId===CLEANER)res.end(JSON.stringify({code:0,message:'Synthetic default options response'}));else send(state.writeData||{message:'Config saved and plugin reloaded'});}
  else{res.statusCode=404;res.end();}await state.after?.(row);
 }catch{res.destroy();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const options={port:server.address().port,token:'synthetic-private-config-token',accountId:ACCOUNT,timeout:120},client=new NapCatWebUI(options);t.after(()=>client.close());
 const scope={kind:'installation',affectedProfiles:[{accountId:'synthetic-a',label:'Synthetic A'},{accountId:'synthetic-b',label:'Synthetic B'}]};
 const controllerOptions={accountId:ACCOUNT,pluginId,scope,client,assertCurrent:()=>{if(!state.current)throw Object.assign(Error('Synthetic changed'),{code:'changed'});},verifyContext:async()=>{await state.verify?.();},now:()=>state.now,monotonic:()=>state.mono,timeoutMs:2000};
 const controller=new QQPluginConfig(controllerOptions);t.after(()=>controller.close());const writes=()=>state.requests.filter(row=>row.path===writeRoute&&row.method==='POST');
 const defaultChanges=pluginId===CLEANER?{retainDays:{present:true,value:14}}:{prefix:{present:true,value:'#changed'}};
 const preview=async(changes=defaultChanges)=>{const row=await controller.read();return controller.preview({observationId:row.observationId,changes});};
 return {state,server,options,client,scope,controllerOptions,controller,writes,preview,defaultChanges};
}
async function sessionFixture(t,options={}){const f=await fixture(t,options),input={accountId:'synthetic-a',panelId:randomUUID(),pluginId:options.pluginId||PLUGIN},created=[];
 const context={profileId:input.accountId,panelId:input.panelId,profile:{},generation:1,characterId:'synthetic-persona',runtime:{},installation:{},runtimeEpoch:1,bridgeRevision:'synthetic-revision',qqAccountId:ACCOUNT,ownerId:OWNER,url:'ws://127.0.0.1:3001/',token:'synthetic-onebot-token',channel:'qq',status:'disconnected',endpointId:'synthetic-config-endpoint',componentVersion:'4.18.42',workScope:'a'.repeat(64),workScopeKind:'installation',affectedProfiles:f.scope.affectedProfiles.map(row=>({...row}))};
 const endpoint={port:f.options.port,token:f.options.token,endpointId:context.endpointId};
 const session=new QQPluginConfigSession({capture:value=>({...context,panelId:value.panelId}),verifyContext:async()=>({verified:true,endpoint:{...endpoint}}),clientFactory:options=>{const c=new NapCatWebUI({...f.options,...options});created.push(c);return c;},controllerFactory:options=>new QQPluginConfig({...options,now:()=>f.state.now,monotonic:()=>f.state.mono,timeoutMs:2000})});t.after(()=>session.close());
 const sessionPreview=async(changes=f.defaultChanges)=>{const row=await session.read(input);return session.preview({...input,observationId:row.profile.observationId,changes});};
 return {...f,input,context,endpoint,created,session,sessionPreview};
}
module.exports={fixture,sessionFixture,schema,ACCOUNT,OWNER,PLUGIN,flush,deferred};
