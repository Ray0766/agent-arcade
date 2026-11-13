'use strict';
// Actual temporary SQLite and production social/controller code; no model/QQ.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {incomingBody}=require('./helpers/social-incoming-frame.cjs');
const Manual=require('../src/bot/manual-qq-receipts.cjs');
const {SocialStore}=require('../src/bot/social-store.cjs');
const {SocialCompanion,scopeFor}=require('../src/bot/social-companion.cjs');
const {BotService}=require('../src/bot/service.cjs');
const {prepareQQInbound}=require('../src/bot/qq.cjs');
const NOW=Date.UTC(2026,10,8,2),identity={accountId:'123456',ownerId:'234567',characterId:'deepseek-whale'},SCOPE=Manual.scope(identity);
const deferred=()=>{let resolve;return {promise:new Promise(r=>resolve=r),resolve};};
function fixture(t){
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-manual-receipts-')),clock={now:NOW};
  assert(directory.startsWith(path.resolve(os.tmpdir())+path.sep));
  t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
  const store=new SocialStore({root:directory,now:()=>clock.now});assert(store.available);
  return {store,clock,directory};
}
const value=(extra={})=>({id:randomUUID(),media:'image',outcome:'accepted',messageId:'444',...extra});
const projected=(store,scope=SCOPE,options={})=>Manual.project(store.manualQQActions(scope),{now:NOW,...options});
test('manual metadata never stores content/path/media and uses the existing exact relationship scope',t=>{
  const {store}=fixture(t);assert.equal(SCOPE,scopeFor(identity.accountId,identity.ownerId,identity.characterId));
  const row=value();store.recordManualQQ(SCOPE,row);const raw=store.manualQQActions(SCOPE);
  assert.deepEqual(JSON.parse(raw[0].text),{v:1,origin:'manual_app',media:'image'});assert.equal(raw[0].receipt,'444');assert.deepEqual(store.history(SCOPE),[]);assert.deepEqual(store.facts(SCOPE),[]);
  assert.throws(()=>store.recordManualQQ(SCOPE,{...value(),text:'PRIVATE_BODY',path:'C:\\PRIVATE.png'}),/Invalid/);
  for(const changed of [{accountId:'345678'},{ownerId:'345678'},{characterId:'claude-ju'}])assert.deepEqual(store.manualQQActions(Manual.scope({...identity,...changed})),[]);
});
test('accepted, unknown and confirmed not-submitted project without viewing or delivery claims',t=>{
  const {store}=fixture(t);store.recordManualQQ(SCOPE,value());store.recordManualQQ(SCOPE,value({outcome:'unknown',messageId:null,media:'voice'}));store.recordManualQQ(SCOPE,value({outcome:'not_submitted',messageId:null,media:'text'}));
  const rows=projected(store);assert.deepEqual(new Set(rows.map(row=>row.outcome)),new Set(['accepted','unknown','not_submitted']));
  for(const row of rows){assert.equal(row.origin,'manual_app');assert.equal(row.contentObserved,false);assert.equal(row.recipientObserved,false);assert(!Object.hasOwn(row,'messageId'));}
  assert.throws(()=>store.recordManualQQ(SCOPE,value({outcome:'accepted',messageId:'malformed'})),/Invalid/);assert.throws(()=>store.recordManualQQ(SCOPE,value({outcome:'unknown'})),/Invalid/);
});
test('retention is at most forty records and seven days, with bounded matching-quote priority',t=>{
  const {store,clock}=fixture(t);for(let i=0;i<45;i++){clock.now=NOW+i;store.recordManualQQ(SCOPE,value({messageId:String(100+i)}));}
  const raw=store.manualQQActions(SCOPE);assert.equal(raw.length,40);assert(!raw.some(row=>row.receipt==='100'));
  const rows=Manual.project(raw,{now:clock.now,quoteIds:['105'],budget:800});assert(rows.length<=6);assert(JSON.stringify(rows).length<=800);assert.equal(rows[0].matchesCurrentQuote,true);assert.equal(rows[0].at,NOW+5);
  clock.now+=Manual.RETENTION+1;assert.deepEqual(store.manualQQActions(SCOPE),[]);
});
test('manual retention cannot crowd out ordinary audit records or change proactive quotas',t=>{
  const {store,clock}=fixture(t);store.configure({enabled:true,proactiveMessages:true,qzonePosts:true,activeStart:0,activeEnd:24});
  store.append(SCOPE,{id:'in:old',role:'user',text:'Ordinary context',at:NOW-3600000});
  store.recordAction(SCOPE,{id:'post',kind:'post',state:'published',text:'public',at:NOW,receipt:'post'});
  store.recordAction(SCOPE,{id:'message',kind:'message',state:'sent',text:'private',at:NOW-7200000,receipt:'message'});
  const engine=new SocialCompanion({store,scope:SCOPE,tickMs:0,now:()=>clock.now,execute:async()=>{},send:async()=>{},sendProactive:async()=>{},publishPost:async()=>{},readPost:async()=>{}});t.after(()=>engine.stop());
  const before=engine.eligibility(),audit=store.actions(SCOPE,200);
  for(let i=0;i<55;i++)store.recordManualQQ(SCOPE,value({messageId:String(100+i)}));
  assert.deepEqual(engine.eligibility(),before);assert.deepEqual(store.actions(SCOPE,200),audit);
  for(let i=0;i<205;i++)store.recordAction(SCOPE,{id:'reply-'+i,kind:'reply',state:'sent',text:'reply',at:NOW,receipt:String(i)});
  assert.equal(store.actions(SCOPE,200).length,200);assert(store.actions(SCOPE,200).some(row=>row.id==='post'));assert(store.actions(SCOPE,200).some(row=>row.id==='message'));assert.equal(store.manualQQActions(SCOPE).length,40);
});
test('forget hides old metadata and blocks a captured late recorder without restoring cleared audit text',t=>{
  const {store}=fixture(t),first=value(),late=store.captureManualQQ(SCOPE);store.recordManualQQ(SCOPE,first);store.clear(SCOPE);
  assert.deepEqual(projected(store),[]);assert.deepEqual(late(value()),{recorded:false,forgotten:true});assert.deepEqual(projected(store),[]);
  assert.throws(()=>store.recordManualQQ(SCOPE,first),/Invalid/);assert.deepEqual(projected(store),[]);
});
test('explicit new send after forget may create new metadata; duplicate final receipts do not refresh retention',t=>{
  const {store,clock}=fixture(t),row=value();store.recordManualQQ(SCOPE,row);clock.now++;assert.equal(store.recordManualQQ(SCOPE,row).duplicate,true);assert.equal(store.manualQQActions(SCOPE)[0].at,NOW);
  store.clear(SCOPE);const next=value({messageId:'555'});store.captureManualQQ(SCOPE)(next);assert.equal(projected(store, SCOPE,{now:clock.now}).length,1);
});
test('actual social prompt correlates only current-scope quote metadata and does not claim seeing an image',async t=>{
  const {store}=fixture(t);store.recordManualQQ(SCOPE,value());store.recordManualQQ(Manual.scope({...identity,ownerId:'345678'}),value({messageId:'999'}));
  const prompts=[],engine=new SocialCompanion({store,scope:SCOPE,tickMs:0,flow:{debounceMs:0,bubbleDelayMs:0},now:()=>NOW,execute:async({prompt})=>{prompts.push(prompt);return {outcome:'reply_ended',text:'Synthetic response'};},send:async()=>({id:'reply'}),sendProactive:async()=>{},publishPost:async()=>{},readPost:async()=>{}});t.after(()=>engine.stop());
  await engine.receive(prepareQQInbound({id:'inbound',text:'这张图是你发的吗？',quote:{id:'444',title:'QQ 引用（原文未读取）',text:''}}));await engine.whenIdle();
  assert.equal(prompts.length,1);assert(prompts[0].includes('"matchesCurrentQuote":true'));assert(prompts[0].includes('"contentObserved":false'));assert(prompts[0].includes('无记录只能说无法确认，不能否认曾发送'));assert(prompts[0].includes('不证明对方看见、读过或听过'));assert(!prompts[0].includes('999'));
  const wrong=JSON.parse(engine.context(undefined,3000,['999']));assert(!wrong.manualQQActions.some(row=>row.matchesCurrentQuote));
  const blocked=prepareQQInbound({id:'auth',text:'/allow ABC',quote:{id:'444',title:'QQ 引用（原文未读取）',text:''}});assert.match(blocked.rejection,/不会执行控制/);
});
for(const media of ['image','voice'])test(`service ${media} late acceptance stays in its captured scope and recording failure never erases acceptance`,async t=>{
  const {store}=fixture(t),hold=deferred();let current={...identity};const controller={send:()=>hold.promise};
  const service=Object.create(BotService.prototype);Object.assign(service,{socialStore:store,generation:1,outgoingAccepted:0,changed:()=>{},images:controller,voices:controller,imageBinding:()=>({...current}),voiceBinding:()=>({...current})});
  const input={ticketId:randomUUID()},operation=media==='image'?service.sendImage(input):service.sendVoice(input);
  current={...identity,ownerId:'345678'};service.generation++;service.images=null;service.voices=null;
  const result={ticketId:input.ticketId,outcome:'accepted',messageId:'777',kind:media};hold.resolve(result);assert.deepEqual(await operation,result);
  assert.equal(projected(store)[0].media,media);assert.deepEqual(projected(store,Manual.scope(current)),[]);
  store.recordManualQQ=()=>{throw Error('synthetic disk failure');};const immediate={send:async()=>result};service.images=immediate;service.voices=immediate;
  assert.equal((await (media==='image'?service.sendImage(input):service.sendVoice(input))).outcome,'accepted');assert.match(service.inputProblem,/原发送结果不变/);
});

