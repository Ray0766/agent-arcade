'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {NativeBroker}=require('../src/bot/native-broker.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,options={}){
  const sent=[],delivered=[];const broker=await new NativeBroker({send:async(text,context)=>{sent.push(text);delivered.push({text,context});},...options}).start();t.after(()=>broker.close());
  let client='';
  const call=async(route,{method='POST',body={},token=broker.token,clientId=client,headers={},signal}={})=>{
    const response=await fetch(broker.url+route,{method,headers:{Authorization:`Bearer ${token}`,'X-Arcade-Client':clientId,'Content-Type':'application/json',...headers},...(method==='POST'?{body:JSON.stringify(body)}:{}),signal});
    return {status:response.status,data:await response.json()};
  };
  const attach=async()=>{const r=await call('/attached',{clientId:''});if(r.status===200)client=r.data.client_id;return r;};
  return {broker,sent,delivered,call,attach};
}
const message=(id='in-1',text='Synthetic task')=>({id,text,contextToken:'fixture-context-not-shared'});
const request=(request_id='abcde',input='{"file_path":"fixture.txt"}')=>({request_id,tool_name:'Write',description:'Synthetic write',input});
test('native fixture: auth, origin, attachment and public snapshot boundaries',async t=>{
  const {broker,call,attach}=await fixture(t);
  assert.equal((await call('/attached',{token:'wrong'})).status,403);
  assert.equal((await call('/attached',{headers:{Origin:'https://example.com'}})).status,403);
  assert.equal((await attach()).status,200);assert.equal((await attach()).status,409);
  assert.equal((await call('/reply',{clientId:'wrong',body:{id:'unknown',text:'x'}})).status,403);
  assert.doesNotMatch(JSON.stringify([broker.snapshot(),broker.nativeSnapshot()]),new RegExp(broker.token));
});
test('native fixture: pre-attach input is not replayed; current reply IDs and counts are bounded facts',async t=>{
  const {broker,call,attach,sent}=await fixture(t);
  await broker.receive(message('before'));assert.equal(broker.seq,0);assert.match(sent[0],/电脑端还没接上/);
  await attach();await broker.receive(message('after'));await broker.receive(message('after'));
  assert.equal(sent.length,1,'Accepted owner messages do not generate chat acknowledgements');
  const batch=await call('/events?after=0',{method:'GET'});assert.equal(batch.data.events.length,1);assert.equal(broker.forwarded,1);
  const id=batch.data.events[0].id;assert.equal((await call('/reply',{body:{id:'unknown',text:'wrong'}})).status,400);
  assert.equal((await call('/reply',{body:{id,text:'Fixture reply'}})).data.read_confirmed,false);assert.equal(broker.replies,1);
  assert(!JSON.stringify(broker.snapshot()).includes('fixture-context'));
  await broker.receive(message('cmd','/allow BAD'));await broker.receive(message('new','/new'));assert.equal(broker.seq,1);
});
test('native chat: silent owner input and unwrapped clean replies stay bound to the original message context',async t=>{
  const {broker,call,attach,sent,delivered}=await fixture(t);await attach();
  await broker.receive({id:'first-owner-message',text:'你好，帮我看一下。',contextToken:'fixture-first-context'});
  await broker.receive({id:'second-owner-message',text:'再补一句。',contextToken:'fixture-second-context'});
  assert.equal(sent.length,0);
  assert.deepEqual(broker.snapshot().messages.map(({role,text})=>({role,text})),[
    {role:'user',text:'你好，帮我看一下。'},{role:'user',text:'再补一句。'},
  ]);
  const batch=await call('/events?after=0',{method:'GET'}),id=batch.data.events[0].id;
  assert.equal(batch.data.events.length,2);assert.equal(batch.data.events[0].text,'你好，帮我看一下。');
  assert.equal((await call('/reply',{body:{id:'unknown-message',text:'Unbound reply'}})).status,400);assert.equal(sent.length,0);
  const response=await call('/reply',{body:{id,text:'你好。\npassword=fixture-private-value\u0000'}});
  assert.deepEqual(response.data,{accepted:true,read_confirmed:false});
  assert.deepEqual(delivered,[{text:'你好。\npassword=[redacted]',context:'fixture-first-context'}]);
  assert.equal(broker.snapshot().messages.at(-1).text,'你好。\npassword=[redacted]');
  await broker.receive(message('status','/status'));
  assert.match(sent.at(-1),/电脑端已连接/);assert.doesNotMatch(sent.at(-1),/任务已完成|任务成功/);
});

