'use strict';

// API protocol fixtures, not paid provider or live social-account acceptance.
// The service, dispatcher, API runners, SQLite and file effects are real;
// only inbound/outbound message transport and fetch responses are synthetic.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {BotService} = require('../src/bot/service.cjs');
const {createDeepSeekRunner} = require('../src/bot/deepseek-runner.cjs');

const KEYS = {gpt:'synthetic-openai-api-flow-key',deepseek:'synthetic-deepseek-api-flow-key',gemini:'synthetic-gemini-api-flow-key',doubao:'synthetic-doubao-api-flow-key'};
const OWNER='12345678', ACCOUNT='87654321', CONTENT='ARCADE_API_FLOW_FIXTURE';
const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
async function until(predicate,label) {
  const end=Date.now()+6000;
  while(Date.now()<end) {if(predicate())return;await new Promise(resolve=>setTimeout(resolve,10));}
  assert(predicate(),label||'API fixture did not reach the required state');
}
function final(mode,text) {
  if(mode==='gemini')return {candidates:[{finishReason:'STOP',content:{role:'model',parts:[{text}]}}]};
  return ['deepseek','doubao'].includes(mode)?{choices:[{finish_reason:'stop',message:{role:'assistant',content:text}}]}:
    {id:'resp_fixture',object:'response',status:'completed',output:[{id:'msg_fixture',type:'message',role:'assistant',status:'completed',content:[{type:'output_text',text,annotations:[]}]}]};
}
function writeCall(mode,name='approved.txt') {
  const argumentsText=JSON.stringify({path:name,content:CONTENT});
  if(mode==='gemini')return {candidates:[{finishReason:'STOP',content:{role:'model',parts:[{functionCall:{id:'call_write',name:'Write',args:JSON.parse(argumentsText)},thoughtSignature:'synthetic-signature'}]}}]};
  return ['deepseek','doubao'].includes(mode)?{choices:[{finish_reason:'tool_calls',message:{role:'assistant',content:null,tool_calls:[{id:'call_write',type:'function',function:{name:'Write',arguments:argumentsText}}]}}]}:
    {id:'resp_write',object:'response',status:'completed',output:[{id:'fc_write',type:'function_call',call_id:'call_write',name:'Write',arguments:argumentsText,status:'completed'}]};
}
class Transport {
  constructor(options) {this.options=options;this.accountId=ACCOUNT;this.sent=[];this.queue=[];this.waiter=null;}
  async connect() {}
  async inspect() {return {accountId:ACCOUNT,nickname:'Synthetic API account',online:true,ownerIsFriend:true};}
  getUpdates(cursor,signal) {
    if(this.queue.length)return Promise.resolve({cursor:'fixture',messages:this.queue.splice(0)});
    return new Promise((resolve,reject)=>{
      const abort=()=>{cleanup();reject(Object.assign(Error('synthetic transport aborted'),{code:'aborted'}));};
      const cleanup=()=>{signal.removeEventListener('abort',abort);this.waiter=null;};
      this.waiter=()=>{cleanup();resolve({cursor:'fixture',messages:this.queue.splice(0)});};
      if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
    });
  }
  push(message) {this.queue.push(message);this.waiter?.();}
  async sendText(to,text,contextToken,_id,signal) {
    assert.equal(to,OWNER);assert.equal(contextToken,'synthetic-api-context');assert(!signal.aborted);
    this.sent.push(text);return {id:'synthetic-send-receipt'};
  }
  close() {}
}
function fixture(t,mode,channel) {
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-api-flow-'));
  const clients=[],requests=[],plans=[];let seq=0;
  const factory=provider=>options=>{
    assert.equal(options.key,KEYS[provider]);
    const create={deepseek:createDeepSeekRunner,gpt:require('../src/bot/gpt-runner.cjs').createGPTRunner,gemini:require('../src/bot/gemini-runner.cjs').createGeminiRunner,doubao:require('../src/bot/doubao-runner.cjs').createDoubaoRunner}[provider];
    return create({...options,fetchImpl:async(url,init)=>{
      const body=JSON.parse(init.body);requests.push({provider,url,body});
      assert.equal(provider==='gemini'?init.headers['x-goog-api-key']:init.headers.Authorization,provider==='gemini'?KEYS[provider]:`Bearer ${KEYS[provider]}`);
      assert.equal(url,{deepseek:'https://api.deepseek.com/chat/completions',gpt:'https://api.openai.com/v1/responses',gemini:'https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent',doubao:'https://ark.cn-beijing.volces.com/api/v3/chat/completions'}[provider]);
      for(const key of Object.values(KEYS))assert(!JSON.stringify(body).includes(key));
      const next=plans.shift();assert(next,'unexpected API fetch');
      if(typeof next==='function')return next(url,init);
      return next instanceof Response?next:Response.json(next);
    }});
  };
  const transportFactory=options=>{const client=new Transport(options);clients.push(client);return client;};
  const service=new BotService({root,vault,clientFactory:transportFactory,qqClientFactory:transportFactory,
    deepseekRunnerFactory:factory('deepseek'),gptRunnerFactory:factory('gpt'),geminiRunnerFactory:factory('gemini'),doubaoRunnerFactory:factory('doubao')});
  service.configure({workspace:root,mode:'deepseek',key:KEYS.deepseek,qqOwnerId:OWNER,qqToken:'synthetic-onebot-api-flow-token'});
  service.configure({mode:'gpt',key:KEYS.gpt});
  service.configure({mode:'gemini',key:KEYS.gemini});service.configure({mode:'doubao',key:KEYS.doubao});
  service.persist({...service.secret,token:'synthetic-wechat-api-flow-token',ownerId:OWNER});
  service.configure({mode,channel});
  t.after(async()=>{await service.disconnect();assert(root.startsWith(path.join(os.tmpdir(),'arcade-api-flow-')));fs.rmSync(root,{recursive:true,force:true});});
  return {root,service,requests,plans,clients,
    send:text=>clients.at(-1).push({id:`synthetic-${++seq}`,text,contextToken:'synthetic-api-context'}),
    get sent(){return clients.at(-1).sent;}};
}

