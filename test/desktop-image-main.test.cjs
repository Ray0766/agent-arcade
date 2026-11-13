'use strict';
// Actual registered main/preload boundary with a synthetic picker and decoder.
// No native dialog, model, QQ connection or user file is opened here.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {localMainHarness}=require('./helpers/desktop-local-main-harness.cjs');
const {png,native}=require('./helpers/fixture-image.cjs');
const {canonicalImage}=require('../src/bot/qq-media.cjs');
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function setup(options={}){
  const calls=[],raws=[],prepared=[];
  const h=localMainHarness({
    imagePicker:async(win,settings)=>{calls.push({kind:'picker',win,settings});return options.picker?options.picker():{canceled:false,filePaths:['F:\\synthetic-only\\picture.png']};},
    imageRead:async(file,signal)=>{calls.push({kind:'read',file,signal});const raw=options.read?await options.read(signal):png(2,2,{metadata:true});raws.push(raw);return raw;},
    imagePrepare:(bytes,extension)=>{calls.push({kind:'prepare',extension});const image=canonicalImage(bytes,extension,native());prepared.push(image);return image;}
  });
  return {...h,imageCalls:calls,raws,prepared};
}
async function openLocal(h){h.a.status='disconnected';h.a.client=null;h.a.socialScope=null;assert.equal((await h.choose()).ok,true);const {ok,sessionId,contextId}=await h.open();assert.equal(ok,true);return {sessionId,contextId};}
test('actual local image IPC uses native selection, strips metadata and sends once to App only',async()=>{
  const h=setup(),session=await openLocal(h);assert.equal(h.api.desktopChat.snapshot().imageSupported,true);
  const selected=await h.invoke('desktopChatSelectImage',session);assert.equal(selected.ok,true);assert.equal(selected.width,2);assert.equal(selected.height,2);
  assert.match(selected.preview,/^data:image\/png;base64,/);assert.doesNotMatch(JSON.stringify(selected),/synthetic-only|picture.png|PRIVATE_FIXTURE_METADATA/);
  assert(h.raws[0].every(byte=>byte===0));assert.equal(h.imageCalls[0].win,h.win);
  assert.deepEqual(Array.from(h.imageCalls[0].settings.properties),['openFile','dontAddToRecent']);
  let sentPixels;
  h.a.localReply=async(text,options)=>{assert.equal(text,'请描述图形');sentPixels=Buffer.from(options.image.bytes);return {outcome:'reply_ended'};};
  const reply=await h.invoke('desktopChatSend',{...session,requestId:'image-turn',text:'请描述图形',attachmentId:selected.attachmentId});
  assert.equal(reply.outcome,'reply_ended');assert(sentPixels.length>0);assert(!sentPixels.includes(Buffer.from('PRIVATE_FIXTURE_METADATA')));
  assert(h.prepared[0].bytes.every(byte=>byte===0));assert.equal(h.calls.filter(x=>x.kind==='channel').length,0);
  assert.doesNotMatch(JSON.stringify(h.api.fullSnapshot()),/data:image|attachmentId|synthetic-only|picture.png/);
});
test('cancelled native picker neither reads a file nor calls the model',async()=>{
  const h=setup({picker:()=>({canceled:true,filePaths:[]})}),session=await openLocal(h);
  const result=await h.invoke('desktopChatSelectImage',session);assert.equal(result.ok,true);assert.equal(result.cancelled,true);assert.equal(h.raws.length,0);assert.equal(h.calls.filter(x=>x.text).length,0);
});
test('account switch while native picker is open retires result before any file read',async()=>{
  const gate=deferred(),h=setup({picker:()=>gate.promise}),session=await openLocal(h);
  const pending=h.invoke('desktopChatSelectImage',session);await tick();assert.equal(h.imageCalls.length,1);
  await h.invoke('accountSelect','b');gate.resolve({canceled:false,filePaths:['F:\\synthetic-only\\late.png']});
  const result=await pending;assert.equal(result.ok,false);assert(['changed','cancelled'].includes(result.code));assert.equal(h.raws.length,0);assert.equal(h.prepared.length,0);
});
test('late selected-file read after close is cleared without image decoding',async()=>{
  const gate=deferred(),h=setup({read:()=>gate.promise}),session=await openLocal(h);
  const pending=h.invoke('desktopChatSelectImage',session);await tick();assert.equal(h.imageCalls.at(-1).kind,'read');
  await h.invoke('desktopChatClose',session);const bytes=png();gate.resolve(bytes);const result=await pending;
  assert.equal(result.ok,false);assert(['changed','cancelled'].includes(result.code));assert(bytes.every(byte=>byte===0));assert.equal(h.prepared.length,0);
});
test('picker validation rejects multiple paths and decoder failures as fixed image codes',async()=>{
  const h=setup({picker:()=>({canceled:false,filePaths:['one.png','two.png']})}),session=await openLocal(h);
  assert.equal((await h.invoke('desktopChatSelectImage',session)).code,'invalid_image');assert.equal(h.raws.length,0);
  const invalid=setup({read:async()=>Buffer.from('PRIVATE_INVALID_PIXELS')}),other=await openLocal(invalid);
  const result=await invalid.invoke('desktopChatSelectImage',other);assert.equal(result.ok,false);assert.equal(result.code,'invalid_image');assert(!JSON.stringify(result).includes('PRIVATE'));assert(invalid.raws[0].every(x=>x===0));
});
test('hidden window, nonlocal source and untrusted sender cannot open a picker',async()=>{
  const h=setup(),opened=await h.open(),channel={sessionId:opened.sessionId,contextId:opened.contextId};assert.equal(h.api.desktopChat.snapshot().imageSupported,false);
  assert.equal((await h.invoke('desktopChatSelectImage',channel)).ok,false);
  const local=await openLocal(h);h.windowState.minimized=true;
  assert.equal((await h.invoke('desktopChatSelectImage',local)).ok,false);h.windowState.minimized=false;
  await assert.rejects(h.invoke('desktopChatSelectImage',local,{untrusted:true}),/Untrusted sender/);
  assert.equal(h.imageCalls.length,0);
});
test('model capability is checked in the actual local context without starting QQ',async()=>{
  for(const [mode,model,capable] of [['api',undefined,true],['gpt','gpt-6.1-sol',true],['gpt','unregistered-model',false],['deepseek','deepseek-flash',true],['deepseek','deepseek-pro',false],['gemini','current-model',false],['claude',undefined,false]]){
    const h=setup();h.a.config.mode=mode;if(model)h.a.config[mode+'Model']=model;const session=await openLocal(h);
    assert.equal(h.api.desktopChat.snapshot().imageSupported,capable,mode+':'+model);
    if(!capable){assert.equal((await h.invoke('desktopChatSelectImage',session)).ok,false);assert.equal(h.imageCalls.length,0);}
    h.api.desktopChat.closeCurrent();
  }
});
