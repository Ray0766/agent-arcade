'use strict';
const http=require('node:http');
const {NapCatWebUI}=require('../../src/bot/napcat-webui.cjs');
const {QQPluginAdmin}=require('../../src/bot/qq-plugin-admin.cjs');
const ACCOUNT='87654321',OWNER='12345678',PLUGIN='napcat-plugin-cleaner';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
async function fixture(t){
 const state={account:ACCOUNT,online:true,manager:true,plugins:[{id:PLUGIN,name:'Synthetic cleaner',version:'1.0.0',status:'disabled',description:'PRIVATE_NOT_PROJECTED',icon:'/PRIVATE_ICON'}],requests:[],now:1800000000000,mono:100,current:true,writeMode:'ok',apply:true};
 const server=http.createServer(async(req,res)=>{try{let raw='';for await(const part of req)raw+=part;const row={method:req.method,path:req.url,body:raw?JSON.parse(raw):null,authorization:req.headers.authorization};state.requests.push(row);await state.before?.(row);const send=data=>res.end(JSON.stringify({code:0,data}));
  if(row.path==='/api/auth/login'){await state.auth?.();send({Credential:'syntheticWebUICredential'});return;}
  if(row.path==='/api/QQLogin/CheckLoginStatus'){send({isLogin:true,isOffline:false,loginPhase:'logged_in'});}
  else if(row.path==='/api/QQLogin/GetQQLoginInfo'){send({uin:state.account,online:state.online});}
  else if(row.path==='/api/Plugin/List'){send(state.listOverride||{plugins:state.manager?state.plugins:[],pluginManagerNotFound:!state.manager,extensionPages:[{path:'/PRIVATE_PLUGIN_HTML'}]});}
  else if(row.path==='/api/Plugin/SetStatus'){if(state.apply){const plugin=state.plugins.find(x=>x.id===row.body.id);if(plugin)plugin.status=row.body.enable?'active':'disabled';}await state.onWrite?.(row);if(state.writeMode==='timeout')return;if(state.writeMode==='disconnect'){res.destroy();return;}if(state.writeMode==='rejected'){res.end(JSON.stringify({code:-1,message:'PRIVATE_PLUGIN_FAILURE'}));return;}if(state.writeMode==='malformed'){res.end('{bad');return;}send({message:'Status updated successfully'});}
  else {res.statusCode=404;res.end();}
  await state.after?.(row);
 }catch{res.destroy();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
 const options={port:server.address().port,token:'synthetic-private-webui-token',accountId:ACCOUNT,timeout:150};
 const client=new NapCatWebUI(options);t.after(()=>client.close());const scope={kind:'installation',affectedProfiles:[{accountId:'synthetic-a',label:'Synthetic A'},{accountId:'synthetic-b',label:'Synthetic B'}]};
 const controllerOptions={accountId:ACCOUNT,scope,client,assertCurrent:()=>{if(!state.current)throw Object.assign(Error('Synthetic changed'),{code:'changed'});},verifyContext:async()=>{await state.verify?.();},now:()=>state.now,monotonic:()=>state.mono,timeoutMs:2000};
 const controller=new QQPluginAdmin(controllerOptions);t.after(()=>controller.close());const writes=()=>state.requests.filter(x=>x.path==='/api/Plugin/SetStatus');
 const preview=async(enable=true)=>{const row=await controller.read();return controller.preview({observationId:row.observationId,pluginId:PLUGIN,enable});};
 return {state,server,options,client,scope,controllerOptions,controller,writes,preview};
}
module.exports={fixture,ACCOUNT,OWNER,PLUGIN,flush,deferred};
