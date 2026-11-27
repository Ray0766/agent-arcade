'use strict';

const assert=require('node:assert/strict');
const {once}=require('node:events');
const {readFileSync}=require('node:fs');
const {join}=require('node:path');
const {test}=require('node:test');
const {createServer}=require('./http.cjs');
const {SocialStore}=require('./store.cjs');

test('explicit text corrections follow author, conversation and both history bounds',async t=>{
  const store=new SocialStore(':memory:');
  const server=createServer(store).listen(0,'127.0.0.1');
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));store.db.close();});
  await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port+'/api/v1';
  const lin='lin_xiao',zhou='zhou_ning',chen='chen_yu',cookies=new Map();
  for(const [number,displayName] of [[lin,'林晓'],[zhou,'周宁'],[chen,'陈屿']]){
    const response=await fetch(origin+'/register',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({number,displayName,password:'synthetic-correction'})});
    assert.equal(response.status,200);
    cookies.set(number,response.headers.get('set-cookie').split(';')[0]);
  }
  const direct=store.decide(zhou,store.request(lin,zhou).id,true).conversation.id;
  store.decide(chen,store.request(lin,chen).id,true);
  const group=store.createGroup(lin,'周末河边散步',[zhou]).id;
  async function request(account,path,body,status=200){
    const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{Cookie:cookies.get(account),
      'Content-Type':'application/json','X-Social-Account':account},body:body&&JSON.stringify(body)});
    const data=await response.json();
    assert.equal(response.status,status,JSON.stringify(data));
    return data;
  }
  const thread=chat=>'/conversations/'+chat;
  const messages=(account,chat,suffix='',body,status)=>request(account,thread(chat)+'/messages'+suffix,body,status);
  const search=(account,chat,filter,status)=>request(account,thread(chat)+'/history-search?'+new URLSearchParams({
    account,...filter
  }),undefined,status);
  const context=(account,chat)=>({expectedAccount:account,revision:store.access(account,chat).membershipRevision});
  const recall=(account,chat,id)=>messages(account,chat,'/'+id+'/recall',context(account,chat));
  const post=async (account,chat,clientId,text,extra={})=>
    (await messages(account,chat,'',{clientId,text,...extra})).message;
  const draft=(account,chat,original,clientId,text)=>({
    expectedAccount:account,membershipRevision:context(account,chat).revision,correctionOf:original,clientId,text
  });
  const total=chat=>store.one('SELECT count(*) AS n FROM messages WHERE chat=?',chat).n;
  const updates=async (account,chat,...ids)=>(await messages(account,chat,'?correctionIds='+ids.join(','))).correctionUpdates;

  const original=await post(lin,direct,'old-agreement','十点半北门蓝色长椅集合');
  const reply=await post(zhou,direct,'ordinary-reply','我带纸杯',{replyTo:original.id});
  const change=draft(lin,direct,original.id,'correct-agreement','十一点东桥集合，我带保温壶');
  await messages(lin,direct,'',change,404);
  await recall(lin,direct,original.id);
  const previous=total(direct);
  assert.equal((await messages(lin,direct,'/'+original.id+'/recall-text',context(lin,direct))).text,original.text);
  await messages(zhou,direct,'/'+original.id+'/recall-text',context(zhou,direct),404);
  await messages(zhou,direct,'',draft(zhou,direct,original.id,'wrong-author',change.text),404);
  await messages(lin,direct,'',{...change,expectedAccount:zhou},409);
  await messages(lin,direct,'',{...change,membershipRevision:undefined},409);
  await messages(lin,direct,'',{...change,replyTo:reply.id},400);
  await messages(lin,group,'',draft(lin,group,original.id,'wrong-group',change.text),404);
  assert.equal(total(direct),previous);
  assert.deepEqual(await updates(zhou,direct,original.id),{});
  store.db.exec(`CREATE TEMP TRIGGER fail_correction BEFORE INSERT ON message_corrections
    BEGIN SELECT RAISE(ABORT,'simulated correction failure'); END`);
  try{
    assert.throws(()=>store.transaction(()=>store.send(lin,direct,change)),/simulated correction failure/);
    assert.equal(total(direct),previous);
  }finally{
    store.db.exec('DROP TRIGGER fail_correction');
  }
  const [sent,retry]=await Promise.all([messages(lin,direct,'',change),messages(lin,direct,'',change)]);
  assert.equal(sent.message.id,retry.message.id);
  const target=sent.message.id;
  assert.equal(sent.message.isCorrection,true);
  assert(!('quote' in sent.message));
  await messages(lin,direct,'',{...change,text:'换一份文字'},409);
  await messages(lin,direct,'',{clientId:change.clientId,text:change.text},409);
  assert.equal((await messages(lin,direct,'',{...change,clientId:'another-confirmation'},409)).error.code,'correction_exists');
  assert.equal(total(direct),previous+1);
  assert.deepEqual(await updates(zhou,direct,original.id),{[original.id]:target});
  const around=await search(zhou,direct,{around:target});
  assert.equal(around.anchor,target);
  const old=around.messages.find(m=>m.id===original.id);
  assert.equal(old.text,'[已撤回]');
  assert.equal(old.correctionId,target);
  assert.deepEqual(around.messages.find(m=>m.id===reply.id).quote,{unavailable:true});
  assert.deepEqual((await search(zhou,direct,{q:'北门'})).results,[]);
  assert.deepEqual((await search(zhou,direct,{q:'东桥'})).results.map(row=>[row.id,row.isCorrection]),[[target,true]]);
  await recall(lin,direct,target);
  assert.deepEqual(await updates(zhou,direct,original.id),{});
  await search(zhou,direct,{around:target},404);
  await messages(lin,direct,'',change,409);
  const next=(await messages(lin,direct,'',draft(lin,direct,target,'second-correction','十一点半东桥集合'))).message;
  assert.deepEqual(await updates(zhou,direct,original.id,target),{[target]:next.id});

  const groupOld=await post(lin,group,'old-group-message','十点半北门集合');
  await recall(lin,group,groupOld.id);
  await request(lin,'/groups/'+group+'/members',{memberNumbers:[chen]});
  const groupNew=(await messages(lin,group,'',draft(lin,group,groupOld.id,'correct-group','十一点东桥等你'))).message;
  const late=await search(chen,group,{around:groupNew.id});
  assert.deepEqual(late.messages.map(m=>m.id),[groupNew.id]);
  assert.equal(late.messages[0].isCorrection,true);
  assert(!('quote' in late.messages[0])&&!('correctionOf' in late.messages[0])&&!('correctionId' in late.messages[0]));
  assert.deepEqual(await updates(chen,group,groupOld.id),{});
  await messages(chen,group,'/'+groupOld.id+'/recall-text',context(chen,group),404);
  await request(zhou,'/groups/'+group+'/leave',{});
  await messages(zhou,group,'?correctionIds='+groupOld.id,undefined,404);
  await request(lin,'/groups/'+group+'/members',{memberNumbers:[zhou]});
  assert.deepEqual(await updates(zhou,group,groupOld.id),{});
  await search(zhou,group,{around:groupNew.id},404);
  // Simulate a card retained from a database with the preparation feature.
  const card=await post(lin,group,'prepare-group','出发前准备');
  store.db.exec('CREATE TABLE group_preparations(message INTEGER PRIMARY KEY REFERENCES messages(id))');
  store.run('INSERT INTO group_preparations(message) VALUES(?)',card.id);
  await recall(lin,group,card.id);
  await messages(lin,group,'',draft(lin,group,card.id,'structured-not-text','不能将卡片按普通文字订正'),404);
});

test('additive correction schema preserves legacy recalled messages and unlinked re-sends',t=>{
  const store=new SocialStore(':memory:');
  t.after(()=>store.db.close());
  for(const account of ['owner','reader'])store.register(account,account,'human','fixture');
  const chat=store.decide('reader',store.request('owner','reader').id,true).conversation.id;
  const original=store.send('owner',chat,{clientId:'old-agreement',text:'十点半北门集合'});
  store.recallMessage('owner',chat,original.id,{expectedAccount:'owner',revision:store.access('owner',chat).membershipRevision});
  const replacement=store.send('owner',chat,{clientId:'old-unlinked-resend',text:'十一点东桥集合'});
  store.db.exec('DROP TABLE message_corrections');
  store.db.exec(readFileSync(join(__dirname,'schema.sql'),'utf8'));
  const {messages}=store.historyPage('reader',chat,new URLSearchParams());
  assert.deepEqual(messages.map(m=>[m.id,m.recalled,m.correctionId,m.isCorrection]),[
    [original.id,true,undefined,undefined],[replacement.id,undefined,undefined,undefined]
  ]);
  assert.equal(store.one('SELECT body FROM recalled_message_text WHERE message=?',original.id).body,original.text);
});
