'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {QQOwnerRemarkPanel,ownerRemarkResult}=require('../src/bot/qq-owner-remark-panel.cjs');
const ticketId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(){
  const calls=[],controllers=[],service={},client={},runtime={},console={};
  const state={selectedId:'whale',visible:true,generation:1,clientGeneration:2,scopeId:'profile:whale',qqAccountId:'100001',ownerId:'200001',role:'鲸鱼娘',epoch:0,service,client,runtime,console};
  const request={accountId:'whale',panelId:'panel-a'};
  const capture=value=>{if(!state.visible||state.selectedId!==value.accountId)throw Object.assign(Error('PRIVATE'),{code:'changed'});if(state.busy)throw Object.assign(Error('PRIVATE'),{code:'operation_in_progress'});return {...state,...value,binding:{...state,accountId:state.qqAccountId}};};
  const panel=new QQOwnerRemarkPanel({capture,controllerFactory:options=>{
    const controller={options,closed:false,async read({signal}){calls.push('read');await this.readGate?.promise;options.getBinding();if(signal.aborted)throw Object.assign(Error('PRIVATE'),{code:'cancelled'});return this.readValue||{kind:'owner-remark',recipient:{accountId:'100001',ownerId:'200001',role:'鲸鱼娘'},editable:true,ticketId,expiresAt:Date.now()+300000,observed:{nickname:'昵称',remark:' 原值 ',fetchedAt:new Date().toISOString(),source:'bridge-cache',token:'PRIVATE'},restore:{available:false},token:'PRIVATE'};},
      async set(value,{signal}){calls.push(['set',value]);await this.writeGate?.promise;if(this.checkBeforeWrite)options.getBinding();return {kind:'owner-remark',ticketId,outcome:'accepted',observation:{state:'observed_match',remark:'新备注',fetchedAt:new Date().toISOString(),source:'bridge-cache'},privateValue:'PRIVATE',...this.writeValue};},
      async restore(value,options){calls.push(['restore',value]);return this.set(value,options);},async close(){this.closed=true;await this.closeGate?.promise;}};
    controllers.push(controller);return controller;
  }});
  return {state,panel,request,calls,controllers,capture,async read(){return panel.read(request);}};
}
test('availability projects the fixed identities only and performs no read or controller creation',()=>{
  const f=fixture(),result=f.panel.availability(f.request);assert.equal(result.available,true);assert.equal(result.recipient.accountId,'100001');assert.equal(f.controllers.length,0);assert.equal(f.calls.length,0);
  assert.doesNotMatch(JSON.stringify(result),/scopeId|client|service|runtime|原值/);f.state.selectedId='other';assert.equal(f.panel.availability(f.request).reason,'changed');
});
test('fixed requests reject arbitrary target, restore text, actions and malformed fields before dispatch',async()=>{
  const f=fixture();for(const extra of [{ownerId:'300001'},{friendId:'300001'},{action:'set_friend_remark'},{url:'ws://elsewhere'},{remark:'old'}])assert.throws(()=>f.panel.availability({...f.request,...extra}),{code:'invalid_request'});
  await f.read();await assert.rejects(f.panel.restore({...f.request,ticketId,remark:'forged'}),{code:'invalid_request'});
  await assert.rejects(f.panel.set({...f.request,ticketId,remark:'bad\nline'}),{code:'invalid_remark'});assert(!f.calls.some(Array.isArray));await f.panel.close();
});
test('read returns only a bounded exact baseline and preserves spaces instead of using a display projection',async()=>{
  const f=fixture(),result=await f.read();assert.equal(result.observed.remark,' 原值 ');assert.equal(result.ticketId,ticketId);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|scopeId|client|service/);await f.panel.close();
});
test('a changed runtime, selected service, generation, role or owner rejects a late baseline',async()=>{
  for(const key of ['runtime','console','service','client','epoch','generation','clientGeneration','scopeId','ownerId','role']){
    const f=fixture();await f.read();const c=f.controllers[0];c.readGate=deferred();const pending=f.read();await tick();f.state[key]=typeof f.state[key]==='number'?f.state[key]+1:typeof f.state[key]==='object'?{}:'changed';c.readGate.resolve();await assert.rejects(pending,{code:'changed'});await f.panel.close();
  }
});
test('closing during old controller cleanup cannot create a late new controller or baseline',async()=>{
  const f=fixture();await f.read();f.controllers[0].closeGate=deferred();const gate=f.controllers[0].closeGate;
  const request={...f.request,panelId:'panel-b'},reading=f.panel.read(request);await tick();const closed=f.panel.closeOwned(request);gate.resolve();await closed;await assert.rejects(reading,{code:'changed'});assert.equal(f.controllers.length,1);assert.equal(f.panel.panel,null);
});
test('an old close cannot discard a new panel; read on one panel retains its restore controller',async()=>{
  const f=fixture();await f.read();await f.read();assert.equal(f.controllers.length,1);const second={...f.request,panelId:'panel-b'};await f.panel.read(second);await f.panel.closeOwned(f.request);assert.equal(f.panel.panel.panelId,'panel-b');assert.equal(f.controllers[1].closed,false);await f.panel.close();
});
test('the capture guard runs again at pre-submit, including a newly started conflicting operation',async()=>{
  const f=fixture();await f.read();const c=f.controllers[0];c.checkBeforeWrite=true;c.writeGate=deferred();const pending=f.panel.set({...f.request,ticketId,remark:'新备注'});await tick();f.state.busy=true;c.writeGate.resolve();await assert.rejects(pending,{code:'operation_in_progress'});await f.panel.close();
});
test('an already accepted write remains attributed to its old panel after selection and visibility change',async()=>{
  const f=fixture();await f.read();const c=f.controllers[0];c.writeGate=deferred();const pending=f.panel.set({...f.request,ticketId,remark:'新备注'});await tick();f.state.selectedId='other';f.state.visible=false;f.panel.observe();c.writeGate.resolve();const result=await pending;
  assert.equal(result.outcome,'accepted');assert.equal(result.accountId,'whale');assert.equal(result.panelId,'panel-a');assert.equal(f.panel.panel,null);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);await f.panel.close();
});
test('restore carries only its ticket and the main projector never accepts a caller-supplied old value',async()=>{
  const f=fixture();await f.read();await f.panel.restore({...f.request,ticketId});const call=f.calls.find(row=>Array.isArray(row)&&row[0]==='restore');assert.deepEqual(call[1],{ticketId});await f.panel.close();
});
test('invalid result correlation becomes unknown; accepted survives invalid or unavailable cache observations',async()=>{
  for(const patch of [{ticketId:'wrong'},{kind:'other'},{outcome:'unexpected'}]){const f=fixture();await f.read();f.controllers[0].writeValue=patch;assert.equal((await f.panel.set({...f.request,ticketId,remark:'新备注'})).outcome,'unknown');await f.panel.close();}
  const f=fixture();await f.read();f.controllers[0].writeValue={observation:{state:'observed_match',remark:'x'.repeat(1000),fetchedAt:new Date().toISOString(),source:'bridge-cache'}};const result=await f.panel.set({...f.request,ticketId,remark:'新备注'});assert.equal(result.outcome,'accepted');assert.equal(result.observation.state,'unavailable');await f.panel.close();
});
test('unsupported originals stay withheld, with no edit ticket or restoration value',async()=>{
  const f=fixture();await f.read();f.controllers[0].readValue={kind:'owner-remark',recipient:{accountId:'100001',ownerId:'200001',role:'鲸鱼娘'},editable:false,reason:'original_unsupported',observed:{nickname:'昵称',withheld:true,remark:'PRIVATE',fetchedAt:new Date().toISOString(),source:'bridge-cache'},restore:{available:true,value:'PRIVATE'},ticketId};
  const result=await f.read();assert.equal(result.editable,false);assert.equal(result.observed.withheld,true);assert.equal(result.ticketId,undefined);assert.equal(result.restore.available,false);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);await f.panel.close();
});
test('IPC result errors are fixed categories, without raw error contents',async()=>{
  assert.deepEqual(await ownerRemarkResult(()=>{throw Object.assign(Error('PRIVATE TOKEN'),{code:'private_value'});}),{ok:false,code:'unavailable'});
});
