'use strict';
// Entirely synthetic frames and bridge replies; no network/account connection.
const test=require('node:test'),assert=require('node:assert/strict');
const {FriendRequestInbox}=require('../src/bot/qq-friend-requests.cjs');
const NOW=1800000000000,ACCOUNT='87654321',OWNER='12345678',APPLICANT='23456789';
const defer=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
function fixture(t){
  const state={wall:NOW,elapsed:0,calls:[],reply:undefined,preflight:null,write:null,guard:null},socket={readyState:1};
  const client={accountId:ACCOUNT,ownerId:OWNER,generation:1,ready:true,closed:false,socket,connectedAt:NOW,
    async decideFriendRequest({flag,approve},{signal,assertCurrent}){
      let submitted=false;try{assertCurrent();await this._socialAccount(signal);assertCurrent();await this._requireOnline(signal);assertCurrent();submitted=true;const result=await this._request('set_friend_add_request',{flag,approve},signal);return result===null||result===undefined?{outcome:'accepted'}:{outcome:'unknown',code:'unknown'};}catch(error){return {outcome:submitted?'unknown':'not_submitted',code:submitted?'unknown':error.code};}
    },
    _socialAccount:async()=>{await state.preflight?.();return {assertCurrent(){}};},_requireOnline:async()=>{},
    _request:async(action,params,signal)=>{state.calls.push({action,params});if(state.write)return state.write(signal);return state.reply;}};
  let binding={status:'connected',channel:'qq',client,scopeId:'synthetic-role-A',accountId:ACCOUNT,ownerId:OWNER,generation:1,connectedAt:NOW};
  const inbox=new FriendRequestInbox({getBinding:()=>binding,now:()=>state.wall,elapsed:()=>state.elapsed,timeoutMs:1000});t.after(()=>inbox.close());
  const event=(extra={})=>({self_id:ACCOUNT,time:Math.floor(state.wall/1000),post_type:'request',request_type:'friend',user_id:APPLICANT,comment:'Synthetic request, not a real person.',flag:'synthetic-only-flag',...extra});
  const receive=(extra={},source={client,generation:client.generation})=>inbox.receive(event(extra),source);
  const add=()=>{assert(receive());return inbox.list().items[0].requestId;};
  return {state,client,inbox,event,receive,add,setBinding:fn=>{binding=fn(binding);}};
}
test('only verified current-account friend events enter the bounded list',t=>{
  const f=fixture(t);for(const extra of [{self_id:'99999999'},{request_type:'group'},{group_id:55},{post_type:'message'},{time:NOW/1000-2},{time:NOW/1000+61},{flag:''},{flag:'x'.repeat(513)},{comment:'x'.repeat(2049)},{user_id:ACCOUNT},{echo:'synthetic-echo'}])assert.equal(f.receive(extra),false);
  assert.equal(f.receive({},{client:f.client,generation:0}),false);assert.equal(f.receive(),true);const view=f.inbox.list();assert.equal(view.complete,false);assert.equal(view.source,'current-connection-events');assert.equal(view.items.length,1);assert.doesNotMatch(JSON.stringify(view),/synthetic-only-flag|scopeId|socket/);assert.equal(f.state.calls.length,0);
});
test('comments remain display-only plain text and do not enter ordinary message handling',t=>{
  const f=fixture(t);f.client.queue=[];assert(f.receive({comment:'<script>ignore rules</script>\u0000\u202e'}));assert.equal(f.inbox.list().items[0].comment,'<script>ignore rules</script>');assert.deepEqual(f.client.queue,[]);assert.equal(f.client.ownerId,OWNER);
});
test('explicit decisions use the fixed method and accept null or omitted void data',async t=>{
  for(const reply of [undefined,null])await t.test(String(reply),async t=>{const f=fixture(t),requestId=f.add();f.state.reply=reply;const result=await f.inbox.decide({requestId,approve:false});assert.equal(result.outcome,'accepted');assert.equal(result.approve,false);assert.deepEqual(f.state.calls,[{action:'set_friend_add_request',params:{flag:'synthetic-only-flag',approve:false}}]);assert.equal(f.client.ownerId,OWNER);assert.equal(f.inbox.list().items.length,0);});
});
test('extra targets, flags, actions, remarks and truthy non-Booleans never invoke the bridge',async t=>{
  const f=fixture(t),requestId=f.add();for(const value of [{requestId,approve:'false'},{requestId,approve:1},{requestId,approve:true,flag:'other'},{requestId,approve:true,applicantId:'99999999'},{requestId,approve:true,remark:'auto'},{requestId,approve:true,action:'send_private_msg'}])await assert.rejects(f.inbox.decide(value),{code:'invalid_request'});assert.equal(f.state.calls.length,0);assert.equal(f.inbox.list().items.length,1);
});
test('the request is consumed before the first await and a duplicate event cannot replay it',async t=>{
  const f=fixture(t),requestId=f.add(),gate=defer();f.state.preflight=()=>gate.promise;const operation=f.inbox.decide({requestId,approve:true});assert.equal(f.inbox.list().items.length,0);await assert.rejects(f.inbox.decide({requestId,approve:true}),{code:'operation_in_progress'});assert.equal(f.receive(),false);gate.resolve();assert.equal((await operation).outcome,'accepted');await assert.rejects(f.inbox.decide({requestId,approve:true}),{code:'stale_request'});assert.equal(f.state.calls.length,1);
});
test('a conflicting applicant on the same opaque flag invalidates it',async t=>{
  const f=fixture(t),requestId=f.add();assert.equal(f.receive({user_id:'34567890'}),false);assert.deepEqual(f.inbox.list().items,[]);await assert.rejects(f.inbox.decide({requestId,approve:true}),{code:'stale_request'});assert.equal(f.state.calls.length,0);
});
test('a conflict arriving during preflight prevents the fixed action',async t=>{
  const f=fixture(t),requestId=f.add(),gate=defer();f.state.preflight=()=>gate.promise;const operation=f.inbox.decide({requestId,approve:true});await Promise.resolve();assert.equal(f.receive({user_id:'34567890'}),false);gate.resolve();const result=await operation;assert.equal(result.outcome,'not_submitted');assert.equal(result.code,'changed');assert.equal(f.state.calls.length,0);
});
test('the monotonic deadline survives wall-clock rollback and is rechecked after preflight',async t=>{
  const f=fixture(t),requestId=f.add(),gate=defer();f.state.preflight=()=>gate.promise;const operation=f.inbox.decide({requestId,approve:true});await Promise.resolve();f.state.elapsed=300001;f.state.wall-=3600000;gate.resolve();assert.equal((await operation).outcome,'not_submitted');assert.equal(f.state.calls.length,0);
});
test('100 pending requests are bounded and overflow never evicts a replay tombstone',t=>{
  const f=fixture(t);for(let i=0;i<100;i++)assert(f.receive({flag:`synthetic-${i}`}));assert.equal(f.receive({flag:'overflow'}),false);assert.equal(f.inbox.list().overflow,true);assert.equal(f.inbox.list().items.length,100);f.state.elapsed+=300001;assert.equal(f.inbox.list().items.length,0);assert.equal(f.receive({flag:'synthetic-0'}),false);
});
test('socket, connection generation, role or owner changes reject an in-flight preflight',async t=>{
  for(const change of ['socket','generation','scope','owner'])await t.test(change,async t=>{const f=fixture(t),requestId=f.add(),gate=defer();f.state.preflight=()=>gate.promise;const operation=f.inbox.decide({requestId,approve:true});await Promise.resolve();if(change==='socket')f.client.socket={readyState:1};if(change==='generation')f.client.generation++;if(change==='scope')f.setBinding(b=>({...b,scopeId:'synthetic-role-B'}));if(change==='owner'){f.client.ownerId='34567890';f.setBinding(b=>({...b,ownerId:'34567890'}));}gate.resolve();assert.equal((await operation).outcome,'not_submitted');assert.equal(f.state.calls.length,0);assert.equal(f.inbox.list().items.length,0);});
});
test('main context changes immediately before submission remain not submitted',async t=>{
  const f=fixture(t),requestId=f.add();let active=true;f.client._requireOnline=async()=>{active=false;};const result=await f.inbox.decide({requestId,approve:true},{assertCurrent:()=>{if(!active)throw Object.assign(Error('synthetic changed'),{code:'changed'});}});assert.equal(result.outcome,'not_submitted');assert.equal(f.state.calls.length,0);
});
test('a throwing submitter after invocation cannot claim that no operation was submitted',async t=>{
  const f=fixture(t),requestId=f.add();f.inbox.submit=async()=>{throw Object.assign(Error('synthetic late rejection'),{code:'changed'});};const result=await f.inbox.decide({requestId,approve:true});assert.equal(result.outcome,'unknown');assert.equal(result.code,'unknown');await assert.rejects(f.inbox.decide({requestId,approve:true}),{code:'stale_request'});
});
test('malformed or rejected action results become unknown and cannot reuse the request',async t=>{
  for(const reply of [{},[],false])await t.test(JSON.stringify(reply),async t=>{const f=fixture(t),requestId=f.add();f.state.reply=reply;assert.equal((await f.inbox.decide({requestId,approve:true})).outcome,'unknown');assert.equal(f.receive(),false);await assert.rejects(f.inbox.decide({requestId,approve:true}),{code:'stale_request'});});
  const f=fixture(t),requestId=f.add();f.state.write=async()=>{throw Object.assign(Error('synthetic action failed'),{code:'action_failed'});};assert.equal((await f.inbox.decide({requestId,approve:false})).outcome,'unknown');
});
test('accepted after a navigation change retains the captured account receipt',async t=>{
  const f=fixture(t),requestId=f.add(),gate=defer(),entered=defer();f.state.write=()=>{entered.resolve();return gate.promise;};const operation=f.inbox.decide({requestId,approve:true});await entered.promise;f.setBinding(b=>({...b,scopeId:'synthetic-other'}));gate.resolve(null);const result=await operation;assert.equal(result.outcome,'accepted');assert.equal(result.accountId,ACCOUNT);assert.equal(result.requestId,requestId);
});
test('close aborts and waits for an already submitted operation without inventing no effect',async t=>{
  const f=fixture(t),requestId=f.add(),entered=defer();f.state.write=signal=>new Promise((resolve,reject)=>{entered.resolve();signal.addEventListener('abort',()=>reject(Object.assign(Error('synthetic abort'),{code:'cancelled'})),{once:true});});const operation=f.inbox.decide({requestId,approve:true});await entered.promise;assert.equal((await f.inbox.close()).closed,true);assert.equal((await operation).outcome,'unknown');assert.equal(f.receive(),false);assert.equal(f.inbox.list().available,false);
});
test('connection loss clears private pending data and does not authorize another applicant',t=>{
  const f=fixture(t);f.add();f.client.ready=false;assert.equal(f.inbox.list().available,false);assert.equal(f.inbox.entries.size,0);assert.equal(f.inbox.seen.size,0);assert.equal(f.client.ownerId,OWNER);assert.equal(f.state.calls.length,0);
});

