'use strict';
// Production main/session/controller/WebUI with an inert local HTTP registry.
// All identities/credentials are synthetic. No plugin code or real QQ runs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const sessionModule=require('../src/bot/qq-plugin-admin-session.cjs'),{QQPluginAdmin}=require('../src/bot/qq-plugin-admin.cjs'),{NapCatWebUI}=require('../src/bot/napcat-webui.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const QQ='123456789',OWNER='234567891',OTHER='345678912',PLUGIN='napcat-plugin-builtin';
const PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NEXT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){const deadline=Date.now()+2000;while(Date.now()<deadline){if(fn())return;await new Promise(r=>setTimeout(r,1));}throw Error('synthetic observation deadline');}
async function fixture(t){
 const temp=path.resolve(os.tmpdir()),root=fs.mkdtempSync(path.join(temp,'qq-plugin-main-'));
 const make=name=>{const workDir=path.join(root,name),configDir=path.join(workDir,'config'),core=path.join(root,name+'.mjs');fs.mkdirSync(configDir,{recursive:true});fs.writeFileSync(core,'SYNTHETIC NONEXECUTABLE CORE');return {available:true,accounts:[QQ,OTHER],workDir,configDir,core,napcatVersion:'4.18.42',installationKind:'legacy'};};
 const layout=make('work'),otherLayout=make('other-work'),layouts=new Map([[QQ,layout],[OTHER,layout]]);
 const state={now:Date.now(),mono:1000,account:QQ,online:true,manager:true,plugins:[{id:PLUGIN,name:'Synthetic builtin',version:'1.0',status:'disabled'}],setMode:'ok',authHold:null,setHold:null,proofHold:null,proofAfter:null,confirmHold:null,auths:0};
 const calls=[],clients=[],handlers=new Map(),windowEvents={},events={},messages=[],proofs=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=raw?JSON.parse(raw):null;calls.push({method:req.method,path:req.url,body});
  const reply=(data,code=0)=>res.end(JSON.stringify({code,data,...(code?{message:'SYNTHETIC_PRIVATE_UPSTREAM'}:{})}));
  if(req.url==='/api/auth/login'){state.auths++;await state.authHold?.promise;return reply({Credential:'SyntheticPluginCredential'});}
  if(req.url==='/api/QQLogin/CheckLoginStatus')return reply({isLogin:true,isOffline:false,loginPhase:'logged_in'});
  if(req.url==='/api/QQLogin/GetQQLoginInfo')return reply({uin:state.account,online:state.online});
  if(req.url==='/api/Plugin/List')return reply({pluginManagerNotFound:!state.manager,plugins:state.manager?state.plugins:[],extensionPages:[{path:'SYNTHETIC_PRIVATE_PAGE'}]});
  if(req.url==='/api/Plugin/SetStatus'){const row=state.plugins.find(p=>p.id===body.id);if(row)row.status=body.enable?'active':'disabled';await state.setHold?.promise;if(state.setMode==='close'){res.destroy();return;}return reply({message:'Status updated successfully'},state.setMode==='error'?-1:0);}
  return reply(null,-1);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint={ownershipVerified:true,port:server.address().port,token:'SYNTHETIC_WEBUI_TOKEN',endpointId:'synthetic-endpoint'};
 const service={status:'disconnected',credentialState:'ready',generation:1,config:{channel:'qq',mode:'deepseek',qqAccountId:QQ,qqOwnerId:OWNER,qqUrl:'ws://127.0.0.1:39999'},secret:{qqToken:'SYNTHETIC_ONEBOT_TOKEN'},socialStore:{config:()=>({characterId:'synthetic-character'})},snapshot(){return {status:this.status,social:{supported:false,config:{enabled:false}}};},async disconnect(){this.status='disconnected';}};
 const second={config:{channel:'wechat',qqAccountId:OTHER},status:'disconnected'},services=new Map([['whale',service],['offline',second]]);
 const accounts={selectedId:'whale',accounts:[{id:'whale',name:'Synthetic current'},{id:'offline',name:'Synthetic retained'}],get(id){if(!services.has(id))throw Error('synthetic missing profile');return services.get(id);},snapshot(){return {selectedId:this.selectedId,accounts:[]};},async close(){},async connect(){return {connected:true};}};
 const connection={accountId:QQ,serverName:'synthetic-onebot',url:service.config.qqUrl,token:service.secret.qqToken};
 const runtime={instance(id){if(!layouts.has(id))throw Error('synthetic missing runtime');return layouts.get(id);},async getConnection(id){proofs.push(id);await state.proofHold?.promise;state.proofAfter?.();return {...endpoint};}};
 let pollingClosed=0;const qqConsole={runtime,epoch:1,closed:false,busy:new Set(),installationSettings:{current:{kind:'legacy'}},state:{desktopRunning:false,instances:[{accountId:QQ,management:'owned',recoveryRequired:false,processRunning:true,login:{identityVerified:true,online:true,accountId:QQ},runtimeRevision:'synthetic-revision',bridges:[{serverName:connection.serverName,enabled:true,loopbackOnly:true,hasToken:true,port:39999}]}]},clients:new Map([[QQ,{publicId:'synthetic-revision',endpointId:endpoint.endpointId,client:{close(){pollingClosed++;}}}]]),profiles(){return {connection:()=>({...connection})};},check(r,e){if(this.closed||this.runtime!==r||this.epoch!==e)throw Object.assign(Error('synthetic changed'),{code:'changed'});},snapshot(){return this.state;},async close(){}};
 const win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},isDestroyed:()=>false,on(name,fn){(windowEvents[name]||=[]).push(fn);},webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href},send(_name,value){messages.push(value);}}};
 class ObservedController extends QQPluginAdmin{async confirm(...args){const result=await super.confirm(...args);await state.confirmHold?.promise;return result;}}
 class ObservedClient extends NapCatWebUI{close(){this.closedByOwner=true;super.close();}}
 class InjectedSession extends sessionModule.QQPluginAdminSession{constructor(options){super({...options,capture:input=>({...options.capture(input)}),verifyContext:async(...args)=>{const r=await options.verifyContext(...args);return {...r,endpoint:{...r.endpoint}};},clientFactory:options=>{const client=new ObservedClient({...options,timeout:500});clients.push(client);return client;},controllerFactory:options=>new ObservedController({...options,now:()=>state.now,monotonic:()=>state.mono,timeoutMs:3000})});}}
 const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
  require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(name,fn){events[name]=fn;}},ipcMain:{handle(name,fn){assert(!handlers.has(name));handlers.set(name,fn);}}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:id==='./bot/qq-plugin-admin-session.cjs'?{...sessionModule,QQPluginAdminSession:InjectedSession}:fromMain(id)};
 const hide=source.split('\n').find(line=>line.includes("for(const event of ['hide','minimize'])win.on(event,()=>void closePluginPanels()"));
 const connect=source.split('\n').find(line=>line.includes("register('accountConnect'")),disconnect=source.split('\n').find(line=>line.includes("register('botDisconnect'"));
 const connectFunction=source.match(/const connectCompanion=id=>\{[\s\S]*?\n    \};/)?.[0];assert(hide&&connect&&disconnect&&connectFunction);
 vm.runInNewContext(source+`\nmodule.exports={registerPluginAdminHandlers,capturePluginAdmin,verifyPluginAdmin,pluginAdminSession,publish,stopping:qqStopping,setup:(s,a,w,q)=>{bot=s;accounts=a;win=w;qqConsole=q;},setQuitting:value=>quitting=value,bindLifecycle:()=>{${connectFunction}\n${hide}\n${connect}\n${disconnect}\n}};`,context,{filename:main});
 const api=context.module.exports;api.setup(service,accounts,win,qqConsole);api.registerPluginAdminHandlers();api.bindLifecycle();
 const event={sender:win.webContents,senderFrame:win.webContents.mainFrame},input={accountId:'whale',panelId:PANEL};
 const invoke=(suffix,value=input,override=event)=>handlers.get(`arcade:qqPluginAdmin${suffix}`)(override,value);
 const writes=()=>calls.filter(row=>row.path==='/api/Plugin/SetStatus');
 const preview=async(enable=true)=>{const r=await invoke('Read');assert.equal(r.ok,true,JSON.stringify(r));const p=await invoke('Preview',{...input,observationId:r.profile.observationId,pluginId:PLUGIN,enable});assert.equal(p.ok,true,JSON.stringify(p));return p.preview;};
 t.after(async()=>{for(const key of ['authHold','setHold','proofHold','confirmHold'])state[key]?.resolve();await api.pluginAdminSession.close();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert(root.startsWith(temp+path.sep+'qq-plugin-main-'));fs.rmSync(root,{recursive:true,force:true});});
 return {root,layout,otherLayout,layouts,state,calls,clients,accounts,service,services,second,runtime,endpoint,qqConsole,connection,win,api,handlers,event,input,invoke,preview,writes,proofs,messages,events,get pollingClosed(){return pollingClosed;},emit:name=>{for(const fn of windowEvents[name]||[])fn();}};
}

