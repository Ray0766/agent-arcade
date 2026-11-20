'use strict';

// Real group routing and SQLite, with a manually advanced clock and in-process
// stand-ins for the model and transport. No account, credentials or network.
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {GroupCompanionRoute}=require('../src/bot/group-companion-route.cjs');
const {SocialStore}=require('../src/bot/social-store.cjs');

const MINUTE=60_000;
const START=new Date(2026,10,19,12).getTime();
const ACCOUNT='100001',G='500001',H='500002',A='200001',B='200002',C='200003';
const FOLLOWUP=/FOLLOWUP_[A-Z0-9_]+/u;
const iso=at=>new Date(at).toISOString().replace(/\.\d{3}Z$/u,'Z');
const reply=text=>({outcome:'reply_ended',text});
const decision=(action,text='')=>reply(JSON.stringify({action,text}));
function deferred(){
 let resolve;
 return {promise:new Promise(done=>{resolve=done;}),release:()=>resolve()};
}
async function until(predicate){
 const deadline=Date.now()+2500;
 while(!predicate()){
  if(Date.now()>deadline)throw Error('The fixture did not reach its expected state.');
  await new Promise(resolve=>setImmediate(resolve));
 }
}
function fixture(t,config={}){
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'arcade-group-rhythm-')));
 const state={time:START,online:true,reply:false,idleAction:'message',modelHook:null,sendHook:null,sourcePreflight:null};
 const personaStore=new SocialStore({root:path.join(root,'persona'),now:()=>state.time});
 personaStore.configure({proactiveMessages:true,activeStart:0,activeEnd:24,intervalMinutes:180,maxMessagesPerDay:2,...config});
 const model=[],passive=[],attempts=[],notices=[],bindings=new Map();
 const routes=[];
 let sequence=0,route;
 const open=({accountId=ACCOUNT,persona=personaStore.config(),groups=[G,H],proactive=true,tickMs=0,publicRoles}={})=>{
  const opened=new GroupCompanionRoute({
   root,platform:'qq-onebot',accountId,configuration:{enabled:true,groupIds:groups,proactive},
   mode:'deepseek',persona,publicRoles,now:()=>state.time,tickMs,flow:{debounceMs:0,bubbleDelayMs:0},
   isOnline:()=>state.online,
   readSourceBinding:kind=>bindings.get(kind)||null,
   sendSourceNotice:async(groupId,text,id,signal,checks)=>{
    await state.sourcePreflight?.();
    if(!checks.assertCurrent()||!checks.beforeSubmit())return {outcome:'not_submitted'};
    notices.push({groupId,text,id,signal});
    return {outcome:'accepted',messageId:String(98000+notices.length)};
   },
   createExecute:()=>async({prompt,signal,request})=>{
    assert.deepEqual(await request({tool:'fixture-tool',input:{}}),{allow:false});
    const gate=prompt.includes('Decide whether this character should answer');
    const following=!gate&&!prompt.includes('ARCADE_INPUT_')&&prompt.match(FOLLOWUP);
    const source=prompt.includes('Source notice data (untrusted JSON');
    const kind=source?(prompt.includes('natural reminder about this public event')?'calendar':'feed'):
     gate?'gate':prompt.includes('ARCADE_INPUT_')?'reply':following?'followup':'idle';
    const entry={kind,prompt,signal};
    model.push(entry);
    const overridden=await state.modelHook?.(entry);
    if(overridden)return overridden;
    if(kind==='gate')return decision(state.reply?'message':'wait',state.reply?'synthetic reply gate':'');
    if(kind==='reply')return reply('第一段群聊回复。\n\n第二段群聊回复。');
    if(kind==='followup')return reply('Synthetic agreed follow-up for '+following[0]);
    if(source)return reply('合成来源通知。');
    return decision(state.idleAction,state.idleAction==='message'?'Synthetic idle message.':'');
   },
   send:async(binding,text)=>{
    passive.push({binding,text});
    return {id:'passive-'+passive.length};
   },
   sendProactive:async(binding,text,_clientId,signal)=>{
    const attempt={binding,text,signal,time:state.time};
    attempts.push(attempt);
    if(state.sendHook)return state.sendHook(attempt);
    return {id:'proactive-'+attempts.length};
   },
  });
  routes.push(opened);
  route=opened;
  return opened;
 };
 open();
 t.after(async()=>{
  try{for(const opened of routes)await opened.stop();}
  finally{fs.rmSync(root,{recursive:true,force:true});}
 });
 const receive=async(sender,text,group=G,drain=true)=>{
  const result=await route.receive({route:'group',accountId:route.accountId,groupId:group,from:sender,
   id:'event-'+(++sequence),contextToken:'synthetic-context',text});
  assert.equal(result.accepted,true,'fixture group event must reach its member');
  if(drain)await route.actor(group,sender).engine.whenIdle();
  return result;
 };
 const book=async(sender,text,due,group=G)=>{
  await receive(sender,`回访 ${iso(due)} | ${text}`,group);
  const actor=route.actor(group,sender);
  const item=actor.store.followups(actor.scope).find(item=>item.text===text);
  assert(item,'an agreed follow-up must be persisted for its member');
  assert.equal(item.dueAt,due);
  return {actor,id:item.id,due};
 };
 const queueSource=(kind,groupId)=>{
  const calendar=kind==='calendar',sourceId='club-'+kind,identity='approval-'+kind;
  const id=(++sequence).toString(16).padStart(32,'0'),title='合成公开活动 '+sourceId,at=state.time,start=at+10*MINUTE;
  const occurrence={id,title,start,localTime:new Date(start).toISOString().slice(0,19),timeZone:'UTC',allDay:false};
  const source={id:sourceId,identity,isCurrent:()=>true,occurrence:value=>value===id?occurrence:null};
  bindings.set(kind,{groupId,sourceId,identity,roleId:route.characterFor(groupId)});
  const event=calendar?{kind:'group-calendar.upcoming',calendarItemId:id,calendarDeliveryId:id,groupCalendarIdentity:identity,at}:
   {kind:'group-feed.item',feedItemId:id,groupFeedIdentity:identity,feedTitle:title,at};
  assert.equal(route.sourceNotices.accept(kind,event,source),true);
 };
 return {
  state,model,passive,attempts,notices,open,receive,book,queueSource,
  get route(){return route;},
  consider:(group=G)=>route.considerGroup(group),
  considerSource:()=>route.sourceNotices.tick(),
  autonomous:()=>model.filter(entry=>['idle','followup'].includes(entry.kind)),
 };
}
const appointment=({actor,id})=>actor.store.followups(actor.scope).find(item=>item.id===id);
const advance=(f,minutes)=>{f.state.time+=minutes*MINUTE;};

