'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {EventEmitter}=require('node:events');
const mainFile=path.resolve(__dirname,'../src/main.cjs'),fromMain=createRequire(mainFile),mainSource=fs.readFileSync(mainFile,'utf8');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function harness(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-entrypoint-')),profile=path.join(root,'original-profile');fs.mkdirSync(profile);fs.writeFileSync(path.join(profile,'Local State'),'synthetic profile marker, never parsed by main');
  t.after(()=>{assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const calls=[],dialogs=[],old={status:'disconnected',generation:0},next={status:'disconnected'},ticket={id:'registered',service:old};
  const accounts={current:()=>next,captureCredentialMigration(id){assert.equal(id,'registered');calls.push({kind:'capture',id});return ticket;},assertCredentialMigration(value){assert.equal(value,ticket);if(old.status!=='disconnected')throw Error('companion changed');},async migrateCredentials(value,migrate){this.assertCredentialMigration(value);calls.push({kind:'migrate'});return migrate({sourceRoot:root,targetRoot:path.join(root,'credential-profiles','registered'),registeredRoots:[root]});}};
  const dialog={showOpenDialog:async(_window,options)=>{dialogs.push(options);return {canceled:false,filePaths:[profile]};}},safeStorage={tag:'synthetic-safe-storage'};
  const context={__dirname:path.dirname(mainFile),module:{exports:{}},process:{argv:[],env:{},execPath:path.join(root,'synthetic-electron.exe')},setInterval,clearInterval,
    require:id=>{
      if(id==='electron')return {app:{requestSingleInstanceLock:()=>false,quit(){},on(){},isPackaged:false,getAppPath:()=>path.resolve(__dirname,'..')},dialog,safeStorage};
      if(id==='./core/files.cjs')return {readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]};
      if(id==='./bot/vault-migration.cjs')return {migrateApplicationVault:async options=>{calls.push({kind:'worker',options});return {migrated:true};}};
      return fromMain(id);
    }};
  vm.runInNewContext(mainSource+'\nmodule.exports={accountMigrateCredentials,setup:a=>{accounts=a;bot=a.current();},current:()=>bot};',context,{filename:mainFile});context.module.exports.setup(accounts);
  return {api:context.module.exports,root,profile,old,next,calls,dialogs,dialog,safeStorage};
}

test('main migration uses only the user-chosen original profile and the captured registered account',async t=>{
  const h=harness(t);const result=await h.api.accountMigrateCredentials('registered');assert.equal(result.migrated,true);
  assert.equal(h.dialogs.length,1);assert.match(h.dialogs[0].title,/Local State/);
  const options=h.calls.find(x=>x.kind==='worker').options;assert.equal(options.sourceProfile,h.profile);assert.equal(options.sourceRoot,h.root);assert.equal(options.vault,h.safeStorage);assert.equal(options.electronPath,path.join(h.root,'synthetic-electron.exe'));assert.equal(options.devAppPath,path.resolve(__dirname,'..'));assert.equal(h.api.current(),h.next);
});

test('cancelling the profile picker does not run or change a migration',async t=>{
  const h=harness(t);h.dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});const result=await h.api.accountMigrateCredentials('registered');assert.equal(result.cancelled,true);assert.equal(h.calls.some(x=>x.kind==='migrate'||x.kind==='worker'),false);
});

test('changing the captured account while the profile picker is open prevents migration',async t=>{
  const h=harness(t);let finish;h.dialog.showOpenDialog=()=>new Promise(resolve=>{finish=resolve;});const pending=h.api.accountMigrateCredentials('registered');await tick();h.old.status='connected';finish({canceled:false,filePaths:[h.profile]});await assert.rejects(pending,/companion changed/);assert.equal(h.calls.some(x=>x.kind==='worker'),false);
});

test('the profile picker cannot substitute a data folder without Local State',async t=>{
  const h=harness(t);h.dialog.showOpenDialog=async()=>({canceled:false,filePaths:[h.root]});await assert.rejects(h.api.accountMigrateCredentials('registered'),/Local State/);assert.equal(h.calls.some(x=>x.kind==='worker'),false);
});

