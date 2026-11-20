'use strict';
// Entirely local fixtures: no model, accounts, OS vault or network.
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {GroupCompanionRoute,settings}=require('../src/bot/group-companion-route.cjs');
const {SocialCompanion}=require('../src/bot/social-companion.cjs');
const {SocialStore}=require('../src/bot/social-store.cjs');
const ACCOUNT='app-opaque_001',GROUP='group-opaque_A',MEMBER='member-opaque_A';
function fixture(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-group-test-')),privateStore=new SocialStore({root});
 privateStore.configure({enabled:true,proactiveMessages:true,activeStart:0,activeEnd:24});
 const calls=[],sent=[],closed=[],state={answer:true,now:1800000000000,online:true};
 const route=new GroupCompanionRoute({root,platform:'fixture-official',accountId:ACCOUNT,configuration:{enabled:true,groupIds:[GROUP,'group-opaque_B'],proactive:false},persona:privateStore.config(),now:()=>state.now,tickMs:0,flow:{debounceMs:0,bubbleDelayMs:0},isOnline:()=>state.online,
  createExecute:memberRoot=>{const execute=async args=>{calls.push({...args,memberRoot});assert.deepEqual(await args.request({tool:'Bash',input:{command:'forbidden'}}),{allow:false});if(options.execute)return options.execute(args,calls.length);return {outcome:'reply_ended',text:args.prompt.includes('Decide whether')?JSON.stringify({action:state.answer?'message':'wait',text:state.answer?'appropriate':''}):'第一段。\n\n第二段。'};};execute.close=()=>closed.push(memberRoot);return execute;},
  send:async(binding,text,contextToken,clientId,signal)=>{sent.push({binding,text,contextToken,clientId,signal});return {id:String(sent.length)};},sendProactive:async()=>{throw Error('not enabled');},...options.route});
 t.after(async()=>{await route.stop();fs.rmSync(root,{recursive:true,force:true});});
 const message=(text='你好',extra={})=>({id:`m-${calls.length}-${sent.length}`,route:'group',accountId:ACCOUNT,groupId:GROUP,from:MEMBER,text,contextToken:'local-context',commandAddress:{targets:[],blocked:false},...extra});
 const idle=()=>Promise.all([...route.actors.values()].map(a=>a.engine.whenIdle()));
 return {root,route,calls,sent,closed,state,privateStore,message,idle};
}
test('group route validates explicit bounded opt-in and opaque transport identities',()=>{
 assert.deepEqual(settings(),{enabled:false,groupIds:[],proactive:false});
 assert.deepEqual(settings({enabled:true,groupIds:['opaque-group'],proactive:false}).groupIds,['opaque-group']);
 for(const config of [{enabled:true,groupIds:[]},{enabled:true,groupIds:['same','same']},{enabled:true,groupIds:['has space']},{enabled:true,groupIds:['one'],owner:'bad'},{enabled:true,groupIds:Array.from({length:6},(_,i)=>String(i))}])assert.throws(()=>settings(config));
});
test('natural group reply may answer without @, keeps bubbles and tools disabled',async t=>{
 const f=fixture(t);await f.route.receive(f.message('你觉得今天适合读什么书？'));await f.idle();
 assert.equal(f.calls.length,2);assert.equal(f.sent.length,2);assert.equal(f.sent[0].binding.senderId,MEMBER);assert.equal(f.sent[0].binding.groupId,GROUP);assert.equal(f.sent[0].binding.accountId,ACCOUNT);assert.equal(f.sent[0].binding.characterId,'claude-ju');assert.equal(f.sent[0].contextToken,'local-context');
 assert.equal(f.route.snapshot().sent,2);assert.equal(f.route.journal.snapshot().recent[0].state,'reply_ended');assert.equal([...f.route.actors.values()][0].engine.current,null);
});

test('ordinary QQ memory commands need verified addressing',async t=>{
 const f=fixture(t,{route:{platform:'qq-onebot'}});
 for(const [id,address] of [['missing-address',undefined],['other-role',{targets:['87654321'],blocked:false}]]){
  assert.deepEqual(await f.route.receive(f.message('记住：合成灯笼',{id,commandAddress:address})),
   {accepted:false,reason:'group_command_address'});
 }
 assert.equal(f.route.actors.size,0);
 assert.equal(f.calls.length,0);
 assert.equal(f.sent.length,0);
});

test('a 2800-character ordinary QQ turn preserves its full frame and stores a compatible public excerpt',async t=>{
 const f=fixture(t,{route:{platform:'qq-onebot',configuration:{enabled:true,groupIds:[GROUP],proactive:true}}});
 const head='群长文合成开头',middle='合成中段只给当前轮',tail='合成末尾问题是否完整？';
 const first=head+'甲'.repeat(1300)+middle;
 const body=first+'乙'.repeat(2800-first.length-tail.length)+tail;
 assert.equal(body.length,2800);
 const input=f.message(body,{id:'ordinary-long-frame'});
 assert.equal((await f.route.receive(input)).accepted,true);
 await f.idle();
 assert.equal(f.calls.length,2);
 assert.deepEqual(f.calls.map(({prompt})=>gate(prompt)),[true,false]);
 for(const {prompt} of f.calls){
  assert.equal(incomingText(prompt),body);
  assert(prompt.length<=6000);
 }

 const actor=f.route.actor(GROUP,MEMBER);
 assert.equal(actor.store.history(actor.scope,20).find(row=>row.id==='in:'+input.id)?.text,body);
 const projection=f.route.publicContext(GROUP,actor.binding.characterId);
 const snapshot=JSON.parse(fs.readFileSync(projection.file,'utf8'));
 assert.deepEqual(Object.keys(snapshot).sort(),['rows','schema','scope']);
 assert.equal(snapshot.schema,1);
 const [row]=snapshot.rows.filter(item=>item.kind==='member');
 assert.deepEqual(Object.keys(row).sort(),['at','id','kind','replyTo','speaker','text']);
 assert(row.text.length<=2000);
 assert(row.text.startsWith(head)&&row.text.endsWith(tail));
 assert.match(row.text,/群长文节选，已略去中间内容/u);
 assert(!row.text.includes(middle));
 assert.deepEqual(projection.view().filter(item=>item.kind==='member'),[row]);

 await f.route.receive(f.message('记住：合成长明灯',{id:'after-long-memory'}));
 await f.route.receive(f.message('暂停主动',{id:'after-long-pause'}));
 await f.idle();
 assert.deepEqual(actor.store.facts(actor.scope).map(item=>item.text),['合成长明灯']);
 assert.equal(actor.store.config().proactiveMessages,false);
 assert.equal(f.calls.length,2,'ordinary control turns remain deterministic');
});

