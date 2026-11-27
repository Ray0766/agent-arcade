'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {once}=require('node:events');
const {SocialStore}=require('./store.cjs');
const {createServer}=require('./http.cjs');
const {bothouseDirectory}=require('./bothouse/directory.cjs');

test('a group text handoff resolves the authorized stable role and only creates a task on confirmation',async t=>{
  const store=new SocialStore(':memory:');
  const author='lin_xiao',other='zhou_ning',outsider='chen_yu';
  const role=(digit,id)=>({id,number:'bh_'+digit.repeat(21),displayName:'小岚',configured:true,kind:'ai',source:'bothouse'});
  const eligible=role('1','editor'),plain=role('2','chat'),different=role('3','other_editor');
  const legacy='bh_'+'4'.repeat(21);
  eligible.legacyNumber=legacy;
  let authorized=true,holdCapability;
  const directory=bothouseDirectory(store,async({account,number})=>{
    const contacts=account===author?[...(authorized?[eligible]:[]),plain,different]:[];
    return {directoryStatus:'ready',contacts:contacts.filter(r=>!number||r.number===number)};
  });
  const receiver={
    identity:async(account,number)=>(await directory.resolveMember(account,number))?.id,
    async available(turn){
      if(holdCapability){await holdCapability();holdCapability=undefined;}
      return turn.project===different.id||authorized&&turn.project===eligible.id;
    },
    async step(){return {state:'waiting_backend'};},
  };
  const server=createServer(store,{bothouse:directory,taskReceiver:receiver}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));store.db.close();});
  const origin='http://127.0.0.1:'+server.address().port+'/api/v1/';
  async function account(number){
    const response=await fetch(origin+'register',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({number,displayName:number,password:'synthetic-group-task'})});
    assert.equal(response.status,200);
    const cookie=response.headers.getSetCookie()[0].split(';')[0];
    return async(route,body,expected=200,selected=number)=>{
      const reply=await fetch(origin+route,{method:body===undefined?'GET':'POST',
        headers:{Cookie:cookie,'Content-Type':'application/json','X-Social-Account':selected},
        body:body===undefined?undefined:JSON.stringify(body)});
      const answer=await reply.json();
      assert.equal(reply.status,expected,JSON.stringify(answer));
      return answer;
    };
  }
  const lin=await account(author),zhou=await account(other),chen=await account(outsider);
  store.decide(other,store.request(author,other).id,true);
  const {conversation:{id:group}}=await lin('groups',{title:'周末河边散步',memberNumbers:[other]});
  const groupMessages='conversations/'+group+'/messages';
  const own=(await lin(groupMessages,{clientId:'own_group_text',text:'大家周日在北门集合，带上雨伞。'})).message.id;
  const others=(await zhou(groupMessages,{clientId:'other_group_text',text:'我会提早到。'})).message.id;
  const fresh=(messageId,account=author)=>({chatId:group,messageId,membershipRevision:store.access(account,group).membershipRevision});
  const source=fresh(own);
  const targets=source=>'ai-contacts/task-targets?'+new URLSearchParams(source);
  assert.deepEqual((await lin(targets(source))).contacts.map(c=>c.number),[eligible.number,different.number]);
  await lin(targets(fresh(others)),undefined,404);
  await zhou(targets(fresh(own,other)),undefined,404);
  await chen(targets(source),undefined,404);
  await lin(targets(source),undefined,409,other);
  const noAccess={...source,membershipRevision:'old-revision'};
  await lin(targets(noAccess),undefined,404);
  const start=(candidate,taskSource=source)=>({number:candidate,expectedAccount:author,taskSource});
  await lin('ai-contacts/start',start(plain.number),403);
  assert.equal(store.direct(author,plain.number),undefined);
  store.register(legacy,'小岚','ai',null);
  const legacyChat=store.openDirect(author,legacy).id;
  const {conversation:target,taskRole}=await lin('ai-contacts/start',start(eligible.number));
  assert.equal(taskRole,eligible.number);
  assert.equal(target.id,legacyChat);
  assert.equal(store.direct(author,eligible.number),undefined);
  const messages='conversations/'+target.id+'/messages';
  assert.equal(store.one('SELECT count(*) n FROM bothouse_work_orders').n,0);
  const submit={clientId:'group_task_once',text:'给你一个任务：\n大家周日在北门集合，带上雨伞。\n\n补充要求：\n把集合提醒缩成一句话。',
    taskSource:source,taskRole:eligible.number};
  await lin(messages,{...submit,text:'普通聊天。'},400);
  await lin(messages,{...submit,text:'给你一个任务：\n与所选群消息无关。'},400);
  await lin(messages,{...submit,taskRole:different.number},403);
  await lin(messages,submit,409,other);
  await lin(groupMessages,submit,403);
  authorized=false;
  await lin('ai-contacts/start',start(eligible.number),403);
  await lin(messages,submit,403);
  assert.equal(store.one('SELECT count(*) n FROM bothouse_work_orders').n,0);
  authorized=true;
  const {message}=await lin(messages,submit);
  assert.equal(message.task.target,legacy);
  const repeated=await lin(messages,submit);
  assert.equal(repeated.message.id,message.id);
  assert.equal(store.one('SELECT count(*) n FROM bothouse_work_orders').n,1);

  const reached=Promise.withResolvers(),resume=Promise.withResolvers();
  holdCapability=async()=>{reached.resolve();await resume.promise;};
  const pending=lin(messages,{...submit,clientId:'group_task_race'},404);
  await reached.promise;
  store.run('UPDATE messages SET removed=1 WHERE id=?',own);
  resume.resolve();
  await pending;
  assert.equal(store.one('SELECT count(*) n FROM bothouse_work_orders').n,1);
  assert.equal(store.one('SELECT count(*) n FROM messages WHERE chat=?',group).n,2);
});
