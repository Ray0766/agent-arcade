'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {DesktopChat,desktopChatResult}=require('../src/bot/desktop-chat.cjs');
const {picture}=require('./helpers/companion-image-fixture.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function image(width=1){const bytes=picture(width);return {bytes,width,height:1,preview:'data:image/png;base64,'+bytes.toString('base64')};}
function fixture(options={}){
 const calls=[],context={kind:'local',accountId:'ju',service:{localReply:async(text,args)=>{calls.push({text,...args});return options.reply?options.reply(text,args):{outcome:'reply_ended'};},socialReply:()=>assert.fail('No image can reach a channel')},dispatcher:{},scope:'local-scope',character:'claude-ju',settings:'settings',generation:1,imageSupported:true};
 const current={value:context},manager=new DesktopChat({getContext:()=>current.value,chooseImage:options.chooseImage||(async()=>image()),prepare:options.prepare});
 const open=()=>manager.open({accountId:current.value.accountId,contextId:manager.snapshot().contextId,panelId:'image-panel'}),session=open();
 const send=(value={})=>manager.send({...session,requestId:'image-request',text:'看看这张图',...value});
 return {manager,current,context,calls,session,send,open};
}
test('canonical selection is private, consumed once, and only sends the selected local image',async()=>{
 const selected=image(),copy=Buffer.from(selected.bytes),h=fixture({chooseImage:async()=>selected,reply:async(_text,args)=>{assert.deepEqual(args.image,{mimeType:'image/png',bytes:copy});return {outcome:'reply_ended'};}});
 const attachment=await h.manager.selectImage(h.session);assert.equal(h.manager.snapshot().imageSupported,true);assert.equal(attachment.bytes,copy.length);assert.equal(attachment.preview,selected.preview);assert(!JSON.stringify(h.manager.snapshot()).includes('data:image'));
 assert.deepEqual(await h.send({attachmentId:attachment.attachmentId}),{outcome:'reply_ended',started:true});assert(selected.bytes.every(byte=>byte===0));assert.equal(h.calls.length,1);
 await assert.rejects(h.send({requestId:'second',attachmentId:attachment.attachmentId}),{code:'stale_attachment'});assert.equal(h.calls.length,1);
});
test('cancelled picker and invalid removal preserve the old attachment; text does not consume it',async()=>{
 const original=image(),choices=[original,null],h=fixture({chooseImage:async()=>choices.shift()});const attached=await h.manager.selectImage(h.session);
 assert.deepEqual(await h.manager.selectImage(h.session),{cancelled:true});assert(original.bytes.some(Boolean));
 await assert.rejects(h.send({attachmentId:'wrong'}),{code:'stale_attachment'});assert.throws(()=>h.manager.removeImage({...h.session,attachmentId:'wrong'}),{code:'stale_attachment'});
 await h.send();assert(!Object.hasOwn(h.calls[0],'image'));assert(original.bytes.some(Boolean));
 assert.deepEqual(h.manager.removeImage({...h.session,attachmentId:attached.attachmentId}),{removed:true});assert(original.bytes.every(byte=>byte===0));
});
test('picker admission rejects sends and reentry; late data after close cannot attach to a new session',async()=>{
 const pick=deferred(),late=image(),h=fixture({chooseImage:()=>pick.promise}),pending=h.manager.selectImage(h.session);
 await assert.rejects(h.send(),{code:'busy'});await assert.rejects(h.manager.selectImage(h.session),{code:'busy'});
 h.manager.close(h.session);const next=h.open();pick.resolve(late);await assert.rejects(pending,{code:'cancelled'});assert(late.bytes.every(byte=>byte===0));
 assert.equal((await h.manager.send({...next,requestId:'new-request',text:'新一轮'})).outcome,'reply_ended');assert(!Object.hasOwn(h.calls[0],'image'));
});
test('account, role, generation, capability and source changes erase a held image and abort its picker',async()=>{
 for(const field of ['accountId','character','generation','imageSupported','kind']){
  const held=image(),late=image(2),pick=deferred(),choices=[held],h=fixture({chooseImage:()=>choices.length?choices.shift():pick.promise});const attachment=await h.manager.selectImage(h.session),pending=h.manager.selectImage(h.session);
  h.current.value={...h.context,[field]:field==='kind'?'channel':field==='imageSupported'?false:'different'};h.manager.observe();assert(held.bytes.every(byte=>byte===0),field);pick.resolve(late);await assert.rejects(pending,{code:'cancelled'});assert(late.bytes.every(byte=>byte===0),field);
  await assert.rejects(h.send({attachmentId:attachment.attachmentId}),{code:'changed'});
 }
});
test('prepare failure and cancellation release only the consumed attachment without calling a model',async()=>{
 for(const cancelled of [false,true]){
  const bytes=image(),gate=deferred(),h=fixture({chooseImage:async()=>bytes,prepare:()=>gate.promise});const attached=await h.manager.selectImage(h.session),pending=h.send({attachmentId:attached.attachmentId});
  if(cancelled)h.manager.cancel({...h.session,requestId:'image-request'});gate.reject(Error('synthetic preparation failed'));
  if(cancelled)assert.deepEqual(await pending,{outcome:'cancelled',started:false});else await assert.rejects(pending,{code:'prepare_failed'});
  assert(bytes.bytes.every(byte=>byte===0));assert.equal(h.calls.length,0);
 }
});
test('running cancellation suppresses a late provider result and never clears another panel attachment',async()=>{
 const gate=deferred(),first=image(),nextImage=image(2),choices=[first,nextImage],h=fixture({chooseImage:async()=>choices.shift(),reply:()=>gate.promise});const a=await h.manager.selectImage(h.session),pending=h.send({attachmentId:a.attachmentId});await turn();h.manager.cancel({...h.session,requestId:'image-request'});assert(first.bytes.every(byte=>byte===0));
 const next=h.open(),b=await h.manager.selectImage(next);gate.resolve({outcome:'reply_ended'});assert.equal((await pending).outcome,'cancelled');assert(nextImage.bytes.some(Boolean));assert.deepEqual(h.manager.removeImage({...next,attachmentId:b.attachmentId}),{removed:true});
});
test('channel and unsupported models never open a picker or fall back to a text request',async()=>{
 for(const kind of ['channel','local']){
  let picks=0;const h=fixture({chooseImage:async()=>{picks++;return image();}});h.current.value={...h.context,kind,imageSupported:kind==='channel'};const session=h.open();assert.equal(h.manager.snapshot().imageSupported,false);
  assert.equal((await desktopChatResult(()=>h.manager.selectImage(session))).code,'image_unsupported');await assert.rejects(h.manager.send({...session,requestId:'refused',text:'caption',attachmentId:'foreign'}),{code:'image_unsupported'});assert.equal(picks,0);assert.equal(h.calls.length,0);
 }
});
test('invalid returned image is cleared and does not replace a valid prior selection',async()=>{
 const first=image(),bad=image(2),choices=[first,bad];bad.width=100;const h=fixture({chooseImage:async()=>choices.shift()}),attached=await h.manager.selectImage(h.session);
 await assert.rejects(h.manager.selectImage(h.session),{code:'invalid_image'});assert(bad.bytes.every(byte=>byte===0));assert(first.bytes.some(Boolean));h.manager.removeImage({...h.session,attachmentId:attached.attachmentId});
});
test('provider errors remain errors and release image bytes; payload cannot inject fields',async()=>{
 const selected=image(),h=fixture({chooseImage:async()=>selected,reply:async()=>({outcome:'error'})}),a=await h.manager.selectImage(h.session);
 await assert.rejects(h.send({attachmentId:a.attachmentId,image:{bytes:picture()}}),{code:'invalid_request'});assert(selected.bytes.some(Boolean));await assert.rejects(h.send({attachmentId:a.attachmentId}),{code:'reply_failed'});assert(selected.bytes.every(byte=>byte===0));
});