test('native fixture: one-time permission nonce and CLI request ID are separate; adoption remains unknown',async t=>{
  const {broker,call,attach,sent}=await fixture(t);await attach();await broker.receive(message());
  const p=await call('/permission',{body:request()});assert.match(p.data.code,/^[a-f0-9]{32}$/);
  await broker.receive(message('approve',`/allow ${p.data.code}`));
  assert.equal(broker.pending.size,0);assert.equal(broker.events.at(-1).behavior,'allow');assert.equal(broker.events.at(-1).request_id,'abcde');
  assert.match(sent.at(-1),/已发送批准/);assert.match(sent.at(-1),/可能不再生效/);const count=broker.seq;
  await broker.receive(message('reuse',`/allow ${p.data.code}`));assert.equal(broker.seq,count);assert.match(sent.at(-1),/无效/);
  assert.equal((await call('/permission',{body:request()})).status,400);
});
test('native chat: ordinary replies and malformed approval copies never authorize a tool',async t=>{
  const {broker,call,attach,sent}=await fixture(t);await attach();await broker.receive(message());
  const p=await call('/permission',{body:request()}),code=p.data.code,alias=broker.snapshot().pending[0].alias;
  assert.match(code,/^[a-f0-9]{32}$/);assert.match(sent.at(-1),/参数预览，不能保证是完整原参数/);
  assert.match(sent.at(-1),/影响本机项目以外的数据/);assert.match(sent.at(-1),/5 分钟内有效，只能用一次/);
  assert.match(alias,/^[2-9A-HJ-NP-Z]{6}$/);assert(sent.at(-1).includes(`\n同意 ${alias}\n`));assert(sent.at(-1).includes(`\n拒绝 ${alias}\n`));
  const sentBefore=sent.length;await broker.receive(message('ordinary-yes','好的'));
  assert.equal(sent.length,sentBefore);assert.equal(broker.pending.size,1);
  const seq=broker.seq;
  for(const [index,text]of ['/allow 后面的确认码','/allow abcde',`/allow ${code}\n/deny ${code}`,`同意 ${alias} 继续`,`拒绝 ${alias}\n同意 ${alias}`].entries()){
    await broker.receive(message(`bad-confirmation-${index}`,text));
    assert.equal(broker.seq,seq);assert.equal(broker.pending.size,1);
    assert.match(sent.at(-1),/单独发送.*确认码/);assert(!sent.at(-1).includes(code));
  }
  assert(!broker.events.some(event=>event.type==='permission_reply'&&event.behavior==='allow'));
  await broker.receive(message('explicit-denial',`/deny ${code}`));
  assert.equal(broker.pending.size,0);assert.equal(broker.events.at(-1).behavior,'deny');
});

