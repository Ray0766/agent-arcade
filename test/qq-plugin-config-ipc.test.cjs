'use strict';
// Production main/session/controller/WebUI with synthetic config over localhost.
// All identities/credentials are synthetic. No plugin code or real QQ runs.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const sessionModule=require('../src/bot/qq-plugin-config-session.cjs'),{QQPluginConfig}=require('../src/bot/qq-plugin-config.cjs'),{NapCatWebUI}=require('../src/bot/napcat-webui.cjs');
const statusModule=require('../src/bot/qq-plugin-admin-session.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const QQ='123456789',OWNER='234567891',OTHER='345678912',PLUGIN='napcat-plugin-builtin';
const CLEANER='napcat-plugin-cleaner';
const CLEANER_KEYS=['enableVideo','enableVideoThumb','enablePtt','enablePic','enableFile','enableLog','enableLogCache','enableNtTemp','enableNapCatData','enableNapCatTemp','retainDays'];
const PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NEXT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){const deadline=Date.now()+2000;while(Date.now()<deadline){if(fn())return;await new Promise(r=>setTimeout(r,1));}throw Error('synthetic observation deadline');}
async function fixture(t,{pluginId=PLUGIN}={}){
 const temp=path.resolve(os.tmpdir()),root=fs.mkdtempSync(path.join(temp,'qq-plugin-config-main-'));
 const make=name=>{const workDir=path.join(root,name),configDir=path.join(workDir,'config'),core=path.join(root,name+'.mjs');fs.mkdirSync(configDir,{recursive:true});fs.writeFileSync(core,'SYNTHETIC NONEXECUTABLE CORE');return {available:true,accounts:[QQ,OTHER],workDir,configDir,core,napcatVersion:'4.18.42',installationKind:'legacy'};};
 const layout=make('work'),otherLayout=make('other-work'),layouts=new Map([[QQ,layout],[OTHER,layout]]);
 const state={now:Date.now(),mono:1000,account:QQ,online:true,manager:true,plugins:[{id:PLUGIN,name:'Synthetic builtin',version:'1.0.0',status:'active'}],setMode:'ok',authHold:null,setHold:null,proofHold:null,proofAfter:null,confirmHold:null,auths:0};
 state.config={prefix:'#synthetic',enableReply:false,description:'Synthetic description',apiUrl:'SYNTHETIC_PRIVATE_REACTIVE',privateField:{key:'SYNTHETIC_PRIVATE_CONFIG'}};
 state.schema=[{key:'_html_random',type:'html',label:'',default:'<script>SYNTHETIC_PRIVATE_HTML</script>'},{key:'prefix',type:'string',label:'Prefix'},{key:'enableReply',type:'boolean',label:'Reply'},{key:'description',type:'string',label:'Description'},{key:'theme',type:'select',label:'Theme',options:['light','dark','auto'].map(value=>({label:value,value}))},{key:'features',type:'multi-select',label:'Features',options:['version','status','debug'].map(value=>({label:value,value}))},{key:'apiUrl',type:'string',label:'URL',reactive:true}];
 if(pluginId===CLEANER){state.plugins=[{id:CLEANER,name:'Synthetic cleaner',version:'1.2.0',status:'active'}];state.config={defaultOptions:{...Object.fromEntries(CLEANER_KEYS.map(key=>[key,key==='retainDays'?7:true])),futurePrivate:'SYNTHETIC_PRIVATE_DEFAULT'},scheduleTasks:[{id:'synthetic-schedule',account:'SYNTHETIC_PRIVATE_SCHEDULE_ACCOUNT',options:{retainDays:99}}],privateField:'SYNTHETIC_PRIVATE_TOP'};}
 const calls=[],clients=[],handlers=new Map(),windowEvents={},events={},messages=[],proofs=[];
 const server=http.createServer(async(req,res)=>{let raw='';for await(const b of req)raw+=b;const body=raw?JSON.parse(raw):null;calls.push({method:req.method,path:req.url,body});
  const reply=(data,code=0)=>res.end(JSON.stringify({code,data,...(code?{message:'SYNTHETIC_PRIVATE_UPSTREAM'}:{})}));
  if(req.url==='/api/auth/login'){state.auths++;await state.authHold?.promise;return reply({Credential:'SyntheticPluginCredential'});}
  if(req.url==='/api/QQLogin/CheckLoginStatus')return reply({isLogin:true,isOffline:false,loginPhase:'logged_in'});
  if(req.url==='/api/QQLogin/GetQQLoginInfo')return reply({uin:state.account,online:state.online});
  if(req.url==='/api/Plugin/List')return reply({pluginManagerNotFound:!state.manager,plugins:state.manager?state.plugins:[],extensionPages:[{path:'SYNTHETIC_PRIVATE_PAGE'}]});
  if(req.url==='/api/Plugin/Config?id='+PLUGIN){state.readConfig?.();return reply({schema:state.schema,config:state.config,supportReactive:true});}
  if(req.url==='/api/Plugin/Config'&&req.method==='POST'){state.config=JSON.parse(JSON.stringify(body.config));await state.setHold?.promise;if(state.setMode==='close'){res.destroy();return;}return reply({message:state.setMode==='reload-false'?'Config saved and plugin reloaded':'Config updated'},state.setMode==='error'?-1:0);}
  if(req.url==='/api/Plugin/ext/napcat-plugin-cleaner/config'&&req.method==='GET'){state.readConfig?.();return reply(state.config);}
  if(req.url==='/api/Plugin/ext/napcat-plugin-cleaner/config/options'&&req.method==='POST'){Object.assign(state.config.defaultOptions,body);await state.setHold?.promise;if(state.setMode==='close'){res.destroy();return;}return reply(null,state.setMode==='error'?-1:0);}
  return reply(null,-1);
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint={ownershipVerified:true,port:server.address().port,token:'SYNTHETIC_WEBUI_TOKEN',endpointId:'synthetic-endpoint'};
 const service={status:'disconnected',credentialState:'ready',generation:1,config:{channel:'qq',mode:'deepseek',qqAccountId:QQ,qqOwnerId:OWNER,qqUrl:'ws://127.0.0.1:39999'},secret:{qqToken:'SYNTHETIC_ONEBOT_TOKEN'},socialStore:{config:()=>({characterId:'synthetic-character'})},snapshot(){return {status:this.status,social:{supported:false,config:{enabled:false}}};},async disconnect(){this.status='disconnected';}};
 const second={config:{channel:'wechat',qqAccountId:OTHER},status:'disconnected',snapshot(){return {status:this.status,social:{supported:false,config:{enabled:false}}};}},services=new Map([['whale',service],['offline',second]]);
 const accounts={selectedId:'whale',accounts:[{id:'whale',name:'Synthetic current'},{id:'offline',name:'Synthetic retained'}],get(id){if(!services.has(id))throw Error('synthetic missing profile');return services.get(id);},select(id){const selected=this.get(id);this.selectedId=id;return selected;},snapshot(){return {selectedId:this.selectedId,accounts:[]};},async close(){},async connect(){return {connected:true};}};
 const connection={accountId:QQ,serverName:'synthetic-onebot',url:service.config.qqUrl,token:service.secret.qqToken};
 const runtime={instance(id){if(!layouts.has(id))throw Error('synthetic missing runtime');return layouts.get(id);},async getConnection(id){proofs.push(id);await state.proofHold?.promise;state.proofAfter?.();return {...endpoint};}};
 let pollingClosed=0;const qqConsole={runtime,epoch:1,closed:false,busy:new Set(),installationSettings:{current:{kind:'legacy'}},state:{desktopRunning:false,instances:[{accountId:QQ,management:'owned',recoveryRequired:false,processRunning:true,login:{identityVerified:true,online:true,accountId:QQ},runtimeRevision:'synthetic-revision',bridges:[{serverName:connection.serverName,enabled:true,loopbackOnly:true,hasToken:true,port:39999}]}]},clients:new Map([[QQ,{publicId:'synthetic-revision',endpointId:endpoint.endpointId,client:{close(){pollingClosed++;}}}]]),profiles(){return {connection:()=>({...connection})};},check(r,e){if(this.closed||this.runtime!==r||this.epoch!==e)throw Object.assign(Error('synthetic changed'),{code:'changed'});},snapshot(){return this.state;},async close(){}};
 const win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},isDestroyed:()=>false,on(name,fn){(windowEvents[name]||=[]).push(fn);},webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href},send(_name,value){messages.push(value);}}};
 class ObservedController extends QQPluginConfig{async confirm(...args){const result=await super.confirm(...args);await state.confirmHold?.promise;return result;}}
 class ObservedClient extends NapCatWebUI{close(){this.closedByOwner=true;super.close();}}
 class InjectedSession extends sessionModule.QQPluginConfigSession{constructor(options){super({...options,capture:input=>({...options.capture(input)}),verifyContext:async(...args)=>{const r=await options.verifyContext(...args);return {...r,endpoint:{...r.endpoint}};},clientFactory:options=>{const client=new ObservedClient({...options,timeout:500});clients.push(client);return client;},controllerFactory:options=>new ObservedController({...options,now:()=>state.now,monotonic:()=>state.mono,timeoutMs:3000})});}}
 // Production objects live in one realm. Only normalize VM-returned plain
 // envelopes here; all actual status/config session logic and HTTP remain real.
 class StatusSession extends statusModule.QQPluginAdminSession{constructor(options){super({...options,capture:input=>({...options.capture(input)}),verifyContext:async(...args)=>{const r=await options.verifyContext(...args);return {...r,endpoint:{...r.endpoint}};}});}}
 const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
  require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(name,fn){events[name]=fn;}},ipcMain:{handle(name,fn){assert(!handlers.has(name));handlers.set(name,fn);}}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:id==='./bot/qq-plugin-config-session.cjs'?{...sessionModule,QQPluginConfigSession:InjectedSession}:id==='./bot/qq-plugin-admin-session.cjs'?{...statusModule,QQPluginAdminSession:StatusSession}:fromMain(id)};
 const hide=source.split('\n').find(line=>line.includes("for(const event of ['hide','minimize'])")&&line.includes('closePluginPanels'));
 const connect=source.split('\n').find(line=>line.includes("register('accountConnect'")),disconnect=source.split('\n').find(line=>line.includes("register('botDisconnect'")),select=source.split('\n').find(line=>line.includes("register('accountSelect'"));
 const connectFunction=source.match(/const connectCompanion=id=>\{[\s\S]*?\n    \};/)?.[0];assert(hide&&connect&&disconnect&&select&&connectFunction);
 vm.runInNewContext(source+`\nmodule.exports={registerPluginConfigHandlers,registerPluginAdminHandlers,pluginAdminSession,capturePluginAdmin,verifyPluginAdmin,pluginConfigSession,publish,stopping:qqStopping,setup:(s,a,w,q)=>{bot=s;accounts=a;win=w;qqConsole=q;},setQuitting:value=>quitting=value,bindLifecycle:()=>{${connectFunction}\n${hide}\n${connect}\n${disconnect}\n${select}\n}};`,context,{filename:main});
 const api=context.module.exports;api.setup(service,accounts,win,qqConsole);api.registerPluginConfigHandlers();api.registerPluginAdminHandlers();api.bindLifecycle();
 const event={sender:win.webContents,senderFrame:win.webContents.mainFrame},input={accountId:'whale',panelId:PANEL,pluginId};
 const invoke=(suffix,value=input,override=event)=>handlers.get(`arcade:qqPluginConfig${suffix}`)(override,value);
 const writes=()=>calls.filter(row=>row.method==='POST'&&['/api/Plugin/Config','/api/Plugin/ext/napcat-plugin-cleaner/config/options'].includes(row.path));
 const preview=async(changes={prefix:{present:true,value:'#changed'}})=>{const r=await invoke('Read');assert.equal(r.ok,true,JSON.stringify(r));const p=await invoke('Preview',{...input,observationId:r.profile.observationId,changes});assert.equal(p.ok,true,JSON.stringify(p));return p.preview;};
 t.after(async()=>{for(const key of ['authHold','setHold','proofHold','confirmHold'])state[key]?.resolve();await Promise.all([api.pluginConfigSession.close(),api.pluginAdminSession.close()]);server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert(root.startsWith(temp+path.sep+'qq-plugin-config-main-'));fs.rmSync(root,{recursive:true,force:true});});
 return {root,layout,otherLayout,layouts,state,calls,clients,accounts,service,services,second,runtime,endpoint,qqConsole,connection,win,api,handlers,event,input,invoke,preview,writes,proofs,messages,events,get pollingClosed(){return pollingClosed;},emit:name=>{for(const fn of windowEvents[name]||[])fn();}};
}

