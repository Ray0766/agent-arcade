'use strict';
// Streamed replies in the App conversation with an imported character: the in-memory
// `streaming` view of localSnapshot(), its throttled change notifications, and that only the
// final text is ever stored. Injected runner; no network and no model.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,card,deferred}=require('./st-local-fixture.cjs');
const {STREAM_NOTIFY_MS}=require('../src/bot/local-companion.cjs');
const settings=require('../src/bot/st/local-settings.cjs');
const mira=()=>card('Mira',{description:'Keeper of the light.',first_mes:'Hello.'});
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
// A profile whose change notifications are counted, with its library character opened.
async function opened(t,options={}){
  const f=fixture(t,options),a=f.characters.add({card:mira()}),changes={count:0};
  const service=f.make({onChange:()=>{changes.count++;}});service.configure({key:'fixture-api-key'});
  service.stConfigure({characterId:a.id,...(options.settings||{})});await service.localStart();
  return {f,a,service,changes,history:()=>service.localSnapshot().history,streaming:()=>service.localSnapshot().streaming};
}

test('text arrives in the snapshot while the reply is generated; only the final text is stored',async t=>{
  const entered=deferred(),finish=deferred();let deliver;
  const o=await opened(t,{execute:async args=>{deliver=args.onDelta;entered.resolve();return finish.promise;}});
  o.f.regexes.add({scriptName:'reply',findRegex:'RAW',replaceString:'FINAL',placement:[2]});
  assert.equal(STREAM_NOTIFY_MS,150);assert.equal(o.service.stSnapshot().settings.streaming,true);assert.equal(o.streaming(),null);
  const pending=o.service.localReply('question');await entered.promise;
  assert.equal(typeof deliver,'function');assert.deepEqual(o.streaming(),{messageId:null,mode:'reply',text:''});
  deliver('RAW he');assert.deepEqual(o.streaming(),{messageId:null,mode:'reply',text:'RAW he'});
  // Throttle: a burst of deltas makes one immediate notification and at most one deferred one.
  const before=o.changes.count;for(let i=0;i<300;i++)deliver('x');
  assert(o.changes.count-before<=1,'burst notified '+(o.changes.count-before));assert.equal(o.streaming().text,'RAW he'+'x'.repeat(300));
  await sleep(STREAM_NOTIFY_MS+80);const settled=o.changes.count;assert(settled-before>=1&&settled-before<=2,'after the burst '+(settled-before));
  await sleep(STREAM_NOTIFY_MS+50);assert.equal(o.changes.count,settled);
  // Display data only: control characters dropped, non-text ignored, never above the message cap.
  for(const value of [null,5,'','\x00\x07','\rllo'])deliver(value);assert.equal(o.streaming().text,'RAW he'+'x'.repeat(300)+'llo');
  deliver('长'.repeat(9000));assert.equal(o.streaming().text.length,8000);deliver('more');assert.equal(o.streaming().text.length,8000);
  // Nothing of it is stored; the stored reply is the runner's final text after the regex pass.
  assert.deepEqual(o.history().map(row=>row.text),['Hello.','question']);
  finish.resolve({outcome:'reply_ended',text:'RAW hello'});const result=await pending;
  assert.deepEqual([result.outcome,result.text],['reply_ended','FINAL hello']);assert.equal(o.streaming(),null);assert.deepEqual(o.history().map(row=>row.text),['Hello.','question','FINAL hello']);
  // A late delta of the finished turn is ignored.
  deliver('late');assert.equal(o.streaming(),null);await sleep(STREAM_NOTIFY_MS+30);assert.equal(o.streaming(),null);
});