test('one group-wide decision for concurrent member ticks, with persistent cooldown even when the model waits',async t=>{
 const f=fixture(t);
 for(const member of [A,B,C]){await f.receive(member,'聊到了一本海洋故事。');advance(f,1);}
 advance(f,16);
 f.state.idleAction='wait';
 await Promise.all([A,B,C].map(member=>f.route.actor(G,member).engine.consider()));
 assert.equal(f.autonomous().length,1,'a group with three actors should ask the model once');
 assert.equal(f.attempts.length,0,'the model may choose silence');
 const decisionTime=f.state.time;
 await f.receive(B,'我今天读到新的章节。');

 await f.route.stop();
 f.open();
 advance(f,1);
 await f.receive(B,'接着说说刚才那一章。');
 f.state.time=decisionTime+30*MINUTE;
 f.state.idleAction='message';
 await f.consider();
 assert.equal(f.autonomous().length,1,'a cold restart must keep the shared decision interval');
 f.state.time=decisionTime+180*MINUTE;
 await f.consider();
 assert.equal(f.autonomous().length,2);
 assert.equal(f.attempts.length,1);
 assert.equal(f.attempts[0].binding.senderId,B,'select the most recent eligible member');
 advance(f,181);
 await f.consider();
 assert.equal(f.autonomous().length,2,'there is no repeated outreach without new human input');
});

