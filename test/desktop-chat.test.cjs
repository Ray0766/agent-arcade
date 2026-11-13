'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DesktopChat,desktopChatResult}=require('../src/bot/desktop-chat.cjs');
const {SocialStore}=require('../src/bot/social-store.cjs');
const {SocialCompanion,scopeFor}=require('../src/bot/social-companion.cjs');
const defer=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};},turn=()=>new Promise(r=>setImmediate(r));
function setup(options={}){
  const calls=[],context={accountId:'ju',service:{socialReply:async(text,o)=>{calls.push({text,...o});return options.reply?options.reply(text,o):{outcome:'reply_ended'};}},dispatcher:{},scope:'fixed-owner',character:'ju',settings:'config',generation:1,client:{},clientGeneration:1,socket:{},owner:'200001',self:'100001'};
  const value={current:context},manager=new DesktopChat({getContext:()=>value.current,prepare:options.prepare});
  const state=manager.snapshot(),session=manager.open({accountId:'ju',contextId:state.contextId,panelId:'panel-1'});
  const send=(text='你好',requestId='request-1')=>manager.send({...session,requestId,text});
  return {manager,context,value,calls,session,send};
}
test('one local turn returns only a status and duplicate request never reaches the model twice',async()=>{
  const h=setup();assert.deepEqual(await h.send(),{outcome:'reply_ended',started:true});assert.equal(h.calls.length,1);assert.deepEqual(Object.keys(h.calls[0]).sort(),['signal','text']);
  await assert.rejects(h.send(),{code:'duplicate'});assert.equal(h.calls.length,1);
});
test('setup admission rejects the second click without cancelling the first',async()=>{
  const gate=defer(),h=setup({prepare:()=>gate.promise});const first=h.send();await assert.rejects(h.send('第二句','second'),{code:'busy'});gate.resolve();assert.equal((await first).outcome,'reply_ended');assert.equal(h.calls.length,1);assert.equal(h.calls[0].text,'你好');
});
test('stop during pending setup retains the draft and never starts a model',async()=>{
  const gate=defer(),h=setup({prepare:()=>gate.promise});const pending=h.send();assert.deepEqual(h.manager.cancel({...h.session,requestId:'request-1'}),{cancelled:true});gate.resolve();assert.deepEqual(await pending,{outcome:'cancelled',started:false});assert.equal(h.calls.length,0);
});
test('a stopped model late success is suppressed, and stale stop cannot abort the next request',async()=>{
  const gate=defer(),h=setup({reply:()=>gate.promise});const first=h.send();await turn();h.manager.cancel({...h.session,requestId:'request-1'});gate.resolve({outcome:'reply_ended',text:'late'});assert.equal((await first).outcome,'cancelled');
  h.context.service.socialReply=async(_text,{signal})=>{assert.equal(h.manager.cancel({...h.session,requestId:'request-1'}).cancelled,false);assert.equal(signal.aborted,false);return {outcome:'reply_ended'};};assert.equal((await h.send('again','request-2')).outcome,'reply_ended');
});
test('each account, owner, character, generation, socket and dispatcher change invalidates pending setup',async()=>{
  for(const field of ['accountId','owner','character','settings','generation','clientGeneration','socket','dispatcher','service','scope']){
    const gate=defer(),h=setup({prepare:()=>gate.promise}),pending=h.send();h.value.current={...h.context,[field]:{new:true}};h.manager.observe();gate.resolve();assert.equal((await pending).outcome,'cancelled',field);assert.equal(h.calls.length,0,field);
  }
});
test('same-context observations do not invalidate a panel or pending text',async()=>{
  const h=setup(),id=h.manager.snapshot().contextId;for(let i=0;i<10;i++){h.value.current={...h.context};assert.equal(h.manager.snapshot().contextId,id);}assert.equal((await h.send()).outcome,'reply_ended');
});
test('old panel close and stop cannot cancel a newly opened panel',async()=>{
  const h=setup(),next=h.manager.open({accountId:'ju',contextId:h.session.contextId,panelId:'replacement'});h.manager.close(h.session);h.manager.cancel({...h.session,requestId:'request-1'});assert.equal((await h.manager.send({...next,requestId:'fresh',text:'新面板'})).outcome,'reply_ended');
});
test('visibility or availability loss cancels the local operation and removes its session',async()=>{
  const gate=defer(),h=setup({reply:()=>gate.promise}),pending=h.send();await turn();h.value.current=null;assert.equal(h.manager.snapshot().available,false);gate.resolve({outcome:'reply_ended'});assert.equal((await pending).outcome,'cancelled');assert.equal(h.manager.session,null);
});
test('invalid inputs, provider errors and inherited error names never expose raw data',async()=>{
  for(const text of ['', ' '.repeat(3),'a'.repeat(2001),'nul\0']){const h=setup();await assert.rejects(h.send(text),{code:'invalid_text'});assert.equal(h.calls.length,0);}
  const h=setup({reply:()=>{throw Object.assign(Error('PRIVATE_KEY_BODY'),{code:'constructor'});}});const result=await desktopChatResult(()=>h.send());assert.deepEqual(result,{ok:false,code:'reply_failed'});assert(!JSON.stringify(result).includes('PRIVATE'));
  await assert.rejects(h.manager.send({...h.session,requestId:'extra',text:'hello',owner:'external'}),{code:'invalid_request'});
});
test('local text uses real companion memory and a no-tools request callback, without any transport send',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-local-text-')),store=new SocialStore({root:dir});store.configure({enabled:true,proactiveMessages:false,qzonePosts:false});const scope=scopeFor('100001','200001','claude-ju'),requests=[],sends=[];
  const engine=new SocialCompanion({store,scope,tickMs:0,flow:{debounceMs:0,bubbleDelayMs:0},execute:async args=>{requests.push(args.prompt);assert.deepEqual(await args.request({kind:'permission'}),{allow:false});return {outcome:'reply_ended',text:'桌面回答。'};},send:async(...args)=>{sends.push(args);},sendProactive:async(...args)=>{sends.push(args);}});
  t.after(async()=>{await engine.stop();const target=path.resolve(dir);assert(target.startsWith(path.resolve(os.tmpdir())+path.sep)&&path.basename(target).startsWith('arcade-local-text-'));fs.rmSync(target,{recursive:true,force:true});});
  store.append(scope,{id:'in:prior',role:'user',text:'上次聊过海边。'});
  const h=setup();h.context.service.socialReply=(text,opts)=>engine.respondLocally(text,opts);
  assert.equal((await h.send('接着聊')).outcome,'reply_ended');assert.equal(sends.length,0);assert.match(requests[0],/上次聊过海边/);const rows=store.history(scope,30);assert(rows.some(r=>r.id.startsWith('local:')));assert(rows.some(r=>r.id.startsWith('local-out:')));assert.equal(store.history(scopeFor('100003','200001','claude-ju'),30).length,0);
});

test('retiring an unavailable empty conversation never publishes unrelated application state',()=>{
  let notices=0;const manager=new DesktopChat({getContext:()=>null,onChange:()=>{notices++;throw Error('Empty retirement must not publish');}});
  assert.deepEqual(manager.snapshot(),{available:false,contextId:null,imageSupported:false});
  for(let n=0;n<3;n++)assert.doesNotThrow(()=>manager.retire());
  assert.equal(notices,0);assert.equal(manager.session,null);
});
test('retiring a known context without an open panel still rotates admission and notifies once',()=>{
  const h=setup();h.manager.close(h.session);let notices=0;h.manager.onChange=()=>{notices++;};
  const before=h.manager.snapshot();h.manager.retire();const after=h.manager.snapshot();
  assert.equal(after.available,true);assert.notEqual(after.contextId,before.contextId);assert.equal(notices,1);
  assert.throws(()=>h.manager.open({accountId:'ju',contextId:before.contextId,panelId:'old'}),{code:'changed'});
  assert(h.manager.open({accountId:'ju',contextId:after.contextId,panelId:'new'}).sessionId);
});
