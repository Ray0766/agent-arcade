'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {DatabaseSync}=require('node:sqlite');
const {setTimeout:delay}=require('node:timers/promises');
const {stockTaskReceiver}=require('./bothouse/stock-tasks.cjs');

test('two workers, redelivery and reopening the board preserve one Bridge turn', async t=>{
  const db=new DatabaseSync(':memory:');
  db.exec('CREATE TABLE bothouse_task_claims(prompt INTEGER,attempt INTEGER,state TEXT,updated INTEGER,result TEXT,PRIMARY KEY(prompt,attempt))');
  const store={one:(q,...v)=>db.prepare(q).get(...v),run:(q,...v)=>db.prepare(q).run(...v)};
  let calls=0, finish, allowed=true;
  const directory={
    list:async()=>({contacts:allowed?[{number:'bh_test',id:'project',configured:true}]:[]}),
    textTaskCapability:async()=>({available:true}),
    runTextTask:async()=>{calls++; return new Promise(resolve=>{finish=resolve;});}
  };
  const first=stockTaskReceiver(store,directory), second=stockTaskReceiver(store,directory);
  t.after(()=>{first.stop();second.stop();db.close();});
  const job={request:'sample',prompt:13,attempt:0,chat:'origin',scope:'session',ai:'bh_test',identity:'project',human:'first',direct:true};
  const step=(r,action,j=job)=>r.step(action,j,'请把文字分类：信封；糖果',()=>allowed);
  await step(first,'submit');
  await Promise.all([step(first,'status'),step(second,'status')]);
  await delay(5);assert.equal(calls,1);
  assert.equal((await step(second,'status')).state,'running');
  finish({text:'["文具","食品"]'});
  await delay(5);
  first.stop();
  const receipt=await step(second,'status');
  assert.equal(receipt.text,'文具：信封\n食品：糖果');
  await step(second,'submit');assert.deepEqual(await step(second,'status'),receipt);
  assert.equal(calls,1);
  const lost={...job,request:'lost',prompt:21};
  await step(second,'submit',lost);
  db.prepare("UPDATE bothouse_task_claims SET state='running',updated=0 WHERE prompt=?").run(lost.prompt);
  assert.equal((await step(second,'status',lost)).state,'uncertain');assert.equal(calls,1);
  const withdraw={...job,request:'withdraw',prompt:33};
  await step(second,'submit',withdraw);await step(second,'status',withdraw);
  await delay(5);assert.equal(calls,2);allowed=false;
  finish({text:'["文具","食品"]'});await delay(5);
  assert.equal(store.one('SELECT result FROM bothouse_task_claims WHERE prompt=33').result,null);
});
