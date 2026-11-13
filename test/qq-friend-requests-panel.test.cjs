'use strict';
// Synthetic identities and inbox replies only; no account connection.
const test=require('node:test'),assert=require('node:assert/strict');
const {QQFriendRequestsPanel,friendRequestsResult}=require('../src/bot/qq-friend-requests-panel.cjs');
const {FriendRequestInbox}=require('../src/bot/qq-friend-requests.cjs');
const PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',SECOND='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',REQUEST='cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const tick=()=>new Promise(resolve=>setImmediate(resolve)),defer=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve};};
function fixture(t){
  const calls=[],now=Date.now();let inboxClose=0;
  const inbox={list:()=>({source:'current-connection-events',complete:false,available:true,overflow:false,busy:false,accountId:'100001',connectedAt:new Date(now).toISOString(),items:[{requestId:REQUEST,applicantId:'300001',comment:'Synthetic verification only.',receivedAt:new Date(now).toISOString(),expiresAt:new Date(now+300000).toISOString(),flag:'PRIVATE'}],token:'PRIVATE'}),
    async decide(input,options){calls.push({input,options});await this.gate?.promise;if(this.preflight)options.assertCurrent();return {kind:'friend-request',accountId:'100001',...input,outcome:'accepted',private:'PRIVATE',...this.result};},async close(){inboxClose++;}};
  const state={selectedId:'whale',visible:true,service:{},generation:1,scopeId:'profile:whale',client:{socket:{}},clientGeneration:2,qqAccountId:'100001',ownerId:'200001',console:{},runtime:{},epoch:1,inbox};
  const args={accountId:'whale',panelId:PANEL};
  const panel=new QQFriendRequestsPanel({capture:value=>{if(!state.visible||state.selectedId!==value.accountId)throw Object.assign(Error('PRIVATE'),{code:'changed'});if(state.busy)throw Object.assign(Error('PRIVATE'),{code:'operation_in_progress'});return {...state};}});
  t.after(()=>panel.close());return {state,panel,args,inbox,calls,get inboxClosed(){return inboxClose;}};
}
test('read projects bounded current-connection data and strips flags and internal identity',async t=>{
  const f=fixture(t),value=await f.panel.read(f.args);assert.equal(value.kind,'friend-requests');assert.equal(value.inbox.items.length,1);assert.equal(value.accountId,'whale');assert.equal(value.panelId,PANEL);assert.doesNotMatch(JSON.stringify(value),/PRIVATE|scopeId|socket|runtime|flag/);assert.equal(f.calls.length,0);
});
test('strict IPC inputs cannot select another friend, action, flag or connection',async t=>{
  const f=fixture(t);for(const extra of [{ownerId:'300001'},{flag:'arbitrary'},{action:'approve'},{url:'ws://example.invalid'},{approve:true}])await assert.rejects(f.panel.read({...f.args,...extra}),{code:'invalid_request'});
  await f.panel.read(f.args);for(const input of [{requestId:REQUEST,approve:'false'},{requestId:'anything',approve:false},{requestId:REQUEST,approve:true,flag:'arbitrary'}])await assert.rejects(f.panel.decide({...f.args,...input}),{code:'invalid_request'});assert.equal(f.calls.length,0);
});
test('read rejects malformed, duplicate, wrong-account and over-limit inbox output',async t=>{
  const f=fixture(t),base=f.inbox.list();const patches=[{accountId:'999999'},{source:'history'},{complete:true},{items:[...base.items,...base.items]},{items:Array(101).fill(base.items[0])},{items:[{...base.items[0],comment:'x'.repeat(501)}]},{items:[{...base.items[0],comment:'bad\u202e'}]},{items:[{...base.items[0],applicantId:'100001'}]},{items:[{...base.items[0],expiresAt:new Date(Date.now()+600000).toISOString()}]}];
  for(const patch of patches){f.inbox.list=()=>({...base,...patch});await assert.rejects(f.panel.read(f.args),{code:'invalid_response'});}
  f.inbox.list=()=>({source:'current-connection-events',complete:false,available:false,overflow:false,items:[],token:'PRIVATE'});assert.equal((await f.panel.read(f.args)).inbox.available,false);
});
test('late read cannot cross service, connection, account, runtime or installation epochs',async t=>{
  for(const key of ['service','generation','scopeId','client','clientGeneration','qqAccountId','ownerId','console','runtime','epoch','inbox']){
    const f=fixture(t),gate=defer(),base=f.inbox.list();f.inbox.list=async()=>{await gate.promise;return base;};const result=f.panel.read(f.args);await tick();f.state[key]=typeof f.state[key]==='number'?f.state[key]+1:typeof f.state[key]==='string'?(key==='qqAccountId'||key==='ownerId'?'900001':'changed'):{};gate.resolve();await assert.rejects(result,error=>['changed','disconnected'].includes(error.code));
  }
});
test('same client socket replacement invalidates a panel even with unchanged capture fields',async t=>{
  const f=fixture(t);await f.panel.read(f.args);f.state.client.socket={};await assert.rejects(f.panel.decide({...f.args,requestId:REQUEST,approve:true}),{code:'changed'});assert.equal(f.calls.length,0);
});
test('a panel closes only its capability, preserving the connection inbox and unread requests',async t=>{
  const f=fixture(t);await f.panel.read(f.args);await f.panel.closeOwned(f.args);assert.equal(f.inboxClosed,0);const value=await f.panel.read({...f.args,panelId:SECOND});assert.equal(value.inbox.items.length,1);await f.panel.closeOwned(f.args);assert.equal(f.panel.panel.panelId,SECOND);
});
test('close aborts the panel decision and waits for settlement without destroying the inbox',async t=>{
  const f=fixture(t);await f.panel.read(f.args);const entered=defer(),gate=defer();f.inbox.decide=async(input,{signal})=>{entered.resolve();await gate.promise;assert.equal(signal.aborted,true);return {kind:'friend-request',accountId:'100001',...input,outcome:'unknown'};};
  const pending=f.panel.decide({...f.args,requestId:REQUEST,approve:false});await entered.promise;let closed=false;const closing=f.panel.closeOwned(f.args).then(()=>{closed=true;});await tick();assert.equal(closed,false);gate.resolve();await closing;assert.equal((await pending).outcome,'unknown');assert.equal(f.inboxClosed,0);
});
test('accepted decisions keep captured correlation when navigation changes after submission',async t=>{
  const f=fixture(t);await f.panel.read(f.args);f.inbox.gate=defer();const pending=f.panel.decide({...f.args,requestId:REQUEST,approve:true});await tick();f.state.visible=false;f.state.selectedId='other';f.panel.observe();f.inbox.gate.resolve();const result=await pending;assert.equal(result.outcome,'accepted');assert.equal(result.qqAccountId,'100001');assert.equal(result.accountId,'whale');assert.equal(result.panelId,PANEL);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|flag/);
});
test('malformed receipt identity or a post-invocation exception cannot claim accepted or not-submitted',async t=>{
  for(const patch of [{accountId:'999999'},{requestId:SECOND},{approve:false},{kind:'other'},{outcome:'invented'}]){const f=fixture(t);await f.panel.read(f.args);f.inbox.result=patch;assert.equal((await f.panel.decide({...f.args,requestId:REQUEST,approve:true})).outcome,'unknown');}
  const f=fixture(t);await f.panel.read(f.args);f.inbox.decide=async()=>{throw Object.assign(Error('PRIVATE'),{code:'changed'});};assert.equal((await f.panel.decide({...f.args,requestId:REQUEST,approve:true})).outcome,'unknown');
});
test('close during retirement cannot reopen an old capability or disturb a newer panel',async t=>{
  const f=fixture(t);await f.panel.read(f.args);f.inbox.gate=defer();const old=f.panel.decide({...f.args,requestId:REQUEST,approve:true});await tick();const reading=f.panel.read({...f.args,panelId:SECOND});await tick();const closing=f.panel.closeOwned({...f.args,panelId:SECOND});f.inbox.gate.resolve();await old;await closing;await assert.rejects(reading,{code:'changed'});assert.equal(f.panel.panel,null);assert.equal(f.inboxClosed,0);
});
test('panel guards reach the fixed client preflight and keep new friends outside owner routing',async t=>{
  const f=fixture(t),now=Date.now(),gate=defer(),client={generation:1,connectedAt:now,socket:{readyState:1},ready:true,closed:false,accountId:'100001',ownerId:'200001'};let writes=0;
  client.decideFriendRequest=async(_value,{assertCurrent})=>{await gate.promise;try{assertCurrent();writes++;return {outcome:'accepted'};}catch(error){return {outcome:'not_submitted',code:error.code};}};
  f.state.client=client;f.state.clientGeneration=1;const inbox=new FriendRequestInbox({getBinding:()=>({status:'connected',channel:'qq',client,scopeId:f.state.scopeId,generation:f.state.generation,accountId:client.accountId,ownerId:client.ownerId})});f.state.inbox=inbox;t.after(()=>inbox.close());
  assert(inbox.receive({self_id:client.accountId,user_id:'300001',time:Math.floor(now/1000),post_type:'request',request_type:'friend',flag:'synthetic-private-flag',comment:'Synthetic'}, {client,generation:1}));
  const list=await f.panel.read(f.args),requestId=list.inbox.items[0].requestId;const pending=f.panel.decide({...f.args,requestId,approve:true});await tick();f.state.busy=true;gate.resolve();const result=await pending;assert.equal(result.outcome,'not_submitted');assert.equal(result.code,'operation_in_progress');assert.equal(writes,0);assert.equal(client.ownerId,'200001');
});
test('error projection exposes only fixed codes',async()=>{
  assert.deepEqual(await friendRequestsResult(()=>{throw Object.assign(Error('PRIVATE TOKEN'),{code:'private_token'});}),{ok:false,code:'invalid_response'});
});
