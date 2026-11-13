'use strict';
// First-run path, main-process side: the last conversation kind is kept per profile, and a
// failed App reply is reported by class without any provider text leaving the main process.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const root=path.resolve(__dirname,'..');
const {DesktopConversations}=require(path.join(root,'src/bot/desktop-conversations.cjs'));
const {DesktopChat,desktopChatResult,classifyFailure,observeLocalRunner,observeLocalRunners}=require(path.join(root,'src/bot/desktop-chat.cjs'));
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-first-run-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const controller=service=>new DesktopConversations({getSelection:()=>({accountId:'a',service}),retire(){}});
const file=dir=>path.join(dir,'desktop-conversation.json');

test('the chosen conversation kind is stored in the profile folder and restored by a later run',async t=>{
  const dir=temp(t),service=()=>({root:dir,localStart:async()=>{}});
  const first=controller(service());assert.equal(first.kind(),'channel');assert.equal(fs.existsSync(file(dir)),false);
  await first.select({accountId:'a',kind:'local'});
  assert.deepEqual(JSON.parse(fs.readFileSync(file(dir),'utf8')),{version:1,kind:'local'});
  assert.equal(controller(service()).kind(),'local');
  const second=controller(service());await second.select({accountId:'a',kind:'channel'});
  assert.deepEqual(JSON.parse(fs.readFileSync(file(dir),'utf8')),{version:1,kind:'channel'});
  assert.equal(controller(service()).kind(),'channel');
});
test('a stored choice that is not exactly {version:1,kind} is ignored',t=>{
  for(const text of ['','not json','[]','{"version":2,"kind":"local"}','{"version":1,"kind":"qq"}','{"version":1,"kind":"local","accountId":"b"}',JSON.stringify({version:1,kind:'local',pad:'x'.repeat(400)})]){
    const dir=temp(t);fs.writeFileSync(file(dir),text);
    assert.equal(controller({root:dir}).kind(),'channel',text.slice(0,40));
  }
});
test('a restored local kind never starts the conversation, and a service without a folder stores nothing',async t=>{
  const dir=temp(t);fs.writeFileSync(file(dir),'{"version":1,"kind":"local"}');let starts=0;
  const restored=controller({root:dir,localStart:async()=>{starts++;}});assert.equal(restored.kind(),'local');assert.equal(starts,0);
  const bare=controller({localStart:async()=>{}});await bare.select({accountId:'a',kind:'local'});assert.equal(bare.kind(),'local');
});
test('a failed start leaves the stored choice untouched',async t=>{
  const dir=temp(t),c=controller({root:dir,localStart:async()=>{throw Object.assign(Error('no'),{code:'start_failed'});}});
  await assert.rejects(c.select({accountId:'a',kind:'local'}),{code:'start_failed'});
  assert.equal(fs.existsSync(file(dir)),false);assert.equal(c.kind(),'channel');
});

test('runner sentences map to the six failure classes',()=>{
  const cases={
    auth:['DeepSeek rejected the API key.','OpenAI rejected the API key.','Anthropic rejected the API key.','Gemini rejected the API key.','Doubao access was denied. Check the key, model access and supported region.','This OpenAI account is not allowed to use this model.','This OpenAI model is unavailable to the account.','Gemini model is unavailable for this account.'],
    quota:['DeepSeek account credit is insufficient.','Doubao account credit is insufficient.','DeepSeek rate limit reached. Try again later.','Anthropic rate limit reached. Try again later.','Gemini rate or credit limit reached. Check the provider console before trying again.','OpenAI quota or rate limit reached. Check billing and retry later.'],
    network:['Could not reach Anthropic. Check your connection.','DeepSeek could not complete this request. Check its service and your connection.','OpenAI could not complete this request. Check its service and your connection.','DeepSeek could not finish. Check the API key, credit and network; previous file changes may remain.','OpenAI could not finish. Check the API key, billing and network; previous file changes may remain.','Gemini could not finish. Check the API key, model access, credit and network; previous file changes may remain.'],
    refused:['Claude declined to answer this message.','Doubao declined this request. No tool call was executed.','Gemini blocked this request. No tool call was executed.','OpenAI returned both a refusal and tool calls. No local action was performed.'],
    other:['Claude could not finish. Check the API key, network and account credit before retrying.','Gemini rejected the request or selected model. Check model access.','DeepSeek returned malformed data.','Claude returned no reply text.','Invalid task input.','本机 Claude 未能完成本轮。请检查原版 CLI 的登录、版本和网络；执行结果未确认。',''],
  };
  for(const [failure,sentences] of Object.entries(cases))for(const text of sentences)assert.equal(classifyFailure({outcome:'error',text}),failure,text);
  assert.equal(classifyFailure({outcome:'limit',text:'DeepSeek reached the response token limit. No partial tool call was executed.'}),'limit');
  assert.equal(classifyFailure({outcome:'limit',text:'The turn time limit was reached. Existing file changes were not rolled back.'}),'limit');
  for(const value of [null,undefined,'DeepSeek rejected the API key.',{outcome:'error'},{outcome:'error',text:5}])assert.equal(classifyFailure(value),'other');
});

