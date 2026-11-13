'use strict';
// Local service fixtures, not live QQ acceptance.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BotService}=require('../src/bot/service.cjs');
const {QQFriendRequestsPanel}=require('../src/bot/qq-friend-requests-panel.cjs');
const {randomUUID}=require('node:crypto');
const ACCOUNT='100001',OWNER='200001';
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-requests-service-')),clients=[],calls=[];
  const service=new BotService({root,vault:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},
    claudeProgramRunnerFactory:()=>async()=>assert.fail('Friend requests must never call the model'),
    qqClientFactory:options=>{const client={accountId:ACCOUNT,ownerId:OWNER,ready:true,closed:false,generation:1,socket:{readyState:1},connectedAt:Date.now(),
      connect:async()=>{},inspect:async()=>({accountId:ACCOUNT,online:true,ownerIsFriend:true}),
      getUpdates:(_cursor,signal)=>new Promise((_r,reject)=>{if(signal.aborted)reject(Error('aborted'));else signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});}),
      sendText:async()=>assert.fail('Friend requests must never send a chat reply'),
      decideFriendRequest:async(value,{assertCurrent})=>{assertCurrent();calls.push(value);return {outcome:'accepted'};},
      close:async()=>{client.closed=true;client.ready=false;client.socket.readyState=3;}};clients.push({client,options});return client;}});
  service.configure({channel:'qq',mode:'claude',workspace:root,qqOwnerId:OWNER,qqAccountId:ACCOUNT,qqUrl:'ws://127.0.0.1:3001/',qqToken:'synthetic-friend-requests-token'});
  t.after(async()=>{await service.disconnect();service.journal.close?.();service.socialStore.close?.();const resolved=path.resolve(root);assert(resolved.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(resolved).startsWith('arcade-requests-service-'));fs.rmSync(resolved,{recursive:true,force:true});});
  const emit=(entry=clients.at(-1),patch={})=>entry.options.onFriendRequest({post_type:'request',request_type:'friend',self_id:Number(ACCOUNT),user_id:300001,time:Math.floor(Date.now()/1000),comment:'PRIVATE_REQUEST_TEXT',flag:'PRIVATE_REQUEST_FLAG',...patch},{client:entry.client,generation:entry.client.generation});
  return {service,clients,calls,emit};
}
test('service collects connection events without a panel and never places their text or flag in snapshots or model input',async t=>{
  const f=fixture(t);await f.service.connect();assert.equal(f.service.status,'connected');f.emit();const list=f.service.friendRequests.list();assert.equal(list.items.length,1);assert.equal(list.items[0].applicantId,'300001');
  assert.doesNotMatch(JSON.stringify(f.service.snapshot()),/PRIVATE_REQUEST/);assert.equal(f.service.incomingCount,0);assert.equal(f.service.dispatcher.snapshot().tasks.length,0);assert.equal(f.calls.length,0);
  const row=list.items[0];assert.deepEqual((await f.service.friendRequests.decide({requestId:row.requestId,approve:false})).outcome,'accepted');assert.deepEqual(f.calls,[{flag:'PRIVATE_REQUEST_FLAG',approve:false}]);assert.equal(f.service.config.qqOwnerId,OWNER);
});
test('closing the drawer preserves new pending requests, while disconnect and reconnect discard old flags',async t=>{
  const f=fixture(t);await f.service.connect();const original=f.service.friendRequests;f.emit();
  const panel=new QQFriendRequestsPanel({capture:()=>({service:f.service,generation:f.service.generation,scopeId:'fixture',client:f.clients.at(-1).client,clientGeneration:1,qqAccountId:ACCOUNT,ownerId:OWNER,inbox:f.service.friendRequests})});
  const input={accountId:'fixture',panelId:randomUUID()};assert.equal((await panel.read(input)).inbox.items.length,1);await panel.closeOwned(input);assert.equal(original.list().items.length,1);
  await f.service.disconnect();assert.equal(original.closed,true);assert.equal(f.service.friendRequests,null);await f.service.connect();f.emit(f.clients[0]);assert.equal(f.service.friendRequests.list().items.length,0);f.emit();assert.equal(f.service.friendRequests.list().items.length,1);assert.equal(f.calls.length,0);
});
test('socket generations invalidate collected requests even when a client instance is reused',async t=>{
  const f=fixture(t);await f.service.connect();f.emit();const client=f.clients[0].client;client.generation++;client.connectedAt=Date.now();client.socket={readyState:1};assert.equal(f.service.friendRequests.list().items.length,0);f.emit();assert.equal(f.service.friendRequests.list().items.length,1);
});
test('failed connection closes the service inbox and does not expose early events',async t=>{
  const f=fixture(t),factory=f.service.qqClientFactory;f.service.qqClientFactory=options=>{const client=factory(options);client.connect=async()=>{f.emit();throw Error('fixture failure');};return client;};await f.service.connect();assert.equal(f.service.status,'disconnected');assert.equal(f.service.friendRequests,null);assert.equal(f.calls.length,0);
});