test('another member’s recent public activity blocks an old idle candidate',async t=>{
 const f=fixture(t);
 await f.receive(A,'读了一本海洋故事。');
 advance(f,20);
 await f.receive(B,'刚才讨论的雨天计划还能怎么改？');
 await f.route.actor(G,A).engine.consider();
 assert.equal(f.autonomous().length,0,'the latest group message governs quiet time');
 assert.equal(f.attempts.length,0);
});

test('a new group turn preempts a held idle generation, even when the model returns late',async t=>{
 const f=fixture(t);
 await f.receive(A,'读了一本海洋故事。');
 advance(f,16);
 const held=deferred();
 f.state.modelHook=async({kind})=>{
  if(kind!=='idle')return;
  await held.promise;
  return decision('message','A late answer that must stay unsent.');
 };
 const thinking=f.consider();
 try{
  await until(()=>f.autonomous().length===1);
  f.state.reply=true;
  await f.receive(B,'现在聊聊雨天计划。');
 }finally{held.release();await thinking;}
 assert.equal(f.autonomous()[0].signal.aborted,true);
 assert.equal(f.attempts.length,0);
 assert(f.passive.some(send=>send.binding.senderId===B),'the ordinary reply may continue');
});

test('earliest agreed follow-up survives restart; unknown delivery spends the group quota without retry',async t=>{
 const f=fixture(t,{maxMessagesPerDay:1});
 const later=await f.book(B,'FOLLOWUP_LATER',START+4*MINUTE);
 const first=await f.book(A,'FOLLOWUP_FIRST',START+3*MINUTE);
 await f.route.stop();
 f.open();
 advance(f,4);
 const held=deferred();
 f.state.sendHook=async()=>{await held.promise;throw Error('Synthetic ambiguous transport failure.');};
 const inFlight=f.consider();
 const concurrent=[inFlight];
 try{
  await until(()=>f.attempts.length===1);
  concurrent.push(f.consider(),f.consider());
  assert.equal(f.attempts.length,1);
 }finally{held.release();await Promise.all(concurrent);}
 assert.equal(f.autonomous().length,1,'one model call for the earliest due item');
 assert.equal(f.attempts.length,1);
 assert.equal(f.attempts[0].binding.senderId,A,'the earliest due appointment must survive reconnect and keep its member');
 assert.match(f.attempts[0].text,/FOLLOWUP_FIRST/u);
 assert.equal(appointment(first).state,'unknown','ambiguous transport must not imply contact');
 assert.equal(appointment(later).state,'pending');

 await f.route.stop();
 f.open();
 f.state.sendHook=null;
 advance(f,1);
 await f.consider();
 assert.deepEqual([f.autonomous().length,f.attempts.length],[1,1],'quota and unknown receipt survive another cold restart');
 assert.equal(appointment(later).state,'pending','an item can wait within its grace period');

 f.state.reply=true;
 await f.receive(C,'我想聊聊公园里的植物。');
 assert(f.passive.some(send=>send.binding.senderId===C),'exhausted proactive quota does not affect ordinary replies');

 advance(f,5);
 await f.consider();
 assert.equal(appointment(later).state,'missed','a quota-blocked item expires visibly');
 assert.equal(appointment(first).state,'unknown');
 assert.equal(f.attempts.length,1);
 advance(f,16);
 await f.consider();
 assert.equal(f.autonomous().length,1,'a follow-up attempt also exhausts discretionary chat quota');
});

test('the route timer restores and delivers a future appointment after reconnect without inbound activity',async t=>{
 const f=fixture(t);
 const due=await f.book(A,'FOLLOWUP_ON_FIRST_TICK',START+2*MINUTE);
 await f.route.stop();
 const reopened=f.open({tickMs:20});
 assert.equal(reopened.actors.size,0,'this connection has never received a group event');
 advance(f,3);
 await until(()=>appointment(due).state==='sent');
 assert.equal(f.autonomous().length,1);
 assert.deepEqual(f.attempts.map(({binding})=>binding.senderId),[A]);
 assert.equal(f.passive.length,1,'only the original booking command replied');
});

