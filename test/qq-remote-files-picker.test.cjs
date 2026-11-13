'use strict';
// Actual main-process picker boundary. Native dialogs are inert test doubles.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const hold=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve:value=>resolve(value)};};
function fixture(){
 const state={visible:true,minimized:false,calls:[],response:{canceled:true,filePaths:[]},gate:null,assertions:0};
 const win={id:42,isDestroyed:()=>false,isVisible:()=>state.visible,isMinimized:()=>state.minimized};
 const dialog={};for(const kind of ['Open','Save'])dialog['show'+kind+'Dialog']=async(parent,options)=>{state.calls.push({kind,parent,options});return state.gate?state.gate.promise:state.response;};
 const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
  require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},dialog}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:fromMain(id)};
 vm.runInNewContext(source+'\nmodule.exports={setup:w=>{win=w;accounts={selectedId:"synthetic"};},pickRemoteTransferFiles};',context,{filename:main});
 const api=context.module.exports;api.setup(win);
 const check=()=>{state.assertions++;};
 return {state,win,pick:(kind,options={})=>api.pickRemoteTransferFiles(kind,{assertCurrent:check,...options})};
}
test('actual upload picker is parented, multi-file, no recent entry and returns only chosen paths',async()=>{
 const f=fixture(),file=path.resolve('synthetic-upload.txt');f.state.response={canceled:false,filePaths:[file]};
 assert.deepEqual(await f.pick('upload'),[file]);assert.equal(f.state.calls[0].parent,f.win);
 assert.deepEqual(Array.from(f.state.calls[0].options.properties),['openFile','multiSelections','dontAddToRecent']);assert.equal(f.state.assertions,2);
});
test('actual transfer picker cancellation makes no local read or retry',async()=>{
 const f=fixture();assert.equal(await f.pick('upload'),null);assert.equal(await f.pick('download',{suggestedName:'note.txt'}),null);assert.equal(f.state.calls.length,2);
});
test('actual picker rejects duplicate, relative, empty and over-limit upload results',async()=>{
 const f=fixture(),file=path.resolve('synthetic-upload.txt');
 for(const files of [[file,file],['relative.txt'],[],Array.from({length:21},(_,i)=>path.resolve('synthetic-'+i+'.txt'))]){f.state.response={canceled:false,filePaths:files};await assert.rejects(f.pick('upload'),e=>e.code==='file_invalid');}
});
test('late native result cannot be adopted after minimize, hide or abort',async()=>{
 for(const change of ['minimized','hidden','abort']){
  const f=fixture(),abort=new AbortController();f.state.gate=hold();const pending=f.pick('upload',{signal:abort.signal});
  if(change==='minimized')f.state.minimized=true;else if(change==='hidden')f.state.visible=false;else abort.abort();
  f.state.gate.resolve({canceled:false,filePaths:[path.resolve('must-not-be-read.txt')]});
  await assert.rejects(pending,e=>['changed','scope_unavailable'].includes(e.code));assert.equal(f.state.calls.length,1);
 }
});
test('overlapping transfer pickers share the main ownership lock and release it on completion',async()=>{
 const f=fixture();f.state.gate=hold();const pending=f.pick('upload');
 await assert.rejects(f.pick('download'),e=>e.code==='operation_in_progress');assert.equal(f.state.calls.length,1);
 f.state.gate.resolve({canceled:true,filePaths:[]});assert.equal(await pending,null);f.state.gate=null;
 assert.equal(await f.pick('download'),null);assert.equal(f.state.calls.length,2);
});
test('download suggestion cannot select a local directory, reserved device or path',async()=>{
 const f=fixture();f.state.response={canceled:false,filePath:path.resolve('synthetic-new-download.bin')};
 for(const suggestedName of ['../token.txt','C:\\credentials.txt','NUL','COM1.txt','bad\u202Etxt','..','a'.repeat(181)]){
  assert.equal(await f.pick('download',{suggestedName}),f.state.response.filePath);assert.equal(f.state.calls.at(-1).options.defaultPath,'remote-download.bin');
 }
 await f.pick('download',{suggestedName:'海边笔记.txt'});assert.equal(f.state.calls.at(-1).options.defaultPath,'海边笔记.txt');
 assert.deepEqual(Array.from(f.state.calls.at(-1).options.properties),['dontAddToRecent']);
});
test('invalid helper kind, absent guard and stale owner never open a dialog',async()=>{
 const f=fixture();await assert.rejects(f.pick('arbitrary'),e=>e.code==='invalid_request');
 await assert.rejects(f.pick('upload',{assertCurrent:null}),e=>e.code==='invalid_request');
 await assert.rejects(f.pick('upload',{assertCurrent:()=>{throw Object.assign(Error('Changed'),{code:'changed'});}}),e=>e.code==='changed');
 assert.equal(f.state.calls.length,0);
});
