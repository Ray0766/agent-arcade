'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {QQFirstSetupPanel}=require('../src/bot/qq-first-setup-panel.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
function fixture(){
  let binding='visible:whale:epoch1',made=0,closed=0;const calls=[];
  const coordinator={async execute(value){calls.push(value);return {status:'ready'};},async close(){closed++;}};
  const panel=new QQFirstSetupPanel({capture(){if(!binding)throw Object.assign(Error('private'),{code:'changed'});return binding;},create(options){made++;coordinator.capture=options.capture;return coordinator;}});
  const request={accountId:'whale',panelId:'setup-1',action:'status'};
  return {panel,coordinator,request,calls,setBinding:value=>{binding=value;},get made(){return made;},get closed(){return closed;}};
}
test('only a visible status request creates a setup session and transport context is stripped',async()=>{
  const f=fixture();await assert.rejects(f.panel.execute({...f.request,action:'create'}),{code:'preview_required'});assert.equal(f.made,0);
  await f.panel.execute(f.request);await f.panel.execute(f.request);assert.equal(f.made,1);assert.deepEqual(f.calls,[{action:'status'},{action:'status'}]);
  await assert.rejects(f.panel.execute({...f.request,panelId:'another'}),{code:'changed'});assert.equal(f.calls.length,2);
  f.setBinding('');f.panel.observe();await f.panel.close();assert.equal(f.closed,1);
});
test('invalid panel requests cannot reach a coordinator',async()=>{
  const f=fixture();for(const value of [null,[],{}, {...f.request,accountId:1},{...f.request,panelId:'../secret'},{...f.request,action:null}])await assert.rejects(f.panel.execute(value),{code:'invalid_request'});
  assert.equal(f.made,0);
});
test('late close from an old drawer cannot close a new one',async()=>{
  const f=fixture();await f.panel.execute(f.request);await f.panel.closeOwned({accountId:'whale',panelId:'setup-1'});
  await f.panel.execute({...f.request,panelId:'setup-2'});await f.panel.closeOwned({accountId:'whale',panelId:'setup-1'});
  assert.equal(f.panel.panel.panelId,'setup-2');assert.equal(f.closed,1);await f.panel.close();
});
test('in-flight read is invalidated on close, and reopening waits for cleanup',async()=>{
  const f=fixture(),read=deferred(),cleanup=deferred();await f.panel.execute(f.request);
  f.coordinator.execute=()=>read.promise;f.coordinator.close=()=>cleanup.promise;
  const pending=f.panel.execute({...f.request,action:'choose-program'});const closed=f.panel.close();
  await assert.rejects(f.panel.execute({...f.request,panelId:'setup-2'}),{code:'operation_in_progress'});
  assert.throws(()=>f.coordinator.capture(),{code:'changed'});read.resolve({program:{version:'1.2.3'}});await assert.rejects(pending,{code:'changed'});
  cleanup.resolve();await closed;
});
test('an acknowledged mutation stays committed when installation epoch changes',async()=>{
  const f=fixture(),mutation=deferred();await f.panel.execute(f.request);f.coordinator.execute=()=>mutation.promise;
  const pending=f.panel.execute({...f.request,action:'use',setupId:'fixture'});f.setBinding('visible:whale:epoch2');
  mutation.resolve({committed:true,automaticStart:false,refreshIssue:'changed'});
  assert.deepEqual(await pending,{committed:true,automaticStart:false,refreshIssue:'changed'});f.panel.observe();await f.panel.close();
});
test('a failed noncommitted result never survives a binding change',async()=>{
  const f=fixture(),read=deferred();await f.panel.execute(f.request);f.coordinator.execute=()=>read.promise;
  const pending=f.panel.execute({...f.request,action:'status'});f.setBinding('other');read.resolve({ok:false,code:'changed'});await assert.rejects(pending,{code:'changed'});await f.panel.close();
});
