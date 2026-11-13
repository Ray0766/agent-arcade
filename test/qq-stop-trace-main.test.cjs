'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
function fixture(env={}){
  const calls=[];let throwOnCreate=false;
  const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env,pid:12345},AbortController,setInterval,clearInterval,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}}}:id==='./bot/qq-stop-trace.cjs'?{createQQStopTrace:options=>{calls.push(options);if(throwOnCreate)throw Error('PRIVATE');return {record:()=>true,close(){},enabled:true};}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:fromMain(id)};
  vm.runInNewContext(source+'\nmodule.exports={initializeQQStopTrace,fullSnapshot,trace:()=>qqStopTrace};',context,{filename:main});
  return {api:context.module.exports,calls,fail(){throwOnCreate=true;}};
}
test('optional stop trace is off by default and only the exact local flag enables it',()=>{
  for(const flag of [undefined,'','true','0']){
    const f=fixture(flag===undefined?{}:{AGENT_ARCADE_QQ_STOP_TRACE:flag});f.api.initializeQQStopTrace();assert.equal(f.calls.length,0);assert.equal(f.api.trace(),undefined);
  }
  const home=path.resolve('synthetic-private-home'),f=fixture({AGENT_ARCADE_HOME:home,AGENT_ARCADE_QQ_STOP_TRACE:'1',AGENT_ARCADE_QQ_STOP_TRACE_DIR:'IGNORED'});
  f.api.initializeQQStopTrace();assert.equal(f.calls.length,1);assert.equal(f.calls[0].directory,path.join(home,'diagnostics'));
  assert.match(f.calls[0].filename,/^qq-stop-trace-12345-\d+\.jsonl$/);assert.equal(f.api.trace().enabled,true);
  assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/stopTrace|diagnostics|IGNORED|synthetic-private-home/);
});
test('trace creation failures cannot prevent startup and no renderer API can activate tracing',()=>{
  const f=fixture({AGENT_ARCADE_QQ_STOP_TRACE:'1'});f.fail();assert.doesNotThrow(()=>f.api.initializeQQStopTrace());assert.equal(f.api.trace(),undefined);
  const preload=fs.readFileSync(path.resolve(__dirname,'../src/preload.cjs'),'utf8');assert.doesNotMatch(preload,/StopTrace|stopTrace|QQ_STOP_TRACE/);
});
