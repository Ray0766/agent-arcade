'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events'),{randomUUID}=require('node:crypto');
const {WebSocketServer,WebSocket}=require('ws');
const {OwnerFriendSetup}=require('../src/bot/qq-owner-friend-setup.cjs');
const {QQClient}=require('../src/bot/qq.cjs');
const ACCOUNT='100001',OWNER='200001';
const tick=()=>new Promise(resolve=>setTimeout(resolve,5));
const until=async predicate=>{for(let i=0;i<100;i++){if(predicate())return;await tick();}throw Error('Synthetic fixture timeout');};
const defer=()=>{let resolve;return {promise:new Promise(yes=>resolve=yes),resolve};};
async function fixture(t){
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  const calls=[],clients=[],sockets=[],now=Date.now();let verifyHook=null,actionHook=null,connectedAccount=ACCOUNT,online=true,hidden=false;
  const binding={profileId:'whale',profile:{},generation:1,characterId:'deepseek-whale',runtime:{},installation:{},runtimeEpoch:1,bridgeRevision:'verified-bridge-1',qqAccountId:ACCOUNT,ownerId:OWNER,url:`ws://127.0.0.1:${server.address().port}/`,token:'SYNTHETIC_PRIVATE_TOKEN_ONLY',channel:'qq',status:'disconnected'};
  const input={accountId:'whale',panelId:randomUUID()};
  const controller=new OwnerFriendSetup({now:()=>now,capture:()=>{if(hidden)throw Object.assign(Error('hidden'),{code:'changed'});return {...binding};},verifyContext:async captured=>{if(verifyHook)await verifyHook(captured);return {verified:true};},clientFactory:options=>{const client=new QQClient({...options,timeoutMs:100});clients.push(client);return client;}});
  server.on('connection',socket=>{sockets.push(socket);socket.on('message',async raw=>{
    const row=JSON.parse(raw);calls.push(row);
    if(actionHook&&await actionHook(row,socket)===true)return;
    const data=row.action==='get_login_info'?{user_id:connectedAccount,nickname:'Synthetic agent'}:row.action==='get_status'?{online,good:true}:row.action==='get_friend_list'?[]:undefined;
    socket.send(JSON.stringify({echo:row.echo,status:'ok',retcode:0,...(data===undefined?{}:{data})}));
  });});
  const emit=(value,socket=sockets.at(-1))=>socket.send(JSON.stringify(value));
  const request=(extra={})=>emit({post_type:'request',request_type:'friend',self_id:ACCOUNT,user_id:OWNER,time:Math.floor(now/1000),comment:'Synthetic first owner request',flag:randomUUID(),...extra});
  const message=(extra={})=>emit({post_type:'message',message_type:'private',sub_type:'friend',self_id:ACCOUNT,user_id:OWNER,message_id:randomUUID(),time:Math.ceil(now/1000),message:[{type:'text',data:{text:'Do not queue this synthetic text'}}],...extra});
  t.after(async()=>{await controller.close();for(const client of clients)client.close();for(const socket of sockets)socket.terminate();await new Promise(resolve=>server.close(resolve));});
  return {controller,input,binding,calls,clients,sockets,now,request,message,emit,set verify(value){verifyHook=value;},set action(value){actionHook=value;},set actual(value){connectedAccount=value;},set online(value){online=value;},set hidden(value){hidden=value;}};
}

