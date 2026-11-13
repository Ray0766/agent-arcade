'use strict';
// Real loopback WS with synthetic QQ identities. No live account/contact calls.
const test=require('node:test'),assert=require('node:assert/strict');
const {once}=require('node:events');const {WebSocketServer,WebSocket}=require('ws');
const {QQClient}=require('../src/bot/qq.cjs');
const {QQOwnerRemark,validateRemark}=require('../src/bot/qq-owner-remark.cjs');
const OWNER='12345678',ACCOUNT='87654321';
async function fixture(t,options={}){
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  const requests=[],state={account:ACCOUNT,online:true,good:true,remark:' 原始 🐳 ',nickname:'Synthetic owner',generation:1,scopeId:'synthetic-root:character',now:Date.now(),mono:100,mode:'ok',listGate:null,setGate:null,lists:0};
  server.on('connection',socket=>socket.on('message',raw=>{
    const req=JSON.parse(raw);requests.push(req);const reply=data=>{if(socket.readyState===1)socket.send(JSON.stringify({status:'ok',retcode:0,echo:req.echo,data}));};
    if(req.action==='get_login_info')reply({user_id:state.account});
    else if(req.action==='get_status')reply({online:state.online,good:state.good});
    else if(req.action==='get_friend_list'){
      state.lists++;const rows=()=>state.rows??[{user_id:'99999999',nickname:'PRIVATE_OTHER_NICK',remark:'PRIVATE_OTHER_REMARK'},{user_id:OWNER,nickname:state.nickname,remark:state.remark}];
      if(state.listGate)state.listGate(reply,rows,state.lists);else reply(rows());
    }else if(req.action==='set_friend_remark'){
      if(state.mode!=='stale')state.remark=req.params.remark;
      if(state.setGate)state.setGate(reply,socket,req);
      else if(state.mode==='disconnect')socket.terminate();
      else if(state.mode==='timeout'){}
      else if(state.mode==='failure')socket.send(JSON.stringify({status:'failed',retcode:1400,echo:req.echo,data:null,message:'PRIVATE_UPSTREAM_ERROR'}));
      else if(state.mode==='void')reply(undefined);
      else if(state.mode==='malformed')reply({});
      else{socket.send(JSON.stringify({status:'ok',retcode:0,echo:'unrelated',data:null}));reply(null);}
    }else assert.fail(`Unexpected synthetic action: ${req.action}`);
  }));
  const client=new QQClient({url:`ws://127.0.0.1:${server.address().port}`,token:'synthetic-token-only',ownerId:OWNER,expectedAccountId:ACCOUNT,timeoutMs:150,socketFactory:(url,o)=>new WebSocket(url,o)});
  await client.connect();const binding=()=>({status:'connected',channel:'qq',generation:state.generation,scopeId:state.scopeId,accountId:ACCOUNT,ownerId:OWNER,role:'Synthetic role',client});
  const controller=new QQOwnerRemark({getBinding:binding,now:()=>state.now,monotonic:()=>state.mono,...options});
  t.after(async()=>{await controller.close();await client.close();for(const ws of server.clients)ws.terminate();await new Promise(resolve=>server.close(resolve));});
  return {client,controller,requests,state,binding,writes:()=>requests.filter(r=>r.action==='set_friend_remark')};
}
test('fixed-owner read preserves exact supported baseline and returns only private owner projection',async t=>{
  const f=await fixture(t),row=await f.controller.read();assert.equal(row.kind,'owner-remark');assert.equal(row.editable,true);assert.equal(row.observed.remark,' 原始 🐳 ');assert.equal(row.recipient.accountId,ACCOUNT);assert.equal(row.recipient.ownerId,OWNER);assert.deepEqual(row.restore,{available:false});assert(Number.isFinite(Date.parse(row.observed.fetchedAt)));assert.equal(row.observed.source,'bridge-cache');assert.doesNotMatch(JSON.stringify(row),/PRIVATE_OTHER/);assert.deepEqual(f.controller.snapshot(),{available:true,busy:false});
  assert.deepEqual(f.requests.slice(2).map(r=>r.action),['get_login_info','get_status','get_friend_list','get_login_info','get_status']);assert.deepEqual(f.requests.find(r=>r.action==='get_friend_list').params,{no_cache:false});assert.equal(f.writes().length,0);
});
test('remark policy preserves spaces and clear, admits 60 astral characters and rejects unsupported input without normalization',()=>{
  for(const s of ['', '  ', ' a ', '🐳'.repeat(60)])assert.equal(validateRemark(s),s);
  for(const s of [null,1,{},'a'.repeat(61),'🐳'.repeat(61),'a\n','a\t','\u202eabc','\u200d','\u2028','\ud800','\udc00'])assert.throws(()=>validateRemark(s),{code:'invalid_remark'});
});
test('unsupported raw original is withheld and never converted into a shorter or stripped writable baseline',async t=>{
  const f=await fixture(t);for(const original of ['PRIVATE_ORIGINAL\u202e', '🐳'.repeat(61)]){
    f.state.remark=original;const row=await f.controller.read();assert.equal(row.editable,false);assert.equal(row.reason,'original_unsupported');assert.equal(row.observed.withheld,true);assert.equal(row.observed.remark,undefined);assert.equal(row.ticketId,undefined);assert.deepEqual(row.restore,{available:false});assert(!JSON.stringify(row).includes('PRIVATE_ORIGINAL'));
  }assert.equal(f.writes().length,0);
});
test('missing, duplicate and malformed owner records fail without a write or an editable ticket',async t=>{
  const f=await fixture(t);for(const [rows,code] of [[[],'owner_not_found'],[{},'invalid_response'],[[{user_id:OWNER,nickname:'a'}],'invalid_response'],[[{user_id:OWNER,nickname:'a',remark:1}],'invalid_response'],[[{user_id:OWNER,nickname:'a',remark:''},{user_id:OWNER,nickname:'b',remark:''}],'invalid_response'],[[{user_id:Number.MAX_SAFE_INTEGER+1}],'invalid_response'],[Array.from({length:10001},()=>({user_id:OWNER})),'response_too_large']]){f.state.rows=rows;await assert.rejects(f.controller.read(),{code});}assert.equal(f.writes().length,0);
});
test('set consumes one ticket synchronously, targets only configured owner and separates accepted from observed cache match',async t=>{
  const f=await fixture(t),row=await f.controller.read(),pending=f.controller.set({ticketId:row.ticketId,remark:'新备注'});await assert.rejects(f.controller.set({ticketId:row.ticketId,remark:'again'}),{code:'operation_in_progress'});
  const result=await pending;assert.equal(result.outcome,'accepted');assert.equal(result.observation.state,'observed_match');assert.equal(result.observation.remark,'新备注');assert.equal(result.ticketId,row.ticketId);assert.equal(result.messageId,undefined);assert.deepEqual(f.writes().map(r=>r.params),[{user_id:OWNER,remark:'新备注'}]);await assert.rejects(f.controller.set({ticketId:row.ticketId,remark:'again'}),{code:'stale_ticket'});assert.doesNotMatch(JSON.stringify(f.controller.snapshot()),/新备注|原始|ticket|Synthetic owner/);
});
test('NapCat void handler success omits the JSON data field and is accepted only with the matched successful envelope',async t=>{
  const f=await fixture(t),row=await f.controller.read();f.state.mode='void';
  const result=await f.controller.set({ticketId:row.ticketId,remark:'void-handler-fixture'});
  assert.equal(result.outcome,'accepted');assert.equal(result.observation.state,'observed_match');assert.equal(f.writes().length,1);
});
test('only null or omitted data are successful remark payloads; other JSON data remain unknown',async t=>{
  for(const payload of [null,{},[],false,0,'']){
    const f=await fixture(t),row=await f.controller.read();f.state.setGate=reply=>reply(payload);
    const result=await f.controller.set({ticketId:row.ticketId,remark:'payload-fixture'});
    assert.equal(result.outcome,payload===null?'accepted':'unknown');assert.equal(f.writes().length,1);
  }
});
test('omitted data never weakens the required echo, status or numeric retcode checks',async t=>{
  for(const patch of [{echo:'other-request'},{status:'failed'},{retcode:1},{retcode:'0'},{status:undefined}]){
    const f=await fixture(t),row=await f.controller.read();f.state.setGate=(_reply,socket,req)=>socket.send(JSON.stringify({echo:req.echo,status:'ok',retcode:0,...patch}));
    const result=await f.controller.set({ticketId:row.ticketId,remark:'envelope-fixture'});assert.equal(result.outcome,'unknown');assert.equal(f.writes().length,1);
  }
});
test('renderer cannot submit a different recipient, original, action or fabricated restore target',async t=>{
  const f=await fixture(t),row=await f.controller.read();for(const extra of [{ownerId:'99999999'},{friendId:'99999999'},{expectedRemark:'wrong'},{action:'send_private_msg'},{original:'wrong'}])await assert.rejects(f.controller.set({ticketId:row.ticketId,remark:'x',...extra}),{code:'invalid_request'});
  await assert.rejects(f.controller.restore({ticketId:row.ticketId,remark:'wrong'}),{code:'invalid_request'});assert.equal(f.writes().length,0);
});
test('new read invalidates old ticket, expiry consumes its ticket and current cache changes refuse write',async t=>{
  const f=await fixture(t),old=await f.controller.read(),fresh=await f.controller.read();await assert.rejects(f.controller.set({ticketId:old.ticketId,remark:'x'}),{code:'stale_ticket'});
  f.state.now+=300001;assert.equal((await f.controller.set({ticketId:fresh.ticketId,remark:'x'})).code,'expired_ticket');const current=await f.controller.read();f.state.remark='external change';const result=await f.controller.set({ticketId:current.ticketId,remark:'x'});assert.equal(result.outcome,'not_submitted');assert.equal(result.code,'baseline_changed');assert.equal(f.writes().length,0);
});
test('same client reconnect generation, service scope and owner changes invalidate existing confirmation',async t=>{
  for(const change of [f=>f.client.generation++,f=>f.state.generation++,f=>f.state.scopeId='another-root:character',f=>f.client.ownerId='99999999']){
    const f=await fixture(t),row=await f.controller.read();change(f);const result=await f.controller.set({ticketId:row.ticketId,remark:'x'});assert.equal(result.outcome,'not_submitted');assert.equal(f.writes().length,0);
  }
});

