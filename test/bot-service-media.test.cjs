'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BotService}=require('../src/bot/service.cjs');const {QQOwnerImage}=require('../src/bot/qq-media.cjs');const {png,native}=require('./helpers/fixture-image.cjs');
const ACCOUNT='87654321',OWNER='12345678';const next=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-service-media-')),image=path.join(root,'fixture.png');fs.writeFileSync(image,png());let factories=0;
  const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const service=new BotService({root,vault,imageFactory:options=>{factories++;return new QQOwnerImage({...options,nativeImage:native()});}});
  service.config={...service.config,channel:'qq',mode:'gpt',qqOwnerId:OWNER,qqAccountId:ACCOUNT};
  const client={accountId:ACCOUNT,ownerId:OWNER,generation:3,ready:true,closed:false,socket:{readyState:1},sendOwnerImage:async()=>({outcome:'accepted',messageId:'77'}),close:async()=>{client.closed=true;client.ready=false;}};
  service.client=client;service.status='connected';service.generation=4;
  t.after(async()=>{await service.disconnect();service.socialStore.close?.();service.journal.close?.();fs.rmSync(root,{recursive:true,force:true});});return {service,client,root,image,factories:()=>factories};
}
test('service image decoder is lazy and public snapshots never expose client, binding hash or preview data',async t=>{
  const f=fixture(t);assert.equal(f.factories(),0);const initial=f.service.snapshot();assert.equal(initial.media.available,true);assert.equal(initial.media.supported,true);assert.equal(f.factories(),0);assert.doesNotMatch(JSON.stringify(initial.media),/scopeId|client|data:image|sha256|root/);
  const chosen=await f.service.selectImage(f.image);assert(chosen.preview.startsWith('data:image/png;base64,'));assert.equal(f.factories(),1);const state=f.service.snapshot().media;assert.equal(state.draft.ticketId,chosen.ticketId);assert.doesNotMatch(JSON.stringify(state),/base64|preview|scopeId|client|fixture\.png/);assert.equal(state.draft.recipient.ownerId,OWNER);
});
test('binding combines profile and actual character identity with owner/account/generation',async t=>{
  const f=fixture(t),before=f.service.imageBinding();assert.equal(before.client,f.client);assert.equal(before.ownerId,OWNER);assert.equal(before.accountId,ACCOUNT);assert(before.scopeId.endsWith(':codex-dragon'));assert.equal(before.generation,4);
  f.service.socialStore.configure({enabled:true,characterId:'deepseek-whale',name:'Whale fixture'});const next=f.service.imageBinding();assert(next.scopeId.endsWith(':deepseek-whale'));assert.notEqual(next.scopeId,before.scopeId);assert.equal(next.role,'Whale fixture');
  const otherRoot=path.join(f.root,'other');fs.mkdirSync(otherRoot);const other=new BotService({root:otherRoot,vault:f.service.vault});assert.notEqual(other.imageProfileId,f.service.imageProfileId);other.socialStore.close?.();other.journal.close?.();
});
test('task-mode media uses the persona actually captured by connect without re-reading mutable preferences',async t=>{
  const f=fixture(t);f.service.status='disconnected';f.service.config.mode='claude';f.service.config.workspace=f.root;f.service.secret.qqToken='fixture-token-not-real';let reads=0;f.service.personaOptions=()=>{reads++;return {enabled:true,selection:'sprout'};};
  f.client.connect=async()=>({accountId:ACCOUNT});f.client.inspect=async()=>({accountId:ACCOUNT,online:true,ownerIsFriend:true});f.client.getUpdates=(_cursor,signal)=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true}));f.service.qqClientFactory=()=>f.client;f.service.claudeProgramRunnerFactory=()=>async()=>({outcome:'reply_ended',text:'unused'});
  await f.service.connect();assert.equal(f.service.status,'connected');assert(f.service.imageBinding().scopeId.endsWith(':sprout'));assert.equal(reads,1);f.service.personaOptions=()=>assert.fail('preferences must not change an active connection persona');f.service.imageSnapshot();await f.service.selectImage(f.image);
});
test('successful manual image increments only accepted-send count, never dispatches model input',async t=>{
  const f=fixture(t);let modelCalls=0;f.service.execute=()=>{modelCalls++;};f.service.dispatcher={receive:()=>{modelCalls++;},stop(){},whenIdle:async()=>{}};
  const chosen=await f.service.selectImage(f.image),result=await f.service.sendImage({ticketId:chosen.ticketId});assert.equal(result.outcome,'accepted');assert.equal(f.service.outgoingAccepted,1);assert.equal(f.service.incomingCount,0);assert.equal(modelCalls,0);
  await assert.rejects(f.service.sendImage({ticketId:chosen.ticketId}),{code:'stale_ticket'});assert.equal(f.service.outgoingAccepted,1);
});
test('unknown image outcome remains visible in same scope and is never counted as accepted',async t=>{
  const f=fixture(t);f.client.sendOwnerImage=async()=>({outcome:'unknown',code:'send_unknown'});const chosen=await f.service.selectImage(f.image),result=await f.service.sendImage({ticketId:chosen.ticketId});assert.equal(result.outcome,'unknown');assert.equal(f.service.outgoingAccepted,0);assert.equal(f.service.imageSnapshot().last.outcome,'unknown');await assert.rejects(f.service.sendImage({ticketId:chosen.ticketId}),{code:'stale_ticket'});
});
test('reset detaches and aborts exactly the old controller, waits for its cleanup, then allows a new selection',async t=>{
  const f=fixture(t),entered=deferred(),finish=deferred();let signal;f.client.sendOwnerImage=async(_to,_bytes,_id,abort)=>{signal=abort;entered.resolve();await finish.promise;return {outcome:'unknown',code:'send_unknown'};};
  const chosen=await f.service.selectImage(f.image),sending=f.service.sendImage({ticketId:chosen.ticketId});await entered.promise;let stopped=false;const reset=f.service.resetImages().then(()=>{stopped=true;});await next();assert(signal.aborted);assert.equal(stopped,false);assert.equal(f.service.imageSnapshot().busy,true);assert.equal(f.service.imageSnapshot().available,false);assert.throws(()=>f.service.selectImage(f.image),{code:'operation_in_progress'});
  finish.resolve();assert.equal((await sending).outcome,'unknown');await reset;assert.equal(f.service.imageSnapshot().last,null);assert.equal(f.service.imageSnapshot().busy,false);assert.equal(f.client.closed,false);const fresh=await f.service.selectImage(f.image);assert.notEqual(fresh.ticketId,chosen.ticketId);assert.equal(f.factories(),2);
});
test('disconnect consumes pending preview and reconnect cannot reuse it',async t=>{
  const f=fixture(t),chosen=await f.service.selectImage(f.image);await f.service.disconnect();assert.equal(f.service.imageSnapshot().draft,null);assert.equal(f.service.imageSnapshot().available,false);await assert.rejects(f.service.sendImage({ticketId:chosen.ticketId}),{code:'stale_ticket'});
  f.client.closed=false;f.client.ready=true;f.client.generation++;f.service.client=f.client;f.service.status='connected';const fresh=await f.service.selectImage(f.image);assert.notEqual(fresh.ticketId,chosen.ticketId);assert.equal(f.service.imageBinding().generation,5);
});
test('config, character changes and forget invalidate previews without deleting a selected source',async t=>{
  for(const change of ['configure','character','forget'])await t.test(change,async t=>{const f=fixture(t),chosen=await f.service.selectImage(f.image);if(change==='forget')await f.service.forget();else{f.service.status='disconnected';if(change==='configure')f.service.configure({qqOwnerId:'11111111'});else f.service.socialConfigure({characterId:'deepseek-whale'});await f.service.imageReset;}
    assert.equal(f.service.imageSnapshot().draft,null);assert(fs.existsSync(f.image));await assert.rejects(f.service.sendImage({ticketId:chosen.ticketId}),{code:'stale_ticket'});
  });
});
test('late accepted result remains accurate but cannot update replacement connection counters',async t=>{
  const f=fixture(t),entered=deferred(),finish=deferred();f.client.sendOwnerImage=async()=>{entered.resolve();await finish.promise;return {outcome:'accepted',messageId:'79'};};const chosen=await f.service.selectImage(f.image),sending=f.service.sendImage({ticketId:chosen.ticketId});await entered.promise;f.service.generation++;const reset=f.service.resetImages();finish.resolve();assert.equal((await sending).outcome,'accepted');await reset;assert.equal(f.service.outgoingAccepted,0);assert.equal(f.service.imageSnapshot().last,null);
});
test('disconnected, WeChat, unavailable decoder and mismatched account cannot select/send',async t=>{
  const f=fixture(t);f.service.status='disconnected';assert.throws(()=>f.service.selectImage(f.image),{code:'disconnected'});f.service.status='connected';f.service.config.channel='wechat';assert.throws(()=>f.service.selectImage(f.image),{code:'disconnected'});assert.equal(f.service.imageSnapshot().supported,false);f.service.config.channel='qq';f.service.config.qqAccountId='11111111';assert.throws(()=>f.service.selectImage(f.image),{code:'account_mismatch'});f.service.config.qqAccountId=ACCOUNT;f.service.imageFactory=undefined;assert.throws(()=>f.service.selectImage(f.image),{code:'media_unavailable'});assert.equal(f.factories(),0);
});
