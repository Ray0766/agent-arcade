'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const {XDirectMessageClient, XRateBudget, prepareXInbound, conversation, POLL_INTERVAL} = require('../src/bot/x-dm.cjs');
const {XError} = require('../src/bot/x-transport.cjs');
const SELF = '910000000000000001', OWNER = '920000000000000001', NOW = 1793920000000;
const deferred = () => { let resolve, reject; const promise = new Promise((yes,no) => {resolve=yes; reject=no;}); return {promise,resolve,reject}; };
const envelope = data => ({data,rate:{remaining:null,retryAt:null}});
function event(overrides = {}) { return {id:'930000000000000001',event_type:'MessageCreate',sender_id:OWNER,
  dm_conversation_id:conversation(SELF,OWNER),created_at:new Date(NOW).toISOString(),text:'hello',...overrides}; }
function page(rows = [], next) { return envelope({data:rows,meta:{result_count:rows.length,...(next ? {next_token:next} : {})}}); }
function fixture(options = {}) {
  const f = {now:NOW, calls:[], pages:[page()], me:SELF, waits:[], writes:0, closed:false};
  const transport = {
    async me({signal,assertCurrent}) { f.calls.push('me'); if (f.meGate) await f.meGate.promise; assertCurrent(); return envelope({data:{id:f.me}}); },
    async events({paginationToken,signal,assertCurrent}) {
      f.calls.push(['events',paginationToken]); if (f.eventGate) await f.eventGate.promise;
      assertCurrent(); if (f.eventError) throw f.eventError; return f.pageFn ? f.pageFn(paginationToken) : f.pages.shift() || page();
    },
    async sendText({text,signal,assertCurrent}) {
      if (f.beforeWrite) await f.beforeWrite.promise;
      assertCurrent(); f.writes++; f.lastText=text;
      if (f.writeGate) await f.writeGate.promise;
      if (f.writeError) throw f.writeError;
      return f.receipt ?? envelope({data:{dm_conversation_id:conversation(SELF,OWNER),dm_event_id:'940000000000000001'}});
    },
    close() { f.closed=true; }
  };
  const client = new XDirectMessageClient({accessToken:'synthetic-user-token',expectedAccountId:SELF,ownerId:OWNER,
    now:() => f.now, sleep:async (ms,signal) => { if (signal.aborted) throw new XError('aborted'); f.waits.push(ms); f.now+=ms; },
    transportFactory:() => transport,...options});
  return {client,f,transport};
}

