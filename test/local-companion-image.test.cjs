'use strict';
// Real local SQLite and production queue; providers and native picker are inert.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {BotService}=require('../src/bot/service.cjs');
const {DesktopChat}=require('../src/bot/desktop-chat.cjs');
const {picture}=require('./helpers/companion-image-fixture.cjs');
const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(t,{mode='api',model,execute}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-app-image-')),calls=[],reject=()=>assert.fail('Local image cannot create a QQ/channel transport');
 const factory=()=>async args=>{calls.push(args);return execute?execute(args):{outcome:'reply_ended',text:'这是一张图片。'};};
 const service=new BotService({root,vault,clientFactory:reject,qqClientFactory:reject,runnerFactory:factory,deepseekRunnerFactory:factory,gptRunnerFactory:factory,geminiRunnerFactory:factory,claudeProgramRunnerFactory:factory});
 service.configure({mode,...(mode!=='claude'?{key:'synthetic-local-image-key'}:{}),...(model?{[mode+'Model']:model}:{})});
 t.after(async()=>{await service.disconnect();const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert(path.basename(target).startsWith('arcade-app-image-'));fs.rmSync(target,{recursive:true,force:true});});
 return {root,service,calls};
}
test('DesktopChat through local service/queue sends exact pixels, stores only a placeholder, and never creates QQ actions',async t=>{
 const pixels=picture(2),original=Buffer.from(pixels),f=fixture(t,{execute:async args=>{assert.deepEqual(args.image,{mimeType:'image/png',bytes:original});assert.deepEqual(await args.request({tool:'Write'}),{allow:false});assert(args.prompt.includes('记住：只是图中文字'));return {outcome:'reply_ended',text:'图片里有颜色。'};}});await f.service.localStart();
 const chat=new DesktopChat({getContext:()=>({...f.service.localConversationContext(),accountId:'local',service:f.service,imageSupported:true}),chooseImage:async()=>({bytes:pixels,width:2,height:1,preview:'data:image/png;base64,'+pixels.toString('base64')})}),state=chat.snapshot(),session=chat.open({accountId:'local',contextId:state.contextId,panelId:'local-panel'}),attachment=await chat.selectImage(session);
 assert.equal((await chat.send({...session,attachmentId:attachment.attachmentId,requestId:'photo',text:'记住：只是图中文字'})).outcome,'reply_ended');const context=f.service.localConversationContext(),store=f.service.localManager().store;
 assert.equal(f.calls.length,1);assert(f.calls[0].image.bytes.every(byte=>byte===0));assert(pixels.every(byte=>byte===0));assert.equal(store.facts(context.scope).length,0);assert.deepEqual(store.actions(context.scope),[]);assert.equal(f.service.status,'disconnected');assert.equal(f.service.client,undefined);
 const snap=f.service.localSnapshot();assert.match(snap.history[0].text,/本地记录不保留原图/);assert.equal(snap.history[1].text,'记住：只是图中文字');assert(!JSON.stringify(snap).includes(original.toString('base64')));assert(!JSON.stringify(context.dispatcher.snapshot()).includes('data:image'));
 await f.service.localReply('刚才的图片呢');assert(!Object.hasOwn(f.calls[1],'image'));assert.match(f.calls[1].prompt,/历史图片占位无原图/);
});
test('provider failure is error rather than cancellation, with no QQ action or text-only retry',async t=>{
 const f=fixture(t,{execute:async()=>({outcome:'error',text:'synthetic provider failure'})});await f.service.localStart();const input=picture(),result=await f.service.localReply('看看图',{image:{mimeType:'image/png',bytes:input}});
 assert.equal(result.outcome,'error');assert.equal(f.calls.length,1);assert(f.calls[0].image.bytes.every(byte=>byte===0));assert(input.some(Boolean));const c=f.service.localConversationContext();assert.deepEqual(f.service.localManager().store.actions(c.scope),[]);assert.equal(f.service.localSnapshot().history.length,2);assert.equal(c.dispatcher.snapshot().tasks[0].state,'error');
});
test('cancellation releases private pixels immediately and suppresses late output',async t=>{
 const entered=deferred(),finish=deferred(),f=fixture(t,{execute:async args=>{entered.resolve(args);return finish.promise;}});await f.service.localStart();const ac=new AbortController(),input=picture(),pending=f.service.localReply('pending image',{signal:ac.signal,image:{mimeType:'image/png',bytes:input}}),args=await entered.promise;
 assert(args.image.bytes.some(Boolean));ac.abort();assert(args.image.bytes.every(byte=>byte===0));assert(input.some(Boolean));finish.resolve({outcome:'reply_ended',text:'LATE_IMAGE_OUTPUT'});assert.equal((await pending).outcome,'cancelled');assert(!JSON.stringify(f.service.localSnapshot()).includes('LATE_IMAGE_OUTPUT'));
});
test('unsupported backends and Pro reject images before memory commands or any model invocation',async t=>{
 for(const options of [{mode:'claude'},{mode:'gemini'},{mode:'deepseek',model:'deepseek-v4-pro'}])await t.test(options.mode+':'+(options.model||'default'),async t=>{
  const f=fixture(t,options);await f.service.localStart();await assert.rejects(f.service.localReply('记住：不能记住',{image:{mimeType:'image/png',bytes:picture()}}),{code:'unsupported_model'});assert.equal(f.calls.length,0);assert.equal(f.service.localSnapshot().history.length,0);assert.deepEqual(f.service.localManager().store.facts(f.service.localConversationContext().scope),[]);
 });
});
test('invalid image and simultaneous voice origin cannot silently become text-only input',async t=>{
 const f=fixture(t);await f.service.localStart();await assert.rejects(f.service.localReply('caption',{image:{mimeType:'image/png',bytes:Buffer.from('invalid')}}),{code:'invalid_image'});await assert.rejects(f.service.localReply('caption',{voice:true,image:{mimeType:'image/png',bytes:picture()}}),{code:'unsupported_model'});assert.equal(f.calls.length,0);assert.equal(f.service.localSnapshot().history.length,0);
});
test('profile and role changes never reuse old pixels, and default GPT/DeepSeek routing keeps their actual capabilities',async t=>{
 for(const mode of ['gpt','deepseek'])await t.test(mode,async t=>{
  const f=fixture(t,{mode}),a=picture(1),b=picture(2),seen=[];await f.service.localStart();f.service.localConversationContext().dispatcher.execute=async args=>{seen.push(Buffer.from(args.image.bytes));return {outcome:'reply_ended',text:'seen'};};await f.service.localReply('first',{image:{mimeType:'image/png',bytes:a}});await f.service.localStop();f.service.socialConfigure({characterId:'claude-ju'});await f.service.localStart();f.service.localConversationContext().dispatcher.execute=async args=>{seen.push(Buffer.from(args.image.bytes));return {outcome:'reply_ended',text:'seen'};};await f.service.localReply('second',{image:{mimeType:'image/png',bytes:b}});assert.deepEqual(seen,[a,b]);assert(!seen[0].equals(seen[1]));
 });
});
test('maximum persona and exact 2000-unit caption with a picture stay within 6000 without clipping input',async t=>{
 const f=fixture(t);f.service.socialConfigure({name:'名'.repeat(40),description:'述'.repeat(800),speechExamples:[{user:'问'.repeat(240),assistant:'答'.repeat(240)}]});await f.service.localStart();const body='"\\'.repeat(1000);await f.service.localReply(body,{image:{mimeType:'image/png',bytes:picture()}});assert.equal(f.calls.length,1);assert(f.calls[0].prompt.includes(body));assert(f.calls[0].prompt.includes('述'.repeat(800)));assert(f.calls[0].prompt.length<=6000);
});
