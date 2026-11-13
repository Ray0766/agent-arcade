'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
function fixture(){
  let selected='whale',visible=true,minimized=false,connected=false,picks=0,picker=async()=>({canceled:false,filePaths:['C:\\PRIVATE\\QQ.exe']});
  const events={},calls=[],service={config:{mode:'deepseek'},snapshot(){return {status:'disconnected',social:{supported:false,config:{enabled:false}}};}},accounts={get(){return service;},get selectedId(){return selected;},snapshot(){return {selectedId:selected,accounts:[{id:selected,channel:'qq',status:connected?'connected':'disconnected'}]};}};
  const qqConsole={epoch:1,closed:false,busy:new Set(),runtime:{},snapshot:()=>({configured:true})};
  const win={isVisible:()=>visible,isMinimized:()=>minimized,isDestroyed:()=>false,webContents:{send(){}}};
  const coordinator={execute:async value=>{calls.push(value);return {state:{setups:[]}};},close:async()=>{}};
  const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},AbortController,setInterval,clearInterval,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(name,fn){events[name]=fn;}},dialog:{showOpenDialog:async()=>{picks++;return picker();}}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:fromMain(id)};
  vm.runInNewContext(source+'\nmodule.exports={firstSetupResult,firstSetupPanel,pickQQProgram,publish,fullSnapshot,setup:(a,w,q,b)=>{accounts=a;win=w;qqConsole=q;bot=b;}};',context,{filename:main});
  const api=context.module.exports;api.setup(accounts,win,qqConsole,service);api.firstSetupPanel.create=()=>coordinator;
  return {api,coordinator,qqConsole,calls,events,request:{accountId:'whale',panelId:'test-panel',action:'status'},
    select:v=>{selected=v;},visible:v=>{visible=v;},minimized:v=>{minimized=v;},connected:v=>{connected=v;},picker:v=>{picker=v;},get picks(){return picks;}};
}
test('main setup replies are drawer-bound and hide paths, raw error messages and arbitrary codes',async()=>{
  const f=fixture();const reply=await f.api.firstSetupResult(f.request);assert.equal(reply.ok,true);assert.equal(reply.accountId,'whale');assert.equal(reply.panelId,'test-panel');
  f.coordinator.execute=async()=>{throw Object.assign(Error('PRIVATE_PATH_TOKEN'),{code:'private_but_syntactically_valid'});};
  const rejected=await f.api.firstSetupResult(f.request);assert.equal(rejected.ok,false);assert.equal(rejected.code,'setup_failed');assert.doesNotMatch(JSON.stringify(rejected),/PRIVATE|private_but/);
  f.coordinator.execute=async()=>{throw Object.assign(Error('PRIVATE'),{code:'recovery_unconfirmed',recoveryAttempted:true,setupId:'UNTRUSTED'});};const uncertain=await f.api.firstSetupResult(f.request);assert.equal(uncertain.code,'recovery_unconfirmed');assert.equal(uncertain.recoveryAttempted,true);assert.equal(uncertain.setupId,undefined);await f.api.firstSetupPanel.close();
});
test('changing the global installation is refused while any QQ companion remains connected',async()=>{
  const f=fixture();await f.api.firstSetupResult(f.request);f.connected(true);
  for(const action of ['use','return-previous']){const reply=await f.api.firstSetupResult({...f.request,action});assert.equal(reply.code,'account_connected');}
  assert.deepEqual(f.calls,[{action:'status'}]);await f.api.firstSetupPanel.close();
});
test('selection, epoch, visibility and minimize revoke a setup panel without publishing its program',async()=>{
  for(const invalidate of [f=>f.select('other'),f=>f.qqConsole.epoch++,f=>f.visible(false),f=>f.minimized(true)]){
    const f=fixture();await f.api.firstSetupResult(f.request);invalidate(f);f.api.publish();assert.equal(f.api.firstSetupPanel.panel,null);
    assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/PRIVATE|test-panel|ticketId|qqFirstSetup/);await f.api.firstSetupPanel.close();
  }
});
test('native executable selection requires a single file and discards a result cancelled while picker was open',async()=>{
  const f=fixture(),controller=new AbortController();assert.equal(await f.api.pickQQProgram({signal:controller.signal}),'C:\\PRIVATE\\QQ.exe');
  f.picker(async()=>({canceled:false,filePaths:['one','two']}));await assert.rejects(f.api.pickQQProgram({signal:controller.signal}),{code:'invalid_request'});
  f.picker(async()=>{controller.abort();return {canceled:false,filePaths:['C:\\PRIVATE\\QQ.exe']};});await assert.rejects(f.api.pickQQProgram({signal:controller.signal}),{code:'cancelled'});
  const before=f.picks;await assert.rejects(f.api.pickQQProgram({signal:controller.signal}),{code:'cancelled'});assert.equal(f.picks,before);
});
test('preload exposes fixed setup actions, and main lifecycle closes the panel',()=>{
  const preload=fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8');
  assert(preload.includes("qqFirstSetup: value => ipcRenderer.invoke('arcade:qqFirstSetup',value)"));assert(preload.includes("qqFirstSetupClose: value => ipcRenderer.invoke('arcade:qqFirstSetupClose',value)"));
  assert(source.includes("register('qqFirstSetup',value=>firstSetupResult(value))"));assert(source.includes("register('qqFirstSetupClose',value=>firstSetupResult(value,{close:true}))"));
  // Other capabilities may register their own listeners on the same event.
  // Each lifecycle still needs the setup-panel cleanup, not every listener.
  for(const marker of ["win.on('hide'","win.on('minimize'","register('accountSelect'","register('accountCreate'"])
    assert(source.split('\n').some(line=>line.includes(marker)&&line.includes('firstSetupPanel.close()')));
});