test('availability is local and initial listening requires no AI key, workspace or friendship',async t=>{
  const f=await fixture(t),available=f.controller.availability(f.input);assert.equal(available.available,true);assert.equal(available.status,'not_started');assert.equal(available.accountId,'whale');assert.equal(f.calls.length,0);
  const result=await f.controller.start(f.input);assert.equal(result.status,'listening');assert.equal(result.ownerId,OWNER);assert.equal(result.qqAccountId,ACCOUNT);assert.equal(result.inbox.available,true);
  assert.deepEqual(f.calls.map(row=>row.action),['get_login_info','get_status']);assert.equal(f.binding.status,'disconnected');
});
test('only the fixed owner request enters the inbox and one explicit approval has a fixed void action',async t=>{
  const f=await fixture(t);await f.controller.start(f.input);f.request({user_id:'300001'});f.request({flag:'PRIVATE_OWNER_FLAG'});await until(()=>f.controller.read(f.input).inbox.items.length===1);
  const read=f.controller.read(f.input);assert.equal(read.inbox.items[0].applicantId,OWNER);assert.doesNotMatch(JSON.stringify(read),/PRIVATE_OWNER_FLAG|SYNTHETIC_PRIVATE_TOKEN|ws:\/\//);
  const row=read.inbox.items[0],reply=await f.controller.decide({...f.input,requestId:row.requestId,approve:true});assert.equal(reply.outcome,'accepted');assert.equal(reply.ownerId,OWNER);assert.equal(f.binding.status,'disconnected');
  const writes=f.calls.filter(row=>row.action==='set_friend_add_request');assert.equal(writes.length,1);assert.deepEqual(writes[0].params,{flag:'PRIVATE_OWNER_FLAG',approve:true});assert.equal(f.controller.read(f.input).inbox.items.length,0);
});
test('message management is disabled before queues, deduplication and reply contexts, including more than the normal queue limit',async t=>{
  const f=await fixture(t);await f.controller.start(f.input);for(let i=0;i<230;i++)f.message({message_id:i});f.request();await until(()=>f.controller.read(f.input).inbox.items.length===1);
  const client=f.clients[0];assert.equal(client.ready,true);assert.equal(client.queue.length,0);assert.equal(client.seen.size,0);assert.equal(client.contextToken,'');assert(f.calls.every(row=>['get_login_info','get_status'].includes(row.action)));
});
test('the default client retains normal message intake',async t=>{
  const f=await fixture(t),client=new QQClient({url:f.binding.url,token:f.binding.token,ownerId:OWNER,expectedAccountId:ACCOUNT,acceptAfter:0,now:()=>f.now});f.clients.push(client);await client.connect();f.message({message_id:123});await until(()=>client.queue.length===1);assert.equal(client.receiveOwnerMessages,true);assert.equal(client.seen.size,1);
});
test('message suppression still rejects wrong self identity and clears the owner inbox',async t=>{
  const f=await fixture(t);await f.controller.start(f.input);const drops=[],client=f.clients[0],drop=client._drop.bind(client);client._drop=value=>{drops.push(value.code);return drop(value);};f.request();await until(()=>f.controller.read(f.input).inbox.items.length===1);f.message({self_id:'900001'});await until(()=>!f.controller.session);assert.equal(client.ready,false);assert.equal(client.closed,true);assert(drops.includes('account_changed'));
});
test('requests before the verified handshake and stale current-connection events are omitted',async t=>{
  const f=await fixture(t);f.action=async(row,socket)=>{if(row.action==='get_login_info')socket.send(JSON.stringify({post_type:'request',request_type:'friend',self_id:ACCOUNT,user_id:OWNER,time:Math.floor(f.now/1000),comment:'pre-handshake',flag:'PREHANDSHAKE'}));return false;};
  await f.controller.start(f.input);f.request({time:Math.floor(f.now/1000)-2});f.request({comment:'current'});await until(()=>f.controller.read(f.input).inbox.items.length===1);assert.equal(f.controller.read(f.input).inbox.items[0].comment,'current');
});
test('offline or wrong actual identity cannot establish a management session',async t=>{
  for(const [field,value,code]of [['online',false,'account_offline'],['actual','900001','account_mismatch']])await t.test(field,async t=>{const f=await fixture(t);f[field]=value;await assert.rejects(f.controller.start(f.input),{code});assert.equal(f.controller.session,null);assert.equal(f.clients[0].closed,true);assert(!f.calls.some(row=>row.action==='set_friend_add_request'));});
});
test('all selected profile, owner, character, installation and runtime changes retire the old session',async t=>{
  for(const change of [f=>f.binding.profile={},f=>f.binding.generation++,f=>f.binding.characterId='another',f=>f.binding.ownerId='300001',f=>f.binding.qqAccountId='900001',f=>f.binding.runtime={},f=>f.binding.installation={},f=>f.binding.runtimeEpoch++,f=>f.binding.bridgeRevision='new-bridge',f=>f.binding.status='connecting',f=>f.hidden=true])await t.test('changed capture',async t=>{
    const f=await fixture(t);await f.controller.start(f.input);const client=f.clients[0];change(f);f.controller.observe();await f.controller.retiring;assert.equal(f.controller.session,null);assert.equal(client.closed,true);assert(!f.calls.some(row=>row.action==='set_friend_add_request'));
  });
});
test('close during endpoint verification prevents socket creation and repeated close waits for the same operation',async t=>{
  const f=await fixture(t),hold=defer();f.verify=()=>hold.promise;const opening=f.controller.start(f.input);await tick();let ended=false;const closing=f.controller.closeOwned(f.input).then(()=>ended=true),again=f.controller.closeOwned(f.input);await tick();assert.equal(ended,false);assert.equal(f.clients.length,0);hold.resolve();await assert.rejects(opening,{code:'changed'});await Promise.all([closing,again]);assert.equal(ended,true);assert.equal(f.clients.length,0);
});
test('owner-friend close microtask after final verification cannot construct a production client or socket',async t=>{
 const f=await fixture(t),capture=f.controller.capture;let verified=false,queued=false,created=0,sockets=0,closing;
 f.verify=()=>{verified=true;};f.controller.capture=input=>{const value=capture(input);if(verified&&!queued){queued=true;queueMicrotask(()=>{closing=f.controller.closeOwned(f.input);});}return value;};
 f.controller.clientFactory=options=>{created++;const client=new QQClient({...options,socketFactory:(...args)=>{sockets++;return new WebSocket(...args);}});f.clients.push(client);return client;};
 await assert.rejects(f.controller.start(f.input));await closing;assert.equal(queued,true);assert.deepEqual({created,sockets},{created:0,sockets:0});assert.equal(f.calls.length,0);
});
test('duplicate start does not create a parallel socket',async t=>{
  const f=await fixture(t),hold=defer();f.verify=()=>hold.promise;const opening=f.controller.start(f.input);await assert.rejects(f.controller.start(f.input),{code:'operation_in_progress'});hold.resolve();await opening;await f.controller.start(f.input);assert.equal(f.clients.length,1);
});
test('a scope change during decision preflight is not submitted',async t=>{
  const f=await fixture(t);await f.controller.start(f.input);f.request();await until(()=>f.controller.read(f.input).inbox.items.length);const row=f.controller.read(f.input).inbox.items[0],hold=defer();f.verify=()=>hold.promise;
  const deciding=f.controller.decide({...f.input,requestId:row.requestId,approve:false});f.binding.runtimeEpoch++;f.controller.observe();hold.resolve();const reply=await deciding;assert.equal(reply.outcome,'not_submitted');assert(!f.calls.some(row=>row.action==='set_friend_add_request'));
});
test('unknown write and double click never replay the consumed request',async t=>{
  const f=await fixture(t);await f.controller.start(f.input);f.request();await until(()=>f.controller.read(f.input).inbox.items.length);const row=f.controller.read(f.input).inbox.items[0];f.action=async r=>r.action==='set_friend_add_request';
  const input={...f.input,requestId:row.requestId,approve:true},first=f.controller.decide(input);await assert.rejects(f.controller.decide(input),{code:'operation_in_progress'});assert.equal((await first).outcome,'unknown');await f.controller.decide(input);assert.equal(f.calls.filter(r=>r.action==='set_friend_add_request').length,1);
});
test('closing after a write was submitted preserves unknown and never reconnects or retries',async t=>{
  const f=await fixture(t);await f.controller.start(f.input);f.request();await until(()=>f.controller.read(f.input).inbox.items.length);const row=f.controller.read(f.input).inbox.items[0];f.action=async r=>r.action==='set_friend_add_request';
  const pending=f.controller.decide({...f.input,requestId:row.requestId,approve:true});await until(()=>f.calls.some(r=>r.action==='set_friend_add_request'));await f.controller.closeOwned(f.input);const reply=await pending;assert.equal(reply.outcome,'unknown');assert.equal(f.controller.session,null);assert.equal(f.clients.length,1);assert.equal(f.calls.filter(r=>r.action==='set_friend_add_request').length,1);
});
test('runtime verification failure before a connection creates no socket and does not fake readiness',async t=>{
  const f=await fixture(t);f.verify=()=>{throw Object.assign(Error('synthetic runtime stop'),{code:'operation_in_progress'});};await assert.rejects(f.controller.start(f.input),{code:'operation_in_progress'});assert.equal(f.controller.session,null);assert.equal(f.clients.length,0);assert.equal(f.controller.availability(f.input).status,'not_started');
});
test('a genuinely accepted receipt retains its old panel identity after scope changes',async t=>{
  const f=await fixture(t);await f.controller.start(f.input);f.request();await until(()=>f.controller.read(f.input).inbox.items.length);const row=f.controller.read(f.input).inbox.items[0],client=f.clients[0],original=client.decideFriendRequest.bind(client);
  client.decideFriendRequest=async(...args)=>{const receipt=await original(...args);f.binding.generation++;f.controller.observe();return receipt;};
  const reply=await f.controller.decide({...f.input,requestId:row.requestId,approve:false});assert.equal(reply.outcome,'accepted');assert.equal(reply.panelId,f.input.panelId);assert.equal(reply.qqAccountId,ACCOUNT);assert.equal(f.binding.status,'disconnected');
});
test('old panel close cannot close a newly selected panel, and no old requests transfer',async t=>{
  const f=await fixture(t);await f.controller.start(f.input);f.request();await until(()=>f.controller.read(f.input).inbox.items.length);const next={...f.input,panelId:randomUUID()};await f.controller.start(next);await f.controller.closeOwned(f.input);assert.equal(f.clients.length,2);assert.equal(f.clients[1].closed,false);assert.equal(f.controller.read(next).inbox.items.length,0);
});
test('renderer-shaped requests cannot add endpoints, applicant IDs, flags or implicit approvals',async t=>{
  const f=await fixture(t);for(const extra of [{url:f.binding.url},{ownerId:OWNER},{friendId:OWNER},{flag:'PRIVATE'},{approve:'true'}])assert.throws(()=>f.controller.availability({...f.input,...extra}),{code:'invalid_request'});
  f.binding.status='connected';assert.equal(f.controller.availability(f.input).reason,'account_connected');await assert.rejects(f.controller.start(f.input),{code:'account_connected'});assert.equal(f.clients.length,0);
});
