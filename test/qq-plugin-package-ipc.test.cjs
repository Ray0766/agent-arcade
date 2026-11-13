'use strict';
// Actual main handlers and package session; temporary files and inert process
// observations only. No installed plugin, credential, QQ or model is used.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const sessionModule=require('../src/bot/qq-plugin-package-session.cjs');
const {QQPluginArtifacts}=require('../src/bot/qq-plugin-artifacts.cjs');
const {ID,rows,zip}=require('./helpers/qq-plugin-artifact-fixture.cjs');
const QQ='12345001',OTHER='12345002',PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NEXT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const hold=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function until(fn){const end=Date.now()+3000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,1));}throw Error('synthetic wait exceeded');}
async function fixture(t){
 const temp=fs.realpathSync(os.tmpdir()),dir=fs.mkdtempSync(path.join(temp,'arcade-plugin-main-')),work=path.join(dir,'work'),configDir=path.join(work,'config'),core=path.join(dir,'core.mjs');
 fs.mkdirSync(configDir,{recursive:true});fs.writeFileSync(core,'SYNTHETIC NEVER EXECUTED CORE');
 const layout={available:true,accounts:[QQ,OTHER],workDir:work,configDir,core,napcatVersion:'4.18.42',installationKind:'legacy'};
 const makeService=id=>({status:'disconnected',generation:1,config:{channel:'qq',mode:'api',qqAccountId:id},socialStore:{config:()=>({characterId:'synthetic'})},snapshot:()=>({status:'disconnected'})});
 const first=makeService(QQ),second=makeService(OTHER),services=new Map([['first',first],['second',second]]);
 Object.defineProperty(first,'secret',{get(){throw Error('package management must not read credentials');}});
 const accounts={selectedId:'first',accounts:[{id:'first',name:'Synthetic first'},{id:'second',name:'Synthetic second'}],get:id=>services.get(id),select(id){this.selectedId=id;return this.get(id);},snapshot:()=>({accounts:[]})};
 const state={picker:null,picks:0,locks:0,stoppedChecks:0,lockHold:null,beforeOperation:null,visible:true,minimized:false},handlers=new Map(),events={};
 const runtime={instance:()=>({...layout}),async withPluginDeploymentLock(_id,operation){state.locks++;await state.lockHold?.promise;state.beforeOperation?.();return operation({...layout,assertStopped:async()=>{state.stoppedChecks++;}});}};
 const manager={runtime,closed:false,epoch:1,selectionIssue:null,installationSettings:{current:{kind:'legacy'}},busy:new Set(),state:{instances:[],configured:true},snapshot(){return this.state;}};
 const win={isVisible:()=>state.visible,isMinimized:()=>state.minimized,isDestroyed:()=>false,on:(name,fn)=>{events[name]=fn;},webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href},send(){}}};
 class BoundSession extends sessionModule.QQPluginPackageSession{constructor(options){super({...options,capture:input=>({...options.capture(input)})});}}
 class BoundArtifacts extends QQPluginArtifacts{constructor(options){super({...options,root:path.join(dir,'staging')});}}
 const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
  require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},ipcMain:{handle(name,fn){handlers.set(name,fn);}},dialog:{async showOpenDialog(){state.picks++;return state.picker?state.picker.promise:{canceled:true,filePaths:[]};}}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:id==='./bot/qq-plugin-package-session.cjs'?{...sessionModule,QQPluginPackageSession:BoundSession}:id==='./bot/qq-plugin-artifacts.cjs'?{QQPluginArtifacts:BoundArtifacts}:fromMain(id)};
 const hide=source.split('\n').find(line=>line.includes("for(const event of ['hide','minimize'])")&&line.includes('closePluginPanels'));
 vm.runInNewContext(source+`\nmodule.exports={registerPluginPackageHandlers,pluginPackageSession,pluginAdminSession,pluginConfigSession,capturePluginPackage,assertPluginPackageCapture,withPluginDeploymentLock,observePluginPanels,closePluginPanels,setup:(a,w,q,s)=>{accounts=a;win=w;qqConsole=q;bot=s;${hide}},select:(id)=>{bot=accounts.select(id);}};`,context,{filename:main});
 const api=context.module.exports;api.setup(accounts,win,manager,first);api.registerPluginPackageHandlers();
 const event={sender:win.webContents,senderFrame:win.webContents.mainFrame},base={accountId:'first',panelId:PANEL};
 const invoke=(name,value=base,ev=event)=>handlers.get('arcade:qqPluginPackage'+name)(ev,value);
 t.after(async()=>{state.picker?.resolve({canceled:true,filePaths:[]});state.lockHold?.resolve();await api.closePluginPanels({permanent:true});const real=fs.realpathSync(dir);assert(real.startsWith(temp+path.sep));fs.rmSync(real,{recursive:true,force:true});});
 return {dir,work,configDir,layout,first,second,accounts,runtime,manager,state,handlers,events,win,event,base,invoke,api};
}

