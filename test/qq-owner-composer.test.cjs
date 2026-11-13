'use strict';
// Real loopback WebSocket transport, synthetic account/peer and bridge replies.
// No QQ process, real credentials, model request or user messages are involved.
const test=require('node:test'),assert=require('node:assert/strict'),{once}=require('node:events'),{randomUUID}=require('node:crypto');
const root=require('node:path').resolve(__dirname,'..'),{QQOwnerHistorySession}=require('../src/bot/qq-owner-history-session.cjs'),{QQOwnerSubmissionBook,LIMITS}=require('../src/bot/qq-owner-composer.cjs');
const {QQClient}=require('../src/bot/qq.cjs'),{WebSocketServer,WebSocket}=require(root+'/node_modules/ws');
const ACCOUNT='87654321',OWNER='12345678',PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const tick=()=>new Promise(r=>setImmediate(r));
async function until(check){for(let n=0;n<1500;n++){if(check())return;await tick();}throw Error('Fixture condition did not arrive');}
async function fixture(t){
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 const state={requests:[],clients:[],account:ACCOUNT,ownerPresent:true,online:true,mode:'ok',visible:true,verify:async()=>({verified:true}),messageId:321};
 server.on('connection',socket=>socket.on('message',bytes=>{const req=JSON.parse(bytes);state.requests.push(req);state.before?.(req);let data;
  if(req.action==='get_login_info')data={user_id:state.account};else if(req.action==='get_status')data={online:state.online,good:true};else if(req.action==='get_friend_list')data=state.ownerPresent?[{user_id:OWNER}]:[];else if(req.action==='get_friend_msg_history')data={messages:[]};else if(req.action==='send_private_msg'){
   if(state.mode==='hold')return;if(state.mode==='disconnect'){socket.close();return;}if(state.mode==='refused'){socket.send(JSON.stringify({echo:req.echo,status:'failed',retcode:1200,message:'PRIVATE_BODY'}));return;}data=state.mode==='invalid'?{message_id:'malformed',private:'PRIVATE_BODY'}:{message_id:state.messageId};
  }else throw Error('Unexpected '+req.action);
  if(socket.readyState===1)socket.send(JSON.stringify({echo:req.echo,status:'ok',retcode:0,data}));
 }));
 const options={url:`ws://127.0.0.1:${server.address().port}/`,token:'synthetic-composer-token',ownerId:OWNER,expectedAccountId:ACCOUNT,receiveOwnerMessages:false,timeoutMs:200,socketFactory:(url,opts)=>new WebSocket(url,opts)};
 const stable={profileId:'synthetic-profile',profile:{},generation:1,characterId:'synthetic-character',runtime:{},installation:{},runtimeEpoch:1,bridgeRevision:'synthetic-revision',endpointId:'synthetic-endpoint',qqAccountId:ACCOUNT,ownerId:OWNER,url:options.url,token:options.token,channel:'qq',status:'disconnected'};
 const manager=new QQOwnerHistorySession({capture:input=>{if(!state.visible)throw Object.assign(Error('hidden'),{code:'changed'});return {...stable,panelId:input.panelId};},verifyContext:(...args)=>state.verify(...args),clientFactory:o=>{const c=new QQClient({...options,...o});state.clients.push(c);return c;}});
 const input={accountId:stable.profileId,panelId:PANEL};manager.open(input);const send=(text='SYNTHETIC_PRIVATE_DRAFT',submissionId=randomUUID())=>manager.send({...input,text,submissionId});
 t.after(async()=>{await manager.close();for(const c of server.clients)c.terminate();await new Promise(r=>server.close(r));});return {server,state,stable,manager,input,send};
}
test('first manual send works while AI is disconnected without reading history or fabricating an inbound context',async t=>{
 const f=await fixture(t),text='Hello <script>literal</script> [CQ:image,file=literal]\n你好';const r=await f.send(text);
 assert.equal(r.submission.outcome,'accepted');assert.equal(r.submission.messageId,'321');assert.equal(r.qqAccountId,ACCOUNT);assert.equal(r.ownerId,OWNER);assert.equal(f.state.clients.length,1);assert.equal(f.state.clients[0].receiveOwnerMessages,false);assert.equal(f.state.clients[0].contextToken,'');
 assert.equal(f.state.requests.some(q=>q.action==='get_friend_msg_history'),false);const send=f.state.requests.filter(q=>q.action==='send_private_msg');assert.equal(send.length,1);assert.deepEqual(send[0].params,{user_id:Number(OWNER),message:[{type:'text',data:{text}}],auto_escape:true});assert.doesNotMatch(JSON.stringify(r),/SYNTHETIC|token|url|delivered|readReceipt/);
});
test('double click and exact submission replay make only one write; changed text or panel cannot reuse its ID',async t=>{
 const f=await fixture(t),id=randomUUID(),a=f.send('same',id),b=f.send('same',id);assert.deepEqual(await a,await b);assert.deepEqual(await f.send('same',id),await a);assert.equal(f.state.requests.filter(q=>q.action==='send_private_msg').length,1);
 await assert.rejects(f.send('different',id),{code:'submission_conflict'});await assert.rejects(f.manager.send({...f.input,panelId:randomUUID(),text:'same',submissionId:id}),{code:'changed'});
 const result=f.manager.querySend({...f.input,submissionId:id});assert.equal(result.submission.outcome,'accepted');assert.equal(f.state.requests.filter(q=>q.action==='send_private_msg').length,1);
});
test('recipient/action/URL injection and invalid plain text are rejected before opening a connection',async t=>{
 const f=await fixture(t);for(const patch of [{user_id:OWNER},{ownerId:OWNER},{action:'send_group_msg'},{url:f.stable.url},{text:''},{text:'x'.repeat(4001)},{text:'bad\u0000'}])await assert.rejects(f.manager.send({...f.input,submissionId:randomUUID(),text:'ok',...patch}));assert.equal(f.state.clients.length,0);
});
test('friendship, offline and actual-account mismatch are not-submitted and have zero writes',async t=>{
 for(const mode of ['ownerPresent','online','account']){const f=await fixture(t);f.state[mode]=mode==='account'?'99999999':false;const r=await f.send();assert.equal(r.submission.outcome,'not_submitted',mode);assert.equal(f.state.requests.filter(q=>q.action==='send_private_msg').length,0,mode);}
});
test('identity change after friend lookup is rejected before send',async t=>{const f=await fixture(t);f.state.before=req=>{if(req.action==='get_friend_list')f.state.account='99999999';};const r=await f.send();assert.equal(r.submission.outcome,'not_submitted');assert.equal(r.submission.code,'account_changed');assert.equal(f.state.requests.filter(q=>q.action==='send_private_msg').length,0);});
test('timeout, failed bridge reply, invalid receipt and disconnect after attempt remain unknown and never replay',async t=>{
 for(const mode of ['hold','refused','invalid','disconnect']){const f=await fixture(t),id=randomUUID();f.state.mode=mode;const r=await f.send('only once',id);assert.equal(r.submission.outcome,'unknown',mode);assert.equal(r.submission.messageId,null);assert.doesNotMatch(JSON.stringify(r),/PRIVATE_BODY/);await f.manager.retiring;const count=f.state.requests.length;assert.deepEqual(await f.send('only once',id),r);assert.equal(f.state.requests.length,count);assert.equal(f.state.requests.filter(q=>q.action==='send_private_msg').length,1);}
});
test('immediate close before setup can finish cannot create a late send',async t=>{
 const f=await fixture(t),id=randomUUID(),pending=f.send('close immediately',id),closing=f.manager.closeOwned(f.input);const r=await pending;await closing;assert.equal(r.submission.outcome,'not_submitted');assert.equal(f.state.requests.filter(q=>q.action==='send_private_msg').length,0);assert.equal(f.manager.session,null);
});
test('already closed panel rejects a delayed send; opening another panel does not revive the old one',async t=>{const f=await fixture(t),id=randomUUID();await f.manager.closeOwned(f.input);await assert.rejects(f.send('late',id),{code:'changed'});assert.equal(f.state.clients.length,0);f.manager.open({...f.input,panelId:randomUUID()});await assert.rejects(f.send('late',id),{code:'changed'});assert.equal(f.state.clients.length,0);});
test('close after attempted write records unknown, closes only the owned connection and makes query read-only',async t=>{
 const f=await fixture(t),other=new QQClient({url:f.stable.url,token:f.stable.token,ownerId:OWNER,expectedAccountId:ACCOUNT,receiveOwnerMessages:false});await other.connect();t.after(()=>other.close());f.state.mode='hold';const id=randomUUID(),pending=f.send('pending',id);await until(()=>f.state.requests.some(q=>q.action==='send_private_msg'));const client=f.manager.session.client;await f.manager.closeOwned(f.input);const r=await pending;assert.equal(r.submission.outcome,'unknown');assert.equal(client.closed,true);assert.equal(other.ready,true);const count=f.state.requests.length;assert.equal(f.manager.querySend({...f.input,submissionId:id}).submission.outcome,'unknown');assert.equal(f.state.requests.length,count);
});
test('all captured account/installation generations invalidate setup before writing',async t=>{
 for(const [key,value]of Object.entries({profile:{},runtime:{},installation:{},generation:2,runtimeEpoch:2,bridgeRevision:'changed',endpointId:'changed',ownerId:'99999999',qqAccountId:'99999998',status:'connected',characterId:'other'})){const f=await fixture(t);let release;f.state.verify=()=>new Promise(r=>{release=r;});const pending=f.send();await until(()=>release);f.stable[key]=value;release({verified:true});const r=await pending;assert.equal(r.submission.outcome,'not_submitted',key);assert.equal(f.state.requests.filter(q=>q.action==='send_private_msg').length,0,key);}
});
test('history and send serialize one management socket without fetching history to send',async t=>{
 const f=await fixture(t);await f.send();const client=f.manager.session.client;await f.manager.read({...f.input,cursor:null});assert.equal(f.state.clients.length,1);assert.equal(f.manager.session.client,client);f.state.mode='hold';const pending=f.send();await until(()=>f.state.requests.filter(q=>q.action==='send_private_msg').length===2);await assert.rejects(f.manager.read({...f.input,cursor:null}),{code:'operation_in_progress'});await f.manager.closeOwned(f.input);await pending;
});
test('known late receipt is retained even after ownership retires, without running post-write checks as retry permission',async t=>{
 const f=await fixture(t);let release;f.manager.composerTransport={send:async(_b,{onAttempt})=>{onAttempt();await new Promise(r=>{release=r;});return {messageId:'-9'};}};const id=randomUUID(),pending=f.send('late',id);await until(()=>release);const closing=f.manager.closeOwned(f.input);release();const r=await pending;await closing;assert.equal(r.submission.outcome,'accepted');assert.equal(r.submission.messageId,'-9');assert.equal(f.manager.querySend({...f.input,submissionId:id}).submission.outcome,'accepted');
});
test('book is bounded without evicting unknown IDs; it never stores message plaintext or bridge credentials',async()=>{
 const book=new QQOwnerSubmissionBook(),binding={qqAccountId:ACCOUNT,ownerId:OWNER},input={accountId:'synthetic',panelId:PANEL,text:'SECRET_SYNTHETIC_DRAFT'};for(let i=0;i<LIMITS.submissions;i++)await book.submit({...input,submissionId:randomUUID()},binding,async mark=>{mark();throw {code:'action_timeout'};});assert.equal(book.records.size,LIMITS.submissions);assert.throws(()=>book.submit({...input,submissionId:randomUUID()},binding,async()=>({messageId:'1'})),{code:'submission_limit'});assert.doesNotMatch(JSON.stringify([...book.records]),/SECRET_SYNTHETIC_DRAFT|token|url/);
});
test('submission identity preserves distinct UTF-16 text even for unpaired code units',async()=>{const book=new QQOwnerSubmissionBook(),binding={qqAccountId:ACCOUNT,ownerId:OWNER},input={accountId:'synthetic',panelId:PANEL,submissionId:randomUUID(),text:'\ud800'};await book.submit(input,binding,async()=>({messageId:'1'}));assert.throws(()=>book.submit({...input,text:'\ud801'},binding,async()=>({messageId:'2'})),{code:'submission_conflict'});});