test('post-redaction overflow is declined without storage, with a bounded hint only when directly addressed',async t=>{
 const f=fixture(t,{route:{platform:'qq-onebot'}});
 const tail='末尾合成内容不可截断';
 const suffix=` token=x ${tail}`;
 const body='文'.repeat(2800-suffix.length)+suffix;
 assert.equal(body.length,2800);
 const ambient=f.message(body,{id:'expanded-ambient',addressing:{mentions:['other'],reference:'none'}});
 const direct=f.message(body,{id:'expanded-direct',contextToken:'addressed-frame',addressing:{mentions:['self'],reference:'none'}});
 const malformed=f.message('',{id:'expanded-nontext',text:{length:2801},addressing:direct.addressing});
 assert.deepEqual(await f.route.receive(ambient),{accepted:false,reason:'group_text_too_long'});
 assert.deepEqual(f.sent,[]);
 assert.deepEqual(await f.route.receive(malformed),{accepted:false,reason:'group_unsupported'});
 assert.deepEqual(f.sent,[]);
 assert.deepEqual(await f.route.receive(direct),{accepted:false,reason:'group_text_too_long'});
 assert.equal((await f.route.receive(direct)).duplicate,true);
 assert.deepEqual(await f.route.receive({...direct,id:'expanded-direct-repeat'}),{accepted:false,reason:'group_text_too_long'});
 await f.idle();
 assert.equal(f.sent.length,1,'direct hints are rate limited and do not replay');
 const [{binding,contextToken,text}]=f.sent;
 assert.deepEqual([binding.groupId,binding.senderId,contextToken],[GROUP,MEMBER,'addressed-frame']);
 assert.match(text,/2800.*没有交给模型/u);
 assert(text.length<=200);
 assert(!text.includes(tail)&&!text.includes('token=x')&&!text.includes('[redacted]'));
 assert.deepEqual(f.calls,[]);
 const actor=f.route.actor(GROUP,MEMBER);
 assert.deepEqual(actor.store.history(actor.scope,20).filter(item=>item.role==='user'),[]);
 assert.deepEqual(f.route.publicContext(GROUP,actor.binding.characterId).view(),[]);
 assert.equal(f.route.journal.snapshot().recent.filter(item=>item.state==='rejected').length,4);
});

test('ordinary typed capacity does not enlarge private, media-caption or official QQ input',async t=>{
 const f=fixture(t,{route:{platform:'qq-onebot',configuration:{enabled:true,groupIds:[GROUP],proactive:false,imageGroupIds:[GROUP],voiceGroupIds:[GROUP]},
  makeImageSource:()=>assert.fail('long image caption must not open the image source'),
  makeVoicePipeline:()=>assert.fail('long voice caption must not start ASR'),
 }});
 const oldLimitPlusOne='文'.repeat(2001);
 for(const [kind,descriptor] of [['image',{id:'synthetic-image'}],['voice',{sourceDigest:'synthetic-voice'}]]){
  const result=await f.route.receive(f.message(oldLimitPlusOne,{id:`media-${kind}`,[kind]:descriptor}));
  assert.deepEqual(result,{accepted:false,reason:'group_unsupported'});
 }
 const privateScope='b'.repeat(64);
 const privateTurn=new SocialCompanion({store:f.privateStore,scope:privateScope,tickMs:0,
  execute:()=>assert.fail('long private text must not reach model'),send:()=>assert.fail('private overflow emits no reply')});
 t.after(()=>privateTurn.stop());
 assert.deepEqual(await privateTurn.receive({id:'private-long',text:oldLimitPlusOne,contextToken:'private'}),{accepted:false,reason:'invalid_text'});
 assert.deepEqual(f.privateStore.history(privateScope,20),[]);
 const official=fixture(t,{route:{platform:'qq-official'}});
 assert.deepEqual(await official.route.receive(official.message(oldLimitPlusOne,{id:'official-long'})),{accepted:false,reason:'group_unsupported'});
 assert.deepEqual([f.calls.length,f.sent.length,official.calls.length,official.sent.length],[0,0,0,0]);
});

test('ordinary QQ emits one role-only activity after the last accepted conversational bubble',async t=>{
 let sent=0,release;const held=new Promise(resolve=>{release=resolve;});
 t.after(()=>release({id:'2'}));
 const reports=[],cardId='0123456789abcdef';
 const f=fixture(t,{route:{platform:'qq-onebot',
  publicRoles:new Map([[GROUP,{cardId,name:'测试搭档',description:'公开角色设定',examples:''}]]),
  send:async()=>++sent===1?{id:'1'}:held,
  onReply:(...args)=>{
   const task=[...f.route.actors.values()][0].engine.snapshot().tasks[0];
   reports.push({args,state:task.state,accepted:task.bubbleDelivery.accepted});
   return Promise.reject(Error('fixture view failure'));
  }}});
 await f.route.receive(f.message('有两个不同的点吗？'));
 await until(()=>sent===2);
 assert.deepEqual(reports,[]);
 release({id:'2'});
 await f.idle();
 assert.deepEqual(reports,[{args:[`card-${cardId}`],state:'reply_ended',accepted:2}]);
 assert.equal(f.route.journal.snapshot().recent[0].state,'reply_ended');
});

test('ordinary QQ uses owner sampling only for the formal conversational reply',async t=>{
 const calls=[];
 const f=fixture(t,{route:{platform:'qq-onebot',mode:'deepseek',loadReplySampling:binding=>{
  calls.push(binding);return {temperature:0,topP:0.6,maxTokens:1200};
 }}});
 await f.route.receive(f.message('请聊聊这张地图。'));
 await f.idle();
 assert.deepEqual(f.calls.map(row=>row.sampling),[{maxTokens:256},{temperature:0,topP:0.6,maxTokens:1200}]);
 assert.deepEqual(calls,[{platform:'qq-onebot',accountId:ACCOUNT,groupId:GROUP,senderId:MEMBER,characterId:'claude-ju'}]);
 f.state.answer=false;
 await f.route.receive(f.message('其他成员在聊共同的话题。'));
 await f.idle();
 assert.deepEqual(f.calls.at(-1).sampling,{maxTokens:256});
 assert.equal(calls.length,1);
 await f.route.receive(f.message('查看记忆'));
 await f.idle();
 assert.equal(calls.length,1);
 assert.equal(f.calls.length,3);
});

test('official QQ, local Claude and optional Claude SDK preserve unsampled requests',async t=>{
 const variants=[
  {platform:'fixture-official',mode:'gpt'},
  {platform:'qq-onebot',mode:'claude'},
  {platform:'qq-onebot',mode:'api',samplingMode:'api-sdk'},
 ];
 for(const route of variants)await t.test(route.samplingMode||route.mode,async t=>{
  const f=fixture(t,{route:{...route,loadReplySampling:()=>assert.fail('no settings read for this route')}});
  await f.route.receive(f.message('你好，能聊一聊吗？'));
  await f.idle();
  assert.equal(f.calls.length,2);
  assert(f.calls.every(row=>!Object.hasOwn(row,'sampling')));
 });
});

