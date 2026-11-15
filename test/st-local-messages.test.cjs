'use strict';
// Message operations of the App conversation (edit, remove, regenerate with alternatives,
// continue) and the storage they need, including in-place migration of an older database.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {SocialStore}=require('../src/bot/social-store.cjs');
const {fixture,card,deferred}=require('./st-local-fixture.cjs');
const {localOperationResult}=require('../src/bot/local-companion.cjs');
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-st-store-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const mira=()=>card('Mira',{description:'Keeper of the light.',first_mes:'Hello.'});
const numbered=()=>async(_args,count)=>({outcome:'reply_ended',text:'REPLY_'+count});

test('edit and remove change exactly one stored message, within the caps of its kind',async t=>{
  const f=fixture(t,{execute:numbered()}),a=f.characters.add({card:mira()});await f.open(a.id);await f.service.localReply('first question');
  const [greeting,user,reply]=f.history();assert.deepEqual([greeting.text,user.text,reply.text],['Hello.','first question','REPLY_1']);const revision=f.service.localSnapshot().historyRevision;
  const edited=await f.service.localMessage({action:'edit',id:reply.id,text:'  EDITED_REPLY  '});
  assert.deepEqual(edited,{outcome:'done',message:{id:reply.id,role:'assistant',text:'EDITED_REPLY',at:reply.at,edited:true,swipeIndex:0,swipeCount:1}});
  assert.deepEqual((await f.service.localMessage({action:'edit',id:user.id,text:'EDITED_QUESTION'})).message.edited,true);
  assert.deepEqual(f.history().map(row=>[row.text,row.edited]),[['Hello.',false],['EDITED_QUESTION',true],['EDITED_REPLY',true]]);assert(f.service.localSnapshot().historyRevision>=revision+2);
  // Caps: a library character's companion message holds 8000 characters, an owner message 2000.
  assert.equal((await f.service.localMessage({action:'edit',id:reply.id,text:'长'.repeat(8000)})).message.text.length,8000);
  await assert.rejects(f.service.localMessage({action:'edit',id:reply.id,text:'长'.repeat(8001)}),{code:'invalid_text'});
  await assert.rejects(f.service.localMessage({action:'edit',id:user.id,text:'长'.repeat(2001)}),{code:'invalid_text'});
  for(const bad of [{action:'edit',id:reply.id,text:'   '},{action:'edit',id:reply.id,text:5}])await assert.rejects(f.service.localMessage(bad),{code:'invalid_text'});
  for(const bad of [null,{},{action:'erase',id:reply.id},{action:'edit',id:reply.id},{action:'edit',id:'',text:'x'},{action:'remove',id:reply.id,text:'x'},{action:'remove'},{action:'regenerate',id:reply.id},{action:'swipe',id:reply.id},{action:'swipe',id:reply.id,index:3},{action:'swipe',id:reply.id,index:'0'}])
    await assert.rejects(f.service.localMessage(bad),{code:'invalid_request'},JSON.stringify(bad));
  await assert.rejects(f.service.localMessage({action:'edit',id:'missing',text:'x'}),{code:'message_not_found'});await assert.rejects(f.service.localMessage({action:'remove',id:'missing'}),{code:'message_not_found'});
  assert.deepEqual(await localOperationResult(()=>f.service.localMessage({action:'remove',id:'missing'})),{ok:false,code:'message_not_found'});
  // The edited text is what the next turn sees.
  await f.service.localMessage({action:'edit',id:reply.id,text:'SHORT_EDIT'});await f.service.localReply('second question');
  assert.match(f.calls.at(-1).prompt,/Mira: SHORT_EDIT/);assert.match(f.calls.at(-1).prompt,/EDITED_QUESTION/);assert.doesNotMatch(f.calls.at(-1).prompt,/REPLY_1|first question/);
  assert.deepEqual(await f.service.localMessage({action:'remove',id:user.id}),{outcome:'done'});
  assert.deepEqual(f.history().map(row=>row.text),['Hello.','SHORT_EDIT','second question','REPLY_2']);
  // Stopped conversation: the three store operations still work on the selected conversation.
  await f.service.localStop();assert.equal((await f.service.localMessage({action:'edit',id:greeting.id,text:'Edited greeting.'})).message.edited,true);
  await assert.rejects(f.service.localMessage({action:'regenerate'}),{code:'unavailable'});assert.equal(f.history()[0].text,'Edited greeting.');
});

