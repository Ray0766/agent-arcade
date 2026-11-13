'use strict';
// Pure fake providers and generated PCM; no process, device, model or account.
const test=require('node:test'),assert=require('node:assert/strict');
const {QQVoiceRenderer}=require('../src/voice/qq-render.cjs');
const {canonicalWav}=require('../src/bot/qq-voice-payload.cjs');
const {wav}=require('./helpers/fixture-wav.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
function fixture({render,close}={}){
  const providers=[];const renderer=new QQVoiceRenderer({createSpeech(){const provider={calls:[],closes:0,async render(text,options){this.calls.push({text,options});return render?render(this):{wav:canonicalWav(wav()).bytes};},async close(){this.closes++;return close?.(this);}};providers.push(provider);return provider;}});
  return {renderer,providers};
}
test('render returns canonical 32 kHz WAV only after closing its exact provider; each later job owns a fresh provider',async()=>{
  const gate=deferred();let source;const f=fixture({render:()=>{source=canonicalWav(wav()).bytes;return {wav:source};},close:()=>gate.promise});
  let returned=false;const pending=f.renderer.render('原创测试。').then(value=>{returned=true;return value;});await tick();assert.equal(f.renderer.busy,true);assert.equal(returned,false);assert.equal(f.providers[0].closes,1);assert(source.every(byte=>byte===0));
  gate.resolve();const result=await pending;assert.equal(canonicalWav(result).sampleRate,32000);assert(result.subarray(44).some(byte=>byte!==0));assert.equal(f.renderer.busy,false);
  assert.equal(f.providers[0].calls[0].options.voice,'Serena');assert.equal(f.providers[0].calls[0].options.locale,'zh-CN');
  await f.renderer.render('第二次');assert.equal(f.providers.length,2);assert.equal(f.providers[1].closes,1);
});
test('invalid text and lone surrogates do not construct a provider; normal multiline matches the worker contract',async()=>{
  const f=fixture();for(const text of ['', ' ', '字'.repeat(121),'😀'.repeat(121),'x\0y','x\u000by','\ud800',null])await assert.rejects(f.renderer.render(text),{code:'voice_render_limit'});
  assert.equal(f.providers.length,0);for(const text of ['😀'.repeat(120),'第一行\n第二行\r\n\t缩进','x\u200by'])assert(Buffer.isBuffer(await f.renderer.render(text)));
});
test('a shared busy gate rejects another account intent instead of launching concurrent providers',async()=>{
  const gate=deferred(),f=fixture({render:()=>gate.promise}),pending=f.renderer.render('第一位');await tick();
  await assert.rejects(f.renderer.render('第二位'),{code:'voice_render_busy'});assert.equal(f.providers.length,1);
  gate.resolve({wav:canonicalWav(wav()).bytes});await pending;assert.equal(f.renderer.busy,false);
});
test('abort before dispatch does not construct any provider or return a buffer',async()=>{
  const f=fixture(),controller=new AbortController(),pending=f.renderer.render('测试',{signal:controller.signal});controller.abort();await assert.rejects(pending,{code:'cancelled'});assert.equal(f.providers.length,0);assert.equal(f.renderer.busy,false);
});
test('cancel waits for actual close, suppresses noncooperative late render and clears its WAV',async()=>{
  const generation=deferred(),exit=deferred(),f=fixture({render:()=>generation.promise,close:()=>exit.promise}),pending=f.renderer.render('测试'),rejected=assert.rejects(pending,{code:'cancelled'});await tick();
  let cancelled=false;const cancelling=f.renderer.cancel().then(result=>{cancelled=true;return result;});await tick();assert.equal(cancelled,false);assert.equal(f.renderer.busy,true);assert.equal(f.providers[0].calls[0].options.signal.aborted,true);
  await assert.rejects(f.renderer.render('不可并行'),{code:'voice_render_busy'});exit.resolve();assert.deepEqual(await cancelling,{cancelled:true});await rejected;assert.equal(f.renderer.busy,false);assert.equal(f.providers[0].closes,1);
  const late=canonicalWav(wav()).bytes;generation.resolve({wav:late});await tick();assert(late.every(byte=>byte===0));
});
test('cancel after generation while closing wipes the completed result rather than returning it',async()=>{
  const exit=deferred(),f=fixture({close:()=>exit.promise}),pending=f.renderer.render('测试'),rejected=assert.rejects(pending,{code:'cancelled'});await tick();const cancelling=f.renderer.cancel();exit.resolve();await cancelling;await rejected;assert.equal(f.renderer.busy,false);
});
test('unconfirmed close keeps the host reference and busy gate until explicit cancel confirms exit',async()=>{
  let confirmed=false;const f=fixture({close:()=>{if(!confirmed)throw Object.assign(Error('PRIVATE native details'),{code:'voice_exit_timeout'});}});
  await assert.rejects(f.renderer.render('测试'),error=>error.code==='voice_render_exit_unconfirmed'&&!error.message.includes('PRIVATE'));assert.equal(f.renderer.busy,true);assert.equal(f.providers[0].closes,1);
  await assert.rejects(f.renderer.render('重试不可新建'),{code:'voice_render_busy'});await assert.rejects(f.renderer.cancel(),{code:'voice_render_exit_unconfirmed'});assert.equal(f.providers.length,1);assert.equal(f.renderer.busy,true);
  confirmed=true;await f.renderer.cancel();assert.equal(f.renderer.busy,false);assert.equal(f.providers[0].closes,3);await f.renderer.render('现在可新建');assert.equal(f.providers.length,2);
});
test('provider failures are sanitized, always close, and never return partial audio',async()=>{
  for(const [code,expected]of [['voice_assets','voice_render_unavailable'],['voice_limit','voice_render_limit'],['voice_timeout','voice_render_timeout'],['PRIVATE_TOKEN','voice_render_failed']]){
    const f=fixture({render:()=>{throw Object.assign(Error('PRIVATE raw failure'),{code});}});await assert.rejects(f.renderer.render('测试'),error=>error.code===expected&&!error.message.includes('PRIVATE'));assert.equal(f.providers[0].closes,1);assert.equal(f.renderer.busy,false);
  }
});
test('invalid output, mismatched WAV rate, oversize and silence are never sent to the caller',async()=>{
  for(const make of [()=>null,()=>Buffer.from('not a WAV'),()=>canonicalWav(wav({rate:16000})).bytes,()=>Buffer.alloc(4*1024*1024+1),()=>{const b=canonicalWav(wav()).bytes;b.fill(0,44);return b;}]){
    let source;const f=fixture({render:()=>{source=make();return {wav:source};}});await assert.rejects(f.renderer.render('测试'),error=>['voice_render_failed','voice_render_limit'].includes(error.code));if(source)assert(source.every(byte=>byte===0));assert.equal(f.providers[0].closes,1);assert.equal(f.renderer.busy,false);
  }
});
test('an old signal cannot cancel a fresh provider and idle cancellation is harmless',async()=>{
  const f=fixture(),old=new AbortController();await f.renderer.render('旧任务',{signal:old.signal});const next=f.renderer.render('新任务');old.abort();await next;assert.equal(f.providers[1].calls[0].options.signal.aborted,false);assert.deepEqual(await f.renderer.cancel(),{cancelled:true});
});
test('factory failure has a fixed unavailable result and cannot silently use a different provider',async()=>{
  let calls=0;const f=new QQVoiceRenderer({createSpeech(){calls++;throw Object.assign(Error('PRIVATE'),{code:'voice_render_unavailable'});}});await assert.rejects(f.render('测试'),{code:'voice_render_unavailable'});assert.equal(calls,1);assert.equal(f.busy,false);assert.throws(()=>new QQVoiceRenderer(),{code:'voice_render_unavailable'});
});
test('active cancellation with an unconfirmed exit stays blocked and never returns a late WAV',async()=>{
  const generation=deferred();let confirmed=false;const f=fixture({render:()=>generation.promise,close:()=>{if(!confirmed)throw Object.assign(Error('PRIVATE'),{code:'voice_exit_timeout'});}});
  const pending=f.renderer.render('测试'),rejected=assert.rejects(pending,{code:'voice_render_exit_unconfirmed'});await tick();await assert.rejects(f.renderer.cancel(),{code:'voice_render_exit_unconfirmed'});await rejected;
  assert.equal(f.renderer.busy,true);assert.equal(f.providers[0].closes,1);await assert.rejects(f.renderer.render('不重复启动'),{code:'voice_render_busy'});
  confirmed=true;await f.renderer.cancel();assert.equal(f.renderer.busy,false);const late=canonicalWav(wav()).bytes;generation.resolve({wav:late});await tick();assert(late.every(value=>value===0));
});

test('progress distinguishes protocol readiness from synthesis and never publishes raw diagnostics or a premature result',async()=>{
  const generation=deferred(),exit=deferred(),f=fixture({render:()=>generation.promise,close:()=>exit.promise});
  assert.deepEqual(f.renderer.progress(),{stage:'idle'});const pending=f.renderer.render('私有文字');await tick();
  let events=[{event:'ready',id:'PRIVATE_ID',text:'PRIVATE_TEXT',path:'PRIVATE_PATH'}];f.providers[0].diagnostics=()=>({events,private:'PRIVATE_TOKEN'});
  assert.deepEqual(f.renderer.progress(),{stage:'preparing'});events.push({event:'render-start',id:'PRIVATE_ID'});assert.deepEqual(f.renderer.progress(),{stage:'generating'});
  let received=false;const final=pending.then(value=>{received=true;return value;});generation.resolve({wav:canonicalWav(wav()).bytes});await tick();assert.deepEqual(f.renderer.progress(),{stage:'finalizing'});assert.equal(received,false);
  exit.resolve();await final;assert.deepEqual(f.renderer.progress(),{stage:'idle'});
});

test('late synthesis events cannot replace stopping or an unconfirmed exit; observer failure does not change the job',async()=>{
  const generation=deferred(),exit=deferred(),f=fixture({render:()=>generation.promise,close:()=>exit.promise});const pending=f.renderer.render('测试'),rejected=assert.rejects(pending,{code:'voice_render_exit_unconfirmed'});await tick();
  f.providers[0].diagnostics=()=>{throw Error('PRIVATE_DETAIL');};assert.deepEqual(f.renderer.progress(),{stage:'preparing'});
  const cancel=f.renderer.cancel();f.providers[0].diagnostics=()=>({events:[{event:'render-start'}]});assert.deepEqual(f.renderer.progress(),{stage:'stopping'});
  const cancelled=assert.rejects(cancel,{code:'voice_render_exit_unconfirmed'});
  exit.reject(Error('PRIVATE_EXIT'));await cancelled;await rejected;
  assert.deepEqual(f.renderer.progress(),{stage:'stop_unconfirmed'});assert.equal(f.renderer.busy,true);
  f.providers[0].close=async()=>{};await f.renderer.cancel();generation.resolve({wav:canonicalWav(wav()).bytes});await tick();assert.deepEqual(f.renderer.progress(),{stage:'idle'});
});