test('group reply activity ignores quiet, control, unknown, stale and other-platform paths',async t=>{
 const events=[];
 for(const scenario of ['quiet','control','unknown','malformed','stale','other-platform']){
  await t.test(scenario,async t=>{
   let sent=0;
   const f=fixture(t,{route:{platform:scenario==='other-platform'?'fixture-official':'qq-onebot',onReply:(...args)=>events.push(args),
    send:async()=>{
     sent++;
     if(scenario==='stale'&&sent===2)f.state.online=false;
     if(scenario==='unknown'&&sent===2)throw Error('unconfirmed');
     if(scenario==='malformed'&&sent===2)return {id:{bad:'not a receipt'}};
     return {id:String(sent)};
    }}});
   if(scenario==='quiet')f.state.answer=false;
   await f.route.receive(f.message(scenario==='control'?'查看记忆':'请聊两点。'));
   await f.idle();
   assert.deepEqual(events,[]);
   assert.equal(sent,scenario==='quiet'?0:scenario==='control'?1:2);
  });
 }
});
test('group wait is terminal silence, not error or a replayable pending turn',async t=>{
 const f=fixture(t);f.state.answer=false;await f.route.receive(f.message('同学甲和同学乙继续聊天'));await f.idle();
 assert.equal(f.calls.length,1);assert.equal(f.sent.length,0);assert.equal(f.route.snapshot().skipped,1);assert.equal(f.route.journal.snapshot().recent[0].state,'skipped');assert.equal([...f.route.actors.values()][0].engine.current,null);
 await f.route.stop();assert.equal(f.closed.length,1);
});
test('ordinary QQ separates valid silence, invalid decisions, and an unfinished formal reply',async t=>{
 const wait='{"action":"wait","text":""}',accept='{"action":"message","text":"answer"}';
 let gateAnswer=wait,reply={outcome:'reply_ended',text:'继续聊吧。'};
 const f=fixture(t,{route:{platform:'qq-onebot'},execute:async args=>gate(args.prompt)?
  {outcome:'reply_ended',text:gateAnswer}:reply});
 const turn=async text=>{await f.route.receive(f.message(text));await f.idle();return f.route.snapshot();};
 assert.deepEqual((await turn('旁人聊天')).providerIssues,[]);
 assert.equal(f.route.journal.snapshot().recent[0].state,'skipped');
 for(const invalid of ['', 'PRIVATE_MALFORMED_BODY', '{"action":"post","text":"不可发布"}','{"action":"wait","text":"多余文本"}']){
  gateAnswer=invalid;
  const result=await turn('请试着判断。');
  assert.deepEqual(result.providerIssues,[{groupId:GROUP,phase:'gate',code:'invalid_response'}]);
  assert.match(result.problem,/接话判断未完成/);
  assert.doesNotMatch(result.problem,/PRIVATE_MALFORMED_BODY/);
  assert.equal(f.route.journal.snapshot().recent[0].state,'error');
  assert.equal(f.sent.length,0);
 }
 gateAnswer=accept;reply={outcome:'error',httpStatus:429,text:'PRIVATE_PROVIDER_BODY'};
 let result=await turn('请回答这个问题。');
 assert.deepEqual(result.providerIssues,[{groupId:GROUP,phase:'reply',code:'rate_limited'}]);
 assert.match(result.problem,/正式回复未完成.*429.*额度.*限流/);
 assert.doesNotMatch(result.problem,/PRIVATE_PROVIDER_BODY/);
 assert.equal(f.route.journal.snapshot().recent[0].state,'error');
 assert.equal(f.sent.length,0);
 gateAnswer=wait;
 assert.deepEqual((await turn('晚些再聊')).providerIssues,[{groupId:GROUP,phase:'reply',code:'rate_limited'}]);
 gateAnswer=accept;reply={outcome:'reply_ended',text:'现在可以继续了。'};
 assert.deepEqual((await turn('现在再问一次。')).providerIssues,[]);
 assert.deepEqual(f.sent.map(row=>row.text),['现在可以继续了。']);
});
test('ordinary QQ model problems are scoped and older successes or cancelled turns cannot clear them',async t=>{
 let oldRelease,oldStarted,holdRelease,holdStarted;
 const oldEntered=new Promise(resolve=>{oldStarted=resolve;});
 const holdEntered=new Promise(resolve=>{holdStarted=resolve;});
 const old=new Promise(resolve=>{oldRelease=resolve;});
 const hold=new Promise(resolve=>{holdRelease=resolve;});
 const wait={outcome:'reply_ended',text:'{"action":"wait","text":""}'};
 const tooMany={outcome:'error',httpStatus:429,text:'PRIVATE_RATE_LIMIT_PAYLOAD'};
 const f=fixture(t,{route:{platform:'qq-onebot'},execute:async ({prompt})=>{
  const input=incomingText(prompt);
  if(input==='先开始的请求'){oldStarted();return old;}
  if(input==='新失败')return tooMany;
  if(input==='取消中的请求'){holdStarted();return hold;}
  return wait;
 }});
 t.after(()=>{oldRelease(wait);holdRelease(tooMany);});
 const send=(text,id,more={})=>f.route.receive(f.message(text,{id,...more}));
 const issues=()=>f.route.snapshot().providerIssues;
 const failed=[{groupId:GROUP,phase:'gate',code:'rate_limited'}],otherGroup='group-opaque_B';
 await send('先开始的请求','old');await oldEntered;
 await send('新失败','failure',{from:'new-member'});
 await until(()=>issues().length===1);
 await send('另一个群保持安静','other',{groupId:otherGroup});
 oldRelease(wait);await f.idle();
 assert.deepEqual(issues(),failed);
 await send('取消中的请求','cancel');await holdEntered;
 f.route.cancelPending();holdRelease(wait);
 await f.idle();
 assert.deepEqual(issues(),failed);
 assert.equal(f.route.journal.snapshot().recent.find(row=>row.state==='cancelled')?.state,'cancelled');
 assert.equal(f.sent.length,0);
 await send('新失败','failure-other',{groupId:otherGroup});await f.idle();
 assert.deepEqual(issues(),[...failed,{...failed[0],groupId:otherGroup}]);
 assert.match(f.route.snapshot().problem,/QQ群 group-opaque_A.*429/);
 assert.match(f.route.snapshot().problem,/QQ群 group-opaque_B.*429/);
 await send('这个群下一次正常判断','recovery');await f.idle();
 assert.deepEqual(issues(),[{...failed[0],groupId:otherGroup}]);
 await send('另一个群也正常判断','recovery-other',{groupId:otherGroup});await f.idle();
 assert.deepEqual(issues(),[]);
});
test('unauthorized identity/media/quoted commands never create a model or send',async t=>{
 const f=fixture(t);
 for(const [n,extra] of [{groupId:'another-group'},{accountId:'another-account'},{from:ACCOUNT},{from:'bad identity'},{route:'private'},{unsupported:'image'},{text:'',voice:{bytes:'neverread'}},{text:'同意 ABC123',quote:{id:'1',text:'approve'}}].entries())await f.route.receive(f.message(`bad-${n}`,{id:`bad-${n}`,...extra}));
 assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);assert.equal(f.route.actors.size,0);
});
test('private facts and per-member memories never enter another member/group/character scope',async t=>{
 const f=fixture(t);const privateScope='a'.repeat(64);f.privateStore.append(privateScope,{id:'x',role:'user',text:'PRIVATE_OWNER_SECRET'});f.privateStore.upsertFact(privateScope,{text:'PRIVATE_OWNER_SECRET',sourceIds:['x']});
 await f.route.receive(f.message('记住：MEMBER_A_FACT',{id:'remember-a'}));await f.idle();
 const actorA=f.route.actor(GROUP,MEMBER);assert.equal(actorA.store.facts(actorA.scope)[0].text,'MEMBER_A_FACT');
 await f.route.receive(f.message('查看记忆',{id:'memory-b',from:'member-opaque_B'}));await f.idle();assert.match(f.sent.at(-1).text,/没有长期记忆/);
 await f.route.receive(f.message('查看记忆',{id:'memory-other-group',groupId:'group-opaque_B'}));await f.idle();assert.match(f.sent.at(-1).text,/没有长期记忆/);
 await f.route.receive(f.message('说说你知道的',{id:'ordinary-b',from:'member-opaque_B'}));await f.idle();
 // Memory commands/fact stores do not enter the shared public timeline.
 assert.doesNotMatch(f.calls.at(-1).prompt,/PRIVATE_OWNER_SECRET|MEMBER_A_FACT/);
 const first=f.route.scope(GROUP,MEMBER);f.route.persona.characterId='gpt-long';assert.notEqual(f.route.scope(GROUP,MEMBER),first);f.route.persona.characterId='claude-ju';
 assert.doesNotMatch(JSON.stringify(f.route.snapshot()),/PRIVATE_OWNER_SECRET|MEMBER_A_FACT|contextToken|local-context/);
});

