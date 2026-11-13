'use strict';
// Real loopback WebSocket transport, synthetic account/peer and bridge replies.
// No QQ process, real credentials, model request or user messages are involved.
const test=require('node:test'),assert=require('node:assert/strict'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
const root=require('node:path').resolve(__dirname,'..'),{QQOwnerHistorySession}=require('../src/bot/qq-owner-history-session.cjs'),{QQOwnerSubmissionBook,LIMITS}=require('../src/bot/qq-owner-composer.cjs');
const {QQClient}=require('../src/bot/qq.cjs'),{WebSocketServer,WebSocket}=require('ws');
const ACCOUNT='87654321',OWNER='12345678',PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tick=()=>new Promise(r=>setImmediate(r));
async function until(check){for(let n=0;n<1500;n++){if(check())return;await tick();}throw Error('Fixture condition did not arrive');}
async function fixture(t){
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 const state={requests:[],clients:[],account:ACCOUNT,ownerPresent:true,online:true,mode:'ok',visible:true,verify:async()=>({verified:true}),messageId:321,captures:[],outcomes:[],captureHook:null};
 server.on('connection',socket=>socket.on('message',bytes=>{const req=JSON.parse(bytes);state.requests.push(req);state.before?.(req);let data;
  if(req.action==='get_login_info')data={user_id:state.account};else if(req.action==='get_status')data={online:state.online,good:true};else if(req.action==='get_friend_list')data=state.ownerPresent?[{user_id:OWNER}]:[];else if(req.action==='get_friend_msg_history')data={messages:[]};else if(req.action==='send_private_msg'){
   if(state.mode==='hold')return;if(state.mode==='disconnect'){socket.close();return;}if(state.mode==='refused'){socket.send(JSON.stringify({echo:req.echo,status:'failed',retcode:1200,message:'PRIVATE_BODY'}));return;}data=state.mode==='invalid'?{message_id:'malformed',private:'PRIVATE_BODY'}:{message_id:state.messageId};
  }else throw Error('Unexpected '+req.action);
  if(socket.readyState===1)socket.send(JSON.stringify({echo:req.echo,status:'ok',retcode:0,data}));
 }));
 const options={url:`ws://127.0.0.1:${server.address().port}/`,token:'synthetic-composer-token',ownerId:OWNER,expectedAccountId:ACCOUNT,receiveOwnerMessages:false,timeoutMs:200,socketFactory:(url,opts)=>new WebSocket(url,opts)};
 const stable={profileId:'synthetic-profile',profile:{},generation:1,characterId:'synthetic-character',runtime:{},installation:{},runtimeEpoch:1,bridgeRevision:'synthetic-revision',endpointId:'synthetic-endpoint',qqAccountId:ACCOUNT,ownerId:OWNER,url:options.url,token:options.token,channel:'qq',status:'disconnected'};
 const manager=new QQOwnerHistorySession({captureSubmission:captured=>{state.captures.push(captured);const finish=state.captureHook?.(captured);return outcome=>{state.outcomes.push(outcome);return finish?.(outcome);};},capture:input=>{if(!state.visible)throw Object.assign(Error('hidden'),{code:'changed'});return {...stable,panelId:input.panelId};},verifyContext:(...args)=>state.verify(...args),clientFactory:o=>{const c=new QQClient({...options,...o});state.clients.push(c);return c;}});
 const input={accountId:stable.profileId,panelId:PANEL};manager.open(input);const send=(text='SYNTHETIC_PRIVATE_DRAFT',submissionId=randomUUID())=>manager.send({...input,text,submissionId});
 t.after(async()=>{await manager.close();for(const c of server.clients)c.terminate();await new Promise(r=>server.close(r));});return {server,state,stable,manager,input,send};
}
const {SocialStore}=require('../src/bot/social-store.cjs'),Manual=require('../src/bot/manual-qq-receipts.cjs');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
function storeFor(t){const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-manual-composer-'));assert(directory.startsWith(path.resolve(os.tmpdir())+path.sep));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));const store=new SocialStore({root:directory});assert(store.available);return store;}
const context=binding=>({accountId:binding.qqAccountId,ownerId:binding.ownerId,characterId:binding.characterId});
test('manual text accepted receipt records only bounded metadata once, not its typed body or history',async t=>{
 const f=await fixture(t),store=storeFor(t);f.state.captureHook=binding=>store.captureManualQQ(Manual.scope(context(binding)));
 const id=randomUUID(),first=await f.send('PRIVATE_TYPED_BODY',id),again=await f.send('PRIVATE_TYPED_BODY',id);
 assert.equal(first.submission.outcome,'accepted');assert.deepEqual(first,again);assert.equal(f.state.captures.length,1);assert.equal(f.state.outcomes.length,1);
 assert.deepEqual(Object.keys(f.state.outcomes[0]).sort(),['id','media','messageId','outcome']);assert.doesNotMatch(JSON.stringify(f.state.outcomes),/PRIVATE_TYPED_BODY/);
 const scope=Manual.scope(context(f.stable));assert.equal(store.manualQQActions(scope).length,1);assert.deepEqual(store.history(scope),[]);
 assert.equal(f.state.requests.filter(row=>row.action==='send_private_msg').length,1);assert(!f.state.requests.some(row=>row.action==='get_friend_msg_history'));
});
test('manual text bridge refusal after submission remains unknown while preflight offline is not-submitted',async t=>{
 const f=await fixture(t);f.state.mode='refused';assert.equal((await f.send()).submission.outcome,'unknown');assert.equal(f.state.outcomes[0].outcome,'unknown');assert.equal(f.state.outcomes[0].messageId,null);
 f.state.mode='ok';f.state.online=false;const count=f.state.requests.filter(row=>row.action==='send_private_msg').length;
 assert.equal((await f.send()).submission.outcome,'not_submitted');assert.equal(f.state.outcomes[1].outcome,'not_submitted');assert.equal(f.state.requests.filter(row=>row.action==='send_private_msg').length,count);
});
test('forget during manual text send blocks late metadata, and querying/replaying acceptance cannot restore it',async t=>{
 const f=await fixture(t),store=storeFor(t),scope=Manual.scope(context(f.stable));f.state.captureHook=binding=>store.captureManualQQ(Manual.scope(context(binding)));
 let release;f.manager.composerTransport={send:async(_binding,{onAttempt})=>{onAttempt();await new Promise(r=>{release=r;});return {messageId:'-9'};}};
 const id=randomUUID(),pending=f.send('private',id);await until(()=>release);store.clear(scope);release();const result=await pending;
 assert.equal(result.submission.outcome,'accepted');assert.deepEqual(store.manualQQActions(scope),[]);
 assert.equal(f.manager.querySend({...f.input,submissionId:id}).submission.outcome,'accepted');assert.equal((await f.send('private',id)).submission.outcome,'accepted');assert.equal(f.state.captures.length,1);assert.deepEqual(store.manualQQActions(scope),[]);
});
test('late known text receipt belongs to its original character scope after management retirement',async t=>{
 const f=await fixture(t),store=storeFor(t),original=Manual.scope(context(f.stable));f.state.captureHook=binding=>store.captureManualQQ(Manual.scope(context(binding)));
 let release;f.manager.composerTransport={send:async(_binding,{onAttempt})=>{onAttempt();await new Promise(r=>{release=r;});return {messageId:'123'};}};
 const pending=f.send();await until(()=>release);const closing=f.manager.closeOwned(f.input);f.stable.characterId='another-character';release();const result=await pending;await closing;
 assert.equal(result.submission.outcome,'accepted');assert.equal(store.manualQQActions(original).length,1);assert.deepEqual(store.manualQQActions(Manual.scope(context(f.stable))),[]);
});
test('local recording failure cannot erase a known text acceptance or call send again',async t=>{
 const f=await fixture(t);f.state.captureHook=()=>()=>{throw Error('synthetic storage failure');};
 const result=await f.send();assert.equal(result.submission.outcome,'accepted');assert.equal(f.state.requests.filter(row=>row.action==='send_private_msg').length,1);
});
