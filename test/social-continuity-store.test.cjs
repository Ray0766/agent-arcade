'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SocialStore}=require('../src/bot/social-store.cjs');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-continuity-'));let at=Date.UTC(2026,10,5,12);
  const store=new SocialStore({root,now:()=>at});
  assert.equal(store.available,true);
  t.after(()=>{assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  return {store,root,now:()=>at,advance:ms=>{at+=ms;}};
}

test('attributed durable facts survive conversation trimming and a restart without crossing scopes',t=>{
  const {store,root,now,advance}=fixture(t),scope='qq:a:owner:ju';
  store.append(scope,{id:'source',role:'user',text:'My favourite tea is jasmine.'});
  const fact=store.remember(scope,{id:'tea',key:'favourite-tea',text:'Likes jasmine tea.',sourceIds:['source']});
  for(let i=0;i<125;i++){advance(1);store.append(scope,{id:String(i),role:'user',text:`unrelated-${i}`});}
  const reopened=new SocialStore({root,now});
  assert.equal(reopened.history(scope,120).some(row=>row.id==='source'),false);
  assert.deepEqual(reopened.facts(scope),[fact]);
  for(const other of ['qq:b:owner:ju','qq:a:another:ju','qq:a:owner:dragon'])assert.deepEqual(reopened.facts(other),[]);
  assert.throws(()=>reopened.remember('qq:b:owner:ju',{text:'steal source',sourceIds:['124']}),/retained owner messages/);
});

test('correcting a fact removes its derived conversation and notes, keeps unrelated facts, and cancels dependent follow-ups',t=>{
  const {store,now,advance}=fixture(t),scope='qq:a:owner:ju';
  const other=store.remember(scope,{id:'music',text:'Likes piano music.'});
  store.append(scope,{id:'older',role:'user',text:'An unrelated earlier question.'});advance(1);
  store.append(scope,{id:'old',role:'user',text:'ARCADE_OLD_TEA_VALUE'});
  store.append(scope,{id:'derived',role:'assistant',text:'That will be your favourite tea next time.'});
  store.setNotes(scope,'ARCADE_OLD_TEA_VALUE');
  const fact=store.remember(scope,{id:'tea',text:'ARCADE_OLD_TEA_VALUE',sourceIds:['old']});
  store.scheduleFollowup(scope,{id:'return',text:'Ask about the old tea.',dueAt:now()+60000,timeZone:'Australia/Sydney',sourceIds:['old'],factIds:['tea']});
  store.recordAction(scope,{id:'old-reply',kind:'reply',state:'sent',text:'ARCADE_OLD_TEA_VALUE',receipt:'accepted'});
  advance(1);store.append(scope,{id:'new',role:'user',text:'Actually I prefer oolong.'});
  const corrected=store.correctFact(scope,'tea',{text:'Prefers oolong.',sourceIds:['new'],revision:fact.revision});
  assert.equal(corrected.revision,2);assert.deepEqual(corrected.sourceIds,['new']);
  assert.deepEqual(store.history(scope).map(row=>row.id),['new']);assert.equal(store.getNotes(scope),'');
  assert.deepEqual(store.facts(scope).find(row=>row.id==='music'),other);
  assert.equal(store.followups(scope)[0].state,'cancelled');assert.equal(store.followups(scope)[0].text,'');
  assert.equal(store.actions(scope)[0].text,'');assert.equal(store.actions(scope)[0].receipt,'accepted');
  assert.throws(()=>store.correctFact(scope,'tea',{text:'A stale editor.',revision:1}),/changed/);
});

test('a stale forget keeps the corrected fact and its derived records',t=>{
  const {store,root,now}=fixture(t),scope='s';
  const first=store.remember(scope,{id:'tea',text:'OLD_TEA'}),current=store.correctFact(scope,'tea',{text:'NEW_TEA',revision:first.revision});
  store.append(scope,{id:'later',role:'user',text:'AFTER_CORRECTION'});store.setNotes(scope,'NEW_NOTE');
  store.scheduleFollowup(scope,{id:'follow',text:'NEW_FOLLOW',dueAt:now()+60000,timeZone:'UTC',factIds:['tea']});
  const before=JSON.stringify([store.facts(scope),store.history(scope),store.getNotes(scope),store.followups(scope)]);
  assert.throws(()=>store.forgetFact(scope,'tea',{revision:first.revision}),{code:'social_invalid_input',message:/changed/});
  const reopened=new SocialStore({root,now});
  assert.equal(JSON.stringify([reopened.facts(scope),reopened.history(scope),reopened.getNotes(scope),reopened.followups(scope)]),before);
  assert.equal(store.forgetFact(scope,'tea',{revision:current.revision}).forgotten,true);assert.deepEqual(store.facts(scope),[]);
});

test('forgetting a fact erases local raw sources, rejects stale extraction, and preserves send barriers',t=>{
  const {store,root,now}=fixture(t),scope='qq:a:owner:ju',secret='ARCADE_PRIVATE_7849_FORGET_THIS';
  store.append(scope,{id:'source',role:'user',text:secret});store.remember(scope,{id:'secret',text:secret,sourceIds:['source']});
  store.setNotes(scope,secret);store.recordAction(scope,{id:'sent',kind:'reply',state:'sent',text:secret,receipt:'message-1'});
  store.scheduleFollowup(scope,{id:'follow',text:secret,dueAt:now()+60000,timeZone:'Australia/Sydney',sourceIds:['source'],factIds:['secret']});
  store.forgetFact(scope,'secret');
  const reopened=new SocialStore({root,now});
  assert.deepEqual(reopened.facts(scope),[]);assert.deepEqual(reopened.history(scope),[]);assert.equal(reopened.getNotes(scope),'');
  assert.equal(reopened.followups(scope)[0].text,'');assert.equal(reopened.actions(scope)[0].receipt,'message-1');
  assert.throws(()=>reopened.remember(scope,{text:secret,sourceIds:['source']}),/retained owner messages/);
  assert.equal(fs.readFileSync(store.file).includes(Buffer.from(secret)),false);
});

test('manual and attributed erasure also clears earlier repeats and exact duplicate fact records',t=>{
  const {store,advance}=fixture(t),scope='s';
  store.append(scope,{id:'earlier',role:'user',text:'OLD_SHARED_DETAIL'});advance(1000);
  const fact=store.remember(scope,{id:'manual',text:'OLD_SHARED_DETAIL'});
  assert.equal(store.remember(scope,{id:'duplicate',text:'OLD_SHARED_DETAIL'}).id,fact.id);
  // A migrated record may contain whitespace-equivalent duplicate content.
  store.remember(scope,{id:'legacy-copy',text:'  OLD_SHARED_DETAIL  '});
  store.remember(scope,{id:'unrelated',text:'An independent preference.'});
  store.append('other',{id:'other-source',role:'user',text:'OTHER_SCOPE_KEPT'});
  store.forgetFact(scope,fact.id);
  assert.deepEqual(store.history(scope),[]);assert.deepEqual(store.facts(scope).map(row=>row.id),['unrelated']);
  assert.equal(store.history('other')[0].text,'OTHER_SCOPE_KEPT');
});

test('facts have bounded storage, validated owner sources and caller-owned snapshots',t=>{
  const {store}=fixture(t),scope='s';
  store.append(scope,{id:'assistant',role:'assistant',text:'A guess.'});
  assert.throws(()=>store.remember(scope,{text:'Derived guess',sourceIds:['assistant']}),/owner messages/);
  for(let i=0;i<100;i++)store.remember(scope,{id:`fact-${i}`,text:`Fact ${i}`});
  assert.throws(()=>store.remember(scope,{text:'Overflow'}),/100 facts/);
  const facts=store.facts(scope);facts[0].text='mutated';facts[0].sourceIds.push('fake');assert.notEqual(store.facts(scope)[0].text,'mutated');
  assert.throws(()=>store.remember(scope,{text:'x'.repeat(601)}),/Invalid/);assert.equal(store.available,true);
});

test('correction and erasure remove the exact old fact embedded in another fact without crossing relationships',t=>{
  const {store}=fixture(t),scope='s',old='The favourite tea is jasmine.';
  store.remember(scope,{id:'tea',text:old});
  store.remember(scope,{id:'summary',text:`Likes quiet evenings. ${old} Drinks it after work.`});
  store.remember(scope,{id:'unrelated',text:'Likes quiet evenings.'});
  store.remember('other',{id:'summary',text:old});
  store.correctFact(scope,'tea',{text:'The favourite tea is oolong.'});
  assert.deepEqual(store.facts(scope).map(row=>row.id).sort(),['tea','unrelated']);
  assert.equal(store.facts('other')[0].text,old);
  store.remember(scope,{id:'new-summary',text:'The favourite tea is oolong. Enjoys it after work.'});
  store.forgetFact(scope,'tea');
  assert.deepEqual(store.facts(scope).map(row=>row.id),['unrelated']);
  assert.equal(store.facts('other')[0].text,old);
});

test('future follow-ups persist while offline deadlines become missed and attempted sends become unknown',t=>{
  const {store,root,now,advance}=fixture(t),scope='s';
  store.scheduleFollowup(scope,{id:'future',text:'Tomorrow',dueAt:now()+86400000,timeZone:'Australia/Sydney'});
  store.scheduleFollowup(scope,{id:'missed',text:'Too late',dueAt:now()+1000,timeZone:'UTC'});
  store.scheduleFollowup(scope,{id:'claimed',text:'In flight',dueAt:now(),timeZone:'UTC'});
  assert.equal(store.claimFollowup(scope,'claimed').state,'attempting');advance(2000);
  const reopened=new SocialStore({root,now}),byId=Object.fromEntries(reopened.followups(scope).map(row=>[row.id,row]));
  assert.equal(byId.future.state,'pending');assert.equal(byId.missed.state,'missed');assert.equal(byId.claimed.state,'unknown');
  assert.equal(reopened.claimFollowup(scope,'claimed'),null);assert.equal(reopened.claimFollowup(scope,'missed'),null);
  assert.throws(()=>reopened.finishFollowup(scope,'claimed',{state:'sent'}),/cannot retry/);
  assert.throws(()=>reopened.scheduleFollowup(scope,{id:'claimed',text:'retry',dueAt:now()+1000,timeZone:'UTC'}),/already recorded/);
});

test('follow-up claims recheck revisions, scope, due time and expiry; cancellation cannot pretend an attempted send never happened',t=>{
  const {store,now,advance}=fixture(t),scope='s';
  const first=store.scheduleFollowup(scope,{id:'f',text:'Interview',dueAt:now()+1000,timeZone:'Australia/Sydney'});
  const updated=store.updateFollowup(scope,'f',{dueAt:now()+2000,text:'Rescheduled interview',revision:first.revision});
  assert.equal(store.claimFollowup(scope,'f'),null);advance(2000);
  assert.equal(store.claimFollowup(scope,'f',{revision:first.revision}),null);assert.equal(store.claimFollowup('other','f'),null);
  assert.equal(store.claimFollowup(scope,'f',{revision:updated.revision}).state,'attempting');
  assert.equal(store.claimFollowup(scope,'f'),null);
  assert.equal(store.cancelFollowup(scope,'f').state,'unknown');assert.throws(()=>store.finishFollowup(scope,'f',{state:'sent'}),/cannot retry/);
  store.scheduleFollowup(scope,{id:'expire',text:'Bounded',dueAt:now(),expiresAt:now()+1000,timeZone:'UTC'});advance(1000);
  assert.equal(store.claimFollowup(scope,'expire'),null);assert.equal(store.followups(scope).find(row=>row.id==='expire').state,'missed');
});

test('completed follow-up receipt persists and source scope, time zone, capacity and malformed input are enforced',t=>{
  const {store,root,now}=fixture(t),scope='s';
  store.scheduleFollowup(scope,{id:'done',text:'A real appointment',dueAt:now(),timeZone:'Australia/Sydney'});store.claimFollowup(scope,'done');
  store.finishFollowup(scope,'done',{state:'sent',receipt:'qq-message-42'});
  assert.equal(new SocialStore({root,now}).followups(scope)[0].receipt,'qq-message-42');
  assert.throws(()=>store.scheduleFollowup(scope,{text:'Bad zone',dueAt:now(),timeZone:'Sydney'}),/valid IANA/);
  assert.throws(()=>store.scheduleFollowup(scope,{text:'Past',dueAt:now()-1,timeZone:'UTC'}),/future follow-up/);
  assert.throws(()=>store.scheduleFollowup(scope,{text:'Other fact',dueAt:now(),timeZone:'UTC',factIds:['unknown']}),/belong/);
  for(let i=0;i<30;i++)store.scheduleFollowup(scope,{text:`Pending ${i}`,dueAt:now()+100000,timeZone:'UTC'});
  assert.throws(()=>store.scheduleFollowup(scope,{text:'Overflow',dueAt:now()+100000,timeZone:'UTC'}),/30 pending/);assert.equal(store.available,true);
});

test('public continuity is separate from private facts and survives restart; editing local entries does not claim external edits',t=>{
  const {store,root,now}=fixture(t),scope='s';
  store.append(scope,{id:'private',role:'user',text:'PRIVATE_OWNER_DETAIL'});store.remember(scope,{text:'PRIVATE_OWNER_DETAIL',sourceIds:['private']});
  const draft=store.addPublicEntry(scope,{id:'draft',text:'A fictional character likes rainy music.'});
  assert.deepEqual(store.journal(scope),[]);assert.equal(draft.state,'draft');
  assert.equal(store.claimPublicEntry(scope,'draft').state,'attempting');
  const published=store.publishPublicEntry(scope,'draft',{postId:'actual-post-1'});
  assert.equal(published.state,'published');assert.equal(store.journal(scope)[0].receipt,'actual-post-1');
  const reopened=new SocialStore({root,now});assert.equal(JSON.stringify(reopened.journal(scope)).includes('PRIVATE_OWNER_DETAIL'),false);
  assert.deepEqual(reopened.journal('other'),[]);
  assert.equal(reopened.updatePublicEntry(scope,'draft',{text:'An edited local note.'}).externalPostUnchanged,true);
  assert.equal(reopened.deletePublicEntry(scope,'draft').externalPostUnchanged,true);assert.deepEqual(reopened.journal(scope),[]);
  assert.throws(()=>reopened.appendJournal(scope,{text:'No receipt'}),/real post receipt/);
});

test('public draft intent is committed once, becomes unknown after restart and never replays',t=>{
  const {store,root,now}=fixture(t),scope='s';
  store.addPublicEntry(scope,{id:'post',text:'A public draft.'});
  assert.equal(store.claimPublicEntry('other','post'),null);assert.equal(store.claimPublicEntry(scope,'post').state,'attempting');assert.equal(store.claimPublicEntry(scope,'post'),null);
  assert.throws(()=>store.updatePublicEntry(scope,'post',{text:'Changed in flight'}),/Wait/);
  assert.throws(()=>store.deletePublicEntry(scope,'post'),/Wait/);
  const reopened=new SocialStore({root,now});assert.equal(reopened.publicEntries(scope)[0].state,'unknown');
  assert.equal(reopened.claimPublicEntry(scope,'post'),null);assert.throws(()=>reopened.finishPublicEntry(scope,'post',{state:'published',postId:'late'}),/cannot retry/);
  assert.deepEqual(reopened.journal(scope),[]);
});

test('new drafts cannot conceal retained published continuity from a limited journal query',t=>{
  const {store,root,now,advance}=fixture(t),scope='s';
  store.appendJournal(scope,{id:'older-public',text:'A fictional island has a small library.',receipt:'public-1'});
  advance(1);store.appendJournal(scope,{id:'newer-public',text:'The library now has a blue bookmark.',receipt:'public-2'});
  for(let i=0;i<32;i++){advance(1);store.addPublicEntry(scope,{id:`draft-${i}`,text:`Unpublished idea ${i}`});}
  store.addPublicEntry('other',{id:'other-published',text:'Unrelated public story.',state:'published',receipt:'other-1'});
  store.claimPublicEntry(scope,'draft-31');
  const reopened=new SocialStore({root,now});
  assert.equal(reopened.publicEntries(scope,8).every(row=>row.state!=='published'),true);
  assert.deepEqual(reopened.journal(scope,1).map(row=>row.id),['newer-public']);
  assert.deepEqual(reopened.journal(scope,8).map(row=>row.id),['newer-public','older-public']);
  assert.equal(reopened.publicEntries(scope,1)[0].state,'unknown');
  assert.throws(()=>reopened.journal(scope,0),/record limit/);
});

test('public journal bounds and duplicate identities are enforced; clearing private memory retains published continuity and barriers',t=>{
  const {store,now,advance}=fixture(t),scope='s';
  for(let i=0;i<105;i++){advance(1);store.appendJournal(scope,{id:`p-${i}`,text:`Public ${i}`,receipt:`qq-post-${i}`});}
  assert.equal(store.publicEntries(scope,100).length,100);assert.equal(store.publicEntries(scope,100).at(-1).text,'Public 5');
  assert.throws(()=>store.appendJournal(scope,{id:'p-104',text:'changed',receipt:'qq-post-104'}),/already used/);
  store.remember(scope,{text:'private'});store.scheduleFollowup(scope,{id:'f',text:'private followup',dueAt:now()+1000,timeZone:'UTC'});
  store.clear(scope);assert.deepEqual(store.facts(scope),[]);assert.equal(store.followups(scope)[0].state,'cancelled');assert.equal(store.followups(scope)[0].text,'');
  assert.equal(store.publicEntries(scope,100).length,100);
});

test('old settings migrate with bounded speech examples and attribution; snapshots cannot mutate saved settings',t=>{
  const {root,now}=fixture(t);
  fs.writeFileSync(path.join(root,'social-config.json'),JSON.stringify({enabled:false,name:'橘'}));
  const store=new SocialStore({root,now});assert.equal(store.available,true);assert.deepEqual(store.config().speechExamples,[]);
  store.configure({speechExamples:[{user:'你好',assistant:'今天过得怎么样？'}],cardMetadata:{creator:'Ray',version:'1',license:'MIT',sourceFormat:'arcade_character_v1'}});
  const config=store.config();config.speechExamples[0].assistant='mutated';config.cardMetadata.creator='someone';
  assert.equal(store.config().speechExamples[0].assistant,'今天过得怎么样？');assert.equal(store.config().cardMetadata.creator,'Ray');
  assert.throws(()=>store.configure({speechExamples:Array.from({length:7},()=>({user:'a',assistant:'b'}))}),/Invalid/);
  assert.throws(()=>store.configure({cardMetadata:{creator:'x',version:'1',license:'MIT',sourceFormat:'script'}}),/Invalid/);
  assert.equal(new SocialStore({root,now}).config().cardMetadata.creator,'Ray');
});
test('public journal pruning keeps an entry being published and the entry just added',t=>{
  const {store,advance}=fixture(t),scope="account:owner:ju",tick=()=>advance(1);
  store.addPublicEntry(scope,{id:'posting',text:'Being published.'});tick();
  assert(store.claimPublicEntry(scope,'posting'));
  for(let i=0;i<100;i++){tick();store.addPublicEntry(scope,{id:'e'+i,text:'Entry '+i});}
  assert.equal(store.finishPublicEntry(scope,'posting',{state:'published',postId:'p1'}).state,'published');
});
