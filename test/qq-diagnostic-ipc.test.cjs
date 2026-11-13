'use strict';
// Executes the real main functions/IPC registration with inert Electron and a
// synthetic classified-event source. No QQ connection, raw log or vault reads.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const reportModule=require('../src/bot/qq-diagnostic-report.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main),accountId='123456789';
const plain=value=>JSON.parse(JSON.stringify(value));
function fixture(t,{writer}={}){
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-qq-diagnostic-ipc-')),file=path.join(dir,'report.json'),handlers=new Map(),calls=[];
  t.after(()=>{assert(dir.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  const content={mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href}},window={webContents:content,isVisible:()=>true,isMinimized:()=>false,isDestroyed:()=>false};
  const row={accountId,processRunning:true,management:'owned',runtimeRevision:'synthetic-runtime',login:{state:'online',online:true},nickname:'synthetic-private-nickname',ownerId:'987654321',bridges:[{url:'ws://127.0.0.1:5555',token:'synthetic-private-token'}]};
  const console={runtime:{},epoch:1,refreshRevision:0,selectionDigest:'synthetic-selection',closed:false,busy:new Set(),state:{installationKind:'legacy',componentsRoot:'C:/synthetic-private/path',components:{available:true,napcatVersion:'4.18.42'},instances:[row]},async perform(kind,args){calls.push([kind,args.accountId]);return {accountId,source:'diagnostic-events',rawMessagesIncluded:false,events:[{type:'session_expired',time:'11-05 22:30:27',text:'synthetic-private-message'}]};}};
  const accounts={selectedId:'synthetic-profile'},bot={generation:1};let picker=async()=>({canceled:false,filePath:file}),picked=0;
  const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{},platform:'win32'},URL,AbortController,setInterval,clearInterval,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)},dialog:{showSaveDialog:async(_win,options)=>{picked++;assert.equal(options.defaultPath,'qq-diagnostics.json');return picker();}}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){throw Error('old unchecked writer must not be used');},drainInbox:()=>[]}:id==='./bot/qq-diagnostic-report.cjs'?{...reportModule,...(writer?{writeQQDiagnosticReport:writer}:{})}:fromMain(id)};
  vm.runInNewContext(source+`\nmodule.exports={setup:(w,c,a,b)=>{win=w;qqConsole=c;accounts=a;bot=b;},bind:registerQQDiagnosticHandlers,observe:observeQQDiagnosticCache,clear:clearQQDiagnosticCache,quit:value=>{quitting=value;}};`,context,{filename:main});
  context.module.exports.setup(window,console,accounts,bot);context.module.exports.bind();const event={sender:content,senderFrame:content.mainFrame};
  return {dir,file,calls,window,console,row,accounts,bot,api:context.module.exports,setPicker:value=>{picker=value;},get picked(){return picked;},invoke:(name,value={accountId},override=event)=>handlers.get(`arcade:${name}`)(override,value),event};
}
const load=f=>f.invoke('qqRuntimeLogs');
const save=f=>f.invoke('qqRuntimeExportDiagnostics');

