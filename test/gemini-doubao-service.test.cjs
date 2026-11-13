'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BotService}=require('../src/bot/service.cjs');
const {SocialCompanion}=require('../src/bot/social-companion.cjs');
const {createGeminiRunner,DEFAULT_MODEL:GEMINI}=require('../src/bot/gemini-runner.cjs');
const {createDoubaoRunner,DEFAULT_MODEL:DOUBAO}=require('../src/bot/doubao-runner.cjs');
const vault={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text),decryptString:bytes=>bytes.toString()};
const keys={api:'synthetic-anthropic-key',gpt:'synthetic-openai-key',deepseek:'synthetic-deepseek-key',gemini:'synthetic-gemini-key',doubao:'synthetic-doubao-key'};
const slots={api:'key',gpt:'openaiKey',deepseek:'deepseekKey',gemini:'geminiKey',doubao:'doubaoKey'};
function root(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-new-provider-'));t.after(()=>{assert(dir.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(dir,{recursive:true,force:true});});return dir;}
test('provider vault slots and fixed models remain separate across switching and reopening',async t=>{
  const dir=root(t),service=new BotService({root:dir,vault});t.after(()=>service.disconnect());
  for(const mode of Object.keys(keys)){service.configure({mode,key:keys[mode]});assert.equal(service.secret[slots[mode]],keys[mode]);}
  for(const mode of ['gemini','doubao']){
    service.configure({mode});const reopened=new BotService({root:dir,vault});assert.equal(reopened.snapshot().mode,mode);assert.equal(reopened.snapshot().hasKey,true);assert.equal(reopened.status,'disconnected');
    assert.equal(reopened.snapshot().geminiModel,GEMINI);assert.equal(reopened.snapshot().doubaoModel,DOUBAO);
    for(const other of Object.keys(keys))assert.equal(reopened.secret[slots[other]],keys[other]);
    const previous=fs.readFileSync(path.join(dir,'bot-vault.json'));assert.throws(()=>reopened.configure({[`${mode}Model`]:'custom-id',key:'synthetic-rejected-key'}),/available/);assert.deepEqual(fs.readFileSync(path.join(dir,'bot-vault.json')),previous);
    for(const key of Object.values(keys)){assert(!JSON.stringify(reopened.snapshot()).includes(key));assert(!fs.readFileSync(path.join(dir,'bot-config.json'),'utf8').includes(key));}
    await reopened.disconnect();
  }
});
for(const mode of ['gemini','doubao'])test(`${mode}: other provider credentials never satisfy key requirement`,async t=>{
  let clients=0;const service=new BotService({root:root(t),vault,qqClientFactory:()=>{clients++;throw Error('must not create');}});t.after(()=>service.disconnect());
  service.configure({mode:'gpt',key:keys.gpt,workspace:service.root,channel:'qq',qqOwnerId:'12345678',qqToken:'synthetic-onebot-token'});service.configure({mode});
  assert.equal(service.snapshot().hasKey,false);await assert.rejects(service.connect(),/selected provider/);assert.equal(clients,0);
});
for(const mode of ['gemini','doubao'])test(`${mode}: QQ companion service selects real no-tools runner and correct persona`,async t=>{
  const dir=root(t),requests=[];let client;const options=[];
  const makeRunner=settings=>{options.push(settings);const create=mode==='gemini'?createGeminiRunner:createDoubaoRunner;return create({...settings,fetchImpl:async(_url,init)=>{requests.push(JSON.parse(init.body));return Response.json(mode==='gemini'?{candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text:'你好，我在听。'}]}}]}:{choices:[{finish_reason:'stop',message:{role:'assistant',content:'你好，我在听。'}}]});}});};
  const service=new BotService({root:dir,vault,[`${mode}RunnerFactory`]:makeRunner,qqClientFactory:settings=>(client={accountId:'87654321',ownerId:settings.ownerId,ready:true,socket:{readyState:1},generation:1,connect:async()=>{},inspect:async()=>({accountId:'87654321',online:true,ownerIsFriend:true}),getUpdates:(_cursor,signal)=>new Promise((_,reject)=>{const abort=()=>reject(Object.assign(Error('fixture abort'),{code:'aborted'}));signal.addEventListener('abort',abort,{once:true});}),sendText:async()=>({id:'synthetic-receipt'}),sendProactiveText:async()=>({id:'synthetic-proactive'}),publishQzoneText:async()=>{throw Error('never publish');},getOwnQzonePost:async()=>{throw Error('never read');},close:()=>{client.closed=true;}})});
  t.after(()=>service.disconnect());service.configure({mode,key:keys[mode],channel:'qq',qqOwnerId:'12345678',qqToken:'synthetic-onebot-token'});
  const characterId=mode==='gemini'?'gemini-cat':'doubao-girl';service.socialConfigure({enabled:true,characterId});await service.connect();assert.equal(service.status,'connected');assert(service.dispatcher instanceof SocialCompanion);assert.equal(service.snapshot().social.supported,true);assert.equal(service.imageBinding().scopeId.endsWith(characterId),true);
  const result=await service.socialReply('你好');assert.equal(result.outcome,'reply_ended');assert.equal(options[0].conversationOnly,true);assert.equal(options[0].key,keys[mode]);assert.equal(options[0].model,mode==='gemini'?GEMINI:DOUBAO);assert.deepEqual(requests[0].tools,[]);
});