test('a due group appointment keeps its only send slot when source ticks run first, including after reopen',async t=>{
 for(const [kind,otherKind,reopen] of [['calendar','feed',false],['feed','calendar',true]]){
  const f=fixture(t,{maxMessagesPerDay:1,intervalMinutes:30});
  const booked=await f.book(A,'FOLLOWUP_BEFORE_SOURCE',START+45*MINUTE);
  if(reopen){
   await f.route.stop();
   f.open();
   assert.equal(f.route.actors.size,0,'the scheduled member is dormant after reconnect');
  }
  advance(f,45);
  f.queueSource(kind,G);
  await f.considerSource();
  assert.deepEqual(f.model.map(entry=>entry.kind),[], 'same-group source must wait before model work');
  assert.deepEqual(f.notices,[]);
  assert.equal(appointment(booked).state,'pending');

  f.queueSource(otherKind,H);
  await f.considerSource();
  assert.deepEqual(f.model.map(entry=>entry.kind),[otherKind]);
  assert.deepEqual(f.notices.map(item=>item.groupId),[H]);
  const turn=await f.consider();
  assert.deepEqual([turn.action,turn.accepted,turn.id],['followup',true,booked.id]);
  assert.equal(appointment(booked).state,'sent');
  assert.deepEqual(f.attempts.map(({binding})=>[binding.groupId,binding.senderId]),[[G,A]]);

  await f.considerSource();
  assert.deepEqual(f.notices.map(item=>item.groupId),[H]);
  assert.deepEqual(f.model.map(entry=>entry.kind),[otherKind,'followup']);
  assert.equal(f.route.rhythm(G).state.attempts.length,1);
  assert.equal(f.route.rhythm(H).state.attempts.length,1);
 }
});

test('a source ready before the deadline rechecks appointment priority before transport submission',async t=>{
 const f=fixture(t,{maxMessagesPerDay:1,intervalMinutes:30});
 const booked=await f.book(A,'FOLLOWUP_DURING_SOURCE_PREFLIGHT',START+45*MINUTE);
 advance(f,44);
 f.queueSource('calendar',G);
 const release=deferred();
 let entered=false;
 f.state.sourcePreflight=()=>{entered=true;return release.promise;};
 const pending=f.considerSource();
 try{
  await until(()=>entered);
  assert.deepEqual(f.model.map(entry=>entry.kind),['calendar']);
  advance(f,1);
  assert.equal(appointment(booked).state,'pending');
 }finally{release.release();await pending;}
 assert.deepEqual(f.notices,[]);
 assert.deepEqual(f.route.rhythm(G).state.attempts,[]);
 const turn=await f.consider();
 assert.deepEqual([turn.action,turn.accepted,turn.id],['followup',true,booked.id]);
 assert.equal(appointment(booked).state,'sent');
 assert.deepEqual(f.attempts.map(({binding})=>[binding.groupId,binding.senderId]),[[G,A]]);
});

test('follow-ups wait while a recent ordinary reply is running and may proceed when the group settles',async t=>{
 const f=fixture(t);
 const due=await f.book(A,'FOLLOWUP_AFTER_REPLY',START+MINUTE);
 advance(f,1);
 const held=deferred();
 f.state.reply=true;
 f.state.modelHook=async({kind})=>{
  if(kind!=='reply')return;
  await held.promise;
  return reply('Ongoing ordinary group reply.');
 };
 try{
  await f.receive(B,'我们正在讨论图书馆。',G,false);
  await until(()=>f.model.some(entry=>entry.kind==='reply'));
  await f.consider();
  assert.equal(f.autonomous().length,0);
  assert.equal(appointment(due).state,'pending');
 }finally{held.release();await f.route.actor(G,B).engine.whenIdle();}
 await f.consider();
 assert.equal(f.attempts.length,1,'a due promise does not require the idle-chat silence interval');
 assert.equal(appointment(due).state,'sent');
});