test('deadline crossing during asynchronous preflight blocks both set and restore without replay',async t=>{
  for(const restore of [false,true]){
    const f=await fixture(t);let row=await f.controller.read();
    if(restore){await f.controller.set({ticketId:row.ticketId,remark:'temporary'});row=await f.controller.read();}
    const before=f.writes().length;f.state.listGate=(reply,rows)=>{f.state.now+=300001;reply(rows());};
    const result=await f.controller[restore?'restore':'set']({ticketId:row.ticketId,...(restore?{}:{remark:'must not write'})});
    assert.equal(result.outcome,'not_submitted');assert.equal(result.code,'expired_ticket');assert.equal(f.writes().length,before);
    await assert.rejects(f.controller[restore?'restore':'set']({ticketId:row.ticketId,...(restore?{}:{remark:'must not replay'})}),{code:'stale_ticket'});
  }
});

test('wall clock rollback does not extend confirmation lifetime across preflight',async t=>{
  const f=await fixture(t),row=await f.controller.read();
  f.state.listGate=(reply,rows)=>{f.state.now-=600000;f.state.mono+=300001;reply(rows());};
  const result=await f.controller.set({ticketId:row.ticketId,remark:'must not write'});
  assert.equal(result.outcome,'not_submitted');assert.equal(result.code,'expired_ticket');assert.equal(f.writes().length,0);
});

