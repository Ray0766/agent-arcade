'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const {WindowsSpeech}=require('../src/voice/windows-speech.cjs');

test('audio diagnostics accept only bounded active-listener measurements',()=>{
  const speech=new WindowsSpeech({now:()=>123}),seen=[];
  speech.listenOperation='active';speech.pending.set('active',{});speech.on('audio-level',row=>seen.push(row));
  const valid={event:'audio-level',id:'active',current:2,max:7,count:3};
  for(const change of [{id:'old'},{current:-1},{current:101},{max:1},{max:101},{count:1000001},{count:1.5}])speech.receive({...valid,...change});
  assert.equal(seen.length,0);
  speech.receive({...valid,text:'must not persist',pcm:[1,2]});
  assert.deepEqual(seen,[{current:2,max:7,count:3,at:123}]);
  assert.equal(speech.diagnostics().events.length,0,'meters do not crowd out semantic events');
  speech.pending.delete('active');speech.receive(valid);assert.equal(seen.length,1);
});

test('finishing targets only the captured listener and bounds final recognition',async()=>{
  const speech=new WindowsSpeech(),timeouts=[],requests=[];
  const operation={expireIn:(ms,code)=>timeouts.push({ms,code})};speech.listenOperation='old';speech.pending.set('old',operation);
  speech.request=async(op,data)=>{requests.push({op,...data});};
  await speech.finishListening();assert.deepEqual(requests,[{op:'finish-listening',listenId:'old'}]);assert.deepEqual(timeouts,[{ms:5000,code:'voice_timeout'}]);
  speech.request=async()=>{speech.pending.delete('old');speech.listenOperation='new';speech.pending.set('new',{expireIn:()=>{throw Error('stale finish affected new microphone');}});};
  await speech.finishListening();assert.equal(timeouts.length,1);
});

test('audio history is limited to 120 samples and detached from exported diagnostics',()=>{
  const speech=new WindowsSpeech();speech.listenOperation='active';speech.pending.set('active',{});
  for(let count=0;count<200;count++)speech.receive({event:'audio-level',id:'active',current:0,max:0,count});
  const evidence=speech.diagnostics();assert.equal(evidence.audioLevels.length,120);assert.equal(evidence.audioLevels[0].count,80);
  evidence.audioLevels[0].count=999;assert.equal(speech.diagnostics().audioLevels[0].count,80);
});
