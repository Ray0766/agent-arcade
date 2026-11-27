'use strict';
const {test}=require('node:test');
const {once}=require('node:events');
const assert=require('node:assert/strict');
const {SocialStore}=require('./store.cjs');
const {createServer}=require('./http.cjs');

test('file name search respects the message cursor, current membership and history floor',t=>{
  const store=new SocialStore(':memory:');
  t.after(()=>store.db.close());
  for(const name of ['owner','guest'])store.register(name,name,'human','fixture');
  store.decide('guest',store.request('owner','guest').id,true);
  const group=store.createGroup('owner','散步小队',['guest']).id;
  const revision=store.access('owner',group).membershipRevision;
  const params=(q,extra={})=>new URLSearchParams({account:'guest',q,...extra});
  const search=(q,extra)=>store.searchConversationMessages('guest',params(q,extra));
  const files=[];
  for(let i=0;i<21;i++)files.push(store.sendFile('owner',group,{
    clientId:'instructions-'+i,name:'散步集合说明.txt',bytes:Buffer.from(String(i)),digest:'file-'+i
  },revision).id);
  const first=search('集合说明');
  assert.deepEqual(first.results.map(row=>row.id),files.slice(1).reverse());
  assert.equal(first.results[0].attachmentKind,'file');
  assert.deepEqual(search('集合说明',{before:first.next}).results.map(row=>row.id),[files[0]]);
  assert.deepEqual(search('没有这句话').results,[]);
  store.run('UPDATE messages SET removed=1 WHERE id=?',files.at(-1));
  assert(!search('集合说明').results.some(row=>row.id===files.at(-1)));
  assert.throws(()=>store.messageFile('guest',group,files.at(-1)),{code:'unknown_file'});
  store.remove('owner',group,'guest',false);
  assert.deepEqual(search('集合说明').results,[]);
  assert.throws(()=>store.messageFile('guest',group,files[0]),{code:'unknown_chat'});
  store.addMembers('owner',group,['guest']);
  assert.deepEqual(search('集合说明').results,[]);
  assert.throws(()=>store.messageFile('guest',group,files[0]),{code:'unknown_file'});
  assert.throws(()=>store.historySearch('guest',group,new URLSearchParams({account:'guest',around:files[0]})),{code:'unknown_message'});
});

