'use strict';
// Exercise production runtime-to-drawer projection, without an app or accounts.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../src/ui/qq-runtime.js'),'utf8');
function fixture(){
  const calls=[],context={language:'zh',cached:null,latest:null,formRoot:'same',orphanRoot:()=> 'same',orphanViews:new Map(),qrImage:null,dialogAccount:null,diagnosticReport:null,logsScope:null,closed:false,view:'qq-runtime',started:true,
    conversationOpening:null,navText:{},compact:{},nav:{setAttribute(){}},tr:zh=>zh,drawChanged(){},syncPolling(){},invalidateAIIntents(){},window:{arcade:{},renderQQFriendRequests:value=>calls.push(value)}};
  vm.createContext(context);
  // Sample full production entry bodies, not a frozen parameter list: acceptState
  // also takes presentation options now. DOM drawing/polling stays inert, while
  // the authoritative cached runtime and both projection calls run unchanged.
  function productionBlock(start,end){
    const head=start.exec(source);assert(head,'Production entry must still exist');
    const tail=end.exec(source.slice(head.index));assert(tail&&tail.index>0,'Production entry must have a following boundary');
    return source.slice(head.index,head.index+tail.index);
  }
  vm.runInContext(productionBlock(/^  function acceptState\(/m,/^  function drawChanged\(/m)+productionBlock(/^  window\.renderQQRuntime\s*=/m,/^  if\(data\)window\.renderQQRuntime\(data\);/m),context);
  return {context,calls,render:value=>context.window.renderQQRuntime(value)};
}
test('the actual qqRuntime snapshot reaches friend drawers on both runtime projection calls',()=>{
  const f=fixture(),accounts={selectedId:'synthetic-ju'},first={installationKind:'managed-shell',managedSetupId:'setup-a',instances:[]},second={installationKind:'managed-node',managedSetupId:'setup-b',instances:[]};
  f.render({config:{language:'zh'},accounts,qqRuntime:first});assert.equal(f.calls.length,2);for(const value of f.calls){assert.equal(value.runtime,first);assert.equal(value.accounts,accounts);}
  f.render({config:{language:'zh'},accounts,qqRuntime:second});assert.equal(f.calls.length,4);for(const value of f.calls.slice(2))assert.equal(value.runtime,second);
});
test('a snapshot without a new runtime retains the current authoritative runtime for drawer scope',()=>{
  const f=fixture(),accounts={selectedId:'synthetic-ju'},runtime={installationKind:'managed-shell',managedSetupId:'setup-a',instances:[]};
  f.render({config:{language:'zh'},accounts,qqRuntime:runtime});f.calls.length=0;f.render({config:{language:'zh'},accounts});assert.equal(f.calls.length,1);assert.equal(f.calls[0].runtime,runtime);
});

test('a stale in-flight conversation navigation does not interrupt authoritative drawer projection',()=>{
  const f=fixture(),accounts={selectedId:'synthetic-ju'},runtime={installationKind:'managed-shell',managedSetupId:'setup-a',instances:[]};
  const opening={current:()=>false,invalidated:false};f.context.conversationOpening=opening;
  f.render({config:{language:'zh'},accounts,qqRuntime:runtime});
  assert.equal(opening.invalidated,true);assert.equal(f.calls.length,2);
  for(const value of f.calls){assert.equal(value.runtime,runtime);assert.equal(value.accounts,accounts);}
});