// A profile service whose App conversation runs one runner call per reply, like LocalCompanion does.
function profile(dir,answers){
  const service={root:dir,deepseekRunnerFactory:()=>async()=>answers.shift(),execute:null,
    start(){this.execute=this.deepseekRunnerFactory({conversationOnly:true,configDir:path.join(dir,'local-companion','agent')});},
    async localReply(){const result=await this.execute({prompt:'x'});return {outcome:result?.outcome==='reply_ended'?'reply_ended':result?.outcome==='cancelled'?'cancelled':'error',text:'',chunks:[]};}};
  const context={accountId:'a',kind:'local',service,dispatcher:{},scope:'local',character:'ju',settings:'{}',generation:1};
  const chat=new DesktopChat({getContext:()=>context}),open=()=>chat.open({accountId:'a',contextId:chat.snapshot().contextId,panelId:'panel'});
  return {service,chat,open,send:(session,id)=>desktopChatResult(()=>chat.send({...session,requestId:id,text:'你好'}))};
}
test('a failed App reply carries its class and nothing else from the runner',async t=>{
  const dir=temp(t),secret='sk-fake-not-a-key-000000';
  const p=profile(dir,[{outcome:'error',text:'DeepSeek rejected the API key.',notice:secret},{outcome:'error',text:'DeepSeek account credit is insufficient.'},{outcome:'limit',text:'whatever'},{outcome:'error',text:`unexpected ${secret}`},{outcome:'reply_ended',text:'好'}]);
  observeLocalRunners(p.service);observeLocalRunners(p.service);p.service.start();
  const session=p.open(),results=[];for(const id of ['r1','r2','r3','r4','r5'])results.push(await p.send(session,id));
  assert.deepEqual(results.slice(0,4),[{ok:false,code:'reply_failed',failure:'auth'},{ok:false,code:'reply_failed',failure:'quota'},{ok:false,code:'reply_failed',failure:'limit'},{ok:false,code:'reply_failed',failure:'other'}]);
  assert.deepEqual(results[4],{ok:true,outcome:'reply_ended',started:true});
  assert.equal(JSON.stringify(results).includes(secret),false);
});
test('a failure without an observed runner result is "other", and channel replies carry no class',async t=>{
  const dir=temp(t),p=profile(dir,[]);p.service.localReply=async()=>({outcome:'error',text:''});
  assert.deepEqual(await p.send(p.open(),'r1'),{ok:false,code:'reply_failed',failure:'other'});
  const service={socialReply:async()=>({outcome:'error'})},context={accountId:'a',kind:'channel',service,dispatcher:{},scope:'s',character:'ju',settings:'{}',generation:1};
  const chat=new DesktopChat({getContext:()=>context}),session=chat.open({accountId:'a',contextId:chat.snapshot().contextId,panelId:'panel'});
  assert.deepEqual(await desktopChatResult(()=>chat.send({...session,requestId:'r1',text:'你好'})),{ok:false,code:'reply_failed'});
});
test('an earlier failure is not reported for a later reply that fails elsewhere',async t=>{
  const dir=temp(t),p=profile(dir,[{outcome:'error',text:'DeepSeek rejected the API key.'}]);observeLocalRunners(p.service);p.service.start();
  const session=p.open();assert.equal((await p.send(session,'r1')).failure,'auth');
  p.service.localReply=async()=>({outcome:'error',text:''});
  assert.equal((await p.send(session,'r2')).failure,'other');
});
test('only the App conversation runner is observed; every other runner is returned untouched',()=>{
  const execute=Object.assign(async()=>({outcome:'error',text:'DeepSeek rejected the API key.'}),{close(){}}),factory=observeLocalRunner(()=>execute);
  assert.equal(factory({workspace:'w',key:'k'}),execute);
  assert.equal(factory({conversationOnly:true,configDir:path.join('p','claude-config')}),execute);
  assert.equal(factory({conversationOnly:false,configDir:path.join('p','local-companion','agent')}),execute);
  const observed=factory({conversationOnly:true,configDir:path.join('p','local-companion','agent')});
  assert.notEqual(observed,execute);assert.equal(observed.close,execute.close);assert.equal(typeof observed,'function');
});