for(const voice of [false,true])test(`full-size persona and 2800 plain-character ${voice?'voice':'text'} batch reach the runner intact within its unchanged limit`,async t=>{
  const {store}=fixture(t);store.configure({name:'名'.repeat(40),description:'设'.repeat(800),speechExamples:[{user:'问'.repeat(240),assistant:'答'.repeat(240)}]});
  store.setNotes(SCOPE,'"\\'.repeat(500));store.recordManualQQ(SCOPE,value());
  for(let i=0;i<6;i++)store.upsertFact(SCOPE,{text:'"\\'.repeat(200)+i});
  for(let i=0;i<6;i++)store.scheduleFollowup(SCOPE,{text:'"\\'.repeat(200)+i,dueAt:NOW+86400000,timeZone:'Australia/Sydney'});
  let time=0;const prompts=[],replies=[];
  const engine=new SocialCompanion({store,scope:SCOPE,tickMs:0,now:()=>NOW,timerNow:()=>time,flow:{debounceMs:20,maxBatchMs:40,bubbleDelayMs:0},execute:async({prompt})=>{prompts.push(prompt);return {outcome:'reply_ended',text:'Synthetic bounded reply'};},send:async text=>{replies.push(text);return {id:'reply'};},sendProactive:async()=>{},publishPost:async()=>{},readPost:async()=>{}});t.after(()=>engine.stop());
  const first='大'.repeat(2000),second='小'.repeat(798),incoming=first+'\n\n'+second,receive=voice?engine.receiveVoice.bind(engine):engine.receive.bind(engine);
  const a=await receive({id:'limit-a',text:first,contextToken:'a'}),b=await receive({id:'limit-b',text:second,contextToken:'b'});assert.equal(b.merged,true);assert.equal(a.taskId,b.taskId);assert.equal(engine.queue[0].prompt.length,2800);
  time=40;engine.bufferWait?.abort();await engine.whenIdle();
  assert.equal(prompts.length,1,'The unchanged model() limit must allow the real batch path to reach execute');assert.equal(replies.length,1);assert(prompts[0].length<=6000);assert.equal(incomingBody(prompts[0]),incoming,'Do not truncate or rewrite owner input');
  assert(prompts[0].includes('名'.repeat(40)));assert(prompts[0].includes('设'.repeat(800)));assert(prompts[0].includes('问'.repeat(240)));assert(prompts[0].includes('答'.repeat(240)));
  assert(prompts[0].includes('"manualQQActions":[{"origin":"manual_app","media":"image","outcome":"accepted"'),'Bounded retained receipt metadata still fits beside the complete incoming batch');
  assert.equal(prompts[0].includes('This batch includes voice transcription that has not been manually corrected.'),voice);
  t.diagnostic(JSON.stringify({voice,promptCharacters:prompts[0].length,inputCharacters:incoming.length}));
});

test('optional context obeys serialized JSON budgets even when notes need escaping',t=>{
  const {store}=fixture(t);store.setNotes(SCOPE,'"\\'.repeat(500));store.recordManualQQ(SCOPE,value());
  const engine=new SocialCompanion({store,scope:SCOPE,tickMs:0,now:()=>NOW,execute:async()=>{},send:async()=>{}});t.after(()=>engine.stop());
  for(const budget of [100,200,300,500,800,1500]){const context=engine.context(undefined,budget,['444']);assert(context.length<=budget,`serialized ${context.length} exceeds ${budget}`);JSON.parse(context);}
});