test('actual fixed IPC read projects only reviewed fields and retains complete private identity capture',async t=>{
 const f=await fixture(t),r=await f.invoke('Read');assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.accountId,'whale');assert.equal(r.qqAccountId,QQ);assert.equal(r.pluginId,PLUGIN);
 assert.deepEqual(r.profile.fields.theme,{present:false});assert.deepEqual(r.profile.fields.features,{present:false});assert.equal(r.profile.readsMayExecuteCode,true);assert.equal(r.profile.persistenceVerified,false);
 assert.equal(f.api.pluginConfigSession.session.binding.ownerId,OWNER);assert.equal(f.api.pluginConfigSession.session.binding.token,f.connection.token);assert.equal(f.api.pluginConfigSession.session.binding.url,new URL(f.connection.url).href);
 assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_PRIVATE|SYNTHETIC_.*TOKEN|Credential|workScope|workDir|core|apiUrl|privateField/);
 assert(f.calls.some(x=>x.method==='GET'&&x.path==='/api/Plugin/Config?id='+PLUGIN));assert(f.calls.every(x=>!/(Register|SSE|Change|SetStatus|QuickLogin)/.test(x.path)));assert.equal(f.writes().length,0);
 await assert.rejects(f.invoke('Read',f.input,{sender:{},senderFrame:{}}));
});
test('read preview dismiss repreview confirm preserves private keys and optional absence without retry',async t=>{
 const f=await fixture(t),r=await f.invoke('Read'),changes={prefix:{present:true,value:'#chosen'}};
 const first=await f.invoke('Preview',{...f.input,observationId:r.profile.observationId,changes});assert.equal(first.ok,true);await f.invoke('Dismiss');assert.equal((await f.invoke('Confirm',{...f.input,ticketId:first.preview.ticketId})).ok,false);
 const p=await f.invoke('Preview',{...f.input,observationId:r.profile.observationId,changes});assert.equal(p.ok,true,JSON.stringify(p));const out=await f.invoke('Confirm',{...f.input,ticketId:p.preview.ticketId});assert.equal(out.ok,true,JSON.stringify(out));
 assert.equal(out.change.outcome,'acknowledged');assert.equal(out.change.acknowledgement,'bridge-action-only');assert.equal(out.change.observation.state,'observed_match');assert.equal(out.change.persistenceVerified,false);assert.equal(out.change.reloadVerified,false);assert.equal(out.change.automaticRetry,false);
 const body=f.writes()[0].body;assert.equal(body.id,PLUGIN);assert.equal(body.config.prefix,'#chosen');assert.equal(body.config.apiUrl,'SYNTHETIC_PRIVATE_REACTIVE');assert.deepEqual(body.config.privateField,{key:'SYNTHETIC_PRIVATE_CONFIG'});assert.equal(Object.hasOwn(body.config,'theme'),false);assert.equal(Object.hasOwn(body.config,'features'),false);
 assert.doesNotMatch(JSON.stringify(out),/SYNTHETIC_PRIVATE|privateField|apiUrl/);assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.preview.ticketId})).ok,false);assert.equal(f.writes().length,1);
});
test('malformed requests cannot retire the other valid plugin session; explicit valid reads hand off ownership',async t=>{
 const f=await fixture(t),statusInput={accountId:'whale',panelId:NEXT},status=(suffix,input)=>f.handlers.get('arcade:qqPluginAdmin'+suffix)(f.event,input);
 assert.equal((await status('Read',statusInput)).ok,true);const statusSession=f.api.pluginAdminSession.session;
 for(const patch of [{url:'http://example.invalid/'},{config:{}},{schema:[]},{pluginId:'napcat-plugin-unreviewed'}])assert.equal((await f.invoke('Read',{...f.input,...patch})).ok,false);
 assert.equal(f.api.pluginAdminSession.session,statusSession);assert.equal(f.clients.length,0);
 assert.equal((await f.invoke('Read')).ok,true);assert.equal(f.api.pluginAdminSession.session,null);const configSession=f.api.pluginConfigSession.session;
 assert.equal((await status('Read',{...statusInput,url:'http://example.invalid/'})).ok,false);assert.equal(f.api.pluginConfigSession.session,configSession);
 assert.equal((await status('Read',statusInput)).ok,true);assert.equal(f.api.pluginConfigSession.session,null);assert.equal(f.clients[0].closedByOwner,true);assert.equal(f.pollingClosed,0);
});
test('main runtime/profile/shared-work guards reject before client creation and after asynchronous proof',async t=>{
 for(const change of [f=>f.accounts.selectedId='offline',f=>f.service.credentialState='locked',f=>f.qqConsole.state.desktopRunning=true,f=>f.qqConsole.state.instances[0].management='external',f=>f.layout.napcatVersion='4.18.41']){
  const f=await fixture(t);change(f);assert.equal((await f.invoke('Read')).ok,false);assert.equal(f.clients.length,0);assert.equal(f.calls.length,0);
 }
 for(const change of [f=>f.service.config.qqOwnerId=OTHER,f=>f.accounts.accounts[1].name='Changed synthetic profile',f=>f.layouts.set(OTHER,f.otherLayout),f=>f.endpoint.endpointId='replaced-endpoint']){
  const f=await fixture(t);f.state.proofHold=deferred();const pending=f.invoke('Read');await until(()=>f.proofs.length===1);change(f);f.state.proofHold.resolve();assert.equal((await pending).ok,false);assert.equal(f.clients.length,0);
 }
});
test('close in a proof continuation prevents late client creation; hide and stale close affect only owned sessions',async t=>{
 const f=await fixture(t);f.state.proofAfter=()=>{f.state.proofAfter=null;queueMicrotask(()=>void f.api.pluginConfigSession.closeCurrent());};assert.equal((await f.invoke('Read')).ok,false);assert.equal(f.clients.length,0);
 assert.equal((await f.invoke('Read')).ok,true);f.emit('hide');await f.api.pluginConfigSession.retiring;assert.equal(f.clients[0].closedByOwner,true);
 const next={...f.input,panelId:NEXT};assert.equal((await f.invoke('Read',next)).ok,true);await f.invoke('Close');assert.notEqual(f.clients[1].closedByOwner,true);
 f.service.generation++;f.api.publish();await f.api.pluginConfigSession.retiring;assert.equal(f.clients[1].closedByOwner,true);assert.equal(f.pollingClosed,0);assert.doesNotMatch(JSON.stringify(f.messages),/SYNTHETIC_PRIVATE|#synthetic|ticketId|observationId/);
});
test('ambiguous getter values and renderer unknown-field edits cannot authorize a replacement',async t=>{
 const f=await fixture(t);f.state.config={};const bad=await f.invoke('Read');assert.equal(bad.ok,false);assert.equal(f.writes().length,0);
 f.state.config={prefix:'#ok',enableReply:false,description:'Synthetic'};const read=await f.invoke('Read');assert.equal(read.ok,true,JSON.stringify(read));
 for(const changes of [{apiUrl:{present:true,value:'https://example.invalid'}},{prefix:{present:false}},{enableReply:{present:true,value:'false'}}])assert.equal((await f.invoke('Preview',{...f.input,observationId:read.profile.observationId,changes})).ok,false);
 assert.equal(f.writes().length,0);
});
test('full private baseline changes and expiry across runtime proof produce zero writes and consume tickets',async t=>{
 const f=await fixture(t),p=await f.preview();f.state.config.privateField.key='SYNTHETIC_PRIVATE_CHANGED';let out=await f.invoke('Confirm',{...f.input,ticketId:p.ticketId});assert.equal(out.change.outcome,'not_submitted');assert.equal(out.change.code,'baseline_changed');assert.equal(f.writes().length,0);
 const q=await f.preview();f.state.proofHold=deferred();const before=f.proofs.length,pending=f.invoke('Confirm',{...f.input,ticketId:q.ticketId});await until(()=>f.proofs.length>before);f.state.mono+=300001;f.state.proofHold.resolve();out=await pending;assert.equal(out.change.outcome,'not_submitted');assert.equal(out.change.code,'expired_ticket');assert.equal(f.writes().length,0);assert.equal((await f.invoke('Confirm',{...f.input,ticketId:q.ticketId})).ok,false);
});
test('setter-then-error stays unknown even with changed memory; apparent reload success is not verified',async t=>{
 const f=await fixture(t),p=await f.preview();f.state.setMode='error';const out=await f.invoke('Confirm',{...f.input,ticketId:p.ticketId});assert.equal(out.change.outcome,'unknown');assert.equal(out.change.observation.state,'unavailable');assert.equal(f.state.config.prefix,'#changed');assert.equal(f.writes().length,1);assert.doesNotMatch(JSON.stringify(out),/SYNTHETIC_PRIVATE/);
 const q=await f.preview({prefix:{present:true,value:'#next'}});f.state.setMode='reload-false';const next=await f.invoke('Confirm',{...f.input,ticketId:q.ticketId});assert.equal(next.change.outcome,'acknowledged');assert.equal(next.change.reloadVerified,false);assert.equal(next.change.persistenceVerified,false);
});
test('close after POST preserves unknown and matched late responses remain attached to their original panel',async t=>{
 const f=await fixture(t),p=await f.preview();f.state.setHold=deferred();const pending=f.invoke('Confirm',{...f.input,ticketId:p.ticketId});await until(()=>f.writes().length===1);const close=f.invoke('Close');const out=await pending;await close;f.state.setHold.resolve();f.state.setHold=null;assert.equal(out.change.outcome,'unknown');assert.equal(out.panelId,PANEL);assert.equal(f.writes().length,1);assert.equal(f.pollingClosed,0);
 const q=await f.preview({prefix:{present:true,value:'#late'}});f.state.confirmHold=deferred();const acknowledged=f.invoke('Confirm',{...f.input,ticketId:q.ticketId});await until(()=>f.writes().length===2&&!f.api.pluginConfigSession.session.controller.operation);const closing=f.invoke('Close');f.state.confirmHold.resolve();const late=await acknowledged;await closing;assert.equal(late.change.outcome,'acknowledged');assert.equal(late.panelId,PANEL);assert.equal(late.qqAccountId,QQ);
});
test('fresh endpoint credentials cannot be replaced between preview and submit',async t=>{
 for(const change of [f=>f.endpoint.token='SYNTHETIC_NEW_WEBUI_TOKEN',f=>f.endpoint.port=f.endpoint.port===65535?65534:f.endpoint.port+1]){
  const f=await fixture(t),p=await f.preview();change(f);const out=await f.invoke('Confirm',{...f.input,ticketId:p.ticketId});assert.equal(out.change.outcome,'not_submitted');assert.equal(out.change.code,'changed');assert.equal(f.writes().length,0);
 }
});
test('AI connection and shutdown close owned config clients without writing or touching runtime polling clients',async t=>{
 const f=await fixture(t);await f.preview();await f.handlers.get('arcade:accountConnect')(f.event,'whale');assert.equal(f.clients[0].closedByOwner,true);
 await f.preview();await f.handlers.get('arcade:botDisconnect')(f.event);assert.equal(f.clients[1].closedByOwner,true);
 await f.preview();let prevented=false;f.events['before-quit']({preventDefault(){prevented=true;}});await f.api.pluginConfigSession.retiring;assert.equal(prevented,true);assert.equal(f.api.pluginConfigSession.closed,true);assert.equal(f.clients[2].closedByOwner,true);assert.equal(f.writes().length,0);assert.equal(f.pollingClosed,0);
});
test('cleaner main flow exposes eleven fixed defaults and sends only the explicit patch',async t=>{
 const f=await fixture(t,{pluginId:CLEANER}),original=JSON.parse(JSON.stringify(f.state.config)),r=await f.invoke('Read');
 assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.pluginId,CLEANER);assert.deepEqual(Object.keys(r.profile.fields),CLEANER_KEYS);assert.equal(r.profile.startsCleanup,false);assert.equal(r.profile.changesExistingSchedules,false);assert.equal(r.profile.updatesFutureCleanupDefaults,true);assert.equal(r.profile.mayReload,false);
 assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC_PRIVATE|scheduleTasks|futurePrivate|privateField/);assert.equal(f.writes().length,0);
 const changes={enableFile:{present:true,value:false},retainDays:{present:true,value:14}},p=await f.invoke('Preview',{...f.input,observationId:r.profile.observationId,changes});
 assert.equal(p.ok,true,JSON.stringify(p));assert.deepEqual(p.preview.changedFields,['enableFile','retainDays']);assert.equal(f.writes().length,0);
 const out=await f.invoke('Confirm',{...f.input,ticketId:p.preview.ticketId});assert.equal(out.ok,true,JSON.stringify(out));assert.equal(out.change.pluginId,CLEANER);assert.equal(out.change.outcome,'acknowledged');assert.equal(out.change.observation.state,'observed_match');assert.equal(out.change.persistenceVerified,false);assert.equal(out.change.reloadVerified,false);
 assert.deepEqual(f.writes().map(row=>({path:row.path,body:row.body})),[{path:'/api/Plugin/ext/napcat-plugin-cleaner/config/options',body:{enableFile:false,retainDays:14}}]);
 assert.deepEqual(f.state.config.scheduleTasks,original.scheduleTasks);assert.equal(f.state.config.defaultOptions.futurePrivate,original.defaultOptions.futurePrivate);assert.equal(f.state.config.privateField,original.privateField);
 assert(f.calls.every(row=>!/(?:\/clean|\/run|\/schedules|\/Register|\/SetStatus|\/SSE)(?:\/|\?|$)/.test(row.path)));assert.doesNotMatch(JSON.stringify(f.messages),/SYNTHETIC_PRIVATE|ticketId|observationId/);
 assert.equal((await f.invoke('Confirm',{...f.input,ticketId:p.preview.ticketId})).ok,false);assert.equal(f.writes().length,1);
});