test('offline selected QQ profile can read plugin files without credentials, bridge or runtime startup',async t=>{
 const f=await fixture(t),r=await f.invoke('Read');assert.equal(r.ok,true,JSON.stringify(r));assert.equal(r.qqAccountId,QQ);assert.equal(r.profile.kind,'plugin-files');assert.equal(r.profile.plugins.length,0);assert.equal(r.profile.scope.affectedProfiles.length,2);
 assert.equal(f.state.locks,0);assert.equal(f.state.picks,0);assert.doesNotMatch(JSON.stringify(r),/workDir|configDir|core\.mjs|token|credential/);assert.deepEqual(fs.readdirSync(f.configDir),[]);
 await assert.rejects(f.invoke('Read',f.base,{sender:{},senderFrame:{}}));
});
test('invalid package requests leave current valid panel intact and cannot inject local paths',async t=>{
 const f=await fixture(t);assert.equal((await f.invoke('Read')).ok,true);const active=f.api.pluginPackageSession.session;
 for(const extra of [{file:'C:\\private.zip'},{url:'https://example.invalid/plugin.zip'},{accountId:QQ}])assert.equal((await f.invoke('Read',{...f.base,...extra})).ok,false);
 assert.equal(f.api.pluginPackageSession.session,active);assert.equal(f.state.picks,0);
});
test('read waiting for another plugin view to close is cancellable before a new session is constructed',async t=>{
 const f=await fixture(t),gate=hold();let closing=0;const original=f.api.pluginAdminSession.closeCurrent.bind(f.api.pluginAdminSession);
 f.api.pluginAdminSession.closeCurrent=()=>{closing++;return gate.promise;};
 const pending=f.invoke('Read');await until(()=>closing===1);const closed=f.invoke('Close');gate.resolve();await closed;const result=await pending;
 assert.equal(result.ok,false);assert.equal(f.api.pluginPackageSession.session,null);f.api.pluginAdminSession.closeCurrent=original;
});
test('changing selected companion while read waits cannot retarget its file scope',async t=>{
 const f=await fixture(t),gate=hold();const original=f.api.pluginConfigSession.closeCurrent.bind(f.api.pluginConfigSession);let closing=false;
 f.api.pluginConfigSession.closeCurrent=()=>{closing=true;return gate.promise;};const pending=f.invoke('Read');await until(()=>closing);f.api.select('second');gate.resolve();assert.equal((await pending).ok,false);assert.equal(f.api.pluginPackageSession.session,null);f.api.pluginConfigSession.closeCurrent=original;
});
test('native picker cancellation and a close during the picker cannot prepare or publish a package',async t=>{
 const f=await fixture(t);assert.equal((await f.invoke('Read')).ok,true);const cancel=await f.invoke('PrepareLocal');assert.equal(cancel.ok,true,JSON.stringify(cancel));assert.equal(cancel.cancelled,true);
 f.state.picker=hold();const pending=f.invoke('PrepareLocal');await until(()=>f.state.picks===2);const closing=f.invoke('Close');f.state.picker.resolve({canceled:false,filePaths:[path.join(f.dir,'never.zip')]});assert.equal((await pending).ok,false);await closing;
 assert.equal(fs.existsSync(path.join(f.dir,'staging','qq-plugin-artifacts')),false);assert.equal(f.state.locks,0);
});
test('stale close does not close a newer panel; hide retires the owned panel',async t=>{
 const f=await fixture(t);assert.equal((await f.invoke('Read')).ok,true);assert.equal((await f.invoke('Read',{...f.base,panelId:NEXT})).ok,true);const active=f.api.pluginPackageSession.session;
 await f.invoke('Close');assert.equal(f.api.pluginPackageSession.session,active);f.events.hide();await f.api.pluginPackageSession.closeCurrent();assert.equal(f.api.pluginPackageSession.session,null);
});
test('main deployment lock retains original capture and refuses late account/scope change before callback',async t=>{
 const f=await fixture(t),captured=f.api.capturePluginPackage(f.base);let entered=0;
 await f.api.withPluginDeploymentLock(captured,{signal:new AbortController().signal,assertCurrent(){}},async({assertStopped})=>{await assertStopped();entered++;return {};});
 assert.equal(entered,1);assert.equal(f.manager.busy.size,0);assert(f.state.stoppedChecks>=2);
 f.state.beforeOperation=()=>{f.api.select('second');};await assert.rejects(f.api.withPluginDeploymentLock(captured,{signal:new AbortController().signal,assertCurrent(){}},async()=>{entered++;}),{code:'changed'});
 assert.equal(entered,1);assert.equal(f.manager.busy.size,0);
});
test('scope change after capture is refused and foreign manager busy state is never cleared',async t=>{
 const f=await fixture(t),captured=f.api.capturePluginPackage(f.base);f.accounts.accounts[1].name='Changed registered companion';assert.throws(()=>f.api.assertPluginPackageCapture(captured),{code:'changed'});
 const fresh=f.api.capturePluginPackage(f.base);f.manager.busy.add('qq-components');await assert.rejects(f.api.withPluginDeploymentLock(fresh,{signal:new AbortController().signal,assertCurrent(){}},async()=>assert.fail()));assert(f.manager.busy.has('qq-components'));assert.equal(f.state.locks,0);
});
test('actual main local ZIP preparation, installation, removal and restoration change only temporary plugin files',async t=>{
 const f=await fixture(t),file=path.join(f.dir,'synthetic.zip');fs.writeFileSync(file,await zip(rows()));
 fs.writeFileSync(path.join(f.configDir,'plugins.json'),' { "SYNTHETIC_PRIVATE_PREFERENCE": true } ');
 const privateDir=path.join(f.configDir,'plugins',ID);fs.mkdirSync(privateDir,{recursive:true});fs.writeFileSync(path.join(privateDir,'config.json'),'SYNTHETIC_PRIVATE_CONFIG');
 assert.equal((await f.invoke('Read')).ok,true);f.state.picker=hold();f.state.picker.resolve({canceled:false,filePaths:[file]});const prepared=await f.invoke('PrepareLocal');assert.equal(prepared.ok,true,JSON.stringify(prepared));assert.equal(fs.existsSync(path.join(f.work,'plugins',ID)),false);
 const preview=async(operation,extra={})=>{const r=await f.invoke('Read');assert.equal(r.ok,true,JSON.stringify(r));const p=await f.invoke('Preview',{...f.base,observationId:r.profile.observationId,operation,pluginId:ID,...extra});assert.equal(p.ok,true,JSON.stringify(p));return p.preview;};
 const p=await preview('install',{preparedId:prepared.prepared.preparedId});const installed=await f.invoke('Confirm',{...f.base,ticketId:p.ticketId});assert.equal(installed.change.outcome,'committed',JSON.stringify(installed));assert.equal(installed.change.pluginExecuted,false);assert.equal(installed.change.configurationPreserved,true);
 assert.equal((await f.invoke('Confirm',{...f.base,ticketId:p.ticketId})).ok,false);assert.equal(JSON.parse(fs.readFileSync(path.join(f.work,'plugins',ID,'package.json'),'utf8')).name,ID);
 const removal=await preview('remove'),removed=await f.invoke('Confirm',{...f.base,ticketId:removal.ticketId});assert.equal(removed.change.outcome,'committed',JSON.stringify(removed));assert.equal(fs.existsSync(path.join(f.work,'plugins',ID)),false);
 const restore=await preview('restore',{backupId:removed.change.backupId}),restored=await f.invoke('Confirm',{...f.base,ticketId:restore.ticketId});assert.equal(restored.change.outcome,'committed',JSON.stringify(restored));assert(fs.existsSync(path.join(f.work,'plugins',ID,'index.mjs')));
 assert.equal(fs.readFileSync(path.join(f.configDir,'plugins.json'),'utf8'),' { "SYNTHETIC_PRIVATE_PREFERENCE": true } ');assert.equal(fs.readFileSync(path.join(privateDir,'config.json'),'utf8'),'SYNTHETIC_PRIVATE_CONFIG');
 assert.doesNotMatch(JSON.stringify([prepared,p,installed,removed,restored]),/SYNTHETIC_PRIVATE|workDir|codeRoot|manifestPath/);assert.equal(f.state.locks,3);
});
test('a real main confirmation refuses changed selected profile after lock acquisition without publishing files',async t=>{
 const f=await fixture(t),file=path.join(f.dir,'synthetic.zip');fs.writeFileSync(file,await zip());await f.invoke('Read');f.state.picker=hold();f.state.picker.resolve({canceled:false,filePaths:[file]});const staged=await f.invoke('PrepareLocal');assert.equal(staged.ok,true,JSON.stringify(staged));
 const r=await f.invoke('Read'),p=await f.invoke('Preview',{...f.base,observationId:r.profile.observationId,operation:'install',pluginId:ID,preparedId:staged.prepared.preparedId});assert.equal(p.ok,true,JSON.stringify(p));
 f.state.beforeOperation=()=>f.api.select('second');const result=await f.invoke('Confirm',{...f.base,ticketId:p.preview.ticketId});assert.equal(result.change.outcome,'not_committed',JSON.stringify(result));assert.equal(fs.existsSync(path.join(f.work,'plugins',ID)),false);assert.equal(f.manager.busy.size,0);assert.equal(result.panelId,PANEL);
});