test('native fixture: no remote context leaves local prompt; omitted/secret/large previews cannot be remotely approved',async t=>{
  const {broker,call,attach}=await fixture(t);await attach();
  assert.equal((await call('/permission',{body:request()})).data.relayed,false);assert.equal(broker.seq,0);
  await broker.receive(message());
  for(const [id,input] of [['abcdf','⋯ 100 code points elided ⋯'],['abcdg','[REDACTED]'],['abcdh','(value unserializable)'],['abcdi','x'.repeat(4000)],['abcdj','token=long-private-fixture']]){
    assert.equal((await call('/permission',{body:request(id,input)})).data.relayed,true);assert.equal(broker.events.at(-1).behavior,'deny');assert.equal(broker.pending.size,0);
  }
});
test('native fixture: expired nonces cannot authorize a pending CLI request',async t=>{
  let now=1000;
  const {broker,attach}=await fixture(t,{now:()=>now});await attach();await broker.receive(message());
  const first=await broker.permission(request());now+=300001;broker.expire();
  await broker.receive(message('expired',`/allow ${first.code}`));assert.equal(broker.events.at(-1).behavior,'deny');
  assert.equal(broker.pending.size,0);
});
test('native fixture: cancel suppresses an approval queued behind an in-flight send',async t=>{
  const gate=deferred(),sent=[];
  const {broker,attach}=await fixture(t,{send:async text=>{sent.push(text);if(sent.length===1)await gate.promise;}});await attach();
  await broker.receive(message());
  const inFlight=broker.deliver('Fixture in-flight delivery');await new Promise(r=>setImmediate(r));
  const waiting=broker.permission(request());await new Promise(r=>setImmediate(r));
  const cancelled=broker.receive(message('cancel','停止'));gate.resolve();await Promise.all([inFlight,waiting,cancelled]);await broker.sendChain;
  assert.equal(broker.paused,true);assert.equal(broker.pending.size,0);assert(!sent.some(text=>text.includes('abcdf')));
  assert.equal(sent.filter(text=>/同意 [2-9A-HJ-NP-Z]{6}/.test(text)).length,0);assert.match(sent.at(-1),/Ctrl\+C/);
  const seq=broker.seq;await broker.receive(message('paused','Do more work'));assert.equal(broker.seq,seq);
});

test('native short approval is one use; aliases are not recycled for a later request',async t=>{
  const {broker,attach,sent}=await fixture(t);await attach();await broker.receive(message());
  await broker.permission(request());const first=broker.snapshot().pending[0];
  await broker.receive(message('short-allow',`同意 ${first.alias.toLowerCase()}`));
  assert.equal(broker.events.at(-1).behavior,'allow');assert.equal(broker.pending.size,0);
  await broker.permission(request('abcdf'));const second=broker.snapshot().pending[0];assert.notEqual(second.alias,first.alias);
  const seq=broker.seq;await broker.receive(message('short-reuse',`同意 ${first.alias}`));assert.equal(broker.seq,seq);assert.match(sent.at(-1),/无效/);
  await broker.receive(message('short-deny',`拒绝 ${second.alias}`));assert.equal(broker.events.at(-1).behavior,'deny');assert.equal(broker.pending.size,0);
});

test('native bare issued codes explain confirmation syntax without approval or task forwarding',async t=>{
  let now=1000;const {broker,attach,sent}=await fixture(t,{now:()=>now});await attach();await broker.receive(message());
  await broker.permission(request());const p=broker.snapshot().pending[0],seq=broker.seq;
  for(const [i,text]of [p.alias.toLowerCase(),p.code.toUpperCase()].entries()){
    await broker.receive(message(`bare-${i}`,text));assert.equal(broker.seq,seq);assert.equal(broker.pending.size,1);
    assert.equal(broker.snapshot().pending[0].expiresAt,p.expiresAt);assert.equal(broker.approvalCodes.failures,0);
    assert.match(sent.at(-1),/只发送确认码不会批准/);assert(sent.at(-1).includes(`同意 ${p.alias}`));assert(sent.at(-1).includes(`拒绝 ${p.alias}`));assert.match(sent.at(-1),/fixture\.txt/);
  }
  now=p.expiresAt;await broker.receive(message('expired-bare-alias',p.alias));assert.equal(broker.events.at(-1).behavior,'deny');
  const expiredSeq=broker.seq;await broker.receive(message('expired-bare-full',p.code));assert.equal(broker.seq,expiredSeq);assert.match(sent.at(-1),/确认码已失效/);
  const ordinary=['BANANA','CHERRY'].find(value=>value!==p.alias),hash=['a'.repeat(32),'b'.repeat(32)].find(value=>value!==p.code);
  await broker.receive(message('ordinary-word',ordinary));assert.equal(broker.events.at(-1).text,ordinary);
  await broker.receive(message('ordinary-hash',hash));assert.equal(broker.events.at(-1).text,hash);
});

