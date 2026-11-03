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
  const attach=async()=>{const r=await call('/attached');if(r.status===200)client=r.data.client_id;return r;};
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
  const p=await call('/permission',{body:request()}),code=p.data.code;
  assert.match(code,/^[a-f0-9]{32}$/);assert.match(sent.at(-1),/参数预览，不能保证是完整原参数/);
  assert.match(sent.at(-1),/影响本机项目以外的数据/);assert.match(sent.at(-1),/五分钟内有效，只能用一次/);
  assert(sent.at(-1).includes(`\n/allow ${code}\n`));assert(sent.at(-1).includes(`\n/deny ${code}\n`));
  const sentBefore=sent.length;await broker.receive(message('ordinary-yes','yes'));
  assert.equal(sent.length,sentBefore);assert.equal(broker.pending.size,1);
  const seq=broker.seq;
  for(const [index,text]of ['/allow 后面的确认码','/allow abcde',`/allow ${code}\n/deny ${code}`].entries()){
    await broker.receive(message(`bad-confirmation-${index}`,text));
    assert.equal(broker.seq,seq);assert.equal(broker.pending.size,1);
    assert.match(sent.at(-1),/一整行.*32位确认码/);assert(!sent.at(-1).includes(code));
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
  const cancelled=broker.receive(message('cancel','/cancel'));gate.resolve();await Promise.all([inFlight,waiting,cancelled]);await broker.sendChain;
  assert.equal(broker.paused,true);assert.equal(broker.pending.size,0);assert(!sent.some(text=>text.includes('abcdf')));
  assert.equal(sent.filter(text=>text.includes('/allow ')).length,0);assert.match(sent.at(-1),/Ctrl\+C/);
  const seq=broker.seq;await broker.receive(message('paused','Do more work'));assert.equal(broker.seq,seq);
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
