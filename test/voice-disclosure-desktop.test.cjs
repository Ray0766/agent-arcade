'use strict';
// Actual main + IPC, synthetic close/model callbacks only.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {mainHarness}=require('./helpers/desktop-chat-main-harness.cjs');
const send=(h,s,id)=>h.invoke('desktopChatSend',{sessionId:s.sessionId,contextId:s.contextId,requestId:id,text:'合成文字问题'});
const speech=close=>({scope:'a:a-owner-scope',snapshot:()=>({mode:'push-to-talk'}),record(){},diagnostics:()=>({speech:{},events:[]}),close});
const tick=()=>new Promise(resolve=>setImmediate(resolve));
test('desktop text waits for its already-running device probe cleanup without starting or sending speech',async()=>{
 let release,closes=0;const gate=new Promise(resolve=>{release=resolve;}),h=mainHarness({capabilityProbe:async options=>{try{await gate;return {};}finally{await options.closeRuntime({close:async()=>{closes++;}});}}});
 const checking=h.api.checkVoiceCapabilities({accountId:'a',panelId:'probe'});await tick();const session=await h.open(),pending=send(h,session,'after-probe');await tick();assert.equal(h.sends.length,0);assert.equal(closes,0);
 release();await checking;assert.equal((await pending).outcome,'reply_ended');assert.equal(closes,1);assert.equal(h.sends.length,1);
});
test('a device probe itself preserves a pending text session and does not invoke a voice turn',async()=>{
 let release;const gate=new Promise(resolve=>{release=resolve;}),h=mainHarness({capabilityProbe:async options=>{try{return {};}finally{await options.closeRuntime({close:async()=>{}});}}});
 h.a.socialReply=async(_text,{signal})=>{await gate;assert.equal(signal.aborted,false);return {outcome:'reply_ended'};};const session=await h.open(),pending=send(h,session,'text');await tick();
 await h.api.checkVoiceCapabilities({accountId:'a',panelId:'probe'});assert.equal(h.api.desktopChat.snapshot().contextId,session.contextId);release();assert.equal((await pending).outcome,'reply_ended');
});
test('text cannot bypass failed own voice shutdown; a later explicit send retries the retained object',async()=>{
 const h=mainHarness();let closes=0;h.api.installVoice('a',speech(async()=>{if(++closes===1)throw Error('Synthetic unconfirmed shutdown');}));
 const session=await h.open(),first=await send(h,session,'first');assert.equal(first.ok,false);assert.equal(h.sends.length,0);assert.equal(closes,1);
 const next=await send(h,session,'retry');assert.equal(next.outcome,'reply_ended');assert.equal(closes,2);assert.equal(h.sends.length,1);
});
test('text in another account does not retry the previous account failed shutdown',async()=>{
 const h=mainHarness();let closes=0;h.api.installVoice('a',speech(async()=>{closes++;throw Error('Synthetic unconfirmed shutdown');}));
 const first=await h.open();assert.equal((await send(h,first,'first')).ok,false);
 h.accounts.selectedId='b';h.api.select(h.b);h.api.desktopChat.observe();const second=await h.open();assert.equal((await send(h,second,'second')).outcome,'reply_ended');assert.equal(closes,1);assert.equal(h.sends[0].id,'b');
});