test('cleaner rejects missing fields, unreviewed versions, inactive status and renderer-injected options',async t=>{
 for(const mutate of [f=>delete f.state.config.defaultOptions.retainDays,f=>f.state.plugins[0].version='1.2.1',f=>f.state.plugins[0].status='disabled']){const f=await fixture(t,{pluginId:CLEANER});mutate(f);assert.equal((await f.invoke('Read')).ok,false);assert.equal(f.writes().length,0);}
 const f=await fixture(t,{pluginId:CLEANER}),r=await f.invoke('Read');assert.equal(r.ok,true,JSON.stringify(r));
 for(const changes of [{retainDays:{present:true,value:366}},{retainDays:{present:true,value:1.5}},{enableFile:{present:false}},{enableFile:{present:true,value:'false'}},{scheduleTasks:{present:true,value:[]}},{futurePrivate:{present:true,value:'replacement'}}])assert.equal((await f.invoke('Preview',{...f.input,observationId:r.profile.observationId,changes})).ok,false);
 const current=f.api.pluginConfigSession.session;assert.equal((await f.invoke('Read',{...f.input,pluginId:'napcat-plugin-qce'})).ok,false);assert.equal(f.api.pluginConfigSession.session,current);assert.equal(f.writes().length,0);
});

test('cleaner full private baseline and schedule changes block before POST without exposing contents',async t=>{
 for(const mutate of [f=>f.state.config.defaultOptions.futurePrivate='SYNTHETIC_PRIVATE_NEW',f=>f.state.config.scheduleTasks[0].options.retainDays=100]){const f=await fixture(t,{pluginId:CLEANER}),p=await f.preview({retainDays:{present:true,value:0}});mutate(f);const out=await f.invoke('Confirm',{...f.input,ticketId:p.ticketId});assert.equal(out.change.outcome,'not_submitted');assert.equal(out.change.code,'baseline_changed');assert.equal(f.writes().length,0);assert.doesNotMatch(JSON.stringify(out),/SYNTHETIC_PRIVATE|scheduleTasks|futurePrivate/);}
});

