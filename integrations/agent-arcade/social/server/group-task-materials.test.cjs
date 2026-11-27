'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {once}=require('node:events');
const {createHash}=require('node:crypto');
const {setTimeout:delay}=require('node:timers/promises');
const {SocialStore}=require('./store.cjs');
const {createServer}=require('./http.cjs');
const {bothouseDirectory}=require('./bothouse/directory.cjs');

test('confirmed group materials reach just the selected authorized local task receiver',{timeout:10000},async t=>{
  const store=new SocialStore(':memory:');
  const lin='lin_xiao',zhou='zhou_ning',chen='chen_yu';
  const role={id:'fixture-rain',number:'bh_'+'a'.repeat(21),displayName:'小岚',
    kind:'ai',source:'bothouse',configured:true};
  let authorized=true,holdCapability;
  const directory=bothouseDirectory(store,async({account,number})=>({directoryStatus:'ready',
    contacts:authorized&&account===zhou&&(!number||number===role.number)?[role]:[]}));
  const delivered=[];
  const output='公开摘录：雨天走紫藤入口。\n私人备忘：先核手头记录。';
  const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
  const receiver={
    identity:async(account,number)=>(await directory.resolveMember(account,number))?.id,
    async available(){
      if(holdCapability){await holdCapability();holdCapability=undefined;}
      return authorized;
    },
    async step(action,job,text){
      delivered.push({action,number:job.ai,identity:job.identity,key:job.request,text});
      return {role:role.id,key:job.request,boardId:job.prompt,state:'returned',text:output,sha256:hash(output)};
    }
  };
  const server=createServer(store,{bothouse:directory,taskReceiver:receiver}).listen(0,'127.0.0.1');
  t.after(async()=>{server.closeAllConnections();await new Promise(done=>server.close(done));store.db.close();});
  await once(server,'listening');
  const endpoint='http://127.0.0.1:'+server.address().port+'/api/v1/';
  async function register(number,displayName){
    const response=await fetch(endpoint+'register',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({number,displayName,password:'synthetic-group-materials'})});
    assert.equal(response.status,200);
    const cookie=response.headers.getSetCookie()[0].split(';')[0];
    return async(path,body,status=200,selected=number)=>{
      const response=await fetch(endpoint+path,{method:body===undefined?'GET':'POST',
        headers:{Cookie:cookie,'Content-Type':'application/json','X-Social-Account':selected},
        body:body===undefined?undefined:JSON.stringify(body)});
      const data=await response.json();
      assert.equal(response.status,status,JSON.stringify(data));
      return data;
    };
  }
  const leader=await register(lin,'林晓'),member=await register(zhou,'周宁'),late=await register(chen,'陈屿');
  store.decide(zhou,store.request(lin,zhou).id,true);
  store.decide(chen,store.request(lin,chen).id,true);
  const group=store.createGroup(lin,'周末河边散步',[zhou]).id;
  const another=store.createGroup(lin,'另一个群',[zhou]).id;
  const hidden=store.send(lin,group,{clientId:'unselected-context',text:'群内无关编号 355'});
  const background=store.send(lin,group,{clientId:'selected-background',text:'只整理雨天入口。',replyTo:hidden.id});
  const revision=(account,chat)=>store.access(account,chat).membershipRevision;
  function file(chat,clientId,body){
    const bytes=Buffer.isBuffer(body)?body:Buffer.from(body);
    return store.sendFile(lin,chat,{clientId,name:'集合说明.txt',bytes,digest:hash(bytes)},revision(lin,chat));
  }
  const wrong=file(group,'matching-name-old','石阶入口，编号 932');
  const chosen=file(group,'matching-name-selected','紫藤入口，编号 714\n请走有顶棚的小路。');
  const invalid=file(group,'unsupported-binary',Buffer.from([0xff,0x81]));
  const tooLong=file(group,'over-the-task-cap','长'.repeat(4001));
  const foreign=file(another,'other-group-file','跨群资料');
  await leader('groups/'+group+'/members',{memberNumbers:[chen]});
  const taskSource={chatId:group,messageId:background.id,fileMessageId:chosen.id,membershipRevision:revision(zhou,group)};
  const targets=source=>'ai-contacts/task-targets?'+new URLSearchParams(source);
  assert.deepEqual((await member(targets(taskSource))).contacts.map(contact=>contact.number),[role.number]);
  await member(targets({...taskSource,fileMessageId:foreign.id}),undefined,404);
  await late(targets({...taskSource,membershipRevision:revision(chen,group)}),undefined,404);
  await member(targets({...taskSource,fileMessageId:undefined}),undefined,404);
  const {conversation:roleChat}=await member('ai-contacts/start',{number:role.number,expectedAccount:zhou,taskSource});
  const rolePath='conversations/'+roleChat.id;
  store.run('INSERT INTO ai_direct_grants(chat,human,ai) VALUES(?,?,?)',roleChat.id,zhou,role.number);
  const body={expectedAccount:zhou,membershipRevision:revision(zhou,roleChat.id),taskSource,taskRole:role.number,
    requirement:'请用一句话整理雨天入口。',aiConsentRevision:0};
  const preview=(input=body,status)=>member(rolePath+'/task-material-preview',input,status);
  const send=(input,status)=>member(rolePath+'/messages',input,status);
  const count=()=>store.one('SELECT count(*) AS n FROM bothouse_work_orders').n;
  const reviewed=await preview();
  assert.deepEqual(reviewed.background,{id:background.id,author:'林晓'});
  assert.deepEqual(reviewed.file,{id:chosen.id,name:'集合说明.txt',author:'林晓'});
  assert.deepEqual(reviewed.recipient,{number:role.number,displayName:'小岚'});
  assert(reviewed.text.includes('只整理雨天入口。'));
  assert(reviewed.text.includes('紫藤入口，编号 714\n请走有顶棚的小路。'));
  assert(reviewed.text.includes(body.requirement));
  assert(!/932|355/.test(reviewed.text));
  const draftFor=fileMessageId=>({...body,taskSource:{...taskSource,fileMessageId}});
  await preview(draftFor(invalid.id),400);
  await preview(draftFor(tooLong.id),400);
  const sameName=await preview(draftFor(wrong.id));
  assert.notEqual(sameName.review,reviewed.review);
  assert.equal(count(),0);
  assert.deepEqual(delivered,[]);
  assert(!store.one('SELECT 1 FROM members WHERE chat=? AND account=?',group,role.number));
  assert.throws(()=>store.messageFile(role.number,group,chosen.id),{code:'unknown_chat'});

  const confirm={...body,materialReview:reviewed.review,clientId:'material_once'};
  await send({...confirm,text:'不可替换的正文'},400);
  await send({...confirm,materialReview:undefined},400);
  await send({...confirm,taskSource:{...taskSource,fileMessageId:wrong.id}},409);
  await send({...confirm,requirement:'别的要求'},409);
  await send({...confirm,expectedAccount:lin},409);
  authorized=false;
  await send(confirm,403);
  authorized=true;
  assert.equal(count(),0);
  const [one,retry]=await Promise.all([send(confirm),send(confirm)]);
  assert.equal(retry.message.id,one.message.id);
  assert.equal(one.message.text,reviewed.text);
  assert.equal(count(),1);
  let returned;
  for(let attempt=0;attempt<80&&!returned;attempt++){
    await delay(50);
    returned=store.one(`SELECT m.id FROM messages m JOIN bothouse_work_orders w
      ON m.chat=w.chat AND m.nonce='work_'||w.request||'_0_returned' WHERE w.prompt=?`,one.message.id);
  }
  assert(returned);
  assert.equal(delivered.length,1);
  assert.deepEqual(delivered[0],{action:'submit',number:role.number,identity:role.id,
    key:store.one('SELECT request FROM bothouse_work_orders WHERE prompt=?',one.message.id).request,text:reviewed.text});
  const groupSource=await member(rolePath+'/messages/'+returned.id+'/task-group-source?account='+zhou);
  assert.deepEqual(groupSource,{group:{id:group,title:'周末河边散步',membershipRevision:revision(zhou,group)},
    source:{id:background.id,text:background.text,author:'林晓'}});
  const groupPath='conversations/'+group+'/messages';
  const handback={clientId:'material_handback',text:'雨天走紫藤入口。',replyTo:background.id,
    membershipRevision:revision(zhou,group),taskHandback:{chatId:roleChat.id,resultId:returned.id}};
  await member(groupPath,{...handback,replyTo:hidden.id},409);
  const excerpt=(await member(groupPath,handback)).message;
  assert.deepEqual(excerpt.quote,{id:background.id,name:'林晓',text:background.text});
  assert(!JSON.stringify(await leader(groupPath)).includes('私人备忘'));

  const reached=Promise.withResolvers(),resume=Promise.withResolvers();
  holdCapability=async()=>{reached.resolve();await resume.promise;};
  const pending=send({...confirm,clientId:'stale_material_file'},404);
  await Promise.race([reached.promise,pending.then(()=>assert.fail('未进入授权复核'))]);
  store.run('UPDATE messages SET removed=1 WHERE id=?',chosen.id);
  resume.resolve();
  await pending;
  assert.equal(count(),1);
  const next={...draftFor(wrong.id),materialReview:sameName.review,clientId:'stale_material_member'};
  store.run('INSERT INTO ai_direct_permissions(chat,enabled,revision,context_floor) VALUES(?,1,1,0)',roleChat.id);
  assert.equal((await send(next,409)).error.code,'ai_consent_changed');
  await member('groups/'+group+'/leave',{});
  await send(next,404);
  await leader('groups/'+group+'/members',{memberNumbers:[zhou]});
  await send(next,404);
  assert.equal(count(),1);
  assert.equal(delivered.length,1);
});
