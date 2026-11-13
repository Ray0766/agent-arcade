'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {QQOwnerRemarkPanel}=require('../src/bot/qq-owner-remark-panel.cjs');
const {QQOwnerRemark}=require('../src/bot/qq-owner-remark.cjs');
const {QQOwnerRemarkSession}=require('../src/bot/qq-owner-remark-session.cjs');
const {fixture,ACCOUNT,OWNER,PANEL,flush,deferred}=require('./helpers/qq-owner-remark-session-fixture.cjs');
const NEXT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

test('availability is local metadata only; disconnected AI reads, changes and restores using its own socket',async t=>{
  const f=await fixture(t),before=f.state.requests.length;
  const available=f.manager.availability(f.input);assert.equal(available.available,true);assert.equal(available.recipient.accountId,ACCOUNT);assert.equal(f.state.requests.length,before);assert.equal(f.state.created.length,0);
  const original=f.state.remark,row=await f.read(),owned=f.manager.session.client;
  assert.notEqual(owned,f.otherClient);assert.equal(owned.receiveOwnerMessages,false);assert.equal(owned.allowOwnerVoice,false);assert.equal(f.stable.status,'disconnected');assert.equal(row.accountId,f.input.accountId);assert.equal(row.recipient.ownerId,OWNER);assert.equal(row.observed.remark,original);assert.doesNotMatch(JSON.stringify(row),/PRIVATE_OTHER/);
  const changed=await f.set(row,' New 🐳 ');assert.equal(changed.outcome,'accepted');assert.equal(changed.observation.state,'observed_match');assert.equal(changed.recipient.accountId,ACCOUNT);assert.equal(changed.recipient.ownerId,OWNER);
  const again=await f.read();assert.deepEqual(again.restore,{available:true,value:original});const restored=await f.manager.restore({...f.input,ticketId:again.ticketId});assert.equal(restored.outcome,'accepted');assert.equal(f.state.remark,original);assert.deepEqual(f.writes().map(r=>r.params),[{user_id:OWNER,remark:' New 🐳 '},{user_id:OWNER,remark:original}]);
  await f.manager.closeOwned(f.input);assert.equal(owned.closed,true);assert.equal(f.otherClient.ready,true);assert.equal(f.stable.status,'disconnected');
});
test('connected AI also uses an independent client; private messages never enter its queue',async t=>{
  const f=await fixture(t);f.stable.status='connected';await f.read();const owned=f.manager.session.client;
  for(const socket of f.server.clients)socket.send(JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:ACCOUNT,user_id:OWNER,message_id:11,time:Math.floor(Date.now()/1000),message:[{type:'text',data:{text:'Synthetic ignored owner text'}}]}));
  await flush();assert.equal(owned.queue.length,0);assert.equal(f.otherClient.ready,true);await f.manager.closeCurrent();assert.equal(f.otherClient.ready,true);
});
test('recipient/action/original injections and malformed capture fail before opening a socket',async t=>{
  const f=await fixture(t);for(const input of [{...f.input,ownerId:OWNER},{...f.input,accountId:ACCOUNT},{...f.input,panelId:'bad'},{...f.input,url:f.options.url}])await assert.rejects(f.manager.read(input));assert.equal(f.state.created.length,0);
  f.stable.ownerId=ACCOUNT;assert.equal(f.manager.availability(f.input).available,false);await assert.rejects(f.read());assert.equal(f.state.created.length,0);
});
test('missing configured friend refuses read and retires only the owned client',async t=>{
  const f=await fixture(t);f.state.ownerPresent=false;await assert.rejects(f.read(),{code:'owner_not_found'});await f.manager.retiring;assert.equal(f.writes().length,0);assert.equal(f.state.created[0].closed,true);assert.equal(f.otherClient.ready,true);
});
test('fresh verification and its immediate caller guard prevent after-close client creation',async t=>{
  for(const mode of ['await','microtask']){const f=await fixture(t);let closing;
    if(mode==='await'){const hold=deferred();f.state.verify=()=>hold.promise;const reading=f.read();await flush();closing=f.manager.closeOwned(f.input);hold.resolve({verified:true});await assert.rejects(reading);}
    else{f.state.onCapture=count=>{if(count===4)queueMicrotask(()=>{closing=f.manager.closeOwned(f.input);});};await assert.rejects(f.read());}
    await closing;assert.equal(f.state.created.length,0,mode);assert.equal(f.otherClient.ready,true);
  }
});
test('session consumes set/restore ticket before awaited verify; transient failure cannot replay it',async t=>{
  for(const restore of [false,true]){const f=await fixture(t);let row=await f.read();if(restore){await f.set(row);row=await f.read();}
    const count=f.writes().length,hold=deferred();f.state.verify=()=>hold.promise;
    const args={...f.input,ticketId:row.ticketId,...(!restore?{remark:'Once'}:{})},pending=f.manager[restore?'restore':'set'](args);
    await assert.rejects(f.manager[restore?'restore':'set'](args),{code:'operation_in_progress'});hold.resolve({verified:false});const result=await pending;
    assert.equal(result.outcome,'not_submitted');assert.equal(f.writes().length,count);f.state.verify=async()=>({verified:true});await assert.rejects(f.manager[restore?'restore':'set'](args),{code:'stale_ticket'});
  }
});
test('same panel can re-read; new panel and close discard prior restoration history',async t=>{
  const f=await fixture(t),row=await f.read();await f.set(row);const next={...f.input,panelId:NEXT},newRow=await f.manager.read(next),owned=f.manager.session.client;
  assert.deepEqual(newRow.restore,{available:false});await f.manager.closeOwned(f.input);assert.equal(f.manager.session.client,owned);assert.equal(owned.ready,true);await f.manager.closeOwned(next);
});
test('every captured scope change invalidates writes without borrowing another account',async t=>{
  for(const [key,value]of Object.entries({profile:{},generation:2,characterId:'other',role:'Other role',runtime:{},installation:{},runtimeEpoch:2,bridgeRevision:'other',endpointId:'other',ownerId:'99999999',qqAccountId:'99999998',url:'ws://127.0.0.1:2',token:'synthetic-different-token',status:'connected'})){
    const f=await fixture(t),row=await f.read();f.stable[key]=value;await assert.rejects(f.set(row));assert.equal(f.writes().length,0,key);f.manager.observe();await f.manager.retiring;assert.equal(f.state.created[0].closed,true,key);assert.equal(f.otherClient.ready,true,key);
  }
});
test('same client and generation with a replaced socket is rejected by session ownership',async t=>{
  const f=await fixture(t),row=await f.read(),owned=f.manager.session.client,old=owned.socket;owned.socket={readyState:1,terminate(){}};
  await assert.rejects(f.set(row));f.manager.observe();await f.manager.retiring;assert.equal(f.writes().length,0);old.terminate();assert.equal(f.otherClient.ready,true);
});
test('unknown after timeout, disconnect or malformed payload stays one-use and never auto-restores',async t=>{
  for(const mode of ['timeout','disconnect','malformed','failed']){const f=await fixture(t),row=await f.read();f.state.mode=mode;const out=await f.set(row);assert.equal(out.outcome,'unknown',mode);assert.equal(out.recipient.ownerId,OWNER);assert.equal(f.writes().length,1);await assert.rejects(f.set(row));assert.doesNotMatch(JSON.stringify(out),/PRIVATE_RAW_ERROR/);}
});
test('exact original comparison refuses externally changed values without write',async t=>{
  const f=await fixture(t),row=await f.read();f.state.remark='Changed elsewhere';const out=await f.set(row);assert.equal(out.outcome,'not_submitted');assert.equal(out.code,'baseline_changed');assert.equal(f.writes().length,0);await assert.rejects(f.set(row),{code:'stale_ticket'});
});
test('late accepted/unknown remains captured after close; a new panel waits for retirement',async t=>{
  for(const mode of ['ok','malformed']){const hold=deferred();class HeldController extends QQOwnerRemark{async set(...args){const result=await super.set(...args);await hold.promise;return result;}}
    const f=await fixture(t,{panelFactory:opts=>new QQOwnerRemarkPanel({...opts,controllerFactory:opts=>new HeldController(opts)})});f.state.release=()=>hold.resolve();
    const row=await f.read();f.state.mode=mode;const changing=f.set(row);while(!f.writes().length)await flush();while(f.manager.session.panel.panel.controller.operation)await flush();
    const closing=f.manager.closeOwned(f.input);let opened=false;const next=f.manager.read({...f.input,panelId:NEXT}).then(result=>{opened=true;return result;});await flush();assert.equal(opened,false);
    hold.resolve();const result=await changing;await closing;await next;assert.equal(result.outcome,mode==='ok'?'accepted':'unknown');assert.equal(result.panelId,PANEL);assert.equal(result.recipient.ownerId,OWNER);assert.equal(f.writes().length,1);assert.equal(f.otherClient.ready,true);
  }
});
test('hide/observe ends the private session and a later show can explicitly read again',async t=>{
  const f=await fixture(t);await f.read();f.state.visible=false;f.manager.observe();await f.manager.retiring;assert.equal(f.state.created[0].closed,true);assert.equal(f.manager.closed,false);f.state.visible=true;await f.manager.read({...f.input,panelId:NEXT});assert.equal(f.state.created[1].ready,true);await f.manager.close();await assert.rejects(f.manager.read(f.input),{code:'closed'});assert.equal(f.otherClient.ready,true);
});
