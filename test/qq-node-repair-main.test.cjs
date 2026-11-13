'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),{createRequire}=require('node:module');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
function fixture(){
 const calls=[],win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},isDestroyed:()=>false,webContents:{send(){}}};
 const service={config:{mode:'deepseek'},snapshot:()=>({status:'disconnected',social:{supported:false,config:{enabled:false}}})};
 const accounts={selectedId:'fixture-one',get:()=>service,snapshot(){return {selectedId:this.selectedId,accounts:[{id:'fixture-one',name:'Fixture\nOne',channel:'qq',apiKey:'SECRET'},{id:'fixture-two',name:'Hidden other channel',channel:'wechat'}]};}};
 const console={epoch:1,closed:false,busy:new Set(),runtime:null,snapshot:()=>({configured:false,canInspectNodeRepair:true})};
 const manager={nodeRepair:{observe(){calls.push('observe');},async dismissCurrent(){calls.push('dismiss');return {closed:true};}},snapshot:()=>({busy:false})};
 const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},AbortController,setInterval,clearInterval,require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}}}:id==='./core/files.cjs'?{readJSON:(_f,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:fromMain(id)};
 vm.runInNewContext(source+'\nmodule.exports={captureNodeRepairUI,dismissNodeRepair,publish,setup:(a,w,q,b,c)=>{accounts=a;win=w;qqConsole=q;bot=b;qqComponents=c;}};',context,{filename:main});
 const api=context.module.exports;api.setup(accounts,win,console,service,manager);return {api,accounts,win,console,manager,calls};
}
test('actual main capture uses selected companion and bounded labels, never account keys or arbitrary paths',()=>{
 const f=fixture(),capture=JSON.parse(JSON.stringify(f.api.captureNodeRepairUI()));assert.deepEqual(capture,{key:'fixture-one',profiles:[{profileId:'fixture-one',label:'FixtureOne'}]});assert.doesNotMatch(JSON.stringify(capture),/SECRET|apiKey|Hidden/);f.accounts.selectedId='fixture-next';assert.equal(f.api.captureNodeRepairUI().key,'fixture-next');
});
test('actual main repair capture rejects hidden, minimized and closed-console contexts',()=>{
 for(const mutate of [f=>f.win.visible=false,f=>f.win.minimized=true,f=>f.console.closed=true]){const f=fixture();mutate(f);assert.throws(()=>f.api.captureNodeRepairUI(),{code:'changed'});}
});
test('actual main publication observes repair lifecycle and explicit dismiss awaits owned cleanup',async()=>{
 const f=fixture();f.api.publish();assert(f.calls.includes('observe'));let finish;f.manager.nodeRepair.dismissCurrent=()=>new Promise(r=>finish=r);let done=false;const pending=f.api.dismissNodeRepair().then(r=>{done=true;return r;});await Promise.resolve();assert.equal(done,false);finish({closed:true});assert.equal((await pending).closed,true);
});
