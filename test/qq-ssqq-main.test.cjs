'use strict';
// Actual main/preload wiring with a synthetic session/window. Native view tests are separate.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main),PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
function fixture(){
 const calls=[],handlers=new Map(),state={zoom:1.25,size:[1200,830],visible:true,minimized:false,picker:{canceled:true,filePaths:[]},closeFailure:false},events={};let options;
 class Session{constructor(o){options=o;}get accountId(){return 'ju';}read(v){calls.push(['read',v]);return {accountId:v.accountId,panelId:v.panelId,state:{status:'closed',viewId:null,preparedId:null},prepared:[]};}prepare(v){calls.push(['prepare',v]);return this.read(v);}open(v){calls.push(['open',v]);return {state:{status:'loaded',viewId:PANEL,preparedId:PANEL}};}setBounds(v){calls.push(['bounds',v]);return {updated:true};}closeOwned(v){calls.push(['close',v]);return {closed:true};}observe(){calls.push(['observe']);}async closeCurrent(){calls.push(['closeCurrent']);if(state.closeFailure)throw Error('synthetic close failure');return {closed:true};}close(){return this.closeCurrent();}}
 const win={isVisible:()=>state.visible,isMinimized:()=>state.minimized,isDestroyed:()=>false,getContentSize:()=>state.size,on:(name,fn)=>{events[name]=fn;},webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href},getZoomFactor:()=>state.zoom,isDestroyed:()=>false,send:(...v)=>calls.push(['state',...v])}};
 const safeResult=async(input,fn)=>{try{return {ok:true,...await fn()};}catch(e){return {ok:false,code:e.code||'unavailable'};}};
 const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
 require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},ipcMain:{handle(name,fn){handlers.set(name,fn);}},dialog:{async showOpenDialog(){calls.push(['picker']);return state.picker;}}}:id==='./core/files.cjs'?{readJSON:(_f,v)=>v,atomicJSON(){},drainInbox:()=>[]}:id==='./bot/qq-ssqq-session.cjs'?{QQSSQQSession:Session,ssqqResult:safeResult}:id==='./bot/qq-ssqq-view.cjs'?{QQSSQQView:class{}}:fromMain(id)};
 vm.runInNewContext(source+'\nmodule.exports={registerSSQQHandlers,closePluginPanels,pickSSQQArchive,observePluginPanels,setup:w=>{win=w;}};',context,{filename:main});
 const api=context.module.exports;api.setup(win);api.registerSSQQHandlers();const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
 let bridge;
 const rendererIPC={invoke:(name,value)=>handlers.get(name)(event,value),on(name,fn){events[name]=fn;},removeListener(name,fn){if(events[name]===fn)delete events[name];}};
 vm.runInNewContext(fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8'),{process:{argv:[]},require:()=>({contextBridge:{exposeInMainWorld(_n,v){bridge=v;}},ipcRenderer:rendererIPC})});
 // Main checks plain object identity in its own realm, as real structured IPC does.
 const input=extra=>vm.runInNewContext('('+JSON.stringify({accountId:'ju',panelId:PANEL,...extra})+')',context);
 return {calls,state,handlers,event,events,options,api,bridge,input};
}
test('five actual preload/main routes retain correlation and never select renderer endpoint/token',async()=>{
 const f=fixture();for(const name of ['Read','Prepare','Close'])assert.equal((await f.bridge['qqSSQQ'+name](f.input())).ok,true);
 assert.deepEqual(f.calls.filter(x=>['read','prepare','close'].includes(x[0])).map(x=>x[0]),['read','prepare','read','close']);
 const value=f.input({preparedId:PANEL,bounds:{x:80,y:100,width:800,height:500}});assert.equal((await f.bridge.qqSSQQOpen(value)).ok,true);
 assert.deepEqual(JSON.parse(JSON.stringify(f.calls.find(x=>x[0]==='open')[1].bounds)),{x:100,y:125,width:1000,height:625});
 assert.equal((await f.bridge.qqSSQQBounds(f.input({viewId:PANEL,bounds:{x:80,y:100,width:800,height:500}}))).ok,true);
 assert(!f.calls.some(x=>JSON.stringify(x).includes('token')));
});
test('out-of-bounds, invisible and untrusted renderer calls never reach the native view',async()=>{
 const f=fixture();for(const bounds of [{x:0,y:0,width:800,height:500},{x:0,y:100,width:2000,height:500},{x:0,y:100,width:800,height:1000},{x:0,y:100,width:20,height:500}])assert.equal((await f.bridge.qqSSQQOpen(f.input({preparedId:PANEL,bounds}))).ok,false);
 f.state.visible=false;assert.equal((await f.bridge.qqSSQQOpen(f.input({preparedId:PANEL,bounds:{x:80,y:100,width:800,height:500}}))).ok,false);
 await assert.rejects(f.handlers.get('arcade:qqSSQQRead')({...f.event,sender:{}},f.input()),/Untrusted/);assert(!f.calls.some(x=>x[0]==='open'||x[0]==='read'));
});
test('state subscription is removable and plugin teardown retains an unconfirmed close',async()=>{
 const f=fixture();let observed;const unsubscribe=f.bridge.onQQSSQQState(v=>{observed=v;});f.events['arcade:ssqqState']({},'synthetic');assert.equal(observed,'synthetic');unsubscribe();assert.equal(f.events['arcade:ssqqState'],undefined);
 f.state.closeFailure=true;await assert.rejects(f.api.closePluginPanels(),/synthetic close failure/);f.state.closeFailure=false;await f.api.closePluginPanels();assert.equal(f.calls.filter(x=>x[0]==='closeCurrent').length,2);
});
test('native archive selection checks ownership again and preserves cancel',async()=>{
 const f=fixture();let assertions=0;assert.equal(await f.api.pickSSQQArchive({},{signal:new AbortController().signal,assertCurrent(){assertions++;}}),null);assert.equal(assertions,2);
 f.state.picker={canceled:false,filePaths:[path.resolve('synthetic-ssqq.zip')]};await assert.rejects(f.api.pickSSQQArchive({},{signal:new AbortController().signal,assertCurrent(){if(++assertions>3)throw Error('scope changed');}}),/scope changed/);
});