for(const mode of ['gpt','deepseek','gemini','doubao'])for(const channel of ['wechat','qq']) {
  test(`${channel} × ${mode}: real API runner chats and writes only after a specific approval`,async t=>{
    const f=fixture(t,mode,channel);
    f.plans.push(final(mode,'Synthetic direct reply'),writeCall(mode),final(mode,'Synthetic write report'));
    await f.service.connect();f.send('Synthetic ordinary chat');
    await until(()=>f.sent.includes('Synthetic direct reply'));
    assert.deepEqual(f.sent,['Synthetic direct reply']);assert.equal(f.service.snapshot().tasks.pending.length,0);
    f.send('Synthetic request: create approved.txt');
    await until(()=>f.service.snapshot().tasks.pending.length===1);
    const request=f.service.snapshot().tasks.pending[0];
    assert.equal(fs.existsSync(path.join(f.root,'approved.txt')),false);
    f.send(`同意 ${request.alias}`);
    await until(()=>f.sent.includes('Synthetic write report'));
    assert.deepEqual(fs.readFileSync(path.join(f.root,'approved.txt')),Buffer.from(CONTENT));
    assert.equal(f.requests.length,3);
    assert.equal(f.service.snapshot().tasks.tasks.at(-1).state,'reply_ended');
    assert.equal(f.service.journal.snapshot().storage,'sqlite');
    assert(f.service.journal.snapshot().recent.some(record=>record.state==='reply_ended'));
    const history=JSON.stringify(f.requests.at(-1).body);
    assert(history.includes('Synthetic ordinary chat'));assert(history.includes('Synthetic direct reply'));
    assert(history.includes('created'));assert(history.includes(String(Buffer.byteLength(CONTENT))));
    for(const key of Object.values(KEYS))assert(!JSON.stringify(f.service.snapshot()).includes(key));
  });
}

for(const mode of ['gpt','deepseek','gemini','doubao']) {
  test(`${mode}: denial, cancellation and HTTP failure stay truthful through social dispatch`,async t=>{
    const f=fixture(t,mode,'qq');
    f.plans.push(writeCall(mode,'denied.txt'),final(mode,'Synthetic action declined'));
    await f.service.connect();f.send('Synthetic denied operation');
    await until(()=>f.service.snapshot().tasks.pending.length===1);
    f.send(`拒绝 ${f.service.snapshot().tasks.pending[0].alias}`);
    await until(()=>f.sent.includes('Synthetic action declined'));
    assert.equal(fs.existsSync(path.join(f.root,'denied.txt')),false);
    assert(JSON.stringify(f.requests.at(-1).body).includes('declined'));

    let entered=false,aborted=false;
    f.plans.push(async(_url,init)=>{entered=true;return new Promise((resolve,reject)=>{
      const abort=()=>{aborted=true;reject(Error('synthetic pending fetch cancelled'));};
      if(init.signal.aborted)abort();else init.signal.addEventListener('abort',abort,{once:true});
    });});
    f.send('Synthetic long generation');await until(()=>entered);
    f.send('停止');await until(()=>aborted&&f.service.snapshot().tasks.tasks.at(-1).state==='cancelled');
    await f.service.dispatcher.whenIdle();
    assert.equal(f.service.snapshot().tasks.tasks.at(-1).text,'');
    assert.equal(f.service.snapshot().tasks.pending.length,0);

    f.plans.push(new Response('PRIVATE_HTTP_BODY_NOT_FOR_OWNER',{status:401}));
    f.send('Synthetic unauthorized request');
    await until(()=>f.service.snapshot().tasks.tasks.at(-1).state==='error');
    await f.service.dispatcher.whenIdle();
    assert.equal(f.service.snapshot().tasks.tasks.at(-1).text,'');
    assert(!f.sent.join('\n').includes('PRIVATE_HTTP_BODY_NOT_FOR_OWNER'));
    assert(f.sent.some(value=>/出错|API key|credential|认证|密钥/i.test(value)));
  });
}

test('switching API providers isolates keys and does not transfer conversational history',async t=>{
  const f=fixture(t,'deepseek','wechat');
  f.plans.push(final('deepseek','DeepSeek-only reply'));
  await f.service.connect();f.send('DEEPSEEK_ONLY_HISTORY');
  await until(()=>f.sent.includes('DeepSeek-only reply'));await f.service.disconnect();
  f.service.configure({mode:'gpt'});f.plans.push(final('gpt','GPT-only reply'));
  await f.service.connect();f.send('GPT_ONLY_HISTORY');
  await until(()=>f.sent.includes('GPT-only reply'));
  assert.equal(f.requests.at(-1).provider,'gpt');assert(!JSON.stringify(f.requests.at(-1).body).includes('DEEPSEEK_ONLY_HISTORY'));
  await f.service.disconnect();f.service.configure({mode:'deepseek'});
  f.plans.push(final('deepseek','Fresh DeepSeek reply'));await f.service.connect();f.send('FRESH_DEEPSEEK');
  await until(()=>f.sent.includes('Fresh DeepSeek reply'));
  assert.equal(f.requests.at(-1).provider,'deepseek');
  assert(!JSON.stringify(f.requests.at(-1).body).includes('GPT_ONLY_HISTORY'));
  assert(!JSON.stringify(f.requests.at(-1).body).includes('DEEPSEEK_ONLY_HISTORY'));
});
