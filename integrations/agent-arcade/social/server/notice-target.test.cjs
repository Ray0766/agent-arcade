'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {once}=require('node:events');
const {randomUUID}=require('node:crypto');
const {SocialStore}=require('./store.cjs');
const {createServer}=require('./http.cjs');

test('notice selection and click resolve only the authorized trigger or original mention',async t=>{
  const store=new SocialStore(':memory:');
  const server=createServer(store).listen(0,'127.0.0.1');
  t.after(()=>{server.closeAllConnections();server.close();store.db.close();});
  await once(server,'listening');
  const root='http://127.0.0.1:'+server.address().port+'/api/v1';
  const owner='walk_lin',reader='walk_zhou',cookies={};
  for(const [number,displayName] of [[owner,'林晓'],[reader,'周宁']]){
    const response=await fetch(root+'/register',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({number,displayName,password:'local-notification-fixture'})});
    assert.equal(response.status,200);
    cookies[number]=response.headers.get('set-cookie').split(';')[0];
    await response.text();
  }
  const direct=store.decide(reader,store.request(owner,reader).id,true).conversation.id;
  const group=store.createGroup(owner,'周日河边小队',[reader]).id;
  async function get(chat,params,status=200,session=reader,header=session){
    const url=root+'/conversations/'+chat+'/notice-target?'+new URLSearchParams({account:reader,...params});
    const response=await fetch(url,{headers:{Cookie:cookies[session],'X-Social-Account':header}});
    const body=await response.json();
    assert.equal(response.status,status,JSON.stringify(body));return body;
  }
  const click=notice=>({through:notice.through,membershipRevision:notice.membershipRevision,...(notice.target??{kind:'none'})});
  const send=(chat,text,mentionAccount)=>store.send(owner,chat,{text,clientId:randomUUID(),mentionAccount}).id;
  const original=send(direct,'周宁，我们在东桥入口等你。');
  const directNotice=await get(direct,{through:original});
  assert.deepEqual(directNotice.target,{messageId:original,kind:'direct'});
  const later=send(direct,'你到了说一声。');
  assert.equal((await get(direct,{through:original})).eligible,false);
  store.markConversationRead(reader,direct,{expectedAccount:reader,through:later});
  assert.deepEqual((await get(direct,click(directNotice))).target,directNotice.target);
  assert.equal(store.historySearch(reader,direct,new URLSearchParams({account:reader,around:original})).anchor,original);
  store.run('UPDATE messages SET removed=1 WHERE chat=? AND id=?',direct,original);
  const recalledDirect=await get(direct,click(directNotice));
  assert.equal(recalledDirect.eligible,true);assert.equal(recalledDirect.target,null);
  const plain=send(group,'周日早点出发。');
  assert.equal((await get(group,{through:plain})).target,null);
  const mention=send(group,'周宁，带上路线图好吗？',reader);
  const reply=send(group,'我带保温杯。');
  const notice=await get(group,{through:reply,after:plain});
  assert.equal(notice.eligible,true);
  assert.deepEqual(notice.target,{messageId:mention,kind:'mention'});
  assert.equal((await get(group,{through:reply,after:mention})).target,null);
  const next=send(group,'周宁，桥头见。',reader);
  assert.equal((await get(group,{through:next})).target.messageId,next);
  assert.deepEqual((await get(group,click(notice))).target,notice.target);
  assert.equal(store.conversation(reader,group).readThrough,store.access(reader,group).since);
  assert.equal((await get(group,{...click(notice),messageId:reply})).target,null);
  assert.equal((await get(group,{...click(notice),messageId:next})).target,null);
  assert.equal((await get(direct,{...click(notice),through:later})).target,null);
  // Even a still-visible original loses its mention target if the relation disappears.
  store.run('DELETE FROM message_mentions WHERE message=?',next);
  assert.equal((await get(group,{...click(notice),through:next,messageId:next})).target,null);
  const recall=id=>store.run('UPDATE messages SET removed=1 WHERE chat=? AND id=?',group,id);
  recall(reply);
  assert.deepEqual((await get(group,click(notice))).target,notice.target);
  recall(mention);
  const missing=await get(group,click(notice));
  assert.equal(missing.eligible,true);assert.equal(missing.target,null);
  await get(group,click(notice),409,owner);
  await get(group,click(notice),409,reader,owner);
  store.run('INSERT INTO muted_conversations(chat,account) VALUES(?,?)',group,reader);
  assert.equal((await get(group,{through:next})).eligible,false);
  assert.equal((await get(group,click(notice))).eligible,false);
  store.run('DELETE FROM muted_conversations WHERE chat=? AND account=?',group,reader);
  store.remove(owner,group,reader,false);
  await get(group,click(notice),404);
  store.addMembers(owner,group,[reader]);
  assert.equal((await get(group,click(notice))).target,null);
  assert.equal((await get(group,{through:next})).eligible,false);
});