function ordinaryMemoryFixture(t){
 const accountId='780001',groupId='780002',otherGroup='780003',member='780004',otherMember='780005';
 const f=fixture(t,{route:{platform:'qq-onebot',accountId,configuration:{enabled:true,groupIds:[groupId,otherGroup],proactive:false}}});
 let sequence=0;
 const post=async(text,extra={})=>{
  f.state.now+=61000;
  const result=await f.route.receive(f.message(text,{id:`memory-turn-${++sequence}`,accountId,groupId,from:member,...extra}));
  await f.idle();
  return result;
 };
 const command=async(text,extra={})=>{
  const model=f.calls.length,sends=f.sent.length;
  await post(text,extra);
  assert.equal(f.calls.length,model,'a group memory command must not go to the model');
  assert.equal(f.sent.length,sends+1,'group memory management sends one native reply');
  const {binding,text:reply}=f.sent.at(-1);
  assert.deepEqual([binding.accountId,binding.groupId,binding.senderId],[accountId,extra.groupId||groupId,extra.from||member]);
  return reply;
 };
 return {...f,groupId,otherGroup,member,otherMember,post,command};
}

function memoryRows(text){
 return text.split('\n').flatMap(line=>{
  const row=/^([a-z0-9-]+) · (.+)$/iu.exec(line);
  return row?[{code:row[1],text:row[2]}]:[];
 });
}

test('ordinary QQ pages older member memories and keeps scoped correction, forgetting and normal chat',async t=>{
 const f=ordinaryMemoryFixture(t);
 const fact=index=>`合成偏好 ${String(index).padStart(2,'0')}`;
 for(let index=1;index<=8;index++)assert.match(await f.command(`记住：${fact(index)}`),/记住了/);
 const actor=f.route.actor(f.groupId,f.member);
 const facts=()=>actor.store.facts(actor.scope);
 const first=await f.command('查看记忆');
 assert.match(first,/你的群内记忆（第 1\/2 页 · 共 8 条）：/u);
 assert.match(first,/下一页“查看记忆 2”/u);
 assert.deepEqual(memoryRows(first).map(row=>row.text),[8,7,6,5,4,3].map(fact));
 const second=await f.command('查看记忆 2');
 assert.match(second,/你的群内记忆（第 2\/2 页 · 共 8 条）：/u);
 assert.match(second,/上一页“查看记忆 1”/u);
 assert.equal(await f.command('查看记忆 ２'),second);
 assert.deepEqual(memoryRows(second),[2,1].map(index=>({
  code:facts().find(row=>row.text===fact(index)).id.slice(0,8),text:fact(index),
 })));
 const oldest=memoryRows(second).at(-1).code;
 for(const page of ['0','-1','1.5','9999999999']){
  const invalid=await f.command(`查看记忆 ${page}`);
  assert.match(invalid,/页码须为 1 到 17/u);
  assert.deepEqual(memoryRows(invalid),[]);
 }
 const missing=await f.command('查看记忆 3');
 assert.match(missing,/没有第 3 页，目前共 2 页/u);
 assert.deepEqual(memoryRows(missing),[]);

 for(const scope of [{from:f.otherMember},{groupId:f.otherGroup}]){
  assert.match(await f.command('查看记忆 2',scope),/还没有长期记忆/u);
  assert.match(await f.command(`忘记 ${oldest}`,scope),/没有找到/u);
 }
 const currentRole=f.route.persona.characterId;
 f.route.persona.characterId='codex-dragon';
 try{
  assert.match(await f.command('查看记忆 2'),/还没有长期记忆/u);
  assert.match(await f.command(`更正 ${oldest}：越界合成值`),/没有找到/u);
 }finally{f.route.persona.characterId=currentRole;}
 assert.equal(facts().at(-1).text,fact(1));

 const sentBeforeQuote=f.sent.length;
 const quoted=await f.post('查看记忆 2',{quote:{id:'78500',text:'普通群友引用的旧文字'}});
 assert.deepEqual([quoted.accepted,quoted.reason],[false,'group_quoted_control']);
 assert.equal(f.sent.length,sentBeforeQuote);
 assert.equal(f.calls.length,0);

 const corrected='已经更正的早期合成偏好';
 assert.match(await f.command(`更正 ${oldest}：${corrected}`),/已改为/u);
 assert.deepEqual(memoryRows(await f.command('查看记忆'))[0],{code:oldest,text:corrected});
 assert.match(await f.command(`忘记 ${oldest}`),/已经忘记/u);
 assert.deepEqual(memoryRows(await f.command('查看记忆 2')).map(row=>row.text),[fact(2)]);
 assert.equal(facts().length,7);

 const natural='查看记忆 这四个字像约定用语吗？';
 f.state.answer=false;
 const sentBeforeChat=f.sent.length;
 assert.equal((await f.post(natural)).accepted,true);
 assert.equal(f.calls.length,1);
 assert.equal(incomingText(f.calls[0].prompt),natural);
 assert.equal(f.sent.length,sentBeforeChat);
 assert(!f.calls[0].prompt.includes(corrected));
});

