'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {SocialStore}=require('../src/bot/social-store.cjs');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-social-'));let at=1000000000;
  const store=new SocialStore({root,now:()=>at});
  t.after(()=>{assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  return {store,root,now:()=>at,tick:()=>at++,advance:ms=>{at+=ms;}};
}
test('social memory and opt-in settings survive restart without mixing contacts or characters',t=>{
  const {store,root}=fixture(t);assert.equal(store.available,true);assert.equal(store.config().enabled,false);
  store.configure({enabled:true,name:'橘'});store.setNotes('account-a:owner-a:ju','用户喜欢轻音乐。');
  store.append('account-a:owner-a:ju',{id:'a',role:'user',text:'记住：我喜欢轻音乐。'});
  store.append('account-a:owner-b:ju',{id:'b',role:'user',text:'Only B'});
  store.append('account-a:owner-a:dragon',{id:'c',role:'user',text:'Only dragon'});
  const reopened=new SocialStore({root});
  assert.equal(reopened.config().notes,'');assert.equal(reopened.getNotes('account-a:owner-a:ju'),'用户喜欢轻音乐。');
  assert.equal(reopened.getNotes('account-a:owner-b:ju'),'');assert.equal(reopened.getNotes('account-a:owner-a:dragon'),'');
  assert.deepEqual(reopened.history('account-a:owner-a:ju').map(m=>m.text),['记住：我喜欢轻音乐。']);
  assert.equal(reopened.history('account-b:owner-a:ju').length,0);
});
test('attempt intent survives a crash as unknown and cannot be retried or erased by clearing chat',t=>{
  const {store,root,now}=fixture(t),scope='account:owner:ju';
  store.recordAction(scope,{id:'post-1',kind:'post',state:'attempting',text:'Character thought'});
  const reopened=new SocialStore({root,now});
  assert.equal(reopened.actions(scope)[0].state,'unknown');
  assert.throws(()=>reopened.updateAction(scope,'post-1',{state:'attempting'}),/cannot be retried/);
  assert.throws(()=>reopened.recordAction(scope,{id:'post-1',kind:'post',state:'attempting'}),/already recorded/);
  reopened.clear(scope);assert.equal(reopened.actions(scope).length,1);assert.equal(reopened.actions(scope)[0].text,'');assert.equal(reopened.actions(scope)[0].state,'unknown');
});
test('editable notes are bound to actual account, contact and character, and clear removes them',t=>{
  const {store}=fixture(t);store.setNotes('account-a:owner-a:ju','Only this relationship.');
  assert.equal(store.getNotes('account-b:owner-a:ju'),'');assert.equal(store.getNotes('account-a:owner-b:ju'),'');
  assert.equal(store.getNotes('account-a:owner-a:dragon'),'');
  assert.throws(()=>store.setNotes('scope','x'.repeat(1001)),/Invalid/);
  assert.throws(()=>store.configure({notes:'unscoped secret'}),/verified/);
  store.clear('account-a:owner-a:ju');assert.equal(store.getNotes('account-a:owner-a:ju'),'');
});
test('receipt changes are scoped and accepted only for unfinished actions',t=>{
  const {store}=fixture(t),scope='account:owner:ju';
  store.recordAction(scope,{id:'reply-1',kind:'reply',state:'attempting',text:'你好'});
  const receipt=store.updateAction(scope,'reply-1',{state:'sent',receipt:'message-001'});
  assert.equal(receipt.receipt,'message-001');assert.equal(receipt.state,'sent');
  assert.throws(()=>store.updateAction('other','reply-1',{state:'sent'}),/not found/);
  assert.throws(()=>store.updateAction(scope,'reply-1',{state:'attempting'}),/cannot be retried/);
  assert.equal(store.available,true);
});
test('memory is bounded, chronological and validates identifiers and payloads before persistence',t=>{
  const {store,tick}=fixture(t),scope='account:owner:ju';
  for(let i=0;i<130;i++){tick();store.append(scope,{id:String(i),role:'user',text:`message-${i}`});}
  const history=store.history(scope,120);assert.equal(history.length,120);assert.equal(history[0].text,'message-10');assert.equal(history.at(-1).text,'message-129');
  assert.throws(()=>store.append(scope,{id:'129',role:'user',text:'changed'}),/different content/);
  assert.throws(()=>store.append(scope,{role:'system',text:'authority'}),/Invalid/);
  assert.throws(()=>store.append(scope,{role:'user',text:'x'.repeat(2001)}),/Invalid/);
  assert.equal(store.available,true);
});
test('daily attempts cannot be pruned by filling the journal and rolled-back overflow cannot reset limits',t=>{
  const {store,advance}=fixture(t),scope='account:owner:ju';
  for(let i=0;i<200;i++)store.recordAction(scope,{id:String(i),kind:i===0?'message':'decision',state:i===0?'sent':'skipped'});
  assert.throws(()=>store.recordAction(scope,{id:'overflow',kind:'decision',state:'skipped'}),/full for this day/);
  assert.equal(store.actions(scope,200).length,200);assert.equal(store.actions(scope,200).find(a=>a.id==='0').state,'sent');
  advance(86400001);store.recordAction(scope,{id:'tomorrow',kind:'decision',state:'skipped'});
  assert.equal(store.actions(scope,200).length,200);assert.equal(store.available,true);
});
test('ordinary conversation can exceed 250 replies without losing recent proactive allowances or uncertain attempts',t=>{
  const {store,tick}=fixture(t),scope='account:owner:ju';
  store.recordAction(scope,{id:'active-initiative',kind:'message',state:'unknown'});
  store.recordAction(scope,{id:'today-post',kind:'post',state:'published'});
  store.recordAction(scope,{id:'today-decision',kind:'decision',state:'skipped'});
  for(let i=0;i<260;i++){
    tick();store.recordAction(scope,{id:`reply-${i}`,kind:'reply',state:'attempting'});
    store.updateAction(scope,`reply-${i}`,{state:'sent',receipt:String(i)});
  }
  const actions=store.actions(scope,200);assert.equal(actions.length,200);
  assert.equal(actions.find(a=>a.id==='active-initiative').state,'unknown');assert.equal(actions.find(a=>a.id==='today-post').state,'published');
  assert.equal(actions.find(a=>a.id==='today-decision').state,'skipped');assert.equal(actions[0].id,'reply-259');assert.equal(store.available,true);
});
test('malformed settings fail closed instead of enabling behavior or silently discarding user memory',t=>{
  const {store,root}=fixture(t);
  for(const patch of [{enabled:'yes'},{characterId:'unrecognized'},{activeStart:9,activeEnd:9},{intervalMinutes:0},{name:''},{notes:'x'.repeat(1001)},{unexpected:true}])assert.throws(()=>store.configure(patch));
  assert.equal(store.config().enabled,false);
  fs.writeFileSync(path.join(root,'social-config.json'),'{broken');
  const broken=new SocialStore({root});assert.equal(broken.available,false);assert.equal(broken.config().enabled,false);
  assert.throws(()=>broken.append('s',{role:'user',text:'no'}),/unavailable/);
});
test('scope count is bounded without destroying existing memories',t=>{
  const {store}=fixture(t);
  for(let i=0;i<20;i++)store.append(`scope-${i}`,{role:'user',text:'retained'});
  assert.throws(()=>store.append('scope-21',{role:'user',text:'overflow'}),/scope limit/);
  assert.equal(store.available,true);assert.equal(store.history('scope-0').length,1);
  store.clear('scope-0');store.append('scope-21',{role:'user',text:'new'});
});
test('a reply recorded into a full journal keeps its own receipt until the sender finishes it',t=>{
  const {store,advance}=fixture(t),scope='account:owner:ju';
  for(let i=0;i<200;i++)store.recordAction(scope,{id:'d'+i,kind:'decision',state:'skipped'});
  store.recordAction(scope,{id:'same-day',kind:'reply',state:'attempting',text:'在'});
  assert.equal(store.updateAction(scope,'same-day',{state:'sent'}).state,'sent');
  advance(86400001);
  store.recordAction(scope,{id:'reply-1',kind:'reply',state:'attempting',text:'你好'});
  assert.equal(store.updateAction(scope,'reply-1',{state:'sent'}).state,'sent');
  const kept=store.actions(scope,200);assert(kept.some(a=>a.id==='reply-1'));assert(!kept.some(a=>a.id==='same-day'));assert(kept.length<=201);
});
test('a cleared scope idle for thirty days gives its slot back; a recent one does not',t=>{
  const {store,advance}=fixture(t);
  for(let i=0;i<20;i++){const scope=`account:owner${i}:ju`;store.append(scope,{role:'user',text:'你好'});store.recordAction(scope,{id:'r',kind:'reply',state:'sent',text:'在'});store.clear(scope);}
  assert.throws(()=>store.append('account:new:ju',{role:'user',text:'你好'}),/scope limit/);
  advance(30*86400000+1);
  store.append('account:new:ju',{role:'user',text:'你好'});
  assert.equal(store.actions('account:new:ju',10).length,0);
});