test('regenerate keeps up to ten alternatives of the last reply; swipe selects one',async t=>{
  const f=fixture(t,{execute:numbered()}),a=f.characters.add({card:mira()});await f.open(a.id,{sampling:{temperature:0.4}});await f.service.localReply('the question');
  const target=f.history().at(-1);assert.equal(target.text,'REPLY_1');
  const again=await f.service.localMessage({action:'regenerate'});
  assert.deepEqual(again,{outcome:'reply_ended',message:{id:target.id,role:'assistant',text:'REPLY_2',at:target.at,edited:false,swipeIndex:1,swipeCount:2}});
  // Same context as the first attempt: the question is framed again and the old answer is not shown.
  const prompt=f.calls[1].prompt;assert.match(prompt,/BEGIN ARCADE_INPUT_0000\nthe question\nEND ARCADE_INPUT_0000/);assert.doesNotMatch(prompt,/REPLY_1/);assert.match(prompt,/Mira: Hello\./);assert.deepEqual(f.calls[1].sampling,{temperature:0.4});
  assert.equal(f.history().length,3);assert.deepEqual([f.history().at(-1).text,f.history().at(-1).swipeIndex,f.history().at(-1).swipeCount],['REPLY_2',1,2]);
  assert.deepEqual((await f.service.localMessage({action:'swipe',id:target.id,index:0})).message,{id:target.id,role:'assistant',text:'REPLY_1',at:target.at,edited:false,swipeIndex:0,swipeCount:2});
  await assert.rejects(f.service.localMessage({action:'swipe',id:target.id,index:2}),{code:'invalid_request'});await assert.rejects(f.service.localMessage({action:'swipe',id:target.id,index:-1}),{code:'invalid_request'});
  // An edit changes the selected alternative only.
  await f.service.localMessage({action:'edit',id:target.id,text:'EDITED_FIRST'});assert.equal((await f.service.localMessage({action:'swipe',id:target.id,index:1})).message.text,'REPLY_2');
  assert.equal((await f.service.localMessage({action:'swipe',id:target.id,index:0})).message.text,'EDITED_FIRST');
  // Ten at most; the oldest is dropped.
  for(let i=0;i<10;i++)assert.equal((await f.service.localMessage({action:'regenerate'})).outcome,'reply_ended');
  const full=f.store().message(f.scope(),target.id);assert.equal(full.swipeCount,10);assert.equal(full.swipeIndex,9);assert.deepEqual(full.swipes,['REPLY_3','REPLY_4','REPLY_5','REPLY_6','REPLY_7','REPLY_8','REPLY_9','REPLY_10','REPLY_11','REPLY_12']);assert.equal(full.text,'REPLY_12');
  assert.equal(f.history().length,3);
  // The next turn sees the selected alternative only.
  await f.service.localMessage({action:'swipe',id:target.id,index:4});await f.service.localReply('next');assert.match(f.calls.at(-1).prompt,/Mira: REPLY_7/);assert.doesNotMatch(f.calls.at(-1).prompt,/REPLY_12|REPLY_3/);
  // Only the last message can be regenerated, and only when it is a companion reply.
  const last=f.history().at(-1);await f.service.localMessage({action:'remove',id:last.id});await assert.rejects(f.service.localMessage({action:'regenerate'}),{code:'invalid_request'});await assert.rejects(f.service.localMessage({action:'continue'}),{code:'invalid_request'});
  // A failed model call leaves the message as it was.
  await f.service.localReply('another');const kept=f.history().at(-1);f.state.execute=async()=>({outcome:'error',text:''});
  assert.deepEqual(await f.service.localMessage({action:'regenerate'}),{outcome:'failed'});assert.deepEqual(f.history().at(-1),kept);
  // Memory-command receipts and source notices are not model replies and cannot be regenerated.
  f.state.execute=null;await f.service.localReply('记住：A_FACT');await assert.rejects(f.service.localMessage({action:'regenerate'}),{code:'invalid_request'});
});

