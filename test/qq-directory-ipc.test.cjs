'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {validateDirectoryRequest}=require('../src/bot/qq-console.cjs');
const source=fs.readFileSync(path.join(__dirname,'../src/main.cjs'),'utf8');
const start=source.indexOf("    register('qqRuntimeDirectory'"),end=source.indexOf("    register('qqRuntimeBackups'",start);assert(start>=0&&end>start);
const replyStart=source.indexOf('    const qqResult='),replyEnd=source.indexOf('    const qqArguments=',replyStart);assert(replyStart>=0&&replyEnd>replyStart);
function fixture(){
  const calls=[],handlers=new Map(),qqConsole={directory:async(accountId,options)=>{calls.push({accountId,options});return {accountId,kind:options.kind,items:[],fetchedAt:'2026-11-06T01:00:00Z',source:'bridge-cache'};}};
  vm.runInNewContext(source.slice(replyStart,replyEnd)+source.slice(start,end),{register:(name,handler)=>handlers.set(name,handler),validateDirectoryRequest,qqConsole});
  return {calls,qqConsole,invoke:handlers.get('qqRuntimeDirectory')};
}
test('production IPC validates the fixed account-bound directory selection before calling the coordinator',async()=>{
  const f=fixture();for(const value of [null,{accountId:'12345001',kind:'friends',action:'get_cookies'},{accountId:'12345001',kind:'groups',url:'private'},{accountId:'12345001',kind:'friends',fresh:'true'}])assert.deepEqual(JSON.parse(JSON.stringify(await f.invoke(value))),{ok:false,code:'invalid_config'});
  assert.equal(f.calls.length,0);const result=await f.invoke({accountId:'12345001',kind:'friends',serverName:'selected'});assert.equal(result.ok,true);assert.equal(result.directory.accountId,'12345001');assert.equal(f.calls[0].options.fresh,false);assert.equal(f.calls[0].options.serverName,'selected');assert.equal(Object.hasOwn(f.calls[0].options,'accountId'),false);
});
test('production error wrapper never exposes upstream bodies or secrets to the page',async()=>{
  const f=fixture();f.qqConsole.directory=async()=>{throw Object.assign(Error('PRIVATE_TOKEN_AND_CONTACT_BODY'),{code:'account_changed'});};assert.deepEqual(JSON.parse(JSON.stringify(await f.invoke({accountId:'12345001',kind:'groups'}))),{ok:false,code:'account_changed'});
  f.qqConsole.directory=async()=>{throw Object.assign(Error('PRIVATE_RAW_MESSAGE'),{code:'contains spaces and private data'});};assert.deepEqual(JSON.parse(JSON.stringify(await f.invoke({accountId:'12345001',kind:'groups'}))),{ok:false,code:'operation_failed'});
});
test('preload exposes one fixed directory command without exposing a generic QQ action or transport',async()=>{
  let api;const calls=[];vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/preload.cjs'),'utf8'),{require:id=>{assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld:(_name,value)=>{api=value;}},ipcRenderer:{invoke:async(...args)=>{calls.push(args);return {ok:true};}}};}});
  const value={accountId:'12345001',kind:'friends'};await api.qqRuntimeDirectory(value);assert.equal(calls[0][0],'arcade:qqRuntimeDirectory');assert.equal(calls[0][1],value);assert.equal(api.qqRequest,undefined);assert.equal(api.qqAction,undefined);
});