test('ordinary QQ can manage the oldest of 100 facts and admit a new fact only after forgetting',async t=>{
 const f=ordinaryMemoryFixture(t);
 const actor=f.route.actor(f.groupId,f.member);
 const code=index=>index.toString(16).padStart(8,'0');
 const text=index=>`合成容量条目 ${String(index).padStart(3,'0')}`;
 for(let index=1;index<=100;index++){
  f.state.now++;
  actor.store.remember(actor.scope,{id:`${code(index)}-fixture`,text:text(index)});
 }
 const facts=()=>actor.store.facts(actor.scope);
 const last=await f.command('查看记忆 17');
 assert.match(last,/你的群内记忆（第 17\/17 页 · 共 100 条）：/u);
 assert.match(last,/上一页“查看记忆 16”/u);
 assert.deepEqual(memoryRows(last),[4,3,2,1].map(index=>({code:code(index),text:text(index)})));
 const newFact=text(101);
 const before=facts();
 assert.doesNotMatch(await f.command(`记住：${newFact}`),/记住了/u);
 assert.deepEqual(facts(),before);

 const oldest=memoryRows(last).at(-1).code;
 assert.match(await f.command(`忘记 ${oldest}`),/已经忘记/u);
 assert.equal(facts().length,99);
 assert.match(await f.command(`记住：${newFact}`),/记住了/u);
 assert.equal(facts().length,100);
 assert.equal(facts()[0].text,newFact);
 assert(!facts().some(item=>item.id.startsWith(oldest)));
 assert.equal(f.calls.length,0);
});

test('ordinary QQ memory details distinguish long matching previews and preserve the exact record scope',async t=>{
 const f=ordinaryMemoryFixture(t);
 const shared='同一条路线经过牌楼和长廊，来到湖边后沿石板路继续前行。'.repeat(8);
 const east=shared+'集合地点是东岸凉亭',west=shared+'集合地点是西岸石桥';
 assert(east.length>=198&&west.length>=198);
 for(const text of [east,west])assert.match(await f.command(`记住：${text}`),/记住了/u);
 const actor=f.route.actor(f.groupId,f.member);
 const facts=()=>actor.store.facts(actor.scope);
 const page=await f.command('查看记忆');
 assert.match(page,/查看记忆详情 编号/u);
 const [westPreview,eastPreview]=memoryRows(page);
 assert.equal(westPreview.text,eastPreview.text);
 assert.notEqual(westPreview.code,eastPreview.code);
 assert.doesNotMatch(page,/东岸凉亭|西岸石桥/u);
 assert.deepEqual([westPreview.code,eastPreview.code],facts().map(item=>item.id.slice(0,8)));

 const detail=(code,scope)=>f.command(`查看记忆详情 ${code}`,scope);
 const chosen=await detail(eastPreview.code);
 assert(chosen.includes(east));
 assert.doesNotMatch(chosen,/西岸石桥/u);
 assert.match(chosen,/本群可见|群内可见|群里可见/u);
 const other=await detail(westPreview.code);
 assert(other.includes(west));
 assert.doesNotMatch(other,/东岸凉亭/u);

 const hidden = text => {
  assert(!text.includes(shared.slice(0,30)));
  assert.doesNotMatch(text,/东岸凉亭|西岸石桥/u);
  assert.match(text,/没有找到|编号|格式|用法/u);
 };
 hidden(await detail('@'));
 hidden(await detail('not-a-current-id'));
 hidden(await detail(eastPreview.code,{from:f.otherMember}));
 hidden(await detail(eastPreview.code,{groupId:f.otherGroup}));
 const role=f.route.persona.characterId;
 f.route.persona.characterId='codex-dragon';
 try{hidden(await detail(eastPreview.code));}finally{f.route.persona.characterId=role;}

 const revised='这条会面记录已更正为南岸售票处';
 assert.match(await f.command(`更正 ${eastPreview.code}：${revised}`),/已改为/u);
 const after=await detail(eastPreview.code);
 assert(after.includes(revised));
 assert.doesNotMatch(after,/东岸凉亭|西岸石桥/u);
 assert((await detail(westPreview.code)).includes(west));
 assert.match(await f.command(`忘记 ${eastPreview.code}`),/已经忘记/u);
 const forgotten=await detail(eastPreview.code);
 hidden(forgotten);
 assert(!forgotten.includes(revised));
 assert((await detail(westPreview.code)).includes(west));
 assert.deepEqual(facts().map(item=>item.text),[west]);
 assert.equal(f.calls.length,0);
});

test('group commands cannot approve tools/publish, member pause does not pause others',async t=>{
 const f=fixture(t,{route:{configuration:{enabled:true,groupIds:[GROUP],proactive:true}}});
 for(const [n,text] of ['同意 ABC123','发布说说：不能发布','/allow ABC123'].entries())await f.route.receive(f.message(text,{id:`control-${n}`}));
 assert.equal(f.calls.length,0);assert.equal(f.sent.length,3);assert.equal(f.route.actors.size,1);
 const a=f.route.actor(GROUP,MEMBER),b=f.route.actor(GROUP,'member-opaque_B');assert.equal(b.store.config().proactiveMessages,true);
 await f.route.receive(f.message('暂停主动',{id:'pause'}));assert.equal(a.store.config().proactiveMessages,false);assert.equal(b.store.config().proactiveMessages,true);assert.equal(f.privateStore.config().proactiveMessages,true);
});
test('duplicate and restart metadata refuse replay; each actor has a distinct runner directory',async t=>{
 const f=fixture(t);const m=f.message('hello',{id:'unique-once'});await f.route.receive(m);await f.idle();assert.equal((await f.route.receive(m)).duplicate,true);assert.equal(f.calls.length,2);
 await f.route.receive(f.message('hello second',{id:'second',from:'member_B'}));await f.idle();assert.notEqual(f.calls[0].memberRoot,f.calls[2].memberRoot);
 await f.route.stop();const restart=new GroupCompanionRoute({root:f.root,platform:'fixture-official',accountId:ACCOUNT,configuration:{enabled:true,groupIds:[GROUP],proactive:false},persona:f.privateStore.config(),createExecute:()=>{throw Error('no replay');},send:()=>{throw Error('no replay');},tickMs:0});
 assert.equal((await restart.receive(m)).duplicate,true);assert.equal(restart.actors.size,0);await restart.stop();
});
test('new text supersedes an in-flight gate and disconnect cancels generation',async t=>{
 let entered;const start=new Promise(resolve=>{entered=resolve;});
 const f=fixture(t,{execute:async({signal})=>{entered();return new Promise(resolve=>{signal.addEventListener('abort',()=>resolve({outcome:'cancelled',text:''}),{once:true});});}});
 await f.route.receive(f.message('first',{id:'first'}));await start;await f.route.stop();assert.equal(f.sent.length,0);assert.equal(f.closed.length,1);assert.equal([...f.route.actors.values()][0].engine.snapshot().tasks[0].state,'cancelled');
});
test('same-member bursts coalesce, different senders never share a batch',async t=>{
 const f=fixture(t,{route:{flow:{debounceMs:25,maxBatchMs:50,bubbleDelayMs:0}}});
 await f.route.receive(f.message('A first',{id:'a1'}));await f.route.receive(f.message('B only',{id:'b1',from:'member_B'}));await f.route.receive(f.message('A second',{id:'a2'}));await f.idle();
 const actual=f.calls.filter(c=>!c.prompt.includes('Decide whether'));assert.equal(actual.length,2);const incoming=c=>c.prompt.match(/BEGIN (ARCADE_INPUT_\d+)\n([\s\S]*?)\nEND \1/)[2];const a=actual.find(c=>incoming(c).includes('A second'));assert.match(incoming(a),/A first/);assert.doesNotMatch(incoming(a),/B only/);assert.equal(incoming(actual.find(c=>incoming(c).includes('B only'))),'B only');
});