test('cleaner post failure stays unknown after memory changed; closing an outstanding patch never replays it',async t=>{
 const f=await fixture(t,{pluginId:CLEANER}),p=await f.preview({retainDays:{present:true,value:15}});f.state.setMode='error';const out=await f.invoke('Confirm',{...f.input,ticketId:p.ticketId});assert.equal(out.change.outcome,'unknown');assert.equal(out.change.observation.state,'unavailable');assert.equal(f.state.config.defaultOptions.retainDays,15);assert.equal(f.writes().length,1);
 f.state.setMode='ok';const q=await f.preview({retainDays:{present:true,value:16}});f.state.setHold=deferred();const pending=f.invoke('Confirm',{...f.input,ticketId:q.ticketId});await until(()=>f.writes().length===2);const closing=f.invoke('Close'),late=await pending;await closing;f.state.setHold.resolve();f.state.setHold=null;assert.equal(late.change.outcome,'unknown');assert.equal(late.pluginId,CLEANER);assert.equal(late.panelId,PANEL);assert.equal(f.writes().length,2);assert.equal(f.pollingClosed,0);
});

test('preload forwards only five fixed config methods and preserves caller correlation',()=>{
 const exposed={},calls=[],input={accountId:'whale',panelId:PANEL,pluginId:PLUGIN};vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{require:id=>{assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld(name,value){exposed[name]=value;}},ipcRenderer:{invoke:(...args)=>calls.push(args)}};}});
 for(const suffix of ['Read','Preview','Confirm','Dismiss','Close'])exposed.arcade['qqPluginConfig'+suffix](input);assert.equal(calls.length,5);assert(calls.every(([channel,value])=>channel.startsWith('arcade:qqPluginConfig')&&value===input));
});
function holdHandoff(f){
 const gate=deferred(),session=f.api.pluginAdminSession,original=session.closeCurrent.bind(session);let calls=0;
 session.closeCurrent=async()=>{calls++;await original();await gate.promise;};
 return {get calls(){return calls;},release(){session.closeCurrent=original;gate.resolve();}};
}
test('Close cancels an exact pending config read while the other panel is still retiring',async t=>{
 const f=await fixture(t),hold=holdHandoff(f),pending=f.invoke('Read');
 try{await until(()=>hold.calls===1);await f.invoke('Close');assert.equal(f.clients.length,0);}finally{hold.release();}
 const out=await pending;assert.equal(out.ok,false);assert.equal(out.code,'changed');assert.equal(f.clients.length,0);assert.equal(f.calls.length,0);
});
test('the latest valid status/config Read wins pending handoff; malformed and stale Close cannot replace it',async t=>{
 for(const winner of ['config','status']){
  const f=await fixture(t),hold=holdHandoff(f),statusInput={accountId:'whale',panelId:NEXT},status=()=>f.handlers.get('arcade:qqPluginAdminRead')(f.event,statusInput);
  const first=winner==='config'?status():f.invoke('Read');await until(()=>hold.calls===1);const second=winner==='config'?f.invoke('Read'):status();
  try{await until(()=>hold.calls===2);assert.equal((await f.invoke('Read',{...f.input,config:{}})).ok,false);await f.invoke('Close',{...f.input,panelId:'cccccccc-cccc-4ccc-8ccc-cccccccccccc'});}finally{hold.release();}
  assert.equal((await first).ok,false);const current=await second;assert.equal(current.ok,true,JSON.stringify(current));assert.equal(!!f.api.pluginConfigSession.session,winner==='config');assert.equal(!!f.api.pluginAdminSession.session,winner==='status');assert.equal(f.clients.length,winner==='config'?1:0);
 }
});
test('actual profile selection away and back cannot revive a pending configuration read',async t=>{
 const f=await fixture(t),hold=holdHandoff(f),pending=f.invoke('Read');await until(()=>hold.calls===1);
 const away=f.handlers.get('arcade:accountSelect')(f.event,'offline'),back=f.handlers.get('arcade:accountSelect')(f.event,'whale');
 try{assert.equal(f.accounts.selectedId,'whale');assert.equal(f.clients.length,0);}finally{hold.release();}
 await Promise.all([away,back]);const out=await pending;assert.equal(out.ok,false);assert.equal(out.code,'changed');assert.equal(f.clients.length,0);assert.equal(f.calls.length,0);
});
test('hide during pending handoff cancels the read even when visibility returns before retirement',async t=>{
 const f=await fixture(t),hold=holdHandoff(f),pending=f.invoke('Read');await until(()=>hold.calls===1);
 try{f.win.visible=false;f.emit('hide');f.win.visible=true;}finally{hold.release();}
 const out=await pending;assert.equal(out.ok,false);assert.equal(out.code,'changed');assert.equal(f.clients.length,0);
});