test('global video search uses stored names and pages only currently readable messages',async t=>{
  const store=new SocialStore(':memory:');
  const server=createServer(store).listen(0,'127.0.0.1');
  t.after(async()=>{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.db.close();});
  await once(server,'listening');
  const origin='http://127.0.0.1:'+server.address().port+'/api/v1';
  const lin='lin_xiao',zhou='zhou_ning',chen='chen_yu',cookies=new Map();
  for(const [number,displayName] of [[lin,'林晓'],[zhou,'周宁'],[chen,'陈屿']]){
    const response=await fetch(origin+'/register',{method:'POST',headers:{'Content-Type':'application/json'},
      body:JSON.stringify({number,displayName,password:'synthetic-global-video'})});
    assert.equal(response.status,200);
    cookies.set(number,response.headers.get('set-cookie').split(';')[0]);
  }
  const direct=store.decide(zhou,store.request(lin,zhou).id,true).conversation.id;
  const target=store.decide(chen,store.request(zhou,chen).id,true).conversation.id;
  const group=store.createGroup(lin,'周末河边散步',[zhou]).id;
  const send=(chat,clientId,mime,name,account=lin)=>store.transaction(()=>store.sendVideo(account,chat,{
    clientId,mime,name,bytes:Buffer.from(clientId),digest:clientId,width:320,height:180,durationMs:3000
  },store.access(account,chat).membershipRevision));
  const filename='东桥到北门.mp4';
  const source=send(direct,'direct-video','video/mp4',filename);
  const groupVideo=send(group,'group-video','video/webm','东桥散步.webm');
  const file=store.sendFile(lin,group,{clientId:'same-name-file',name:filename,bytes:Buffer.from('file'),
    digest:'same-name-file'},store.access(lin,group).membershipRevision);
  const role='video_role';
  store.register(role,'散步助手','ai',null);
  store.run('INSERT INTO members VALUES(?,?,?)',group,role,0);
  assert.deepEqual(store.searchConversationMessages(role,new URLSearchParams({account:role,q:'东桥'}))
    .results.map(({id})=>id),[file.id]);
  const otherVideo=send(target,'same-name-other-chat','video/mp4',filename,zhou);
  let videoReads=0;
  const getVideo=store.messageVideo.bind(store);
  store.messageVideo=(...args)=>{videoReads++;return getVideo(...args);};
  async function request(account,path,status=200){
    const response=await fetch(origin+path,{headers:{Cookie:cookies.get(account),'X-Social-Account':account}});
    const data=await response.json();
    assert.equal(response.status,status,JSON.stringify(data));
    return data;
  }
  const search=(account,q,opts={},status)=>request(account,'/conversation-search?'+new URLSearchParams({account,q,...opts}),status);
  const changes=store.one('SELECT total_changes() AS n').n;
  const visible=await search(zhou,'东桥');
  assert.deepEqual(visible.results.map(({id,chatId,text,attachmentKind,mime,durationMs})=>
    [id,chatId,text,attachmentKind,mime,durationMs]),[
    [otherVideo.id,target,filename,'video','video/mp4',3000],
    [file.id,group,filename,'file',undefined,undefined],
    [groupVideo.id,group,'东桥散步.webm','video','video/webm',3000],
    [source.id,direct,filename,'video','video/mp4',3000]
  ]);
  assert.deepEqual((await search(zhou,'短视频')).results.map(row=>row.id),[otherVideo.id,groupVideo.id,source.id]);
  const resultOnly=await search(chen,'东桥');
  assert.deepEqual(resultOnly.results.map(({id,chatId})=>[id,chatId]),[[otherVideo.id,target]]);
  const context=await request(chen,'/conversations/'+target+'/history-search?account='+chen+'&around='+otherVideo.id);
  assert.equal(context.anchor,otherVideo.id);
  assert.equal(context.messages.find(row=>row.id===otherVideo.id).attachment.type,'video');
  await search(chen,'东桥',{account:zhou},409);
  assert.equal(videoReads,0);
  assert.equal(store.one('SELECT total_changes() AS n').n,changes);

  const visibleIds=[otherVideo.id],excluded=store.createGroup(lin,'另一个群',[zhou]).id;
  store.remove(lin,excluded,zhou,false);
  for(let index=0;index<22;index++){
    visibleIds.unshift(send(group,'visible-video-'+index,'video/mp4','东桥集合 '+index+'.mp4').id);
    send(excluded,'hidden-video-'+index,'video/mp4','东桥不可见 '+index+'.mp4');
  }
  store.addMembers(lin,excluded,[zhou]);
  store.run('UPDATE messages SET removed=1 WHERE id=?',source.id);
  const expected=[...visibleIds.slice(0,-1),otherVideo.id,file.id,groupVideo.id];
  const page=await search(zhou,'东桥');
  assert.deepEqual(page.results.map(row=>row.id),expected.slice(0,20));
  const continuation=await search(zhou,'东桥',{before:page.next});
  assert.deepEqual(continuation.results.map(row=>row.id),expected.slice(20));
  assert.equal(continuation.next,null);
  assert.deepEqual((await search(chen,'东桥')).results.map(row=>row.id),[otherVideo.id]);
  store.remove(lin,group,zhou,false);
  assert.deepEqual((await search(zhou,'东桥')).results.map(row=>row.id),[otherVideo.id]);
  store.addMembers(lin,group,[zhou]);
  assert.deepEqual((await search(zhou,'东桥')).results.map(row=>row.id),[otherVideo.id]);
  assert.equal(videoReads,0);
});