test('native status retries an undelivered complete permission in its original context without extending TTL',async t=>{
  let now=1000;const delivered=[];
  const {broker,attach}=await fixture(t,{now:()=>now,send:async(text,context)=>{delivered.push({text,context});if(delivered.length===1)throw Error('synthetic send failure');}});
  await attach();await broker.receive(message());await broker.permission(request());const first=broker.snapshot().pending[0];
  assert(broker.snapshot().messages.at(-1).deliveryFailed);now+=1000;
  await broker.receive({id:'recover',text:'状态',contextToken:'new-fixture-context'});
  assert.equal(broker.snapshot().pending[0].expiresAt,first.expiresAt);
  const resent=delivered.at(-1);assert.equal(resent.context,'fixture-context-not-shared');assert.match(resent.text,/Synthetic write/);assert.match(resent.text,/fixture\.txt/);assert(resent.text.includes(first.alias));
  now=first.expiresAt;await broker.receive(message('expired-status','状态'));
  assert.equal(broker.pending.size,0);assert.equal(broker.events.at(-1).behavior,'deny');assert(!delivered.at(-1).text.includes(first.alias));
});

test('native invalid short attempts are limited; full fallback keeps the original permission binding',async t=>{
  const {broker,attach,sent}=await fixture(t);await attach();await broker.receive(message());await broker.permission(request());const first=broker.snapshot().pending[0];
  for(let i=0;i<8;i++)await broker.receive(message(`guess-${i}`,'同意 000000'));
  await broker.receive(message('locked-valid-short',`同意 ${first.alias}`));assert.equal(broker.pending.size,1);assert.match(sent.at(-1),/输错次数过多/);
  await broker.receive(message('fallback-status','状态'));assert(sent.at(-1).includes(`/allow ${first.code}`));assert.match(sent.at(-1),/fixture\.txt/);
  assert.equal(broker.snapshot().pending[0].expiresAt,first.expiresAt);
  await broker.receive(message('fallback-allow',`/allow ${first.code}`));assert.equal(broker.pending.size,0);assert.equal(broker.events.at(-1).request_id,'abcde');assert.equal(broker.events.at(-1).behavior,'allow');
});

test('managed cancel revokes approvals before awaiting stop and uses only the controller receipt',async t=>{
  const gate=deferred();let calls=0;
  const {broker,attach,sent}=await fixture(t,{onCancel:async()=>{calls++;await gate.promise;return '当前会话已停止。需要继续时发送“恢复会话”。';}});
  await attach();await broker.receive(message());await broker.permission(request());const alias=broker.snapshot().pending[0].alias;
  const before=sent.length,cancelling=broker.receive(message('managed-stop','停止'));await new Promise(r=>setImmediate(r));
  assert.equal(calls,1);assert.equal(broker.paused,true);assert.equal(broker.pending.size,0);assert.equal(sent.length,before);
  assert(!broker.events.some(event=>event.type==='message'));assert.equal(broker.events.at(-1).behavior,'deny');
  gate.resolve();await cancelling;assert.equal(sent.at(-1),'当前会话已停止。需要继续时发送“恢复会话”。');
  assert(!sent.some(text=>text.includes('电脑上的 Claude Code 可能还在运行')));
  const seq=broker.seq;await broker.receive(message('old-code',`同意 ${alias}`));assert.equal(broker.seq,seq);
  await broker.receive(message('slash-stop','/cancel'));assert.equal(calls,2);
});

test('a failed or empty stop callback never reports process exit and keeps forwarding paused',async t=>{
  let calls=0;const {broker,attach,sent}=await fixture(t,{onCancel:async()=>{if(++calls===1)throw Error('PRIVATE_PROCESS_ERROR');return '';}});
  await attach();await broker.receive(message());
  for(const [i,text]of ['停止','/cancel'].entries()){
    await broker.receive(message(`failed-stop-${i}`,text));assert.equal(broker.paused,true);
    assert.match(sent.at(-1),/尚未确认 Claude Code 是否停止/);assert.doesNotMatch(sent.at(-1),/已停止|PRIVATE_PROCESS_ERROR/);
  }
});