test('edited or cancelled appointment revisions cannot send a stale generated message',async t=>{
 const f=fixture(t);
 const item=await f.book(A,'FOLLOWUP_BEFORE_EDIT',START+MINUTE);
 advance(f,1);
 const first=deferred();
 f.state.modelHook=async({kind})=>{
  if(kind!=='followup')return;
  await first.promise;
  return reply('This old appointment text must not send.');
 };
 let thinking=f.consider();
 try{
  await until(()=>f.autonomous().length===1);
  item.actor.store.updateFollowup(item.actor.scope,item.id,{text:'FOLLOWUP_AFTER_EDIT',dueAt:f.state.time+MINUTE});
 }finally{first.release();await thinking;}
 assert.equal(appointment(item).state,'pending');
 assert.equal(f.attempts.length,0);

 const newDue=f.state.time+2*MINUTE;
 await f.receive(A,`改期回访 ${item.id.slice(0,8)} ${iso(newDue)}`);
 assert.equal(appointment(item).dueAt,newDue,'the group reschedule command changes the persisted due time');
 assert.equal(appointment(item).expiresAt,newDue+5*MINUTE+1);
 advance(f,2);
 const second=deferred();
 f.state.modelHook=async({kind})=>{
  if(kind!=='followup')return;
  await second.promise;
  return reply('This cancelled appointment text must not send.');
 };
 thinking=f.consider();
 try{
  await until(()=>f.autonomous().length===2);
  await f.receive(A,'取消回访 '+item.id.slice(0,8),G,false);
 }finally{second.release();await thinking;}
 assert.equal(appointment(item).state,'cancelled');
 assert.equal(f.attempts.length,0);
});

test('closed active hours, individual pause, offline and owner pause all prevent proactive group sends',async t=>{
 const f=fixture(t,{activeStart:13,activeEnd:16});
 const outside=await f.book(A,'FOLLOWUP_OUTSIDE_HOURS',START+MINUTE);
 advance(f,1);
 await f.consider();
 assert.equal(appointment(outside).state,'pending');
 assert.equal(f.autonomous().length,0,'closed hours must gate before model work');
 advance(f,5);
 await f.consider();
 assert.equal(appointment(outside).state,'pending','the five-minute grace includes its boundary');
 advance(f,1);
 await f.consider();
 assert.equal(appointment(outside).state,'missed');

 f.state.time=new Date(2026,10,19,13,1).getTime();
 const paused=await f.book(A,'FOLLOWUP_PAUSED_MEMBER',f.state.time+MINUTE);
 await f.receive(A,'暂停主动');
 const enabled=await f.book(B,'FOLLOWUP_ENABLED_MEMBER',f.state.time+MINUTE);
 advance(f,1);
 f.state.online=false;
 await f.consider();
 assert.equal(f.autonomous().length,0,'offline must gate before model work');
 assert.equal(appointment(enabled).state,'pending');
 f.state.online=true;
 await f.consider();
 assert.equal(f.attempts.length,1);
 assert.equal(f.attempts[0].binding.senderId,B);
 assert.equal(appointment(paused).state,'pending','one member pause does not pause another member');

 const ownerPaused=await f.book(C,'FOLLOWUP_OWNER_PAUSED',f.state.time+MINUTE);
 f.route.pauseProactive();
 advance(f,7);
 await f.consider();
 assert.equal(f.attempts.length,1);
 assert.equal(f.autonomous().length,1,'owner pause also gates before model work');
 assert.equal(appointment(ownerPaused).state,'missed','missed intervals do not replay after a later resume');
});

test('group, account and character have separate proactive budgets',async t=>{
 const f=fixture(t,{maxMessagesPerDay:1});
 const first=await f.book(A,'FOLLOWUP_FIRST_GROUP',START+MINUTE);
 const otherGroup=await f.book(A,'FOLLOWUP_SECOND_GROUP',START+MINUTE,H);
 const firstConfig=first.actor.store.config();
 advance(f,1);
 await f.consider(G);
 await f.consider(H);
 assert.equal(appointment(first).state,'sent');
 assert.equal(appointment(otherGroup).state,'sent');
 assert.deepEqual(f.attempts.map(send=>send.binding.groupId),[G,H]);

 await f.route.stop();
 f.open({persona:{...firstConfig,characterId:'codex-dragon'}});
 const otherCharacter=await f.book(A,'FOLLOWUP_OTHER_CHARACTER',f.state.time+MINUTE);
 advance(f,1);
 await f.consider();
 assert.equal(appointment(otherCharacter).state,'sent');

 await f.route.stop();
 f.open({accountId:'100002',persona:firstConfig});
 const otherAccount=await f.book(A,'FOLLOWUP_OTHER_ACCOUNT',f.state.time+MINUTE);
 advance(f,1);
 await f.consider();
 assert.equal(appointment(otherAccount).state,'sent');
 assert.deepEqual(f.attempts.map(({binding})=>[binding.accountId,binding.characterId]),[
  [ACCOUNT,firstConfig.characterId],[ACCOUNT,firstConfig.characterId],[ACCOUNT,'codex-dragon'],['100002',firstConfig.characterId],
 ]);
});

