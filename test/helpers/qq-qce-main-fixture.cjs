'use strict';
// Actual main/session/client over two isolated HTTP fixtures; identity and vault are synthetic.
const assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm'),http=require('node:http');
const {createCipheriv,createDecipheriv,randomBytes}=require('node:crypto');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const {fixture:qceFixture,ACCOUNT,TOKEN,deferred}=require('./qq-qce-fixture.cjs');
const Session=require('../../src/bot/qq-qce-session.cjs'),Binding=require('../../src/bot/qq-qce-binding.cjs');
const {QQQCEClient}=require('../../src/bot/qq-qce-client.cjs');
const SecuritySession=require('../../src/bot/qq-qce-security-session.cjs');
const {QQQCESecurityClient}=require('../../src/bot/qq-qce-security-client.cjs');
const NativePlansSession=require('../../src/bot/qq-qce-native-plans-session.cjs');
const {QQQCENativePlansClient}=require('../../src/bot/qq-qce-native-plans-client.cjs');
const ExportSession=require('../../src/bot/qq-qce-export-session.cjs');
const {QQQCEExportClient}=require('../../src/bot/qq-qce-export-client.cjs');
const ScheduleSession=require('../../src/bot/qq-qce-schedule-session.cjs');
const ScheduleRunner=require('../../src/bot/qq-qce-schedule-runner.cjs');
const {NapCatWebUI}=require('../../src/bot/napcat-webui.cjs');
const Admin=require('../../src/bot/qq-plugin-admin-session.cjs');
const main=path.resolve(__dirname,'../../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const OWNER='200001',OTHER='300001',PLUGIN='napcat-plugin-qce';
const PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NEXT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
async function until(check){const deadline=Date.now()+3000;while(Date.now()<deadline){if(check())return;await new Promise(r=>setTimeout(r,2));}throw Error('Synthetic main observation deadline');}
function syntheticVault(){
 const key=Buffer.alloc(32,7);
 return {isEncryptionAvailable:()=>true,encryptString(value){const iv=randomBytes(12),c=createCipheriv('aes-256-gcm',key,iv);return Buffer.concat([iv,c.update(value,'utf8'),c.final(),c.getAuthTag()]);},decryptString(value){const d=createDecipheriv('aes-256-gcm',key,value.subarray(0,12));d.setAuthTag(value.subarray(-16));return Buffer.concat([d.update(value.subarray(12,-16)),d.final()]).toString('utf8');}};
}
async function fixture(t,{qceTimeoutMs}={}){
 const qce=await qceFixture(t),temp=path.resolve(os.tmpdir()),root=fs.mkdtempSync(path.join(temp,'qq-qce-main-'));
 // Actual main flows use each production client's default timeout. The nested
 // low-level fixture keeps its 150 ms budget; explicit fault tests may override.
 const mainClientOptions={...qce.clientOptions};
 if(qceTimeoutMs===undefined)delete mainClientOptions.timeoutMs;else mainClientOptions.timeoutMs=qceTimeoutMs;
 const workDir=path.join(root,'work'),configDir=path.join(workDir,'config'),core=path.join(root,'synthetic-core.mjs');
 fs.mkdirSync(configDir,{recursive:true});fs.writeFileSync(core,'SYNTHETIC NONEXECUTABLE CORE');
 const layout={available:true,accounts:[ACCOUNT,OTHER],workDir,configDir,core,napcatVersion:'4.18.42',installationKind:'legacy'};
 const state={account:ACCOUNT,online:true,plugins:[{id:PLUGIN,name:'Synthetic QCE',version:'5.5.77',status:'active'}],nativeProofs:0};
 const calls=[],clients=[],handlers=new Map(),events={},windowEvents={},messages=[];
 const server=http.createServer(async(req,res)=>{try{
  let raw='';for await(const part of req)raw+=part;const row={method:req.method,path:req.url,body:raw?JSON.parse(raw):null};calls.push(row);await state.before?.(row,res);
  const send=data=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:0,data}));};
  if(row.path==='/api/auth/login')return send({Credential:'SyntheticQceWebuiCredential'});
  if(row.path==='/api/QQLogin/CheckLoginStatus')return send({isLogin:true,isOffline:false,loginPhase:'logged_in'});
  if(row.path==='/api/QQLogin/GetQQLoginInfo')return send({uin:state.account,online:state.online});
  if(row.path==='/api/Plugin/List')return send({pluginManagerNotFound:false,plugins:state.plugins});
  if(row.path==='/api/Plugin/SetStatus'){const p=state.plugins.find(p=>p.id===row.body.id);if(p)p.status=row.body.enable?'active':'disabled';return send({message:'Synthetic status updated'});}
  res.statusCode=404;res.end();
 }catch{res.destroy();}});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const endpoint={ownershipVerified:true,port:server.address().port,token:'SYNTHETIC_QCE_WEBUI_TOKEN',endpointId:'synthetic-napcat-endpoint'};
 const service={status:'disconnected',credentialState:'ready',generation:1,config:{channel:'qq',mode:'deepseek',qqAccountId:ACCOUNT,qqOwnerId:OWNER,qqUrl:'ws://127.0.0.1:39999'},secret:{qqToken:'SYNTHETIC_QCE_ONEBOT_TOKEN'},socialStore:{config:()=>({characterId:'synthetic-character'})},snapshot(){return {status:this.status,social:{supported:false,config:{enabled:false}}};},async disconnect(){this.status='disconnected';}};
 const other={config:{channel:'wechat',qqAccountId:OTHER},status:'disconnected',snapshot(){return {status:this.status,social:{supported:false,config:{enabled:false}}};}};
 const services=new Map([['whale',service],['other',other]]);
 const accounts={selectedId:'whale',accounts:[{id:'whale',name:'Synthetic selected'},{id:'other',name:'Synthetic other'}],get(id){assert(services.has(id));return services.get(id);},select(id){this.selectedId=id;return this.get(id);},snapshot(){return {selectedId:this.selectedId,accounts:[]};},async close(){},async connect(){return {connected:true};}};
 const connection={accountId:ACCOUNT,serverName:'synthetic',url:service.config.qqUrl,token:service.secret.qqToken};
 const runtime={instance(){return layout;},async getConnection(){await state.proofHold?.promise;state.proofAfter?.();return {...endpoint};}};
 let pollingClosed=0;
 const console={runtime,epoch:1,closed:false,busy:new Set(),installationSettings:{current:{kind:'legacy'}},state:{desktopRunning:false,instances:[{accountId:ACCOUNT,management:'owned',recoveryRequired:false,processRunning:true,login:{identityVerified:true,online:true,accountId:ACCOUNT},runtimeRevision:'synthetic-revision',bridges:[{serverName:connection.serverName,enabled:true,loopbackOnly:true,hasToken:true,port:39999}]}]},clients:new Map([[ACCOUNT,{publicId:'synthetic-revision',endpointId:endpoint.endpointId,client:{close(){pollingClosed++;}}}]]),profiles(){return {connection:()=>({...connection})};},check(r,e){if(this.closed||this.runtime!==r||this.epoch!==e)throw Object.assign(Error('Synthetic scope changed'),{code:'changed'});},snapshot(){return this.state;},async close(){}};
 const win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},isDestroyed:()=>false,on(name,fn){(windowEvents[name]||=[]).push(fn);},webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../../src/ui/index.html')).href},send(_name,value){messages.push(value);}}};
 class NormalizedStore extends Binding.QCECredentialStore{
  status(s){return super.status({...s});}capture(s){return super.capture({...s});}assertCurrent(s,r){return super.assertCurrent({...s},r);}
  save(s,v){return super.save({...s},{...v});}remove(s,v){return super.remove({...s},{...v});}
 }
 class InjectedSession extends Session.QQQCESession{
  constructor(options){super({...options,capture:v=>({...options.capture(v)}),verifyContext:async(...args)=>{const r=await options.verifyContext(...args);return {...r,endpoint:{...r.endpoint}};},clientFactory:options=>{const c=new QQQCEClient({...mainClientOptions,...options});clients.push(c);return c;},now:()=>qce.state.now,monotonic:()=>qce.state.mono});}
 }
 class InjectedSecuritySession extends SecuritySession.QQQCESecuritySession{
  constructor(options){super({...options,capture:v=>({...options.capture(v)}),verifyContext:async(...args)=>{const r=await options.verifyContext(...args);return {...r,endpoint:{...r.endpoint}};},clientFactory:options=>{const c=new QQQCESecurityClient({...mainClientOptions,...options});clients.push(c);return c;},now:()=>qce.state.now,monotonic:()=>qce.state.mono});}
 }
 class InjectedNativePlansSession extends NativePlansSession.QQQCENativePlansSession{
  constructor(options){super({...options,capture:v=>({...options.capture(v)}),verifyContext:async(...args)=>{const r=await options.verifyContext(...args);return {...r,endpoint:{...r.endpoint}};},clientFactory:options=>{const c=new QQQCENativePlansClient({...mainClientOptions,...options});clients.push(c);return c;},now:()=>qce.state.now,monotonic:()=>qce.state.mono});}
 }
 class NormalizedAdmin extends Admin.QQPluginAdminSession{
  constructor(options){super({...options,capture:v=>({...options.capture(v)}),verifyContext:async(...args)=>{const r=await options.verifyContext(...args);return {...r,endpoint:{...r.endpoint}};}});}
 }
 class InjectedExportSession extends ExportSession.QQQCEExportSession{
  constructor(options){super({...options,capture:v=>({...options.capture(v)}),verifyContext:async(...args)=>{const r=await options.verifyContext(...args);return {...r,endpoint:{...r.endpoint}};},saveDownload:async(...args)=>({...await options.saveDownload(...args)}),clientFactory:options=>{const c=new QQQCEExportClient({...mainClientOptions,...options});clients.push(c);return c;},now:()=>qce.state.now,monotonic:()=>qce.state.mono});}
 }
 const scheduleOptions=options=>({...options,
  ...(options.capture?{capture:v=>({...options.capture(v)})}:{}),
  ...(options.captureLocal?{captureLocal:v=>({...options.captureLocal(v)})}:{}),
  ...(options.captureNetwork?{captureNetwork:v=>({...options.captureNetwork(v)})}:{}),
  verifyContext:async(...args)=>{const r=await options.verifyContext(...args);return {...r,endpoint:{...r.endpoint}};},
  clientFactory:options=>{const c=new QQQCEExportClient({...mainClientOptions,...options});clients.push(c);return c;},now:()=>qce.state.now,monotonic:()=>qce.state.mono});
 class InjectedScheduleSession extends ScheduleSession.QQQCEScheduleSession{constructor(options){super(scheduleOptions(options));}}
 class InjectedScheduleRunner extends ScheduleRunner.QQQCEScheduleRunner{constructor(options){super(scheduleOptions(options));}}
 const vault=syntheticVault();
 const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{AGENT_ARCADE_HOME:root,LOCALAPPDATA:root}},URL,AbortController,setInterval,clearInterval,
  require:id=>id==='electron'?{safeStorage:vault,dialog:{showSaveDialog:async(_win,options)=>{state.pickerOptions=options;return state.pickSave?state.pickSave(options):{canceled:true};}},app:{requestSingleInstanceLock:()=>false,quit(){},on(name,fn){events[name]=fn;}},ipcMain:{handle(name,fn){assert(!handlers.has(name));handlers.set(name,fn);}}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:id==='./bot/qq-qce-session.cjs'?{...Session,QQQCESession:InjectedSession}:id==='./bot/qq-qce-native-plans-session.cjs'?{...NativePlansSession,QQQCENativePlansSession:InjectedNativePlansSession}:id==='./bot/qq-qce-security-session.cjs'?{...SecuritySession,QQQCESecuritySession:InjectedSecuritySession}:id==='./bot/qq-qce-export-session.cjs'?{...ExportSession,QQQCEExportSession:InjectedExportSession}:id==='./bot/qq-qce-schedule-session.cjs'?{...ScheduleSession,QQQCEScheduleSession:InjectedScheduleSession}:id==='./bot/qq-qce-schedule-runner.cjs'?{...ScheduleRunner,QQQCEScheduleRunner:InjectedScheduleRunner}:id==='./bot/qq-qce-managed-process.cjs'?{readManagedQCEVersion:()=>state.installedVersion||'5.5.77',verifyManagedQCEEnable:async options=>{state.enableProofs=(state.enableProofs||0)+1;assert.equal(options.runtime,runtime);assert.equal(options.qqAccountId,ACCOUNT);options.assertCurrent();if(state.enableVerify)return state.enableVerify(options);throw Object.assign(Error('Synthetic unverified launch'),{code:'qce_process_unverified'});}}:id==='./bot/qq-qce-binding.cjs'?{...Binding,QCECredentialStore:NormalizedStore,verifyQCEListener:async value=>{state.nativeProofs++;value.assertCurrent();await state.listener?.(value);value.assertCurrent();return {host:'127.0.0.1',port:40653,endpointId:'a'.repeat(64),ownershipVerified:true};}}:id==='./bot/qq-plugin-admin-session.cjs'?{...Admin,QQPluginAdminSession:NormalizedAdmin}:fromMain(id)};
 const hide=source.split('\n').find(line=>line.includes("for(const event of ['hide','minimize'])")&&line.includes('closePluginPanels'));
 const select=source.split('\n').find(line=>line.includes("register('accountSelect'"));assert(hide&&select);
 vm.runInNewContext(source+`\nmodule.exports={registerQCEHandlers,registerPluginAdminHandlers,qceSession,qceSecuritySession,qceNativePlansSession,qceExportSession,qceScheduleSession,qceScheduleRunner,stopScheduleTimer:()=>{clearInterval(qceScheduleTimer);qceScheduleTimer=null;},schedules:()=>qceSchedules(),captureQCEScheduleLocal,captureQCEBackground:v=>captureQCE(v,{background:true}),pluginAdminSession,closePluginPanels,observePluginPanels,captureQCE,saveQCEExportDownload,qceExportStages,jobs:()=>qceJobs(),setup:(s,a,w,q)=>{bot=s;accounts=a;win=w;qqConsole=q;},store:()=>qceStore(),localPanel:()=>qceCredentialPanel,pending:()=>pendingPluginRead,bindLifecycle:()=>{${hide}\n${select}\n}};`,context,{filename:main});
 const api=context.module.exports;api.setup(service,accounts,win,console);api.registerQCEHandlers();api.registerPluginAdminHandlers();api.bindLifecycle();
 const event={sender:win.webContents,senderFrame:win.webContents.mainFrame},input={accountId:'whale',panelId:PANEL};
 const invoke=(suffix,value=input,override=event)=>handlers.get('arcade:qqQce'+suffix)(override,value);
 const save=async(token=TOKEN)=>{const s=await invoke('Status');assert.equal(s.ok,true,JSON.stringify(s));const r=await invoke('SaveCredential',{...input,expectedRevision:s.credential.revision,token});assert.equal(r.ok,true,JSON.stringify(r));return r;};
 const preview=async(field='customOutputDir',value='C:\\Synthetic-QCE\\main-change')=>{const r=await invoke('Read');assert.equal(r.ok,true,JSON.stringify(r));const p=await invoke('Preview',{...input,observationId:r.profile.observationId,field,value});assert.equal(p.ok,true,JSON.stringify(p));return p.preview;};
 t.after(async()=>{state.proofHold?.resolve();await api.closePluginPanels({permanent:true});server.closeAllConnections();await new Promise(resolve=>server.close(resolve));assert(root.startsWith(temp+path.sep+'qq-qce-main-'));fs.rmSync(root,{recursive:true,force:true});});
 return {root,qce,state,calls,clients,handlers,events,messages,endpoint,service,accounts,runtime,console,win,api,event,input,invoke,save,preview,emit:name=>{for(const fn of windowEvents[name]||[])fn();},get pollingClosed(){return pollingClosed;}};
}
module.exports={fixture,ACCOUNT,TOKEN,PANEL,NEXT,until,deferred};