test('expiry after submission cannot relabel an accepted bridge response as not submitted',async t=>{
  const f=await fixture(t),row=await f.controller.read();
  f.state.setGate=reply=>{f.state.now+=300001;f.state.mono+=300001;reply(null);};
  const result=await f.controller.set({ticketId:row.ticketId,remark:'written before expiry'});
  assert.equal(result.outcome,'accepted');assert.equal(result.observation.state,'observed_match');assert.equal(f.writes().length,1);
});
test('wrong actual identity and offline states in final preflight cannot submit',async t=>{
  for(const change of [f=>f.state.account='99999999',f=>f.state.online=false,f=>f.state.good=false]){const f=await fixture(t),row=await f.controller.read();change(f);const result=await f.controller.set({ticketId:row.ticketId,remark:'x'});assert.equal(result.outcome,'not_submitted');assert.equal(f.writes().length,0);}
});
test('direct client methods also reject owner or same-object generation change across an await',async t=>{
  for(const change of [f=>f.client.ownerId='99999999',f=>f.client.generation++]){const f=await fixture(t),original=f.client._request.bind(f.client);f.client._request=async(...args)=>{const response=await original(...args);if(args[0]==='get_friend_list')change(f);return response;};await assert.rejects(f.client.readOwnerRemark(),e=>['account_changed','changed'].includes(e.code));assert.equal(f.writes().length,0);}
});
test('explicit empty remark clears while preserving the exact original for a separately confirmed restore',async t=>{
  const f=await fixture(t),original=f.state.remark,row=await f.controller.read();assert.equal((await f.controller.set({ticketId:row.ticketId,remark:''})).outcome,'accepted');assert.equal(f.state.remark,'');
  await assert.rejects(f.controller.restore({ticketId:row.ticketId}),{code:'stale_ticket'});const reread=await f.controller.read();assert.deepEqual(reread.restore,{available:true,value:original});const restored=await f.controller.restore({ticketId:reread.ticketId});assert.equal(restored.outcome,'accepted');assert.equal(restored.observation.state,'observed_match');assert.equal(restored.observation.remark,original);assert.deepEqual(f.writes().map(x=>x.params.remark),['',original]);
});
test('restore refuses an unrelated current value and does not erase it or auto-restore on close',async t=>{
  const f=await fixture(t),row=await f.controller.read();await f.controller.set({ticketId:row.ticketId,remark:'temporary'});const fresh=await f.controller.read();f.state.remark='someone else';const result=await f.controller.restore({ticketId:fresh.ticketId});assert.equal(result.outcome,'not_submitted');assert.equal(result.code,'baseline_changed');assert.equal(f.writes().length,1);assert.equal((await f.controller.read()).restore.available,false);await f.controller.close();assert.equal(f.state.remark,'someone else');assert.equal(f.writes().length,1);
});
for(const mode of ['timeout','disconnect','failure','malformed'])test(`post-submission ${mode} stays unknown and never resends or restores`,async t=>{
  const f=await fixture(t),row=await f.controller.read();f.state.mode=mode;const result=await f.controller.set({ticketId:row.ticketId,remark:'PRIVATE_NEW'});assert.equal(result.outcome,'unknown');assert.equal(result.code,'change_unknown');assert.equal(result.observation.state,'unavailable');assert.equal(f.writes().length,1);assert.doesNotMatch(JSON.stringify(result),/PRIVATE_UPSTREAM_ERROR|PRIVATE_NEW|Synthetic owner/);await assert.rejects(f.controller.set({ticketId:row.ticketId,remark:'x'}),{code:'stale_ticket'});
});
test('unknown requires explicit new read before restore becomes available',async t=>{
  const f=await fixture(t),row=await f.controller.read(),original=f.state.remark;f.state.mode='malformed';const result=await f.controller.set({ticketId:row.ticketId,remark:'temporary'});assert.equal(result.outcome,'unknown');assert.equal(f.state.lists,2);await assert.rejects(f.controller.restore({ticketId:row.ticketId}),{code:'stale_ticket'});f.state.mode='ok';const current=await f.controller.read();assert.equal(current.restore.value,original);assert.equal((await f.controller.restore({ticketId:current.ticketId})).outcome,'accepted');assert.equal(f.state.remark,original);assert.equal(f.writes().length,2);
});
test('accepted is not undone by stale cache, readback failure or changed scope after actual response',async t=>{
  for(const scenario of ['stale','readback-failure','scope-change']){const f=await fixture(t),row=await f.controller.read();
    if(scenario==='stale')f.state.mode='stale';
    if(scenario==='readback-failure')f.state.listGate=(reply,rows,count)=>{if(count<3)reply(rows());};
    if(scenario==='scope-change')f.state.setGate=reply=>{f.state.scopeId='new-root:character';reply(null);};
    const result=await f.controller.set({ticketId:row.ticketId,remark:'new'});assert.equal(result.outcome,'accepted');assert.equal(result.observation.state,scenario==='stale'?'observed_different':'unavailable');assert.equal(f.writes().length,1);
  }
});
test('cancel/close during a preflight read settles promptly without a write or private draft',async t=>{
  const f=await fixture(t),row=await f.controller.read();let release;const reached=new Promise(resolve=>release=resolve);f.state.listGate=()=>release();const pending=f.controller.set({ticketId:row.ticketId,remark:'x'});await reached;await f.controller.close();const result=await pending;assert.equal(result.outcome,'not_submitted');assert.equal(result.code,'cancelled');assert.equal(f.writes().length,0);assert.deepEqual(f.controller.snapshot(),{busy:false,available:false});
});
test('cancel after submission is unknown, closes bounded work and never restores',async t=>{
  const f=await fixture(t),row=await f.controller.read();let entered;const reached=new Promise(resolve=>entered=resolve);f.state.setGate=()=>entered();const pending=f.controller.set({ticketId:row.ticketId,remark:'new'});await reached;await f.controller.close();assert.equal((await pending).outcome,'unknown');assert.equal(f.writes().length,1);assert.equal(f.controller.lastChange,null);
});
test('controller deadline caps a pending read and does not expose a raw transport error',async t=>{
  const f=await fixture(t,{readTimeoutMs:15});f.state.listGate=()=>{};await assert.rejects(f.controller.read(),{code:'timeout'});assert.equal(f.controller.snapshot().busy,false);assert.equal(f.writes().length,0);
});
test('main binding assertion immediately before actual mutation can veto after final status response',async t=>{
  const f=await fixture(t);let checks=0;const result=await f.client.setOwnerRemark('x',undefined,{expectedRemark:f.state.remark,assertCurrent:()=>{checks++;const last=f.requests.at(-1);if(f.state.lists===1&&last?.action==='get_status'&&f.requests.filter(x=>x.action==='get_status').length===4)throw Object.assign(new Error('PRIVATE_RUNTIME_CHANGED'),{code:'changed'});}});assert(checks>0);assert.equal(result.outcome,'not_submitted');assert.equal(result.code,'changed');assert.equal(f.writes().length,0);
});