test('an evicted future appointment retains ownership and consumes an unknown attempt only once',async t=>{
 const f=fixture(t,{maxMessagesPerDay:1});
 const due=await f.book(A,'FOLLOWUP_DORMANT',START+90*MINUTE);
 for(let i=0;i<41;i++){
  advance(f,1);
  await f.receive(String(300000+i),'日常合成群聊。',H);
 }
 assert(!f.route.actors.has(due.actor.scope),'a pending appointment does not keep an idle runner open');
 assert.equal(appointment(due).state,'pending');
 await f.consider();
 assert.equal(appointment(due).state,'pending');
 assert.equal(f.attempts.length,0);
 advance(f,49);
 f.state.sendHook=async()=>{throw Error('Synthetic unknown delivery');};
 await Promise.all([f.consider(),f.consider()]);
 assert.equal(appointment(due).state,'unknown');
 assert.deepEqual(f.attempts.map(row=>row.binding.senderId),[A]);
 assert.equal(f.route.actors.size,40);
 await f.route.stop();f.open();
 await f.consider();
 assert.equal(appointment(due).state,'unknown');
 assert.equal(f.attempts.length,1);
});

test('terminal enrollments are reclaimed without disabling the remaining agreed follow-up',async t=>{
 const f=fixture(t);
 for(let i=0;i<39;i++){
  const member=String(23000000+i),appointmentRef=await f.book(member,'FOLLOWUP_CANCELLED',START+4*MINUTE);
  await f.receive(member,'取消回访 '+appointmentRef.id.slice(0,8));
  assert.equal(appointment(appointmentRef).state,'cancelled');
 }
 const prior=await f.book('23000039','FOLLOWUP_KEEP',START+3*MINUTE);
 const next=await f.book('23000040','FOLLOWUP_NEXT',START+4*MINUTE);
 assert.equal(f.route.rhythm(G).failed,undefined);
 advance(f,3);
 await f.consider();
 assert.equal(appointment(prior).state,'sent');
 assert.equal(appointment(next).state,'pending');
 assert.equal(f.attempts[0].binding.senderId,'23000039');
});

test('full live enrollment remains bounded across role changes without disabling existing work',async t=>{
 const f=fixture(t);
 const first=await f.book('23000000','FOLLOWUP_BASE_ROLE',START+3*MINUTE);
 for(let i=1;i<40;i++)await f.book(String(23000000+i),'FOLLOWUP_STAY',START+30*MINUTE);
 await f.route.stop();
 const role={cardId:'0123456789abcdef',name:'合成另一角色',description:'',examples:''};
 f.open({publicRoles:new Map([[G,role]])});
 const result=await f.receive('23000040',`回访 ${iso(START+30*MINUTE)} | FOLLOWUP_REJECTED`);
 assert.equal(result.accepted,true);
 assert.match(f.passive.at(-1).text,/回访登记已满/);
 assert.equal(f.route.rhythm(G).failed,undefined);
 assert.equal(f.route.rhythm(G).state.registrations.length,40);
 assert.equal(f.route.actor(G,'23000040').store.followups(f.route.scope(G,'23000040')).length,0);
 await f.route.stop();f.open();
 advance(f,3);
 await f.consider();
 assert.equal(appointment(first).state,'sent');
 assert.deepEqual(f.attempts.map(row=>row.binding.senderId),['23000000']);
});