test('actual five IPC handlers preserve private capture fields and list without loading or registering plugins',async t=>{
 const f=await fixture(t);const r=await f.invoke('Read');assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.qqAccountId,QQ);assert.equal(r.profile.scope.kind,'installation');assert.deepEqual(r.profile.scope.affectedProfiles.map(x=>x.accountId),['offline','whale']);
 assert.equal(f.api.pluginAdminSession.session.binding.ownerId,OWNER);assert.equal(f.api.pluginAdminSession.session.binding.url,new URL(f.connection.url).href);assert.equal(f.api.pluginAdminSession.session.binding.token,f.connection.token);
 assert(f.calls.some(r=>r.method==='GET'&&r.path==='/api/Plugin/List'&&r.body===null));assert(f.calls.every(r=>!/(Register|Config|QuickLogin|Reload|Import)/.test(r.path)));
 assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_.*(?:TOKEN|PAGE)|Credential|workScope|workDir|core/);await f.invoke('Close');assert.equal(f.clients[0].closedByOwner,true);assert.equal(f.pollingClosed,0);
 await assert.rejects(f.invoke('Read',f.input,{sender:{},senderFrame:{}}));
});
test('missing manager is explicit unavailable and never triggers registration',async t=>{
 const f=await fixture(t);f.state.manager=false;const r=await f.invoke('Read');assert.equal(r.ok,true);assert.equal(r.profile.managerAvailable,false);assert.deepEqual(r.profile.plugins,[]);assert.equal(f.writes().length,0);assert(!f.calls.some(r=>r.path.includes('Register')));
 assert.equal((await f.invoke('Preview',{...f.input,observationId:r.profile.observationId,pluginId:PLUGIN,enable:true})).ok,false);
});
test('main visible selected online and unlocked scope gates run before creating any HTTP client',async t=>{
 for(const change of [f=>f.win.visible=false,f=>f.win.minimized=true,f=>f.api.setQuitting(true),f=>f.accounts.selectedId='offline',f=>f.service.status='connecting',f=>f.service.credentialState='locked',f=>f.qqConsole.state.instances[0].login.accountId=OTHER,f=>f.qqConsole.busy.add('qq-components'),f=>f.api.stopping.add(QQ),f=>f.layout.napcatVersion='4.18.41',f=>f.qqConsole.state.desktopRunning=true,f=>f.qqConsole.state.instances[0].management='external',f=>f.qqConsole.state.instances[0].recoveryRequired=true]){
  const f=await fixture(t);change(f);assert.equal((await f.invoke('Read')).ok,false);assert.equal(f.clients.length,0);assert.equal(f.calls.length,0);
 }
});
test('fresh main proof rejects changed identity, shared profile labels, installation and endpoint after await',async t=>{
 for(const change of [f=>f.service.generation++,f=>f.service.config.qqOwnerId=OTHER,f=>f.qqConsole.installationSettings.current={kind:'legacy'},f=>f.accounts.accounts[1].name='Synthetic renamed',f=>f.layouts.set(OTHER,f.otherLayout),f=>f.endpoint.endpointId='different',f=>f.accounts.selectedId='offline']){
  const f=await fixture(t);f.state.proofHold=deferred();const pending=f.invoke('Read');await until(()=>f.proofs.length===1);change(f);f.state.proofHold.resolve();assert.equal((await pending).ok,false);assert.equal(f.clients.length,0);assert.equal(f.calls.length,0);
 }
});
test('closing inside verify continuation prevents late client creation, and auth close prevents list requests',async t=>{
 const f=await fixture(t);f.state.proofAfter=()=>{f.state.proofAfter=null;queueMicrotask(()=>void f.api.pluginAdminSession.closeCurrent());};assert.equal((await f.invoke('Read')).ok,false);assert.equal(f.clients.length,0);
 f.state.authHold=deferred();const pending=f.invoke('Read');await until(()=>f.state.auths===1);const closing=f.invoke('Close');f.state.authHold.resolve();assert.equal((await pending).ok,false);await closing;assert.equal(f.calls.length,1);assert.equal(f.pollingClosed,0);
});
test('actual read preview dismiss repreview and one confirmed POST keep weak acknowledgement semantics',async t=>{
 const f=await fixture(t),r=await f.invoke('Read'),p=await f.invoke('Preview',{...f.input,observationId:r.profile.observationId,pluginId:PLUGIN,enable:true});await f.invoke('Dismiss');assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.preview.ticketId})).ok,false);
 const q=await f.invoke('Preview',{...f.input,observationId:r.profile.observationId,pluginId:PLUGIN,enable:true});assert.equal(q.ok,true);const out=await f.invoke('Confirm',{...f.input,ticketId:q.preview.ticketId});assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.change.outcome,'acknowledged');assert.equal(out.change.acknowledgement,'bridge-action-only');assert.equal(out.change.observation.state,'observed_match');assert.equal(out.change.persistenceVerified,false);assert.equal(out.change.executionStoppedVerified,false);assert.equal(out.change.automaticRetry,false);
 assert.deepEqual(f.writes().map(x=>x.body),[{id:PLUGIN,enable:true}]);assert.equal((await f.invoke('Confirm',{...f.input,ticketId:q.preview.ticketId})).ok,false);assert.equal(f.writes().length,1);
});
test('shared work replacement or profile membership change after preview consumes intent without a POST',async t=>{
 for(const change of [f=>{fs.renameSync(f.layout.workDir,path.join(f.root,'retired'));fs.mkdirSync(f.layout.configDir,{recursive:true});},f=>f.accounts.accounts[1].name='Synthetic new label',f=>f.layouts.set(OTHER,f.otherLayout)]){
  const f=await fixture(t),p=await f.preview();change(f);assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.ticketId})).ok,false);assert.equal(f.writes().length,0);
 }
});
test('expiry crossing runtime verification sends nothing and does not renew the old ticket',async t=>{
 const f=await fixture(t),p=await f.preview();f.state.proofHold=deferred();const n=f.proofs.length,pending=f.invoke('Confirm',{...f.input,ticketId:p.ticketId});await until(()=>f.proofs.length>n);f.state.mono+=300001;f.state.proofHold.resolve();const out=await pending;
 assert.equal(out.change.outcome,'not_submitted');assert.equal(out.change.code,'expired_ticket');assert.equal(f.writes().length,0);assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.ticketId})).ok,false);
});
test('submitted upstream error remains unknown even when simulated registry already changed',async t=>{
 const f=await fixture(t),p=await f.preview();f.state.setMode='error';const out=await f.invoke('Confirm',{...f.input,ticketId:p.ticketId});assert.equal(out.change.outcome,'unknown');assert.equal(out.change.observation.state,'unavailable');assert.equal(f.state.plugins[0].status,'active');assert.equal(f.writes().length,1);assert.doesNotMatch(JSON.stringify(out),/SYNTHETIC_PRIVATE/);assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.ticketId})).ok,false);
});
test('close after submission stays unknown and does not replay or close a shared client',async t=>{
 const f=await fixture(t),p=await f.preview();f.state.setHold=deferred();const pending=f.invoke('Confirm',{...f.input,ticketId:p.ticketId});await until(()=>f.writes().length===1);const closing=f.invoke('Close');const out=await pending;await closing;f.state.setHold.resolve();assert.equal(out.change.outcome,'unknown');assert.equal(out.panelId,PANEL);assert.equal(f.writes().length,1);assert.equal(f.pollingClosed,0);
});
test('an already acknowledged late result keeps its captured panel after closing',async t=>{
 const f=await fixture(t),p=await f.preview();f.state.confirmHold=deferred();const pending=f.invoke('Confirm',{...f.input,ticketId:p.ticketId});await until(()=>f.writes().length===1&&!f.api.pluginAdminSession.session.controller.operation);const closing=f.invoke('Close');f.state.confirmHold.resolve();const out=await pending;await closing;assert.equal(out.change.outcome,'acknowledged');assert.equal(out.panelId,PANEL);assert.equal(out.qqAccountId,QQ);assert.equal(f.pollingClosed,0);
});
test('hide and changed scope close only owned authentication; stale Close cannot touch a new panel',async t=>{
 const f=await fixture(t);await f.preview();f.emit('hide');await f.api.pluginAdminSession.retiring;assert.equal(f.clients[0].closedByOwner,true);
 const next={...f.input,panelId:NEXT};assert.equal((await f.invoke('Read',next)).ok,true);await f.invoke('Close');assert.notEqual(f.clients[1].closedByOwner,true);
 f.service.generation++;f.api.publish();await f.api.pluginAdminSession.retiring;assert.equal(f.clients[1].closedByOwner,true);assert.equal(f.pollingClosed,0);assert.doesNotMatch(JSON.stringify(f.messages),/Synthetic builtin|Credential|SYNTHETIC_WEBUI_TOKEN|ticketId|observationId/);
});
test('renderer cannot choose plugin URLs, credentials, routes or mismatched profile inputs',async t=>{
 const f=await fixture(t);for(const value of [{...f.input,url:'http://example.invalid/'},{...f.input,token:'SYNTHETIC_RENDERER_TOKEN'},{...f.input,action:'SetStatus'},{...f.input,pluginId:PLUGIN},{...f.input,panelId:'invalid'}])assert.equal((await f.invoke('Read',value)).ok,false);
 assert.equal(f.clients.length,0);assert.equal(f.calls.length,0);
});
test('fresh private endpoint token or port changes cannot reuse earlier authentication for a write',async t=>{
 for(const change of [f=>f.endpoint.token='SYNTHETIC_NEW_WEBUI_TOKEN',f=>f.endpoint.port=f.endpoint.port===65535?65534:f.endpoint.port+1]){
  const f=await fixture(t),p=await f.preview();change(f);const out=await f.invoke('Confirm',{...f.input,ticketId:p.ticketId});assert.equal(out.change.outcome,'not_submitted');assert.equal(out.change.code,'changed');assert.equal(f.writes().length,0);
 }
});
test('AI connect, legacy disconnect and quit retire owned plugin clients without toggling plugins',async t=>{
 const f=await fixture(t);await f.preview();await f.handlers.get('arcade:accountConnect')(f.event,'whale');assert.equal(f.clients[0].closedByOwner,true);
 await f.preview();await f.handlers.get('arcade:botDisconnect')(f.event);assert.equal(f.clients[1].closedByOwner,true);
 await f.preview();let prevented=false;f.events['before-quit']({preventDefault(){prevented=true;}});await until(()=>f.api.pluginAdminSession.closed);await f.api.pluginAdminSession.retiring;assert.equal(prevented,true);assert.equal(f.api.pluginAdminSession.closed,true);assert.equal(f.clients[2].closedByOwner,true);assert.equal(f.writes().length,0);assert.equal(f.pollingClosed,0);
});
test('preload exposes only five fixed plugin methods and does not expose runtime credentials',async t=>{
 const f=await fixture(t),exposed={},calls=[];vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{require:id=>{assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld(name,value){exposed[name]=value;}},ipcRenderer:{invoke:(...args)=>calls.push(args)}};}});
 for(const suffix of ['Read','Preview','Confirm','Dismiss','Close'])exposed.arcade['qqPluginAdmin'+suffix](f.input);assert.equal(calls.length,5);assert(calls.every(([channel,input])=>channel.startsWith('arcade:qqPluginAdmin')&&input===f.input));
});
