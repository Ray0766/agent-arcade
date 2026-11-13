'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{once}=require('node:events');
const root=require('node:path').resolve(__dirname,'..'),load=name=>require(root+'/src/bot/'+name);
const {QQOwnerHistorySession}=load('qq-owner-history-session.cjs'),{projectPage,segments}=load('qq-owner-history.cjs');
const {QQClient}=require(root+'/src/bot/qq.cjs'),{WebSocketServer,WebSocket}=require(root+'/node_modules/ws');
const ACCOUNT='87654321',OWNER='12345678',PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',NEXT='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const tick=()=>new Promise(r=>setImmediate(r));
const row=(n,extra={})=>({self_id:ACCOUNT,user_id:n%2?OWNER:ACCOUNT,sender:{user_id:n%2?OWNER:ACCOUNT,nickname:'UNPROJECTED_NICKNAME'},message_type:'private',sub_type:'friend',message_id:n,real_seq:String(n),time:1700000000+n,message:[{type:'text',data:{text:'Synthetic '+n}}],raw_message:'UNPROJECTED_RAW',...extra});
async function fixture(t){
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 const state={requests:[],created:[],account:ACCOUNT,online:true,ownerPresent:true,now:1000,history:req=>({messages:req.params.message_seq?[row(Number(req.params.message_seq)),row(Number(req.params.message_seq)-1)]:[row(10),row(11)]}),verify:async()=>({verified:true}),visible:true};
 server.on('connection',socket=>socket.on('message',async bytes=>{const req=JSON.parse(bytes);state.requests.push(req);state.before?.(req);let data;
  if(req.action==='get_login_info')data={user_id:state.account};else if(req.action==='get_status')data={online:state.online,good:true};else if(req.action==='get_friend_list')data=state.ownerPresent?[{user_id:OWNER}]:[];else if(req.action==='get_friend_msg_history'){data=await state.history(req);if(data==='failed'){if(socket.readyState===1)socket.send(JSON.stringify({echo:req.echo,status:'failed',retcode:1200,message:'PRIVATE_REMOTE_ERROR'}));return;}if(data==='hold')return;}else throw Error('Unexpected action '+req.action);if(socket.readyState===1)socket.send(JSON.stringify({echo:req.echo,status:'ok',retcode:0,data}));}));
 const options={url:`ws://127.0.0.1:${server.address().port}/`,token:'synthetic-history-token',ownerId:OWNER,expectedAccountId:ACCOUNT,receiveOwnerMessages:false,timeoutMs:300,socketFactory:(url,opts)=>new WebSocket(url,opts)};
 const stable={profileId:'synthetic-profile',profile:{},generation:1,characterId:'synthetic-character',runtime:{},installation:{},runtimeEpoch:1,bridgeRevision:'synthetic-revision',endpointId:'synthetic-endpoint',qqAccountId:ACCOUNT,ownerId:OWNER,url:options.url,token:options.token,channel:'qq',status:'disconnected'};
 const manager=new QQOwnerHistorySession({capture:input=>{if(!state.visible)throw Object.assign(Error('hidden'),{code:'changed'});return {...stable,panelId:input.panelId};},verifyContext:(...args)=>state.verify(...args),clientFactory:o=>{const c=new QQClient({...options,...o});state.created.push(c);return c;},monotonic:()=>state.now});
 const other=new QQClient(options);await other.connect();const input={accountId:stable.profileId,panelId:PANEL};
 t.after(async()=>{state.release?.();await manager.close();other.close();for(const c of server.clients)c.terminate();await new Promise(r=>server.close(r));});
 return {server,state,stable,manager,other,input,read:(cursor=null)=>manager.read({...input,cursor})};
}
test('explicit request-only socket reads bounded owner history, strips private metadata and is independently closed',async t=>{
 const f=await fixture(t),before=f.state.requests.length;assert.equal(f.manager.availability(f.input).available,true);assert.equal(f.state.requests.length,before);const result=await f.read(),client=f.manager.session.client;
 assert.equal(client.receiveOwnerMessages,false);assert.equal(client.allowOwnerVoice,false);assert.notEqual(client,f.other);assert.equal(result.ownerId,OWNER);assert.deepEqual(result.page.rows.map(r=>r.direction),['outgoing','incoming']);assert.equal(result.page.completeHistory,false);assert.equal(result.page.mediaLoaded,false);assert.doesNotMatch(JSON.stringify(result),/UNPROJECTED|token|url/);
 const query=f.state.requests.find(r=>r.action==='get_friend_msg_history');assert.deepEqual(query.params,{user_id:OWNER,count:20,reverse_order:false,reverseOrder:false,disable_get_url:true,parse_mult_msg:false,quick_reply:false});
 await f.manager.closeOwned(f.input);assert.equal(client.closed,true);assert.equal(f.other.ready,true);assert(f.state.requests.every(r=>['get_login_info','get_status','get_friend_list','get_friend_msg_history'].includes(r.action)));
});
test('older page uses only captured message id and omits include-self anchor; stale/reused and foreign cursors cannot query',async t=>{
 const f=await fixture(t);f.state.history=req=>({messages:req.params.message_seq?[row(10,{real_seq:'1000'}),row(9,{real_seq:'900'})]:[row(10,{real_seq:'1000'}),row(11,{real_seq:'1100'})]});const first=await f.read(),cursor=first.page.nextCursor,next=await f.read(cursor);assert.deepEqual(next.page.rows.map(r=>r.messageId),['9']);assert.equal(next.page.pageNumber,2);assert.deepEqual(f.state.requests.filter(r=>r.action==='get_friend_msg_history').at(-1).params,{user_id:OWNER,count:20,reverse_order:true,reverseOrder:true,disable_get_url:true,parse_mult_msg:false,quick_reply:false,message_seq:'10'});const count=f.state.requests.length;
 await assert.rejects(f.read(cursor),{code:'cursor_not_found'});await assert.rejects(f.manager.read({...f.input,panelId:NEXT,cursor:next.page.nextCursor}),{code:'cursor_session_mismatch'});assert.equal(f.state.requests.length,count);
});
test('cursor expiry is not a complete-history statement; late/duplicate or unsequenced older data is refused',async t=>{
 for(const returned of [[row(12)],[row(9),row(9)],[row(9,{real_seq:'bad'})]]){const f=await fixture(t),first=await f.read();f.state.history=()=>({messages:returned});await assert.rejects(f.read(first.page.nextCursor));await f.manager.retiring;assert.equal(f.state.created[0].closed,true);assert.equal(f.other.ready,true);}
 const f=await fixture(t),first=await f.read();f.state.now+=300001;const n=f.state.requests.length;await assert.rejects(f.read(first.page.nextCursor),{code:'cursor_expired'});assert.equal(f.state.requests.length,n);
});
test('group, other sender, wrong self, oversize pages and unsupported row formats never escape projection',()=>{
 const bad=[row(1,{message_type:'group'}),row(1,{sub_type:'group'}),row(1,{self_id:'99999999'}),row(1,{sender:{user_id:'99999999'}}),row(1,{group_id:0}),row(1,{message:[{type:'text',data:{text:'x'.repeat(16001)}}]})];
 for(const r of bad)assert.throws(()=>projectPage({messages:[r]},{accountId:ACCOUNT,ownerId:OWNER}));assert.throws(()=>projectPage({messages:Array.from({length:21},(_,i)=>row(i+1))},{accountId:ACCOUNT,ownerId:OWNER}));
 const projected=projectPage({messages:[row(1,{message:[{type:'image',data:{url:'https://PRIVATE.invalid/a',file:'PRIVATE_PATH'}},{type:'json',data:{data:'PRIVATE_CARD'}},{type:'text',data:{text:'Visible <script>literal</script>'}}]})]},{accountId:ACCOUNT,ownerId:OWNER});assert.deepEqual(projected.rows[0].parts,[{kind:'image'},{kind:'json'},{kind:'text',text:'Visible <script>literal</script>'}]);assert.doesNotMatch(JSON.stringify(projected),/PRIVATE/);
});
test('CQ text format decodes text but never surfaces media attributes or malformed raw CQ syntax',()=>{
 assert.deepEqual(segments('Hello &amp; &#91;world&#93; [CQ:image,file=PRIVATE_FILE,url=https://PRIVATE.invalid/a] OK').parts,[{kind:'text',text:'Hello & [world] '},{kind:'image'},{kind:'text',text:' OK'}]);assert.throws(()=>segments('abc[CQ:image,url=PRIVATE_UNCLOSED'));assert.throws(()=>segments('abc[CQ:broken PRIVATE_PREFIX [CQ:image,file=private]'));
});
test('pinned zero short id displays but cannot become a cursor; missing native time is not guessed as milliseconds',()=>{
 const p=projectPage({messages:[row(0,{real_seq:'1',time:1794000000000}),row(2,{real_seq:'2',time:1794000000})]},{accountId:ACCOUNT,ownerId:OWNER});assert.equal(p.rows[0].messageId,'0');assert.equal(p.anchor,null);assert.equal(p.rows[0].time,null);assert.equal(p.rows[1].time,1794000000000);
});
test('mixed sequence observations use one consistent time ordering, not a non-transitive comparator',()=>{
 const p=projectPage({messages:[row(4,{real_seq:'30',time:30}),row(5,{real_seq:null,time:20}),row(6,{real_seq:'10',time:10})]},{accountId:ACCOUNT,ownerId:OWNER});assert.deepEqual(p.rows.map(r=>r.messageId),['6','5','4']);assert.equal(p.anchor,null);
 const unknown=projectPage({messages:[row(4,{real_seq:'30',time:30}),row(5,{real_seq:null,time:1794000000000}),row(6,{real_seq:'10',time:10})]},{accountId:ACCOUNT,ownerId:OWNER});assert.deepEqual(unknown.rows.map(r=>r.messageId),['4','5','6']);assert.equal(unknown.anchor,null);
});
test('closing a pending read aborts its socket and discards late content; another account socket stays alive',async t=>{
 const f=await fixture(t);let release;f.state.history=()=>new Promise(r=>{release=r;});const p=f.read();while(!release)await tick();const client=f.manager.session.client;const closing=f.manager.closeOwned(f.input);release({messages:[row(1,{message:[{type:'text',data:{text:'NEVER_DISPLAY_LATE'}}]})]});await assert.rejects(p);await closing;assert.equal(client.closed,true);assert.equal(f.manager.session,null);assert.equal(f.other.ready,true);
});
test('fresh verification rejects a changed scope before creating a client, and post-history identity change rejects content',async t=>{
 const f=await fixture(t);let release;f.state.verify=()=>new Promise(r=>{release=r;});const p=f.read();while(!release)await tick();const close=f.manager.closeOwned(f.input);release({verified:true});await assert.rejects(p);await close;assert.equal(f.state.created.length,0);
 const g=await fixture(t);g.state.history=()=>{g.state.account='99999999';return {messages:[row(1)]};};await assert.rejects(g.read(),{code:'account_changed'});assert.equal(g.other.ready,true);
});
test('all scope substitutions invalidate history and do not borrow an AI socket',async t=>{
 for(const [key,value]of Object.entries({profile:{},runtime:{},installation:{},generation:2,runtimeEpoch:2,bridgeRevision:'changed',endpointId:'changed',ownerId:'99999999',qqAccountId:'99999998',status:'connected',characterId:'other'})){const f=await fixture(t),first=await f.read();f.stable[key]=value;await assert.rejects(f.read(first.page.nextCursor));f.manager.observe();await f.manager.retiring;assert.equal(f.state.created[0].closed,true,key);assert.equal(f.other.ready,true,key);}
});
test('owner friendship and bridge errors remain unavailable rather than false empty-history success',async t=>{
 const f=await fixture(t);f.state.ownerPresent=false;await assert.rejects(f.read(),{code:'owner_not_friend'});assert.equal(f.state.requests.filter(r=>r.action==='get_friend_msg_history').length,0);
 const g=await fixture(t);g.state.history=()=> 'failed';await assert.rejects(g.read(),e=>{assert.doesNotMatch(e.message,/PRIVATE_REMOTE/);return true;});assert.equal(g.manager.session,null);
});
test('injected recipients/actions fail locally; cursor limit is bounded and refresh creates a new sequence',async t=>{
 const f=await fixture(t);for(const v of [{...f.input,cursor:null,ownerId:OWNER},{...f.input,cursor:null,url:f.stable.url},{...f.input,cursor:'100'}])await assert.rejects(f.manager.read(v));assert.equal(f.state.created.length,0);
 f.state.history=req=>({messages:[row(req.params.message_seq?Number(req.params.message_seq)-1:100)]});let p=await f.read();for(let i=0;i<9;i++)p=await f.read(p.page.nextCursor);assert.equal(p.page.pageNumber,10);assert.equal(p.page.nextCursor,null);assert.equal(p.page.continuation,'limit');assert.equal(p.page.completeHistory,false);p=await f.read();assert.equal(p.page.pageNumber,1);
});