test('channel reset revokes the old client, pending permission and reply IDs but accepts a fresh cursor zero',async t=>{
  let now=1000,closed=0;const {broker,attach,call,sent}=await fixture(t,{now:()=>now,onClose:()=>{closed++;}});
  const oldClient=(await attach()).data.client_id;await broker.receive(message());
  const oldId=(await call('/events?after=0',{method:'GET'})).data.events[0].id;
  await broker.permission(request());const oldPermission=broker.snapshot().pending[0],token=broker.token,url=broker.url;
  const pending=call(`/events?after=${broker.seq}`,{method:'GET'});
  const end=Date.now()+1000;while(!broker.waiter&&Date.now()<end)await new Promise(r=>setTimeout(r,5));assert(broker.waiter);
  now+=20000;broker.resetChannel({paused:false});
  assert.deepEqual((await pending).data,{events:[],closed:true});assert.equal(broker.closed,false);assert.equal(closed,0);
  assert.equal(broker.url,url);assert.equal(broker.token,token);assert.equal(broker.createdAt,now);assert.equal(broker.lastSeen,now);
  assert.equal(broker.seq,0);assert.equal(broker.floor,0);assert.equal(broker.ackSeq,0);assert.equal(broker.records.size,0);assert.equal(broker.pending.size,0);
  for(const route of ['/reply','/permission','/detached','/attached'])assert.equal((await call(route,{clientId:oldClient,body:route==='/permission'?request():{id:oldId,text:'old reply'}})).status,403);
  assert.equal((await call('/events?after=0',{method:'GET',clientId:oldClient})).status,403);assert.equal(broker.closed,false);
  const newClient=(await attach()).data.client_id;assert.notEqual(newClient,oldClient);
  assert.equal((await call('/reply',{body:{id:oldId,text:'old reply'}})).status,400);
  await broker.receive(message());assert.equal(broker.seq,0,'An old owner message is not replayed after reset');
  await broker.receive(message('old-approval',`同意 ${oldPermission.alias}`));assert.equal(broker.seq,0);assert.match(sent.at(-1),/无效/);
  await broker.receive(message('fresh-input','A fresh input'));const fresh=await call('/events?after=0',{method:'GET'});
  assert.equal(fresh.data.events.length,1);assert.equal(fresh.data.events[0].seq,1);assert.equal(fresh.data.events[0].text,'A fresh input');
  assert.equal((await call('/permission',{body:request()})).status,200,'The new CLI may reuse its own request ID');
  assert.notEqual(broker.snapshot().pending[0].alias,oldPermission.alias);
});

test('intentional detach keeps the broker open while default detach still closes it',async t=>{
  let closed=0;const {broker,attach,call}=await fixture(t,{managedDetach:true,onClose:()=>{closed++;}});await attach();await broker.receive(message());
  await broker.permission(request());assert.equal((await call('/detached')).data.closed,true);
  assert.equal(broker.closed,false);assert.equal(closed,0);assert.equal(broker.clientId,'');assert.equal(broker.pending.size,0);assert.equal(broker.paused,true);
  assert.equal(broker.managedDetach,false,'Managed detach is a one-shot shutdown window');
  assert.equal((await attach()).status,200);assert.equal((await call('/detached')).data.closed,true);
  await broker.close();assert.equal(broker.closed,true);assert.equal(closed,1);
});

test('reset drops an old reply waiting behind a send already in flight',async t=>{
  const gate=deferred(),sent=[];const {broker,attach,call}=await fixture(t,{send:async text=>{sent.push(text);if(sent.length===1)await gate.promise;}});
  await attach();await broker.receive(message());const id=(await call('/events?after=0',{method:'GET'})).data.events[0].id;
  const inFlight=broker.deliver('Fixture send already in flight');await new Promise(r=>setImmediate(r));
  const stale=broker.reply({id,text:'Old reply must not appear'});const rejected=assert.rejects(stale,/send_failed/);
  broker.resetChannel();gate.resolve();await Promise.all([inFlight,rejected]);assert.deepEqual(sent,['Fixture send already in flight']);
});

