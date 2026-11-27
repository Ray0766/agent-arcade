'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {setTimeout:delay}=require('node:timers/promises');
const {SocialStore}=require('./store.cjs');
const {createServer}=require('./http.cjs');
const {bothouseDirectory}=require('./bothouse/directory.cjs');

test('a private work result can quote only its live source group and exact visible question',async t=>{
  const scratch=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-task-handback-'));
  const filename=path.join(scratch,'fixture.sqlite');
  const store=new SocialStore(filename);
  const author='lin_xiao',owner='zhou_ning';
  const role={id:'fixture-sort',number:'bh_'+'1'.repeat(21),displayName:'序序',kind:'ai',source:'bothouse',configured:true};
  let shared=true;
  const directory=bothouseDirectory(store,async({account,number})=>({
    contacts:shared&&account===author&&(!number||number===role.number)?[role]:[],
  }));
  const received=[];
  const receiver={
    identity:async(account,number)=>(await directory.resolveMember(account,number))?.id,
    available:async()=>true,
    async step(action,job,text){
      received.push(text);
      const output='4、8、12';
      return {role:role.id,key:job.request,boardId:job.prompt,state:'returned',text:output,
        sha256:createHash('sha256').update(output).digest('hex')};
    },
  };
  const server=createServer(store,{bothouse:directory,taskReceiver:receiver}).listen(0,'127.0.0.1');
  await once(server,'listening');
  t.after(async()=>{
    server.closeAllConnections();
    await new Promise(done=>server.close(done));
    store.db.close();
    for(const file of fs.readdirSync(scratch))fs.unlinkSync(path.join(scratch,file));
    fs.rmdirSync(scratch);
  });
  const origin='http://127.0.0.1:'+server.address().port+'/api/v1/';
  async function register(number,displayName){
    const entered=await fetch(origin+'register',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({number,displayName,password:'synthetic-quote-handback'})});
    assert.equal(entered.status,200,await entered.text());
    const cookie=entered.headers.getSetCookie()[0].split(';',1)[0];
    return async(route,data,status=200,expected=number)=>{
      const response=await fetch(origin+route,{method:data===undefined?'GET':'POST',
        headers:{cookie,'Content-Type':'application/json','X-Social-Account':expected},body:data===undefined?undefined:JSON.stringify(data)});
      const body=await response.json();assert.equal(response.status,status,JSON.stringify(body));return body;
    };
  }
  const lin=await register(author,'林晓'),zhou=await register(owner,'周宁');
  store.decide(author,store.request(owner,author).id,true);
  const group=store.createGroup(owner,'河边散步讨论',[author]).id;
  const otherGroup=store.createGroup(owner,'另一个河边散步讨论',[author]).id;
  const questionText='三组 12、4、8 人，按人数如何排列？';
  const question=store.send(owner,group,{clientId:'question_main',text:questionText});
  const decoy=store.send(owner,group,{clientId:'question_same',text:questionText});
  const elsewhere=store.send(owner,otherGroup,{clientId:'question_elsewhere',text:questionText});
  const selected='请帮忙把分组人数排序。';
  const source=store.send(author,group,{clientId:'source_reply',text:selected,replyTo:question.id});
  const groupRoute='conversations/'+group+'/messages';
  const membershipRevision=store.access(author,group).membershipRevision;
  const anchor={chatId:group,messageId:source.id,membershipRevision};
  const {conversation:{id:privateChat}}=await lin('ai-contacts/start',{number:role.number,expectedAccount:author,taskSource:anchor});
  const privateRoute='conversations/'+privateChat+'/messages';
  const text='给你一个任务：\n'+selected;
  const pending=(await lin(privateRoute,{clientId:'task_group_create',text,taskSource:anchor,taskRole:role.number})).message;
  async function waitResult(prompt){
    for(let attempt=0;attempt<120;attempt++){
      const hit=store.one("SELECT m.id FROM messages m JOIN bothouse_work_orders w ON m.chat=w.chat AND m.nonce='work_'||w.request||'_0_returned' WHERE w.prompt=?",prompt);
      if(hit)return hit.id;
      await delay(50);
    }
    assert.fail('未读回工作单结果');
  }
  const result=await waitResult(pending.id);
  const reviewRoute=privateRoute+'/'+result+'/task-group-source?account='+author;
  const seen=await lin(reviewRoute);
  assert.deepEqual(seen,{group:{id:group,title:'河边散步讨论',membershipRevision},
    source:{id:source.id,text:selected,author:'林晓'},question:{id:question.id,text:questionText,author:'周宁'}});
  assert.deepEqual(received,[text]);
  const persisted=new DatabaseSync(filename,{readOnly:true});
  try{
    const record=persisted.prepare('SELECT source_chat,source_message FROM bothouse_work_order_group_sources WHERE prompt=?').get(pending.id);
    assert.deepEqual({...record},{source_chat:group,source_message:source.id});
  }finally{persisted.close();}

  const ordinary=(await lin(privateRoute,{clientId:'task_old_direct',text:'给你一个任务：旧式私聊交办。'})).message;
  const oldResult=await waitResult(ordinary.id);
  await lin(privateRoute+'/'+oldResult+'/task-group-source?account='+author,undefined,404);
  await zhou(privateRoute+'/'+result+'/task-group-source?account='+owner,undefined,404);
  await lin(reviewRoute,undefined,409,owner);

  const handback={clientId:'group_handback_once',text:'4、8、12',replyTo:question.id,membershipRevision,
    taskHandback:{chatId:privateChat,resultId:result}};
  await lin(groupRoute,{...handback,replyTo:decoy.id},409);
  await lin('conversations/'+otherGroup+'/messages',{...handback,replyTo:elsewhere.id},409);
  await lin(groupRoute,{...handback,membershipRevision:'old'},409);
  await lin(groupRoute,{...handback,replyTo:undefined},409);
  shared=false;
  await lin(groupRoute,handback,404);
  shared=true;
  const sent=(await lin(groupRoute,handback)).message;
  assert.deepEqual(sent.quote,{id:question.id,name:'周宁',text:questionText});
  assert.equal((await lin(groupRoute,handback)).message.id,sent.id);
  assert.equal(store.one('SELECT count(*) n FROM messages WHERE chat=? AND sender=? AND nonce=?',group,author,handback.clientId).n,1);
  assert.equal(received.length,2);

  store.run('UPDATE messages SET removed=1 WHERE id=?',question.id);
  assert.equal((await lin(reviewRoute)).question,undefined);
  await lin(groupRoute,{...handback,clientId:'stale_parent'},409);
  const fallback=(await lin(groupRoute,{...handback,clientId:'explicit_source',replyTo:source.id})).message;
  assert.equal(fallback.quote.id,source.id);
  store.remove(owner,group,author,false);
  await lin(reviewRoute,undefined,404);
  store.addMembers(owner,group,[author]);
  await lin(reviewRoute,undefined,404);
});