test('cursor diagnostics distinguish exact expiry, missing record, and retired binding without a bridge query',async t=>{
 for(const [kind,expected]of [['expired','cursor_expired'],['unknown','cursor_not_found'],['closed','cursor_session_mismatch'],['binding','cursor_session_mismatch']]){
  const f=await fixture(t),first=await f.read();let cursor=first.page.nextCursor;
  if(kind==='expired')f.state.now+=300000;else if(kind==='unknown')cursor=NEXT;else if(kind==='closed')await f.manager.closeOwned(f.input);else f.stable.bridgeRevision='different-synthetic-revision';
  const before=f.state.requests.length,clients=f.state.created.length;await assert.rejects(f.read(cursor),{code:expected});assert.equal(f.state.requests.length,before,kind);assert.equal(f.state.created.length,clients,kind);assert.equal(f.other.ready,true);
 }
 const f=await fixture(t),first=await f.read();f.state.now+=299999;assert.equal((await f.read(first.page.nextCursor)).page.pageNumber,2);
});
test('sequence diagnostics survive actual transport/session/result sanitization and retire only their own socket',async t=>{
 const {ownerHistoryResult}=load('qq-owner-history-session.cjs');
 for(const [value,expected]of [[undefined,'history_sequence_missing'],[null,'history_sequence_missing'],['PRIVATE_BAD_SEQUENCE','history_sequence_invalid'],[9,'history_sequence_invalid'],['0','history_sequence_invalid'],['12','history_page_newer']]){
  const f=await fixture(t),first=await f.read();f.state.history=()=>({messages:[row(9,{real_seq:value,message:[{type:'text',data:{text:'PRIVATE_BODY_MUST_NOT_ESCAPE'}}]})]});
  const result=await ownerHistoryResult({...f.input,cursor:first.page.nextCursor},()=>f.read(first.page.nextCursor));assert.deepEqual(result,{ok:false,...f.input,code:expected});assert.doesNotMatch(JSON.stringify(result),/PRIVATE|real_seq|message_id/);await f.manager.retiring;assert.equal(f.manager.session,null);assert.equal(f.state.created[0].closed,true);assert.equal(f.other.ready,true);const req=f.state.requests.filter(r=>r.action==='get_friend_msg_history').at(-1);assert.deepEqual(req.params,{user_id:OWNER,count:20,reverse_order:true,reverseOrder:true,disable_get_url:true,parse_mult_msg:false,quick_reply:false,message_seq:'10'});
 }
});
test('new diagnostic codes do not reinterpret equal anchors, empty results, or unsequenced latest pages',()=>{
 const options={accountId:ACCOUNT,ownerId:OWNER,anchor:{messageId:'10',sequence:'10'}};
 const same=projectPage({messages:[row(10),row(9)]},options);assert.deepEqual(same.rows.map(r=>r.messageId),['9']);assert.deepEqual(projectPage({messages:[row(10)]},options).rows,[]);assert.deepEqual(projectPage({messages:[]},options).rows,[]);
 const latest=projectPage({messages:[row(9,{real_seq:null})]},{accountId:ACCOUNT,ownerId:OWNER});assert.equal(latest.rows.length,1);assert.equal(latest.anchor,null);assert.equal(latest.completeHistory,false);
});
test('diagnostic result projection has only known scalar code and caller correlation, never raw error material',async()=>{
 const {ownerHistoryResult}=load('qq-owner-history-session.cjs');
 for(const code of ['cursor_session_mismatch','cursor_not_found','cursor_expired','history_sequence_missing','history_sequence_invalid','history_page_newer','constructor','__proto__','PRIVATE_UNKNOWN']){
  const result=await ownerHistoryResult({accountId:'synthetic-profile',panelId:PANEL},async()=>{throw Object.assign(Error('PRIVATE_BODY_MUST_NOT_ESCAPE'),{code,raw:{messageId:'PRIVATE_MESSAGE_ID',sequence:'PRIVATE_SEQUENCE'}});});
  assert.deepEqual(Object.keys(result).sort(),['accountId','code','ok','panelId']);assert.equal(result.code,['constructor','__proto__','PRIVATE_UNKNOWN'].includes(code)?'unavailable':code);assert.doesNotMatch(JSON.stringify(result),/PRIVATE/);
 }
});