function bootstrapHarness({worker=false}={}){
  const source=fs.readFileSync(path.resolve(__dirname,'../src/bootstrap.cjs'),'utf8'),app=new EventEmitter();
  const loaded=[],exits=[],calls={worker:0,guard:0,main:0,close:0,stdio:0};let resolveGuard;
  const deferred=new Promise(resolve=>{resolveGuard=resolve;});
  Object.assign(app,{isReady:()=>false,exit:code=>exits.push(code),quit:()=>app.emit('will-quit')});
  const context={module:{exports:{}},setImmediate,process:{argv:worker?['electron','--arcade-vault-migration-worker']:['electron'],cwd:()=> 'synthetic-application-root'},require:id=>{
    loaded.push(id);
    if(id==='./bot/vault-migration-worker.cjs')return {run:async()=>{calls.worker++;return 'worker-only';}};
    if(id==='./core/desktop-stdio.cjs')return {guardDesktopOutput:()=>{calls.stdio++;}};
    if(id==='./core/app-identity.cjs')return require('../src/core/app-identity.cjs');
    if(id==='electron')return {app,BrowserWindow:{getAllWindows:()=>[]},dialog:{showErrorBox:()=>assert.fail('Unexpected bootstrap error')}};
    if(id==='./core/single-instance.cjs')return {acquireSingleInstance:options=>{calls.guard++;assert.equal(typeof options.onRaise,'function');assert.equal(typeof options.onLost,'function');return deferred;}};
    if(id==='./main.cjs'){calls.main++;return {};}
    throw Error('Unexpected bootstrap dependency');
  }};
  vm.runInNewContext(source,context);
  return {app,loaded,exits,calls,completion:context.module.exports,resolveGuard:primary=>resolveGuard({primary,close:async()=>{calls.close++;}})};
}

test('bootstrap dispatches the credential worker without loading Electron, the desktop guard or normal main',async()=>{
  const h=bootstrapHarness({worker:true});assert.equal(await h.completion,'worker-only');assert.deepEqual(h.loaded,['./bot/vault-migration-worker.cjs']);assert.equal(h.calls.worker,1);assert.equal(h.calls.guard,0);assert.equal(h.calls.main,0);assert.equal(h.app.eventNames().length,0);
  assert.equal(require('../package.json').main,'src/bootstrap.cjs');
});

test('normal bootstrap waits for primary ownership before loading application main',async()=>{
  const h=bootstrapHarness();await tick();assert.deepEqual(h.loaded,['./core/desktop-stdio.cjs','electron','./core/app-identity.cjs','./core/single-instance.cjs']);assert.equal(h.calls.stdio,1);assert.equal(h.calls.guard,1);assert.equal(h.calls.main,0);assert.equal(h.calls.worker,0);assert.equal(h.app.listenerCount('will-quit'),1);
  h.resolveGuard(true);await h.completion;assert.equal(h.calls.main,1);assert.deepEqual(h.loaded,['./core/desktop-stdio.cjs','electron','./core/app-identity.cjs','./core/single-instance.cjs','./main.cjs']);assert.deepEqual(h.exits,[]);
  h.app.emit('will-quit');await tick();assert.equal(h.calls.close,1);
});

test('secondary bootstrap exits without loading normal main or starting migration',async()=>{
  const h=bootstrapHarness();await tick();assert.equal(h.calls.main,0);h.resolveGuard(false);await h.completion;
  assert.deepEqual(h.exits,[0]);assert.equal(h.calls.main,0);assert.equal(h.calls.worker,0);assert.equal(h.calls.close,0);assert.deepEqual(h.loaded,['./core/desktop-stdio.cjs','electron','./core/app-identity.cjs','./core/single-instance.cjs']);
});

test('preload exposes only a migration command with the selected account id',async()=>{
  let api;const calls=[];vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{require:id=>{assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return {migrated:true};}}};}});
  await api.accountMigrateCredentials('registered');assert.deepEqual(calls,[['arcade:accountMigrateCredentials','registered']]);
});
