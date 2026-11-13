'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {QQClient}=require('../src/bot/qq.cjs');
const {QQGroupProfile}=require('../src/bot/qq-group-profile.cjs');
const {QQGroupProfileSession,profileProjection,changeProjection}=require('../src/bot/qq-group-profile-session.cjs');
const {fixture,ACCOUNT,OWNER,GROUP,OTHER,flush,deferred}=require('./helpers/qq-group-profile-fixture.cjs');
function sessionFixture(t,f){
 class SyntheticService{}class SyntheticRuntime{}
 const state={visible:true,generation:1,runtimeEpoch:1,profile:new SyntheticService(),runtime:new SyntheticRuntime(),installation:{},bridgeRevision:'bridge',status:'disconnected',created:[],verifyCalls:[],verify:async()=>({verified:true})};
 const input={accountId:'synthetic-profile',panelId:randomUUID(),groupId:GROUP};
 const capture=identity=>{if(!state.visible)throw Object.assign(Error('hidden'),{code:'changed'});return {profileId:identity.accountId,panelId:identity.panelId,groupId:identity.groupId,profile:state.profile,generation:state.generation,characterId:'synthetic-character',runtime:state.runtime,installation:state.installation,runtimeEpoch:state.runtimeEpoch,bridgeRevision:state.bridgeRevision,qqAccountId:ACCOUNT,ownerId:OWNER,url:f.options.url,token:f.options.token,channel:'qq',status:state.status,endpointId:'endpoint'};};
 const manager=new QQGroupProfileSession({capture,verifyContext:async(...args)=>{state.verifyCalls.push(args[0]);return state.verify(...args);},clientFactory:options=>{state.created.push(options);return new QQClient({...f.options,...options});}});
 t.after(()=>manager.close());const preview=async(value='New group')=>{const read=await manager.read(input);return manager.preview({...input,observationId:read.profile.observationId,field:'name',value});};
 return {manager,state,input,preview,capture};
}
test('disconnected AI can manage with a distinct request-only socket and private projected fields',async t=>{
 const f=await fixture(t),s=sessionFixture(t,f),read=await s.manager.read(s.input);assert.equal(read.accountId,s.input.accountId);assert.equal(read.qqAccountId,ACCOUNT);assert.equal(read.groupId,GROUP);assert.equal(read.profile.accountId,undefined);assert.equal(s.state.created.length,1);assert.equal(s.state.created[0].receiveOwnerMessages,false);assert.equal(s.state.created[0].allowOwnerVoice,false);assert.notEqual(s.manager.session.client,f.client);assert.equal(f.client.ready,true);assert.equal(s.state.verifyCalls[0].panelId,s.input.panelId);assert.equal(s.state.verifyCalls[0].groupId,GROUP);
 const own=s.manager.session.client;for(const socket of f.server.clients)socket.send(JSON.stringify({post_type:'message',message_type:'private',self_id:ACCOUNT,user_id:OWNER,message_id:1,time:Math.floor(Date.now()/1000),message:[{type:'text',data:{text:'Synthetic text must not be queued'}}]}));await flush();assert.equal(own.queue.length,0);
 const p=s.manager.preview({...s.input,observationId:read.profile.observationId,field:'name',value:'New group'});const out=await s.manager.confirm({...s.input,ticketId:p.preview.ticketId});assert.equal(out.change.outcome,'accepted');assert(!JSON.stringify(out).includes('PRIVATE_'));assert.equal(out.change.accountId,undefined);await s.manager.closeOwned(s.input);assert.equal(own.closed,true);assert.equal(f.client.ready,true);
});
test('invalid group, wrong panel capture and arbitrary target fields fail before connecting',async t=>{
 const f=await fixture(t),s=sessionFixture(t,f);for(const input of [{...s.input,groupId:Number(GROUP)},{...s.input,friendId:OWNER},{...s.input,panelId:'bad'}])await assert.rejects(s.manager.read(input),{code:'invalid_request'});
 s.manager.capture=value=>({...s.capture(value),panelId:randomUUID()});await assert.rejects(s.manager.read(s.input),{code:'unconfigured'});assert.equal(s.state.created.length,0);
});
test('fresh runtime verification checks again after awaiting before any new socket is created',async t=>{
 const f=await fixture(t),s=sessionFixture(t,f),held=deferred();s.state.verify=()=>held.promise;const reading=s.manager.read(s.input);await flush();s.state.runtimeEpoch++;held.resolve({verified:true});await assert.rejects(reading,{code:'changed'});assert.equal(s.state.created.length,0);
});
test('close microtask after final verification cannot construct a production client or socket',async t=>{
 const f=await fixture(t),s=sessionFixture(t,f);let queued=false,created=0,sockets=0,closing;
 s.manager.capture=value=>{const captured=s.capture(value);if(s.state.verifyCalls.length===1&&!queued){queued=true;queueMicrotask(()=>{closing=s.manager.closeCurrent();});}return captured;};
 s.manager.clientFactory=options=>{created++;const client=new QQClient({...f.options,...options,socketFactory:(...args)=>{sockets++;return f.options.socketFactory(...args);}});t.after(()=>client.close());return client;};
 await assert.rejects(s.manager.read(s.input));await closing;await flush();
 assert.equal(queued,true);assert.deepEqual({created,sockets},{created:0,sockets:0});assert.equal(f.client.ready,true);assert.equal(f.writes().length,0);
});
test('confirm fresh verification is bound to runtime generation; role/name write is never invoked after change',async t=>{
 const f=await fixture(t),s=sessionFixture(t,f),p=await s.preview(),held=deferred();s.state.verify=()=>held.promise;const changing=s.manager.confirm({...s.input,ticketId:p.preview.ticketId});await flush();s.state.installation={};held.resolve({verified:true});const out=await changing;assert.equal(out.change.outcome,'not_submitted');assert.equal(f.writes().length,0);
});
test('synchronous dismiss preserves baseline for the following preview, while stale close cannot close a new panel',async t=>{
 const f=await fixture(t),s=sessionFixture(t,f),read=await s.manager.read(s.input);const p=s.manager.preview({...s.input,observationId:read.profile.observationId,field:'name',value:'First'});s.manager.dismiss(s.input);const q=s.manager.preview({...s.input,observationId:read.profile.observationId,field:'name',value:'Second'});await assert.rejects(s.manager.confirm({...s.input,ticketId:p.preview.ticketId}),{code:'stale_ticket'});assert.notEqual(p.preview.ticketId,q.preview.ticketId);
 const next={...s.input,panelId:randomUUID()};await s.manager.read(next);const current=s.manager.session.client;await s.manager.closeOwned(s.input);assert.equal(s.manager.session.client,current);assert.equal(current.ready,true);
});
test('visibility, account context or same-client reconnect ends only the owned management connection',async t=>{
 for(const mode of ['hidden','generation','reconnect']){const f=await fixture(t),s=sessionFixture(t,f);await s.manager.read(s.input);const own=s.manager.session.client;if(mode==='hidden')s.state.visible=false;if(mode==='generation')s.state.generation++;if(mode==='reconnect')own.generation++;s.manager.observe();await s.manager.retiring;assert.equal(own.closed,true,mode);assert.equal(s.manager.session,null);assert.equal(f.client.ready,true);}
});
test('close during pending read prevents reopening; closeCurrent remains reusable after show',async t=>{
 const f=await fixture(t),s=sessionFixture(t,f),held=deferred();s.state.verify=()=>held.promise;const reading=s.manager.read(s.input);const caught=assert.rejects(reading);await flush();const closing=s.manager.closeOwned(s.input);held.resolve({verified:true});await caught;await closing;assert.equal(s.state.created.length,0);
 s.state.verify=async()=>({verified:true});await s.manager.read({...s.input,panelId:randomUUID()});assert(s.manager.session.client.ready);await s.manager.closeCurrent();assert.equal(s.manager.closed,false);
});
test('late accepted receipt retains original account/group after close and does not claim current scope success',async t=>{
 const f=await fixture(t),s=sessionFixture(t,f),held=deferred();s.manager.controllerFactory=options=>new QQGroupProfile({...options,transport:{read:(binding,target)=>f.transport.read({...binding,socket:binding.client.socket,clientGeneration:binding.client.generation},target,{assertCurrent:()=>{}}),write:()=>held.promise}});
 const p=await s.preview(),changing=s.manager.confirm({...s.input,ticketId:p.preview.ticketId});await flush();let closed=false;const closing=s.manager.closeOwned(s.input).then(()=>{closed=true;});await flush();assert.equal(closed,false);held.resolve({outcome:'accepted',acknowledgement:'bridge-reported-success'});const out=await changing;assert.equal(out.change.outcome,'accepted');assert.equal(out.qqAccountId,ACCOUNT);assert.equal(out.groupId,GROUP);assert.equal(out.change.observation.state,'unavailable');await closing;
});
test('projection rejects wrong group/actual account and cannot elevate member edit capability',()=>{
 const valid={kind:'group-profile',observationId:randomUUID(),accountId:ACCOUNT,groupId:GROUP,name:'Synthetic',selfRole:'member',capabilities:{readName:true,editName:false},source:'bridge-observed',cacheMayBeStale:true,fetchedAt:new Date().toISOString()};
 assert.throws(()=>profileProjection({...valid,groupId:OTHER},ACCOUNT,GROUP),{code:'invalid_response'});assert.throws(()=>profileProjection({...valid,capabilities:{readName:true,editName:true}},ACCOUNT,GROUP),{code:'invalid_response'});assert.throws(()=>profileProjection({...valid,fetchedAt:0},ACCOUNT,GROUP),{code:'invalid_response'});
 const ticketId=randomUUID(),result={kind:'group-profile-change',ticketId,accountId:ACCOUNT,groupId:OTHER,field:'name',outcome:'unknown',observation:{state:'unavailable',source:'bridge-observed'},automaticRetry:false,automaticRestore:false};assert.throws(()=>changeProjection(result,ACCOUNT,GROUP,ticketId),{code:'invalid_response'});
});