test('another member can continue the public plan and the AI reply without being treated as its author',async t=>{
 const f=fixture(t,{execute:async args=>({outcome:'reply_ended',text:args.prompt.includes('Decide whether')?'{"action":"message","text":"continue the discussion"}':'那我提议在杉园西门14:30集合，带上蓝色野餐垫。'})});
 await f.route.receive(f.message('我们周六去杉园野餐吧，大家14:30有空吗？',{id:'plan-a',from:'member_A'}));await f.idle();
 await f.route.receive(f.message('那我到哪个门，带什么东西？',{id:'follow-b',from:'member_B'}));await f.idle();
 const prompt=f.calls.filter(c=>!c.prompt.includes('Decide whether')).at(-1).prompt;
 assert.deepEqual({humanPlan:prompt.includes('我们周六去杉园野餐吧'),aiReply:prompt.includes('带上蓝色野餐垫')},{humanPlan:true,aiReply:true});
});

const incomingText=prompt=>prompt.match(/BEGIN (ARCADE_INPUT_\d+)\n([\s\S]*?)\nEND \1/)[2];
const groupData=prompt=>JSON.parse(prompt.split('\n').find(line=>line.startsWith('{"currentMember":')));
const gate=prompt=>prompt.includes('Decide whether');
const until=async fn=>{const start=Date.now();while(!fn()){if(Date.now()-start>3000)throw Error('fixture timeout');await new Promise(resolve=>setImmediate(resolve));}};

test('H01/H02 public context keeps distinct human and character authors with the right reply recipient',async t=>{
 const f=fixture(t,{execute:async args=>({outcome:'reply_ended',text:gate(args.prompt)?'{"action":"message","text":"answer"}':'第一种：杉园。第二种：海边。'})});
 await f.route.receive(f.message('周六去哪儿？',{id:'choices-a',from:'member_A'}));await f.idle();
 await f.route.receive(f.message('第二个更合适。',{id:'choice-b',from:'member_B'}));await f.idle();
 const data=groupData(f.calls.filter(c=>!gate(c.prompt)).at(-1).prompt),human=data.groupConversation.find(r=>r.kind==='member'),ai=data.groupConversation.find(r=>r.kind==='character');
 assert.equal(human.text,'周六去哪儿？');assert.notEqual(human.speaker,data.currentMember);assert.equal(human.replyTo,null);
 assert.match(ai.text,/第二种：海边/);assert.equal(ai.speaker,'claude-ju');assert.equal(ai.replyTo,human.speaker);assert.notEqual(ai.speaker,data.currentMember);
 assert.deepEqual(data.currentMemberMemory.facts,[]);assert.equal(incomingText(f.calls.at(-1).prompt),'第二个更合适。');
 assert(!JSON.stringify(f.route.actor(GROUP,'member_B').engine.snapshot()).includes('groupPublicRows'));
});

test('public discussion is bounded to its group, account and character, including after restart',async t=>{
 const f=fixture(t,{execute:async args=>({outcome:'reply_ended',text:gate(args.prompt)?'{"action":"message","text":"answer"}':'公开回应：赤杉路线。'})});
 await f.route.receive(f.message('赤杉路线周六出发。',{id:'public-a',from:'member_A'}));await f.idle();
 await f.route.receive(f.message('什么路线？',{id:'other-group',groupId:'group-opaque_B',from:'member_B'}));await f.idle();
 assert.doesNotMatch(f.calls.filter(c=>!gate(c.prompt)).at(-1).prompt,/赤杉路线/);
 f.route.persona.characterId='codex-dragon';
 await f.route.receive(f.message('什么路线？',{id:'other-character',from:'member_B'}));await f.idle();
 assert.doesNotMatch(f.calls.filter(c=>!gate(c.prompt)).at(-1).prompt,/赤杉路线/);
 f.route.persona.characterId='claude-ju';await f.route.stop();
 const calls=[],send=[];
 const restarted=new GroupCompanionRoute({root:f.root,platform:'fixture-official',accountId:ACCOUNT,configuration:{enabled:true,groupIds:[GROUP],proactive:false},persona:f.privateStore.config(),tickMs:0,now:()=>f.state.now,flow:{debounceMs:0,bubbleDelayMs:0},
  createExecute:()=>async args=>{calls.push(args);return {outcome:'reply_ended',text:gate(args.prompt)?'{"action":"message","text":"answer"}':'重开后的回应'};},send:async(_binding,text)=>{send.push(text);return{id:'restart-'+send.length};}});
 try{await restarted.receive(f.message('接着刚才的路线说。',{id:'after-restart',from:'member_C'}));await Promise.all([...restarted.actors.values()].map(a=>a.engine.whenIdle()));
  assert.match(calls.filter(c=>!gate(c.prompt)).at(-1).prompt,/赤杉路线/);assert.equal(send.length,1);
  const anotherAccount=new GroupCompanionRoute({root:f.root,platform:'fixture-official',accountId:'separate-account',configuration:{enabled:true,groupIds:[GROUP],proactive:false},persona:f.privateStore.config(),tickMs:0,now:()=>f.state.now,flow:{debounceMs:0,bubbleDelayMs:0},createExecute:()=>async args=>{assert.doesNotMatch(args.prompt,/赤杉路线/);return{outcome:'reply_ended',text:'{"action":"wait","text":""}'};},send:()=>{throw Error('no send');}});
  try{await anotherAccount.receive({id:'same-member-new-account',route:'group',accountId:'separate-account',groupId:GROUP,from:'member_A',text:'还记得路线吗？'});await Promise.all([...anotherAccount.actors.values()].map(a=>a.engine.whenIdle()));}finally{await anotherAccount.stop();}
 }finally{await restarted.stop();}
});

