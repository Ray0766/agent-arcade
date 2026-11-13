'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {localMainHarness}=require('./helpers/desktop-local-main-harness.cjs');
const turn=()=>new Promise(resolve=>setImmediate(resolve));
function defer(){let resolve;const promise=new Promise(yes=>{resolve=yes;});return {promise,resolve};}
const speech=close=>({scope:'a:a-qq-scope',snapshot:()=>({mode:'push-to-talk'}),record(){},diagnostics:()=>({speech:{},events:[]}),close});

test('actual local IPC selection admits an offline account and routes only to its local reply',async()=>{
  const h=localMainHarness();h.a.status='disconnected';h.a.client=null;h.a.socialScope=null;
  assert.equal(h.api.desktopChat.snapshot().available,false);
  assert.equal((await h.choose()).kind,'local');
  const context=h.api.desktopChatContext();assert.equal(context.kind,'local');assert.equal(context.scope,'a-local-scope');assert.equal(context.client,undefined);assert.equal(context.owner,undefined);
  const session=await h.open();assert.equal(session.ok,true);assert.equal((await h.send(session)).outcome,'reply_ended');
  assert.deepEqual(h.calls.map(row=>row.kind),['start','local']);assert.equal(h.runtimes.length,0);
});

test('switching back to channel restores the original QQ scope and rejects old local admission',async()=>{
  const h=localMainHarness();await h.choose();const local=await h.open();await h.send(local);
  assert.equal((await h.choose('channel')).kind,'channel');
  const context=h.api.desktopChatContext();assert.equal(context.scope,'a-qq-scope');assert.equal(context.dispatcher,h.a.dispatcher);assert.equal(context.client,h.a.client);assert.equal(context.owner,'owner');
  assert.equal((await h.send(local,'old')).code,'changed');
  const next=await h.open();assert.equal((await h.send(next)).outcome,'reply_ended');assert.deepEqual(h.calls.filter(row=>row.text).map(row=>row.kind),['local','channel']);
});

test('selection IPC rejects false accounts, extra fields, unknown kinds and an untrusted sender',async()=>{
  const h=localMainHarness();
  for(const [value,code] of [[{accountId:'b',kind:'local'},'changed'],[{accountId:'a',kind:'local',ownerId:'other'},'invalid_request'],[{accountId:'a',kind:'qq'},'invalid_request']])assert.equal((await h.invoke('desktopConversationSelect',value)).code,code);
  await assert.rejects(h.invoke('desktopConversationSelect',{accountId:'a',kind:'local'},{untrusted:true}),/Untrusted sender/);
  assert.equal(h.calls.length,0);assert.equal(h.api.desktopConversations.kind(),'channel');
});

test('actual accountSelect invalidates an earlier pending local start before it can own the new profile',async()=>{
  const h=localMainHarness(),gate=defer();h.a.startGate=gate;
  const pending=h.choose();await turn();assert.deepEqual(h.calls.map(row=>row.kind),['start']);
  await h.invoke('accountSelect','b');gate.resolve();assert.equal((await pending).code,'changed');
  assert.equal(h.a.localActive,false);assert.equal(h.api.desktopConversations.kind(),'channel');
  assert.equal((await h.choose()).kind,'local');const session=await h.open();assert.equal((await h.send(session)).outcome,'reply_ended');
  assert.equal(h.calls.filter(row=>row.kind==='local')[0].id,'b');
});

test('changing source waits for its same-account speech and media cleanup before local startup',async()=>{
  const h=localMainHarness(),voiceGate=defer(),mediaGate=defer();let voiceCloses=0,mediaCloses=0;
  h.api.installVoice('a',speech(async()=>{voiceCloses++;await voiceGate.promise;}));
  h.api.installMedia('a',async()=>{mediaCloses++;await mediaGate.promise;});
  const pending=h.choose();await turn();assert.equal(voiceCloses,1);assert.equal(mediaCloses,1);assert.equal(h.calls.length,0);
  voiceGate.resolve();await turn();assert.equal(h.calls.length,0);mediaGate.resolve();assert.equal((await pending).kind,'local');
  assert.deepEqual(h.calls.map(row=>row.kind),['start']);
});

test('actual voiceStart requires an explicit App source before creating any speech runtime',async()=>{
  const h=localMainHarness();await h.choose();const before=h.api.voiceState();
  await assert.rejects(h.invoke('voiceStart',{accountId:'a',panelId:'voice-new',mode:'push-to-talk'}),/App voice conversation changed/);
  assert.equal(h.runtimes.length,0);assert.equal(h.api.voiceState().voice,before.voice);assert.equal(h.api.voiceState().voiceEpoch,before.voiceEpoch);
  assert.equal(h.api.desktopConversations.kind(),'local');
});

test('minimizing the window keeps the local request alive and its admission unchanged',async()=>{
  const h=localMainHarness(),gate=defer();await h.choose();h.a.replyGate=gate;const session=await h.open(),pending=h.send(session);await turn();
  const call=h.calls.find(row=>row.kind==='local');assert(call);h.windowState.visible=false;h.windowState.minimized=true;h.api.publish();
  assert.equal(call.options.signal.aborted,false);assert.equal(h.api.desktopChat.snapshot().contextId,session.contextId);
  gate.resolve();assert.equal((await pending).outcome,'reply_ended');h.windowState.visible=true;h.windowState.minimized=false;assert.equal(h.api.desktopChat.snapshot().contextId,session.contextId);
});

test('a source switch cancels late local output without routing it into the channel',async()=>{
  const h=localMainHarness(),gate=defer();await h.choose();h.a.replyGate=gate;const session=await h.open(),pending=h.send(session);await turn();
  const call=h.calls.find(row=>row.kind==='local');await h.choose('channel');assert.equal(call.options.signal.aborted,true);
  gate.resolve();assert.equal((await pending).outcome,'cancelled');assert.equal(h.calls.filter(row=>row.kind==='channel').length,0);assert.equal(h.api.desktopChatContext().scope,'a-qq-scope');
});

test('actual before-quit retains failed local cleanup and only a second explicit Quit completes exit',async()=>{
  const h=localMainHarness();let attempts=0,owned=true;
  h.a.localStop=async()=>{attempts++;if(attempts===1)throw Error('Synthetic owned cleanup failure');owned=false;};
  h.a.assertLocalStopped=()=>{if(owned)throw Error('Local cleanup remains unconfirmed');};
  const first=await h.quit();assert.equal(first.prevented,1);assert.equal(first.cleanedUp,false);assert.equal(first.quitting,false);
  assert.match(first.problem,/App conversation has not fully stopped/);assert.equal(attempts,1);assert.equal(h.quits.length,0);assert.equal(h.accounts.services.get('a'),h.a);
  const second=await h.quit();assert.equal(second.prevented,1);assert.equal(second.cleanedUp,true);assert.equal(attempts,2);assert.equal(h.quits.length,1);
});