test('real main view then save exports only the projected report; export never rereads classified logs',async t=>{
  const f=fixture(t),view=await load(f);assert.equal(view.ok,true);assert.equal(f.calls.length,1);const result=await save(f);
  assert.deepEqual(plain(result),{ok:true,accountId,saved:true,schema:reportModule.SCHEMA});assert.equal(f.calls.length,1);assert.equal(f.picked,1);
  const body=fs.readFileSync(f.file,'utf8'),parsed=JSON.parse(body);assert.equal(parsed.events[0].type,'session_expired');assert.equal(parsed.account.alias,'selected-account');
  for(const marker of [accountId,'987654321','synthetic-private','127.0.0.1','5555','synthetic-profile','synthetic-runtime','synthetic-selection'])assert(!body.includes(marker),marker);
});
test('native cancellation saves nothing and returns cancellation rather than failure',async t=>{
  const f=fixture(t);await load(f);f.setPicker(async()=>({canceled:true}));assert.deepEqual(plain(await save(f)),{ok:true,accountId,saved:false,cancelled:true});assert(!fs.existsSync(f.file));
});
test('invalid request, account and untrusted renderer cannot open a save dialog',async t=>{
  const f=fixture(t);for(const value of [null,{},[],{accountId,filename:'private.json'},{accountId:123456789},{accountId:'00000'}]){const result=await f.invoke('qqRuntimeExportDiagnostics',value);assert.equal(result.code,'invalid_request');}
  assert.equal((await save(f)).code,'diagnostics_unavailable');await assert.rejects(f.invoke('qqRuntimeLogs',{accountId},{sender:{},senderFrame:f.event.senderFrame}),/Untrusted sender/);assert.equal(f.picked,0);assert.equal(f.calls.length,0);
});
test('another account cannot use the selected report; matching report requires exact diagnostic identity',async t=>{
  const f=fixture(t);await load(f);assert.equal((await f.invoke('qqRuntimeExportDiagnostics',{accountId:'222223333'})).code,'diagnostics_unavailable');
  f.console.perform=async()=>({accountId:'222223333',source:'diagnostic-events',rawMessagesIncluded:false,events:[]});assert.equal((await load(f)).code,'report_invalid');assert.equal((await save(f)).code,'diagnostics_unavailable');assert.equal(f.picked,0);
});
test('runtime, epoch, profile, service, login and configuration changes during save are rejected before write',async t=>{
  for(const [name,mutate]of Object.entries({runtime:f=>f.console.runtime={},epoch:f=>f.console.epoch++,profile:f=>f.accounts.selectedId='other-profile',service:f=>f.bot.generation++,login:f=>f.row.login.state='offline',revision:f=>f.console.refreshRevision++,hidden:f=>f.window.isVisible=()=>false,quitting:f=>f.api.quit(true),busy:f=>f.console.busy.add('qq-components')})){
    await t.test(name,async t=>{const f=fixture(t);await load(f);f.setPicker(async()=>{mutate(f);return {canceled:false,filePath:f.file};});const result=await save(f);assert.equal(result.ok,false);assert(['changed','operation_in_progress'].includes(result.code));assert.equal(result.saved,false);assert(!fs.existsSync(f.file));});
  }
});
test('clearing after account/window change prevents an A-to-B-to-A saved report from reviving',async t=>{
  const f=fixture(t);await load(f);f.setPicker(async()=>{f.accounts.selectedId='other';f.api.observe();f.accounts.selectedId='synthetic-profile';return {canceled:false,filePath:f.file};});assert.equal((await save(f)).code,'changed');assert(!fs.existsSync(f.file));
  await load(f);f.api.clear();assert.equal((await save(f)).code,'diagnostics_unavailable');
});
test('a stale pending log read cannot repopulate a cleared diagnostic capability',async t=>{
  const f=fixture(t);let resolve;f.console.perform=()=>new Promise(r=>{resolve=r;});const pending=load(f);f.api.clear();resolve({accountId,source:'diagnostic-events',rawMessagesIncluded:false,events:[]});assert.equal((await pending).code,'changed');assert.equal((await save(f)).code,'diagnostics_unavailable');
});
test('one native save at a time; pending capture replacement cannot publish the old report',async t=>{
  const f=fixture(t);await load(f);let resolve;f.setPicker(()=>new Promise(r=>{resolve=r;}));const pending=save(f);assert.equal((await save(f)).code,'operation_in_progress');await load(f);resolve({canceled:false,filePath:f.file});assert.equal((await pending).code,'changed');assert(!fs.existsSync(f.file));assert.equal(f.picked,1);
});
test('filesystem and dialog errors never expose raw paths; publication uncertainty stays explicit',async t=>{
  const f=fixture(t);await load(f);f.setPicker(async()=>{throw Error('synthetic-private-path C:/private');});const result=await save(f);assert.equal(result.code,'save_failed');assert(!JSON.stringify(result).includes('private'));
  const u=fixture(t,{writer:()=>{const error=new reportModule.QQDiagnosticError('save_unconfirmed');error.saveAttempted=true;throw error;}});await load(u);assert.deepEqual(plain(await save(u)),{ok:false,accountId,saved:null,code:'save_unconfirmed',saveAttempted:true});
});
test('actual preload forwards only the fixed diagnostic action without a path-selecting API',async()=>{
  const preload=fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),calls=[];let api;
  vm.runInNewContext(preload,{require:id=>{assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld:(name,value)=>{assert.equal(name,'arcade');api=value;}},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return {ok:true};},on(){},removeListener(){}}};}});
  assert.equal(typeof api.qqRuntimeExportDiagnostics,'function');assert.equal((await api.qqRuntimeExportDiagnostics({accountId})).ok,true);assert.deepEqual(calls,[['arcade:qqRuntimeExportDiagnostics',{accountId}]]);assert.equal(api.invoke,undefined);
});