test('unknown sends and failed gate output never become the character public conversation',async t=>{
 let failed=false;
 const f=fixture(t,{execute:async args=>{if(gate(args.prompt)){if(failed)throw Error('fixture unavailable');return{outcome:'reply_ended',text:'{"action":"message","text":"GATE_PRIVATE_REASON_8731"}'};}return {outcome:'reply_ended',text:'UNACCEPTED_AI_OPTION_8731'};},route:{send:async()=>{throw Error('ambiguous send');}}});
 await f.route.receive(f.message('两个选择是什么？',{id:'unknown-a',from:'member_A'}));await f.idle();
 failed=true;await f.route.receive(f.message('让我再想想。',{id:'failed-gate',from:'member_B'}));await f.idle();
 const rows=[...f.route.publicContexts.values()][0].view();assert(rows.every(row=>row.kind==='member'));
 assert.doesNotMatch(JSON.stringify(rows),/GATE_PRIVATE_REASON|UNACCEPTED_AI_OPTION/);
 assert.equal(f.route.journal.snapshot().recent.find(r=>r.state==='skipped')?.state,'skipped');
});

test('H07 member stop blocks a late answer while another member can continue independently',async t=>{
 let release,oldSignal,entered;const started=new Promise(resolve=>{entered=resolve;});
 const f=fixture(t,{execute:async args=>{if(gate(args.prompt))return{outcome:'reply_ended',text:'{"action":"message","text":"answer"}'};
  if(incomingText(args.prompt)==='旧话题'){oldSignal=args.signal;entered();return new Promise(resolve=>{release=()=>resolve({outcome:'reply_ended',text:'LATE_CANCELLED_ANSWER_6732'});});}
  return{outcome:'reply_ended',text:'新成员的新话题回应'};}});
 await f.route.receive(f.message('旧话题',{id:'old-topic',from:'member_A'}));await started;
 await f.route.receive(f.message('停止',{id:'stop-old',from:'member_A'}));assert(oldSignal.aborted);
 await f.route.receive(f.message('现在聊新话题。',{id:'new-topic',from:'member_B'}));await until(()=>f.sent.some(row=>row.text==='新成员的新话题回应'));
 release();await f.idle();
 assert(!f.sent.some(row=>row.text.includes('LATE_CANCELLED_ANSWER')));
 assert(!JSON.stringify([...f.route.publicContexts.values()][0].view()).includes('LATE_CANCELLED_ANSWER'));
 assert.equal(f.route.actor(GROUP,'member_A').engine.snapshot().tasks[0].state,'cancelled');
 assert.equal(f.route.actor(GROUP,'member_B').engine.snapshot().tasks[0].state,'reply_ended');
});

test('H09 forgetting resets shared paraphrases and derived AI replies, cancels pending context and survives restart',async t=>{
 const marker='雾港6241';let release,signal,entered;const started=new Promise(resolve=>{entered=resolve;});
 const f=fixture(t,{execute:async args=>{if(gate(args.prompt))return{outcome:'reply_ended',text:'{"action":"message","text":"answer"}'};
  const body=incomingText(args.prompt);
  if(body==='请等我想想'){signal=args.signal;entered();return new Promise(resolve=>{release=()=>resolve({outcome:'reply_ended',text:'迟到的 '+marker});});}
  return{outcome:'reply_ended',text:body.includes(marker)?'沿用公开午后码：'+marker:'没有复述旧事实。'};}});
 await f.route.receive(f.message('公开说：我的午后码是'+marker,{id:'public-secret',from:'member_A'}));await f.idle();
 await f.route.receive(f.message('记住：午后码是'+marker,{id:'remember-secret',from:'member_A'}));await f.idle();
 await f.route.receive(f.message('甲刚说的那个编号换个说法就是'+marker+'，我们沿用吗？',{id:'quoted-secret',from:'member_B'}));await f.idle();
 await f.route.receive(f.message('记住：我喜欢杉林',{id:'other-fact',from:'member_B'}));await f.idle();
 await f.route.receive(f.message('我只负责带茶。',{id:'unrelated-public',from:'member_C'}));await f.idle();
 const a=f.route.actor(GROUP,'member_A'),b=f.route.actor(GROUP,'member_B'),fact=a.store.facts(a.scope)[0];b.store.setNotes(b.scope,'乙的旧自由笔记也复述了 '+marker);
 await f.route.receive(f.message('请等我想想',{id:'pending-reference',from:'member_B'}));await started;
 const forget=f.route.receive(f.message('忘记 '+fact.id.slice(0,8),{id:'forget-secret',from:'member_A'}));
 await until(()=>signal.aborted);
 const during=await f.route.receive(f.message('同时新进来的消息',{id:'during-forget',from:'member_D'}));assert.equal(during.accepted,false);
 release();await forget;await f.idle();
 assert.deepEqual(a.store.facts(a.scope),[]);assert.equal(b.store.facts(b.scope)[0].text,'我喜欢杉林');
 const rows=[...f.route.publicContexts.values()][0].view();assert(b.store.getNotes(b.scope).includes(marker));assert(f.sent.at(-1).text.includes('共同近期上下文也已重置'));
 assert(!f.sent.some(row=>row.text==='迟到的 '+marker));assert(f.closed.length>=3,'every old observer runner was closed before the memory transaction completed');
 // The old per-member assistant history still exists for audit; it is not the
 // conversation source used by future group prompts.
 assert(b.store.history(b.scope,60).some(row=>row.text.includes(marker)));
 for(const who of ['member_A','member_B']){await f.route.receive(f.message('你现在记得什么？',{id:'query-'+who,from:who}));await f.idle();assert.doesNotMatch(f.calls.filter(c=>!gate(c.prompt)).at(-1).prompt,new RegExp(marker));}
 assert.deepEqual(rows,[]);
 await f.route.stop();const calls=[];
 const restarted=new GroupCompanionRoute({root:f.root,platform:'fixture-official',accountId:ACCOUNT,configuration:{enabled:true,groupIds:[GROUP],proactive:false},persona:f.privateStore.config(),tickMs:0,now:()=>f.state.now,flow:{debounceMs:0,bubbleDelayMs:0},createExecute:()=>async args=>{calls.push(args);return{outcome:'reply_ended',text:gate(args.prompt)?'{"action":"message","text":"answer"}':'重开后没有旧事实。'};},send:async()=>({id:'new-receipt'})});
 try{await restarted.receive(f.message('重开后呢？',{id:'forget-restart-query',from:'member_B'}));await Promise.all([...restarted.actors.values()].map(a=>a.engine.whenIdle()));assert.doesNotMatch(calls.at(-1).prompt,new RegExp(marker));assert.match(calls.at(-1).prompt,/我喜欢杉林/);}finally{await restarted.stop();}
});