test('resume requires an exact typed control and reports only the controller result',async t=>{
  let resumed=0;const {broker,attach,sent}=await fixture(t,{onResume:async()=>{resumed++;return '已重新连接，可以发送新的需求。';}});await attach();
  await broker.receive(message('resume-word-in-sentence','请恢复会话中的标题'));assert.equal(resumed,0);assert.equal(broker.events.at(-1).text,'请恢复会话中的标题');
  await broker.receive(message('resume','恢复会话'));await broker.receive(message('slash-resume','/resume'));
  assert.equal(resumed,2);assert.equal(sent.at(-1),'已重新连接，可以发送新的需求。');
  broker.onResume=async()=>{throw Error('PRIVATE_RESUME_ERROR');};await broker.receive(message('resume-failed','恢复会话'));
  assert.match(sent.at(-1),/尚未恢复连接/);assert.doesNotMatch(sent.at(-1),/PRIVATE_RESUME_ERROR/);
  broker.onResume=undefined;await broker.receive(message('manual-resume','恢复会话'));assert.match(sent.at(-1),/请在 Agent Arcade/);
});

test('only paused managed sessions without a client may outlive the unattached lease',async t=>{
  let now=1000;const {broker,sent}=await fixture(t,{now:()=>now,onResume:async()=>''});
  broker.resetChannel();now+=300001;broker.checkLease();assert.equal(broker.closed,false);
  await broker.receive(message('paused-status','状态'));assert.match(sent.at(-1),/发送“恢复会话”/);
  broker.resetChannel({paused:false});now+=300001;broker.checkLease();assert.equal(broker.closed,true);await broker.close();
  const attached=await fixture(t,{now:()=>now,onResume:async()=>''});await attached.attach();attached.broker.pause();
  now+=90001;attached.broker.checkLease();assert.equal(attached.broker.closed,true,'A process that remains attached still has a lease');await attached.broker.close();
  const manual=await fixture(t,{now:()=>now});manual.broker.resetChannel();now+=300001;manual.broker.checkLease();assert.equal(manual.broker.closed,true,'Manual pause has no managed resume exemption');await manual.broker.close();
});

test('startup renewal does not extend attached, paused, or closed channel capabilities',async t=>{
  let now=1000;const {broker,attach}=await fixture(t,{now:()=>now});
  for(let i=0;i<4;i++){now+=120000;assert.equal(broker.renewStartupLease(),true);broker.checkLease();assert.equal(broker.closed,false);}
  assert.equal(broker.clientId,'');assert.equal(broker.lastSeen,1000,'Process checks are not MCP heartbeats');
  broker.pause();now+=1000;assert.equal(broker.renewStartupLease(),false);
  broker.resetChannel({paused:false});await attach();
  now+=90001;assert.equal(broker.renewStartupLease(),false);broker.checkLease();
  assert.equal(broker.closed,true,'A live process cannot keep an unresponsive MCP channel attached');
  assert.equal(broker.renewStartupLease(),false);await broker.close();
});

test('native fixture: event paging, gaps, one long poll and closed capabilities',async t=>{
  const {broker,call,attach}=await fixture(t);await attach();
  for(let i=0;i<101;i++)broker.event({type:'permission_reply',request_id:'abcde',behavior:'deny'});
  const first=await call('/events?after=0',{method:'GET'});assert.equal(first.data.events.length,100);
  const second=await call('/events?after=100',{method:'GET'});assert.equal(second.data.events.length,1);
  for(let i=0;i<130;i++)broker.event({type:'permission_reply',request_id:'abcde',behavior:'deny'});
  assert.equal((await call('/events?after=0',{method:'GET'})).data.error,'resync_required');
  const controller=new AbortController(),pending=call(`/events?after=${broker.seq}`,{method:'GET',signal:controller.signal});
  const end=Date.now()+1000;while(!broker.waiter&&Date.now()<end)await new Promise(r=>setTimeout(r,5));
  assert.equal((await call(`/events?after=${broker.seq}`,{method:'GET'})).data.error,'concurrent_poll');
  const p1=broker.close(),p2=broker.close();assert.equal(p1,p2);await Promise.all([p1,p2]);
  assert.equal((await pending).data.closed,true);assert.equal(broker.closed,true);assert.equal(broker.token,'');
  await assert.rejects(broker.permission(request()),/channel_closed/);assert.equal(broker.pending.size,0);
});