test('continue appends to the last reply within the cap',async t=>{
  const f=fixture(t,{execute:numbered()}),a=f.characters.add({card:mira()});await f.open(a.id);await f.service.localReply('tell me a story');const target=f.history().at(-1);
  f.state.execute=async()=>({outcome:'reply_ended',text:' and then the lamp went out.  \n'});
  const result=await f.service.localMessage({action:'continue'});
  assert.deepEqual(result,{outcome:'reply_ended',message:{id:target.id,role:'assistant',text:'REPLY_1 and then the lamp went out.',at:target.at,edited:false,swipeIndex:0,swipeCount:1}});
  const prompt=f.calls.at(-1).prompt;assert.match(prompt,/Mira: REPLY_1\n/);assert.match(prompt,/Mira: tell me a story|[^\n]*: tell me a story/);assert.doesNotMatch(prompt,/BEGIN ARCADE_INPUT/);
  assert(prompt.endsWith('[System note: Continue the character\'s last message from exactly where it stops. Write only the continuation; do not repeat what is already written and do not start a new turn.]'));
  // With alternatives, the continuation belongs to the selected one.
  f.state.execute=async()=>({outcome:'reply_ended',text:'ALTERNATIVE'});await f.service.localMessage({action:'regenerate'});
  f.state.execute=async()=>({outcome:'reply_ended',text:' continued'});await f.service.localMessage({action:'continue'});
  assert.deepEqual(f.store().message(f.scope(),target.id).swipes,['REPLY_1 and then the lamp went out.','ALTERNATIVE continued']);
  // Bounded by the 8000-character cap; a full message cannot be continued.
  await f.service.localMessage({action:'edit',id:target.id,text:'长'.repeat(7990)});f.state.execute=async()=>({outcome:'reply_ended',text:'续'.repeat(500)});
  assert.equal((await f.service.localMessage({action:'continue'})).message.text.length,8000);await assert.rejects(f.service.localMessage({action:'continue'}),{code:'invalid_request'});
  assert.equal(f.history().length,3);
});

test('every operation is refused while a reply or regeneration is in flight; a new turn or Stop pre-empts a regeneration',async t=>{
  const f=fixture(t,{execute:numbered()}),a=f.characters.add({card:mira()});await f.open(a.id);await f.service.localReply('one');const target=f.history().at(-1);
  let entered=deferred(),finish=deferred();f.state.execute=async()=>{entered.resolve();return finish.promise;};
  const pending=f.service.localReply('two');await entered.promise;
  for(const value of [{action:'edit',id:target.id,text:'x'},{action:'remove',id:target.id},{action:'swipe',id:target.id,index:0},{action:'regenerate'},{action:'continue'}])await assert.rejects(f.service.localMessage(value),{code:'busy'},value.action);
  finish.resolve({outcome:'reply_ended',text:'TWO_REPLY'});await pending;assert.equal(f.history().at(-1).text,'TWO_REPLY');
  // During a regeneration: other operations and settings are refused.
  entered=deferred();finish=deferred();const working=f.service.localMessage({action:'regenerate'});await entered.promise;
  await assert.rejects(f.service.localMessage({action:'edit',id:target.id,text:'x'}),{code:'busy'});await assert.rejects(f.service.localMessage({action:'regenerate'}),{code:'busy'});assert.throws(()=>f.service.stConfigure({greeting:0}),{code:'busy'});
  finish.resolve({outcome:'reply_ended',text:'REGENERATED'});assert.equal((await working).message.text,'REGENERATED');
  // A new owner turn pre-empts a regeneration: no alternative is stored from the stale answer.
  entered=deferred();finish=deferred();const stale=f.service.localMessage({action:'regenerate'});await entered.promise;const before=f.store().message(f.scope(),f.history().at(-1).id);
  const late=finish;entered=deferred();finish=deferred();const turn=f.service.localReply('three');late.resolve({outcome:'reply_ended',text:'STALE_ALTERNATIVE'});
  assert.deepEqual(await stale,{outcome:'cancelled'});await entered.promise;finish.resolve({outcome:'reply_ended',text:'THREE_REPLY'});assert.equal((await turn).outcome,'reply_ended');
  assert.deepEqual(f.store().message(f.scope(),before.id),before);assert(!JSON.stringify(f.history()).includes('STALE_ALTERNATIVE'));assert.equal(f.history().at(-1).text,'THREE_REPLY');
  // Stopping the conversation cancels a regeneration.
  entered=deferred();finish=deferred();const stopping=f.service.localMessage({action:'regenerate'});await entered.promise;const stop=f.service.localStop();finish.resolve({outcome:'reply_ended',text:'AFTER_STOP'});
  assert.deepEqual(await stopping,{outcome:'cancelled'});await stop;assert(!JSON.stringify(f.history()).includes('AFTER_STOP'));
});