test('H09 correction replaces the member fact without carrying the old public value to another member',async t=>{
 const f=fixture(t);await f.route.receive(f.message('公开偏好：old-preference-6412',{id:'public-old',from:'member_A'}));await f.idle();
 await f.route.receive(f.message('记住：old-preference-6412',{id:'remember-old',from:'member_A'}));await f.idle();
 const actor=f.route.actor(GROUP,'member_A'),fact=actor.store.facts(actor.scope)[0];
 await f.route.receive(f.message('更正 '+fact.id.slice(0,8)+'：new-preference-8523',{id:'correct-old',from:'member_A'}));await f.idle();
 await f.route.receive(f.message('你记得我的偏好吗？',{id:'query-corrected',from:'member_A'}));await f.idle();assert.match(f.calls.at(-1).prompt,/new-preference-8523/);assert.doesNotMatch(f.calls.at(-1).prompt,/old-preference-6412/);
 await f.route.receive(f.message('你记得甲的偏好吗？',{id:'query-other',from:'member_B'}));await f.idle();assert.doesNotMatch(f.calls.at(-1).prompt,/old-preference-6412|new-preference-8523/);
});

test('real DeepSeek runner with fake HTTP keeps gate/reply sampling independent, sessions fresh and tools disabled',async t=>{
 const {createDeepSeekRunner}=require('../src/bot/deepseek-runner.cjs'),requests=[];
 const f=fixture(t,{route:{platform:'qq-onebot',mode:'deepseek',loadReplySampling:()=>({temperature:0,topP:.6,maxTokens:1200}),
  createExecute:memberRoot=>createDeepSeekRunner({workspace:memberRoot,key:'fixture-deepseek-key',conversationOnly:true,fetchImpl:async(url,init)=>{
  assert.equal(url,'https://api.deepseek.com/chat/completions');const body=JSON.parse(init.body);requests.push(body);
  const prompt=body.messages.at(-1).content;return Response.json({choices:[{message:{role:'assistant',content:gate(prompt)?'{"action":"message","text":"GATE_ONLY_REASON_9704"}':'公开回复而非接话理由。'},finish_reason:'stop'}]});
 }})}});
 await f.route.receive(f.message('第一句',{id:'runner-one',from:'member_A'}));await f.idle();await f.route.receive(f.message('接着第一句。',{id:'runner-two',from:'member_B'}));await f.idle();
 assert.equal(requests.length,4);
 for(const body of requests){assert.equal(body.messages.length,2);assert.deepEqual(body.messages.map(m=>m.role),['system','user']);assert(!body.tools||body.tools.length===0);assert.doesNotMatch(body.messages.at(-1).content,/GATE_ONLY_REASON_9704/);}
 assert.deepEqual(requests.map(body=>[body.max_tokens,body.temperature,body.top_p]),[
  [256,undefined,undefined],[1200,0,.6],[256,undefined,undefined],[1200,0,.6],
 ]);
 assert.match(requests[3].messages[1].content,/公开回复而非接话理由/);
 const marker='北塔码9138';
 await f.route.receive(f.message('公开计划的编号是'+marker,{id:'wire-public-a',from:'member_A'}));await f.idle();
 await f.route.receive(f.message('记住：计划编号是'+marker,{id:'wire-remember-a',from:'member_A'}));await f.idle();
 await f.route.receive(f.message('用另一种说法：'+marker+'就是刚才那个代号。',{id:'wire-paraphrase-b',from:'member_B'}));await f.idle();
 const a=f.route.actor(GROUP,'member_A'),b=f.route.actor(GROUP,'member_B'),fact=a.store.facts(a.scope)[0];b.store.setNotes(b.scope,'旧推导自由笔记 '+marker);
 await f.route.receive(f.message('忘记 '+fact.id.slice(0,8),{id:'wire-forget-a',from:'member_A'}));await f.idle();
 await f.route.receive(f.message('乙自己再问：你还知道那个代号吗？',{id:'wire-query-b',from:'member_B'}));await f.idle();
 assert.doesNotMatch(requests.at(-1).messages[1].content,new RegExp(marker));
 assert.equal(requests.at(-1).messages.length,2);assert.deepEqual(requests.at(-1).messages.map(m=>m.role),['system','user']);
});

test('an accepted send with failed public-context storage is not repeated or presented as remembered',async t=>{
 const f=fixture(t,{execute:async args=>({outcome:'reply_ended',text:gate(args.prompt)?'{"action":"message","text":"answer"}':'UNRECORDED_CONFIRMED_REPLY_9012'})});
 const publicStore=f.route.publicContext(GROUP,'claude-ju'),append=publicStore.append.bind(publicStore);
 publicStore.append=row=>{if(row.kind==='character')throw Error('fixture disk unavailable');append(row);};
 await f.route.receive(f.message('给我一个建议',{id:'storage-send-one',from:'member_A'}));await f.idle();
 assert.equal(f.sent.length,1);assert.match(f.route.snapshot().problem,/共同上下文保存失败/);assert(publicStore.view().every(row=>row.kind==='member'));
 await f.route.receive(f.message('刚才你说什么？',{id:'storage-followup',from:'member_B'}));await f.idle();
 assert.doesNotMatch(f.calls.filter(c=>!gate(c.prompt)).at(-1).prompt,/UNRECORDED_CONFIRMED_REPLY_9012/);assert.equal(f.sent.length,2);
});

test('concurrent group stops share cleanup and a later stop retries only the failed runner',async t=>{
 const f=fixture(t);
 const a=f.route.actor(GROUP,MEMBER),b=f.route.actor(GROUP,'member-opaque_B');
 let attemptsA=0,attemptsB=0,release,entered;
 const blocked=new Promise(resolve=>{release=resolve;});
 const started=new Promise(resolve=>{entered=resolve;});
 a.execute.close=async()=>{if(++attemptsA===1){entered();await blocked;throw Error('Transient group runner close');}};
 b.execute.close=async()=>{attemptsB++;};
 const first=f.route.stop(),parallel=f.route.stop();
 const failure=Promise.allSettled([first,parallel]);
 try{await started;assert.equal(first,parallel);assert.equal(f.route.snapshot().active,false);assert.equal(attemptsA,1);}
 finally{release();}
 const outcomes=await failure;
 assert(outcomes.every(result=>result.status==='rejected'&&result.reason.message==='Transient group runner close'));
 assert.equal(attemptsB,1,'another runner must be closed even when one fails');
 await f.route.stop();
 assert.deepEqual([attemptsA,attemptsB],[2,1]);
 assert.equal(f.route.snapshot().active,false);
 assert.equal(f.sent.length,0);
});
