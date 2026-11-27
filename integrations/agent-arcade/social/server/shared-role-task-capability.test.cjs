'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {SocialStore}=require('./store.cjs');
const {createServer}=require('./http.cjs');
const {bothouseDirectory}=require('./bothouse/directory.cjs');
const {boardReceiver}=require('./bothouse/board-receiver.cjs');

test('first-task confirms the current share and preserves the original legacy direct chat',async t=>{
  const store=new SocialStore(':memory:');
  const legacy='bh_'+ '1'.repeat(21), native='bh_'+ '2'.repeat(21);
  const member={number:native,legacyNumber:legacy,id:'synthetic-project',displayName:'合成角色',configured:true};
  let shared=true, supported=true, revokeDuringCheck=false;
  let probes=0;
  const directory=bothouseDirectory(store,async request=>{
    if(request.action==='list')return {contacts:request.account==='cap_reader'&&shared?[member]:[]};
    assert.equal(request.action,'text_capability');
    assert.equal(request.number,native);
    assert.equal(request.project,member.id);
    probes++;
    if(revokeDuringCheck)shared=false;
    return {available:supported};
  });
  const server=createServer(store,{bothouse:directory}).listen(0,'127.0.0.1');
  t.after(async()=>{
    server.closeAllConnections();
    await new Promise(done=>server.close(done));
    store.db.close();
  });
  await once(server,'listening');
  const base='http://127.0.0.1:'+server.address().port+'/api/v1';
  async function register(number){
    const response=await fetch(base+'/register',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({number,password:'synthetic capability fixture',displayName:number})});
    assert.equal(response.status,200);
    return response.headers.getSetCookie()[0].split(';')[0];
  }
  const reader=await register('cap_reader'), outsider=await register('cap_outsider');
  store.register(legacy,member.displayName,'ai',null);
  const chat=store.openDirect('cap_reader',legacy).id;
  store.decide('cap_outsider',store.request('cap_reader','cap_outsider').id,true);
  const ordinary=store.createGroup('cap_reader','Synthetic group',['cap_outsider']).id;
  async function check(id=chat,cookie=reader,account='cap_reader'){
    const response=await fetch(base+'/conversations/'+id+'/first-task',{
      headers:{Cookie:cookie,'X-Social-Account':account}});
    return {status:response.status,cache:response.headers.get('cache-control'),body:await response.json()};
  }
  assert.deepEqual(await check(),{
    status:200,cache:'no-store',body:{available:true,number:legacy,stableNumber:native}});
  assert.equal(store.direct('cap_reader',native),undefined);
  assert.equal((await check(chat,reader,'cap_outsider')).status,409);
  assert.equal((await check(chat,outsider,'cap_outsider')).status,404);
  assert.deepEqual((await check(ordinary)).body,{available:false});
  assert.equal(probes,1);
  supported=false;
  assert.deepEqual((await check()).body,{available:false});
  supported=true;
  revokeDuringCheck=true;
  assert.deepEqual((await check()).body,{available:false});
  const before=probes;
  assert.deepEqual((await check()).body,{available:false});
  assert.equal(probes,before);
  assert.equal(store.one('SELECT count(*) n FROM messages').n,0);
  assert.equal(store.one('SELECT count(*) n FROM bothouse_work_orders').n,0);
});

test('the board receiver reports capability without starting a task',async ()=>{
  const path=require('node:path');
  const options={resolveMember:async()=>null,gate:path.resolve('synthetic-gate'),boardDir:path.resolve('synthetic-board'),
    textTaskCapability:async()=>({available:true})};
  assert.equal(await boardReceiver(options).available({}),false);
  assert.equal(await boardReceiver({...options,runTextTask(){assert.fail('must not start');}}).available({}),true);
});