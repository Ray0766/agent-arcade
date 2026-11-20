'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {GroupCompanionRoute,MAX_ACTORS}=require('../src/bot/group-companion-route.cjs');
const {SocialStore}=require('../src/bot/social-store.cjs');

const ACCOUNT='87654321', GROUP_A='55556666', GROUP_B='99998888', OUTSIDER='30000001';
const member=number=>String(20000000+number);
const fact='自留的琥珀路标';
const quiet={outcome:'reply_ended',text:'{"action":"wait","text":""}'};
function fixture(t){
 const root=mkdtempSync(join(tmpdir(),'arcade-member-capacity-')),routes=[],requests=[],sent=[];
 const state={at:1800000000000,live:0,peak:0,respond:()=>quiet};
 const persona=new SocialStore({root}).config();
 let sequence=0,route;
 const reopen=()=>{
  route=new GroupCompanionRoute({root,platform:'qq-onebot',accountId:ACCOUNT,persona,tickMs:0,now:()=>state.at,
   configuration:{enabled:true,groupIds:[GROUP_A,GROUP_B],proactive:false},flow:{debounceMs:0,bubbleDelayMs:0},
   createExecute:dir=>{
    state.peak=Math.max(state.peak,++state.live);
    const run=async({prompt,signal})=>{requests.push({dir,prompt,signal});return state.respond(prompt,signal);};
    run.close=async()=>{state.live--;};
    return run;
   },send:async(binding,text)=>{sent.push({binding,text});return {id:String(10000+sent.length)};}});
  routes.push(route);
  return route;
 };
 reopen();
 t.after(async()=>{for(const item of routes)await item.stop();rmSync(root,{recursive:true,force:true});});
 async function enter(groupId,from,text='今天有人去展馆吗？',drain=true){
  state.at+=61000;
  const result=await route.receive({route:'group',accountId:ACCOUNT,groupId,from,id:String(++sequence),text,contextToken:'synthetic',createdAt:state.at});
  if(drain&&result.accepted)await route.actors.get(route.scope(groupId,from))?.engine.whenIdle();
  return result;
 }
 return {enter,reopen,get route(){return route;},state,requests,sent};
}

test('40 quiet members in one group do not deny a second group or erase an old member after reconnect',async t=>{
 const f=fixture(t);
 for(let i=0;i<40;i++)assert.equal((await f.enter(GROUP_A,member(i))).accepted,true);
 await f.enter(GROUP_A,member(0),'记住：'+fact);
 for(const id of [OUTSIDER,'30000002'])assert.equal((await f.enter(GROUP_B,id)).accepted,true);
 assert.equal(f.route.actors.size,MAX_ACTORS);
 assert.equal(f.state.peak,MAX_ACTORS);
 assert(!f.requests.at(-1).prompt.includes(fact));
 const savedScope=f.route.scope(GROUP_A,member(0));
 await f.route.stop();f.reopen();
 assert.equal((await f.enter(GROUP_B,OUTSIDER)).accepted,true);
 assert.equal((await f.enter(GROUP_A,member(0),'我之前记过什么？')).accepted,true);
 const original=f.route.actors.get(savedScope);
 assert.equal(original.store.facts(savedScope,1)[0].text,fact);
 assert(f.requests.at(-1).prompt.includes(fact));
 assert.deepEqual(f.sent.map(row=>row.binding.senderId),[member(0)],'Model gates chose silence; only the direct memory command replied');
});

test('a full active pool refuses new work without cancelling anyone and reopens room after explicit cancellation',async t=>{
 const f=fixture(t);
 let release;
 const held=new Promise(resolve=>{release=resolve;});
 f.state.respond=()=>held;
 try{
  for(let i=0;i<MAX_ACTORS;i++)assert.equal((await f.enter(GROUP_A,member(i),undefined,false)).accepted,true);
  assert.equal(f.requests.length,MAX_ACTORS);
  const rejected=await f.enter(GROUP_B,OUTSIDER,undefined,false);
  assert.deepEqual({accepted:rejected.accepted,reason:rejected.reason},{accepted:false,reason:'group_member_busy'});
  assert(f.requests.every(row=>!row.signal.aborted));
  assert.equal((await f.enter(GROUP_A,member(0),'停止',false)).accepted,true);
  assert.equal(f.requests[0].signal.aborted,true);
  assert(f.requests.slice(1).every(row=>!row.signal.aborted));
 }finally{release(quiet);await Promise.all([...f.route.actors.values()].map(row=>row.engine.whenIdle()));}
 const result=await Promise.all([f.enter(GROUP_B,OUTSIDER),f.enter(GROUP_B,'30000002')]);
 assert(result.every(row=>row.accepted));
 assert.equal(f.state.peak,MAX_ACTORS);
 assert.equal(f.sent.length,1,'Only the explicit stop acknowledgement was delivered');
});