test('anchored true-direction requests still reject newer sequences with no automatic fallback',async t=>{
 const f=await fixture(t),first=await f.read();f.state.history=()=>({messages:[row(12)]});
 await assert.rejects(f.read(first.page.nextCursor),{code:'history_page_newer'});await f.manager.retiring;await tick();
 const queries=f.state.requests.filter(r=>r.action==='get_friend_msg_history');assert.equal(queries.length,2);
 assert.equal(queries[0].params.reverse_order,false);assert.equal(queries[0].params.reverseOrder,false);
 assert.equal(queries[1].params.reverse_order,true);assert.equal(queries[1].params.reverseOrder,true);
 assert.equal(queries[1].params.message_seq,'10');assert.equal(f.other.ready,true);
});
test('explicit latest refresh after older paging returns to both false flags without a cursor',async t=>{
 const f=await fixture(t),first=await f.read();await f.read(first.page.nextCursor);await f.read(null);
 const queries=f.state.requests.filter(r=>r.action==='get_friend_msg_history');assert.equal(queries.length,3);
 assert.deepEqual(queries.map(q=>[q.params.reverse_order,q.params.reverseOrder]),[[false,false],[true,true],[false,false]]);
 assert(!Object.hasOwn(queries.at(-1).params,'message_seq'));assert(queries.every(q=>q.params.count===20&&q.params.user_id===OWNER&&q.params.disable_get_url===true&&q.params.parse_mult_msg===false&&q.params.quick_reply===false));
});