test('preload and actual registered main complete all four builtin offline routes on temporary configuration',{skip:!process.env.ARCADE_BUILTIN_OFFLINE_FIXTURE?'Set ARCADE_BUILTIN_OFFLINE_FIXTURE to the reviewed builtin 1.0.0 code directory; plugin code is copied and verified, never executed.':false},async t=>{
 const f=await fixture(t),{FILES,PLUGIN}=require('../src/bot/qq-builtin-offline-replies.cjs'),installed=path.join(f.work,'plugins',PLUGIN),configuration=path.join(f.configDir,'plugins',PLUGIN,'config.json');
 fs.mkdirSync(path.join(installed,'webui'),{recursive:true});for(const file of Object.keys(FILES))fs.copyFileSync(path.join(process.env.ARCADE_BUILTIN_OFFLINE_FIXTURE,file),path.join(installed,file),fs.constants.COPYFILE_EXCL);
 fs.mkdirSync(path.dirname(configuration),{recursive:true});const original='{\n "enableReply":true, "wide":9007199254740993, "private":"SYNTHETIC_PRIVATE_CONFIG"\n}\n';fs.writeFileSync(configuration,original);
 const preferences=JSON.stringify({[PLUGIN]:false,'napcat-plugin-cleaner':false});fs.writeFileSync(path.join(f.configDir,'plugins.json'),preferences);
 const invoked=[],preload=path.resolve(__dirname,'../src/preload.cjs');let bridge;
 vm.runInNewContext(fs.readFileSync(preload,'utf8'),{process:{argv:[]},require(id){assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld(name,value){assert.equal(name,'arcade');bridge=value;}},ipcRenderer:{invoke(name,value){invoked.push(name);const handler=f.handlers.get(name);assert.equal(typeof handler,'function');return handler(f.event,value);}}};}},{filename:preload});
 assert.equal((await bridge.qqPluginPackageRead(f.base)).ok,true);
 for(const suffix of ['Read','Preview','Confirm','Dismiss'])assert.equal(typeof bridge['qqPluginPackageBuiltin'+suffix],'function');
 await assert.rejects(f.invoke('BuiltinRead',f.base,{sender:{},senderFrame:{}}));
 assert.equal((await bridge.qqPluginPackageBuiltinRead({...f.base,path:configuration})).code,'invalid_request');
 const read=await bridge.qqPluginPackageBuiltinRead(f.base);assert.equal(read.ok,true,JSON.stringify(read));assert.equal(read.replySettings.before.value,true);assert.equal(read.replySettings.scope.affectedProfiles.length,2);
 const preview=await bridge.qqPluginPackageBuiltinPreview({...f.base,observationId:read.replySettings.observationId});assert.equal(preview.ok,true,JSON.stringify(preview));assert.equal(preview.replyPreview.after.value,false);
 const dismissed=await bridge.qqPluginPackageBuiltinDismiss(f.base);assert.equal(dismissed.ok,true);assert.equal(dismissed.dismissed,true);
 assert.equal((await bridge.qqPluginPackageBuiltinConfirm({...f.base,ticketId:preview.replyPreview.ticketId})).code,'stale_ticket');assert.equal((await bridge.qqPluginPackageBuiltinPreview({...f.base,observationId:read.replySettings.observationId})).code,'stale_observation');assert.equal(fs.readFileSync(configuration,'utf8'),original);
 const fresh=await bridge.qqPluginPackageBuiltinRead(f.base),planned=await bridge.qqPluginPackageBuiltinPreview({...f.base,observationId:fresh.replySettings.observationId}),change=await bridge.qqPluginPackageBuiltinConfirm({...f.base,ticketId:planned.replyPreview.ticketId});
 assert.equal(change.ok,true,JSON.stringify(change));assert.equal(change.replyChange.outcome,'committed',JSON.stringify(change));assert.equal(change.replyChange.replyDisabledVerified,true);assert.equal(change.replyChange.pluginStarted,false);assert.equal(change.accountId,'first');assert.equal(change.panelId,PANEL);
 assert.equal(fs.readFileSync(configuration,'utf8'),original.replace('"enableReply":true','"enableReply":false'));assert.equal(fs.readFileSync(path.join(f.work,'.agent-arcade-builtin-reply-backups',change.replyChange.backupId,'before.json'),'utf8'),original);assert.equal(fs.readFileSync(path.join(f.configDir,'plugins.json'),'utf8'),preferences);
 assert.equal((await bridge.qqPluginPackageBuiltinConfirm({...f.base,ticketId:planned.replyPreview.ticketId})).code,'stale_ticket');const final=await bridge.qqPluginPackageBuiltinRead(f.base);assert.equal(final.replySettings.unchanged,true);assert.equal(f.state.locks,1);assert(f.state.stoppedChecks>=3);
 assert.doesNotMatch(JSON.stringify([read,preview,change,final]),/SYNTHETIC_PRIVATE|configDir|workDir|core\.mjs/);
 for(const suffix of ['Read','Preview','Confirm','Dismiss'])assert(invoked.includes('arcade:qqPluginPackageBuiltin'+suffix));
});