test('built-in persona: edit, remove, alternatives and continuation operate on a complete reply with the existing cap',async t=>{
  const f=fixture(t,{execute:async()=>({outcome:'reply_ended',text:'第一段。\n\n第二段。'})});await f.service.localStart();await f.service.localReply('你好');
  const [user,reply]=f.history();
  assert.equal((await f.service.localMessage({action:'regenerate'})).outcome,'reply_ended');assert.equal(f.history().at(-1).swipeCount,2);
  assert.equal((await f.service.localMessage({action:'continue'})).outcome,'reply_ended');assert.equal(f.history().at(-1).text,'第一段。\n\n第二段。第一段。\n\n第二段。');
  assert.equal((await f.service.localMessage({action:'edit',id:reply.id,text:'改过的回复。'})).message.edited,true);
  await assert.rejects(f.service.localMessage({action:'edit',id:reply.id,text:'长'.repeat(2001)}),{code:'invalid_text'});
  await f.service.localMessage({action:'remove',id:user.id});assert.deepEqual(f.history().map(row=>row.text),['改过的回复。']);
  await f.service.localReply('继续');assert.match(f.calls.at(-1).prompt,/"text":"改过的回复。"/);assert.doesNotMatch(f.calls.at(-1).prompt,/第一段。/);
});