test('the view is cleared when the reply fails, is cancelled, or the conversation stops',async t=>{
  let entered=deferred(),finish=deferred(),deliver;
  const o=await opened(t,{execute:async args=>{deliver=args.onDelta;entered.resolve();return finish.promise;}});
  const next=()=>{entered=deferred();finish=deferred();};
  // Failure.
  let pending=o.service.localReply('one');await entered.promise;deliver('partial');assert.equal(o.streaming().text,'partial');
  finish.resolve({outcome:'error',text:'provider failed'});assert.equal((await pending).outcome,'error');assert.equal(o.streaming(),null);assert(!JSON.stringify(o.history()).includes('partial'));
  // A runner that throws.
  next();pending=o.service.localReply('two');await entered.promise;deliver('partial');finish.reject(Error('boom'));assert.equal((await pending).outcome,'error');assert.equal(o.streaming(),null);
  // A newer owner turn pre-empts the stream; the old runner's late deltas do not touch the new one.
  next();pending=o.service.localReply('three');await entered.promise;deliver('old text');const old=deliver,oldFinish=finish;next();
  const newer=o.service.localReply('four');oldFinish.resolve({outcome:'reply_ended',text:'STALE'});assert.equal((await pending).outcome,'cancelled');await entered.promise;
  old('stale delta');assert.deepEqual(o.streaming(),{messageId:null,mode:'reply',text:''});deliver('new text');assert.equal(o.streaming().text,'new text');
  finish.resolve({outcome:'reply_ended',text:'FOUR'});assert.equal((await newer).text,'FOUR');assert.equal(o.streaming(),null);assert(!JSON.stringify(o.history()).includes('STALE'));
  // Stop.
  next();pending=o.service.localReply('five');await entered.promise;deliver('going');const stop=o.service.localStop();finish.resolve({outcome:'reply_ended',text:'AFTER_STOP'});
  assert.equal((await pending).outcome,'cancelled');await stop;assert.equal(o.service.localSnapshot().streaming,null);assert(!JSON.stringify(o.history()).includes('AFTER_STOP'));
});

test('regenerate and continue stream against the message they change',async t=>{
  let entered=deferred(),finish=deferred(),deliver;
  const o=await opened(t,{execute:async args=>{deliver=args.onDelta;entered.resolve();return finish.promise;}});
  let pending=o.service.localReply('question');await entered.promise;finish.resolve({outcome:'reply_ended',text:'FIRST'});await pending;const target=o.history().at(-1);
  entered=deferred();finish=deferred();pending=o.service.localMessage({action:'regenerate'});await entered.promise;deliver('SEC');
  assert.deepEqual(o.streaming(),{messageId:target.id,mode:'regenerate',text:'SEC'});assert.equal(o.history().at(-1).text,'FIRST');
  finish.resolve({outcome:'reply_ended',text:'SECOND'});assert.equal((await pending).message.text,'SECOND');assert.equal(o.streaming(),null);
  entered=deferred();finish=deferred();pending=o.service.localMessage({action:'continue'});await entered.promise;deliver(' and');
  assert.deepEqual(o.streaming(),{messageId:target.id,mode:'continue',text:' and'});
  finish.resolve({outcome:'reply_ended',text:' and more'});assert.equal((await pending).message.text,'SECOND and more');assert.equal(o.streaming(),null);
  // A failed regeneration clears the view and leaves the message.
  entered=deferred();finish=deferred();pending=o.service.localMessage({action:'regenerate'});await entered.promise;deliver('half');finish.resolve({outcome:'error',text:''});
  assert.deepEqual(await pending,{outcome:'failed'});assert.equal(o.streaming(),null);assert.equal(o.history().at(-1).text,'SECOND and more');
});

test('streaming setting applies to library and built-in App conversations; notices never ask for deltas',async t=>{
  const seen=[];const execute=async args=>{seen.push(Object.hasOwn(args,'onDelta'));args.onDelta?.('shown');return {outcome:'reply_ended',text:'REPLY'};};
  const o=await opened(t,{execute,settings:{streaming:false}});
  assert.equal(o.service.stSnapshot().settings.streaming,false);assert.equal((await o.service.localReply('one')).text,'REPLY');assert.deepEqual(seen,[false]);assert.equal(o.streaming(),null);
  // Applies to the next turn without a restart.
  o.service.stConfigure({streaming:true});await o.service.localReply('two');assert.deepEqual(seen,[false,true]);assert.equal(o.streaming(),null);
  assert.throws(()=>o.service.stConfigure({streaming:'yes'}),{code:'invalid_request'});
  // Source notices are not streamed. Built-in App turns use the same switch.
  await o.service.localConversationContext().dispatcher.notify({id:'batch-1',sourceName:'Calendar',total:1,items:[{kind:'calendar.soon',title:'Team meeting',importance:'normal',time:'2026-11-14 09:00',data:{}}]});
  assert.deepEqual(seen,[false,true,false]);
  o.service.stConfigure({characterId:null});await o.service.localStop();await o.service.localStart();await o.service.localReply('你好');assert.deepEqual(seen,[false,true,false,true]);
  assert.equal(o.service.localSnapshot().streaming,null);
  assert.equal(settings.defaults().streaming,true);assert.equal(settings.validate({streaming:false}).streaming,false);assert.throws(()=>settings.validate({streaming:1}),{code:'st_settings_invalid'});
});