test('fixed self verification and one-to-one owner projection preserve uint64 strings',async()=>{
  const {client,f}=fixture(); f.pages=[page([event(),event({id:'930000000000000002',sender_id:SELF})])];
  assert.deepEqual(await client.connect(),{accountId:SELF,ownerId:OWNER});
  const got=await client.getUpdates(); assert.equal(got.messages.length,1); assert.equal(got.messages[0].from,OWNER);
  assert.equal(got.messages[0].id,'930000000000000001'); assert.equal(f.calls.filter(x=>x==='me').length,3); client.close();
});
test('wrong or absent self never begins a DM read; expired user token is not replaced',async()=>{
  for(const actual of ['123',undefined]){
    const {client,f}=fixture(); f.me=actual;
    await assert.rejects(client.connect(),{code:actual?'account_mismatch':'invalid_response'});
    assert.equal(f.calls.filter(Array.isArray).length,0); client.close();
  }
  const {client,transport,f}=fixture(); transport.me=async()=>{throw new XError('requires_reauthorization');};
  await assert.rejects(client.connect(),{code:'requires_reauthorization'});assert.equal(f.writes,0);client.close();
});
test('numeric identity guesses, self owner and invalid admission time are rejected',()=>{
  assert.throws(()=>fixture({ownerId:OWNER+'x'}),{code:'invalid_owner'});
  assert.throws(()=>fixture({ownerId:SELF}),{code:'invalid_owner'});
  assert.throws(()=>fixture({expectedAccountId:Number(SELF)}),{code:'invalid_account'});
  assert.throws(()=>fixture({acceptAfter:NOW+1}),{code:'invalid_input'});
});
test('each unexpected sender/group/participants/metadata case fails the entire read without a claim',async t=>{
  const cases = {otherSender:{sender_id:'123'},wrongConversation:{dm_conversation_id:'123-456'},group:{participant_ids:[SELF,OWNER,'123']},
    missingSender:{sender_id:undefined},numericId:{id:930000000000000001},badTime:{created_at:'yesterday'},impossibleDate:{created_at:'2026-02-30T00:00:00Z'},
    future:{created_at:new Date(NOW+61000).toISOString()},nonMessage:{event_type:'ParticipantsJoin'},invalidText:{text:'x'.repeat(6001)}};
  for(const [name,change] of Object.entries(cases)) await t.test(name,async()=>{
    const {client,f}=fixture();f.pages=[page([event(change)])];await assert.rejects(client.getUpdates(),{code:'invalid_response'});
    assert.equal(client.seenIds().length,0);client.close();
  });
});
test('old history and self echoes are not commands; duplicate ID across polls is admitted once',async()=>{
  const {client,f}=fixture();const old=event({id:'930000000000000000',created_at:new Date(NOW-1).toISOString()});
  f.pages=[page([event(),old]),page([event(),old])];
  assert.equal((await client.getUpdates()).messages.length,1);
  assert.equal((await client.getUpdates('1')).messages.length,0);
  assert.deepEqual(f.waits,[POLL_INTERVAL]);assert.equal(client.seenIds().length,1);client.close();
});
test('seen IDs supplied by durable journal survive a new client generation',async()=>{
  const {client,f}=fixture({seenIds:['930000000000000001']});f.pages=[page([event()])];
  assert.equal((await client.getUpdates()).messages.length,0);client.close();
});
test('attachment plus approval and referenced approval are never flattened into authorization',async()=>{
  const {client,f}=fixture();f.pages=[page([
    event({text:'/allow exact-code',attachments:{media_keys:['synthetic']}}),
    event({id:'930000000000000002',text:'/allow exact-code',referenced_posts:[{id:'123'}]}),
    event({id:'930000000000000003',text:'Explain this quote',quote:{text:'/allow hidden'}})
  ])];
  const rows=(await client.getUpdates()).messages;
  assert(prepareXInbound(rows[0]).rejection);assert(prepareXInbound(rows[1]).rejection);
  assert.equal(rows[2].quote.text,'');assert(!JSON.stringify(rows).includes('hidden'));assert(!prepareXInbound(rows[2]).rejection);client.close();
});
test('an unfamiliar future reply wrapper cannot become plain typed approval',async()=>{
  const {client,f}=fixture();f.pages=[page([event({text:'/allow exact-code',reply_to_dm_event_id:'123'})])];
  const message=(await client.getUpdates()).messages[0];assert.equal(message.text,'');assert(prepareXInbound(message).rejection);client.close();
});
test('three-page scan returns chronological owner events, not page-order commands',async()=>{
  const {client,f}=fixture();f.pages=[page([event({created_at:new Date(NOW+2).toISOString()})],'ABCDEFGHIJKLMNOP'),
    page([event({id:'930000000000000002',created_at:new Date(NOW+1).toISOString()})],'ABCDEFGHIJKLMNOPQ'),
    page([event({id:'930000000000000003'})])];
  assert.deepEqual((await client.getUpdates()).messages.map(x=>x.id),['930000000000000003','930000000000000002','930000000000000001']);client.close();
});
test('partial errors, repeated cursor, and an unclosed page window never return a partial batch',async t=>{
  await t.test('partial response',async()=>{const {client,f}=fixture();f.pages=[envelope({data:[event()],meta:{result_count:1},errors:[{}]})];
    await assert.rejects(client.getUpdates(),{code:'invalid_response'});assert.equal(client.seenIds().length,0);client.close();});
  await t.test('cursor cycle',async()=>{const {client,f}=fixture();f.pages=[page([event()],'ABCDEFGHIJKLMNOP'),page([event()],'ABCDEFGHIJKLMNOP')];
    await assert.rejects(client.getUpdates(),{code:'invalid_response'});assert.equal(client.seenIds().length,0);client.close();});
  await t.test('backlog',async()=>{const {client,f}=fixture();f.pages=[page([event()],'ABCDEFGHIJKLMNOP'),page([event()],'ABCDEFGHIJKLMNOPQ'),page([event()],'ABCDEFGHIJKLMNOPQR')];
    await assert.rejects(client.getUpdates(),{code:'backlog_limit'});assert.equal(client.seenIds().length,0);client.close();});
});
test('a response identity change after data retrieval discards all pending input',async()=>{
  const {client,f}=fixture(); f.pageFn=()=>{f.me='123';return page([event()]);};
  await assert.rejects(client.getUpdates(),{code:'account_changed'});assert.equal(client.seenIds().length,0);assert.equal(client.ready,false);client.close();
});
test('bounded read quota counts every page and cannot be bypassed by empty cursor',async()=>{
  const {client,f}=fixture();let n=0;
  f.pageFn=()=>{n++;return page([event({sender_id:SELF})],n%3===0?undefined:'ABCDEFGHIJKLMNOP'+n);};
  for(let i=0;i<5;i++)assert.equal((await client.getUpdates()).messages.length,0);
  await assert.rejects(client.getUpdates(),{code:'rate_limited'});assert.equal(n,15);client.close();
});
test('429 and remaining-zero reset hints retain a bounded paused read state',async()=>{
  const {client,f}=fixture();f.eventError=new XError('rate_limited',{retryAt:NOW+300000});
  await assert.rejects(client.getUpdates(),{code:'rate_limited'});const reads=f.calls.filter(Array.isArray).length;
  f.eventError=null;await assert.rejects(client.getUpdates(),{code:'rate_limited'});assert.equal(f.calls.filter(Array.isArray).length,reads);client.close();
  const b=fixture();const p=page();p.rate={remaining:0,retryAt:NOW+300000};b.f.pages=[p];await b.client.getUpdates();
  await assert.rejects(b.client.getUpdates(),{code:'rate_limited'});b.client.close();
});
test('cancel/close during a polling wait does not start another HTTP request',async()=>{
  let entered;const started=new Promise(r=>entered=r);
  const {client,f}=fixture({sleep:(ms,signal)=>new Promise((resolve,reject)=>{entered();signal.addEventListener('abort',()=>reject(new XError('aborted')),{once:true});})});
  await client.getUpdates();const before=f.calls.length,p=client.getUpdates();await started;client.close();
  await assert.rejects(p,{code:'aborted'});assert.equal(f.calls.length,before);assert(f.closed);
});
test('late handshake/read cannot resurrect closed client; concurrent poll is rejected',async()=>{
  const {client,f}=fixture();f.meGate=deferred();const p=client.connect();client.close();f.meGate.resolve();
  await assert.rejects(p,{code:'closed'});assert.equal(client.ready,false);
  const b=fixture();await b.client.connect();b.f.eventGate=deferred();const q=b.client.getUpdates();await new Promise(setImmediate);
  await assert.rejects(b.client.getUpdates(),{code:'concurrent_poll'});b.client.close();b.f.eventGate.resolve();
  await assert.rejects(q,{code:'closed'});assert.equal(b.client.seenIds().length,0);
});
test('send requires fixed owner and exact live context, and validates correlated receipt',async()=>{
  const {client,f}=fixture();await client.connect();
  await assert.rejects(client.sendText('123','x',client.contextToken),{code:'owner_required'});
  await assert.rejects(client.sendText(OWNER,'x','guessed'),{code:'stale_context'});
  const got=await client.sendText(OWNER,'reply',client.contextToken,'receipt001');assert.equal(got.ownerId,OWNER);assert.equal(got.accountId,SELF);assert.equal(f.writes,1);
  await assert.rejects(client.sendText(OWNER,'reply',client.contextToken,'receipt001'),{code:'already_attempted'});
  f.receipt=envelope({data:{dm_event_id:'123',dm_conversation_id:'1-2'}});
  await assert.rejects(client.sendText(OWNER,'x',client.contextToken,'receipt002'),{code:'send_unknown'});assert.equal(f.writes,2);client.close();
});
test('cancel before actual submission makes no write; submitted failures retain consumed client ID',async()=>{
  const {client,f}=fixture();await client.connect();const control=new AbortController();f.beforeWrite=deferred();
  const pending=client.sendText(OWNER,'x',client.contextToken,'prewrite',control.signal);await new Promise(setImmediate);control.abort();f.beforeWrite.resolve();
  await assert.rejects(pending,{code:'aborted'});assert.equal(f.writes,0);assert(!client.attempted.has('prewrite'));
  f.beforeWrite=null;f.writeError=Error('raw secret failure');await assert.rejects(client.sendText(OWNER,'x',client.contextToken,'unknown'),e=>e.code==='send_unknown'&&!e.message.includes('secret'));
  await assert.rejects(client.sendText(OWNER,'x',client.contextToken,'unknown'),{code:'already_attempted'});assert.equal(f.writes,1);client.close();
});
test('late accepted receipt remains truthful and bound to captured identity after close',async()=>{
  const {client,f}=fixture();await client.connect();const context=client.contextToken;f.writeGate=deferred();
  const p=client.sendText(OWNER,'x',context,'late');await new Promise(setImmediate);assert.equal(f.writes,1);
  client.close();f.writeGate.resolve();const receipt=await p;assert.equal(receipt.contextToken,context);assert.equal(receipt.accountId,SELF);assert.equal(client.ready,false);
});
test('simultaneous writes and the sixteenth write in a window are blocked before POST',async()=>{
  const {client,f}=fixture();await client.connect();f.writeGate=deferred();const p=client.sendText(OWNER,'x',client.contextToken,'a');
  await assert.rejects(client.sendText(OWNER,'x',client.contextToken,'b'),{code:'concurrent_send'});f.writeGate.resolve();await p;f.writeGate=null;
  for(let i=1;i<15;i++)await client.sendText(OWNER,'x',client.contextToken,`n${i}`);
  const before = f.calls.length;
  await assert.rejects(client.sendText(OWNER,'x',client.contextToken,'sixteenth'),{code:'rate_limited'});
  assert.equal(f.calls.length,before,'exhausted write budget must not perform another paid identity read');
  assert.equal(f.writes,15);client.close();
});
test('identity budget survives close and token replacement, and expires after its own 75-request window',async()=>{
  let now=NOW;const budget=new XRateBudget({now:()=>now});let calls=0;
  for(let i=0;i<75;i++){
    const {client,f}=fixture({rateBudget:budget,now:()=>now});await client.connect();calls+=f.calls.length;client.close();
  }
  const {client,f}=fixture({rateBudget:budget,now:()=>now});
  await assert.rejects(client.connect(),e=>e.code==='rate_limited'&&e.retryAt===NOW+900000);
  assert.equal(calls,75);assert.equal(f.calls.length,0);
  now+=900000;await client.connect();assert.equal(f.calls.length,1);client.close();
  assert.throws(()=>fixture({rateBudget:{}}),{code:'invalid_input'});
});
test('identity remaining-zero and 429 pause only that account budget, including new clients',async()=>{
  for(const status of ['remaining-zero','429']){
    const budget=new XRateBudget({now:()=>NOW});const a=fixture({rateBudget:budget});
    a.transport.me=async()=>{a.f.calls.push('me');if(status==='429')throw new XError('rate_limited',{retryAt:NOW+300000});
      return {data:{data:{id:SELF}},rate:{remaining:0,retryAt:NOW+300000}};};
    if(status==='429')await assert.rejects(a.client.connect(),{code:'rate_limited'});else await a.client.connect();
    a.client.close();const b=fixture({rateBudget:budget});
    await assert.rejects(b.client.connect(),e=>e.code==='rate_limited'&&e.retryAt===NOW+300000);
    assert.equal(b.f.calls.length,0);b.client.close();
    const independent=fixture();await independent.client.connect();independent.client.close();
  }
});
test('shared read and write budgets reject retries without additional identity or POST requests',async()=>{
  const budget=new XRateBudget({now:()=>NOW});const a=fixture({rateBudget:budget});await a.client.connect();
  for(let i=0;i<15;i++)await a.client.sendText(OWNER,'x',a.client.contextToken,`first${i}`);
  a.client.close();const b=fixture({rateBudget:budget});await b.client.connect();const before=b.f.calls.length;
  await assert.rejects(b.client.sendText(OWNER,'x',b.client.contextToken,'later'),{code:'rate_limited'});
  assert.equal(b.f.calls.length,before);assert.equal(b.f.writes,0);
  budget.block('read',NOW+300000);await assert.rejects(b.client.getUpdates(),{code:'rate_limited'});
  assert.equal(b.f.calls.length,before);b.client.close();
});
test('a submitted unknown with a bounded reset hint blocks new writes without claiming failure before send',async()=>{
  const {client,f}=fixture();await client.connect();f.writeError=new XError('send_unknown',{submitted:true,retryAt:NOW+300000});
  await assert.rejects(client.sendText(OWNER,'x',client.contextToken,'unknown'),{code:'send_unknown'});
  const before=f.calls.length;
  await assert.rejects(client.sendText(OWNER,'x',client.contextToken,'new'),{code:'rate_limited'});
  assert.equal(f.writes,1);assert.equal(f.calls.length,before);client.close();
});