test('storage: old databases migrate in place and old behaviour is unchanged',t=>{
  const root=temp(t),file=path.join(root,'social-memory.sqlite');let at=1700000000000;
  // A database as written before any versioned migration: the original four tables only.
  const old=new DatabaseSync(file);
  old.exec(`CREATE TABLE scopes (id TEXT PRIMARY KEY);
    CREATE TABLE messages (scope TEXT NOT NULL,id TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,at INTEGER NOT NULL,PRIMARY KEY(scope,id));
    CREATE TABLE actions (scope TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL,state TEXT NOT NULL,text TEXT NOT NULL,at INTEGER NOT NULL,updated_at INTEGER NOT NULL,receipt TEXT NOT NULL,PRIMARY KEY(scope,id));
    CREATE TABLE scoped_notes (scope TEXT PRIMARY KEY,text TEXT NOT NULL);`);
  const probe=new SocialStore({root:temp(t)}),key=probe.scope('scope-a');
  old.prepare('INSERT INTO scopes(id) VALUES(?)').run(key);old.prepare('INSERT INTO messages(scope,id,role,text,at) VALUES(?,?,?,?,?)').run(key,'old-1','user','OLD_USER',5);old.prepare('INSERT INTO messages(scope,id,role,text,at) VALUES(?,?,?,?,?)').run(key,'old-2','assistant','OLD_REPLY',6);
  old.close();
  const raw=(sql,all)=>{const db=new DatabaseSync(file);try{return all?db.prepare(sql).all():db.exec(sql);}finally{db.close();}};
  const open=()=>new SocialStore({root,now:()=>at});let store=open();assert.equal(store.available,true);
  assert.equal(raw('PRAGMA user_version',true)[0].user_version,4);assert.deepEqual(raw('PRAGMA table_info(messages)',true).map(column=>column.name),['scope','id','role','text','at','swipes','swipe_index','edited_at']);
  // Old rows read exactly as before; the detailed view gives them neutral values.
  assert.deepEqual(store.history('scope-a'),[{id:'old-1',role:'user',text:'OLD_USER',at:5},{id:'old-2',role:'assistant',text:'OLD_REPLY',at:6}]);
  assert.deepEqual(store.historyWindow('scope-a',1),{messages:[{id:'old-2',role:'assistant',text:'OLD_REPLY',at:6}],hasEarlier:true});
  assert.deepEqual(store.history('scope-a',30,{details:true})[1],{id:'old-2',role:'assistant',text:'OLD_REPLY',at:6,edited:false,swipeIndex:0,swipeCount:1});
  assert.deepEqual(store.message('scope-a','old-2').swipes,['OLD_REPLY']);
  // A version 3 database (today's earlier build) gains only the new columns and table.
  raw('ALTER TABLE messages DROP COLUMN swipes; ALTER TABLE messages DROP COLUMN swipe_index; ALTER TABLE messages DROP COLUMN edited_at; DROP TABLE scope_state; PRAGMA user_version=3;');
  store=open();assert.equal(store.available,true);assert.equal(raw('PRAGMA user_version',true)[0].user_version,4);assert.equal(store.history('scope-a').length,2);
  store=open();assert.equal(store.available,true);assert.equal(raw('PRAGMA table_info(messages)',true).length,8);
  // Message operations.
  assert.deepEqual(store.addSwipe('scope-a','old-2','SECOND'),{id:'old-2',role:'assistant',text:'SECOND',at:6,edited:false,swipeIndex:1,swipeCount:2});
  assert.throws(()=>store.addSwipe('scope-a','old-1','x'),{code:'social_invalid_input'});assert.throws(()=>store.addSwipe('scope-a','old-2','x'.repeat(2001)),{code:'social_invalid_input'});
  assert.equal(store.addSwipe('scope-a','old-2','x'.repeat(8000),{maxChars:8000}).swipeCount,3);assert.throws(()=>store.addSwipe('scope-a','old-2','x'.repeat(8001),{maxChars:8001}),{code:'social_invalid_input'});
  at+=10;assert.deepEqual(store.editMessage('scope-a','old-1','EDITED'),{id:'old-1',role:'user',text:'EDITED',at:5,edited:true,swipeIndex:0,swipeCount:1});
  assert.equal(store.editMessage('scope-a','old-2','CONTINUED',{edited:false}).edited,false);assert.deepEqual(store.message('scope-a','old-2').swipes,['OLD_REPLY','SECOND','CONTINUED']);
  assert.deepEqual(store.selectSwipe('scope-a','old-2',0),{id:'old-2',role:'assistant',text:'OLD_REPLY',at:6,edited:false,swipeIndex:0,swipeCount:3});
  for(const call of [()=>store.selectSwipe('scope-a','old-2',3),()=>store.selectSwipe('scope-a','old-1',1),()=>store.editMessage('scope-a','old-1',''),()=>store.editMessage('scope-a','old-1','a\x00b'),()=>store.editMessage('scope-a','nope','x'),()=>store.removeMessage('scope-b','old-1'),()=>store.append('scope-a',{role:'user',text:'x'.repeat(2001)})])assert.throws(call,{code:'social_invalid_input'});
  assert.equal(store.available,true);
  // The duplicate-identifier rule and the 2000-character default still hold; the larger bound is per call.
  assert.deepEqual(store.append('scope-a',{id:'old-1',role:'user',text:'EDITED',at:99}),{id:'old-1',role:'user',text:'EDITED',at:5});
  assert.throws(()=>store.append('scope-a',{id:'old-1',role:'user',text:'DIFFERENT'}),/different content/);
  assert.equal(store.append('scope-a',{id:'long',role:'assistant',text:'x'.repeat(8000),at:7},{maxChars:8000}).text.length,8000);
  // Pruning keeps the newest 120 rows of the scope, alternatives included or not.
  for(let i=0;i<130;i++)store.append('scope-a',{id:'bulk-'+i,role:i%2?'assistant':'user',text:'BULK_'+i,at:1000+i});
  assert.equal(store.messageCount('scope-a'),120);assert.equal(store.history('scope-a',120)[0].id,'bulk-10');assert.throws(()=>store.message('scope-a','old-2'),{code:'social_invalid_input'});
  assert.deepEqual(store.removeMessage('scope-a','bulk-10'),{removed:true});assert.equal(store.messageCount('scope-a'),119);
  // Lorebook state: per scope, removed with the conversation it was derived from.
  assert.equal(store.worldInfoState('scope-a'),'');assert.equal(store.setWorldInfoState('scope-a','{"turn":1}'),'{"turn":1}');store.setWorldInfoState('scope-b','{"turn":9}');
  assert.equal(new SocialStore({root,now:()=>at}).worldInfoState('scope-a'),'{"turn":1}');assert.throws(()=>store.setWorldInfoState('scope-a','x'.repeat(200001)),{code:'social_invalid_input'});
  const fact=store.remember('scope-a',{text:'A fact'});store.forgetFact('scope-a',fact.id);assert.equal(store.worldInfoState('scope-a'),'');assert.equal(store.messageCount('scope-a'),0);assert.equal(store.worldInfoState('scope-b'),'{"turn":9}');
  store.clear('scope-b');assert.equal(store.worldInfoState('scope-b'),'');assert.equal(store.setWorldInfoState('scope-b',''),'');
  // Versions 5 (conversation branches) and 6 (group speakers) are written only by a store opened with branches:true; a
  // plain store accepts it without changing the number. A newer database is refused, as before.
  raw('PRAGMA user_version=5;');assert.equal(open().available,true);assert.equal(raw('PRAGMA user_version',true)[0].user_version,5);
  raw('PRAGMA user_version=6;');assert.equal(open().available,true);assert.equal(raw('PRAGMA user_version',true)[0].user_version,6);
  raw('PRAGMA user_version=7;');assert.equal(open().available,false);
});