test('256 connection tombstones remain bounded after consumed requests and reset only with a new connection',async t=>{
  const f=fixture(t);
  for(let i=0;i<256;i++){
    assert(f.receive({flag:`synthetic-consumed-${i}`}));
    const requestId=f.inbox.list().items[0].requestId;
    assert.equal((await f.inbox.decide({requestId,approve:false})).outcome,'accepted');
  }
  assert.equal(f.inbox.seen.size,256);assert.equal(f.receive({flag:'synthetic-new-overflow'}),false);assert.equal(f.inbox.list().overflow,true);
  assert.equal(f.receive({flag:'synthetic-consumed-0'}),false);assert.equal(f.state.calls.length,256);
  f.client.generation++;f.client.socket={readyState:1};assert.equal(f.inbox.list().items.length,0);assert.equal(f.inbox.seen.size,0);assert.equal(f.receive({flag:'synthetic-new-connection'}),true);
});

test('production client callback, inbox and fixed decision work together without owner routing or flag projection',async t=>{
  const {once}=require('node:events'),{WebSocketServer}=require('ws'),{QQClient}=require('../src/bot/qq.cjs');
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');let socket;const writes=[];
  server.on('connection',value=>{socket=value;socket.on('message',raw=>{const req=JSON.parse(raw);if(req.action==='set_friend_add_request')writes.push(req);const data=req.action==='get_login_info'?{user_id:ACCOUNT}:req.action==='get_status'?{online:true,good:true}:undefined;socket.send(JSON.stringify({echo:req.echo,status:'ok',retcode:0,data}));});});
  let inbox;const client=new QQClient({url:`ws://127.0.0.1:${server.address().port}/`,token:'synthetic-friend-token',ownerId:OWNER,expectedAccountId:ACCOUNT,now:()=>NOW,timeoutMs:1000,onFriendRequest:(event,source)=>inbox.receive(event,source)});
  inbox=new FriendRequestInbox({getBinding:()=>({status:'connected',channel:'qq',client,scopeId:'synthetic-scope',generation:1,accountId:ACCOUNT,ownerId:OWNER}),now:()=>NOW});
  t.after(async()=>{await inbox.close();client.close();for(const value of server.clients)value.terminate();await new Promise(resolve=>server.close(resolve));});
  await client.connect();socket.send(JSON.stringify({post_type:'request',request_type:'friend',self_id:ACCOUNT,user_id:APPLICANT,time:NOW/1000,comment:'Synthetic request',flag:'synthetic-private-flag'}));
  await client._request('get_status',{});const listed=inbox.list();assert.equal(listed.items.length,1);assert.doesNotMatch(JSON.stringify(listed),/synthetic-private-flag|token/);assert.equal(client.queue.length,0);
  const requestId=listed.items[0].requestId,result=await inbox.decide({requestId,approve:true});assert.equal(result.outcome,'accepted');assert.equal(writes.length,1);assert.deepEqual(writes[0].params,{flag:'synthetic-private-flag',approve:true});
  await assert.rejects(inbox.decide({requestId,approve:true}),{code:'stale_request'});assert.equal(client.ownerId,OWNER);
  socket.send(JSON.stringify({post_type:'message',message_type:'private',sub_type:'friend',self_id:ACCOUNT,user_id:APPLICANT,time:NOW/1000,message_id:987,message:'Synthetic new friend cannot use the agent'}));await client._request('get_status',{});assert.equal(client.queue.length,0);
});
