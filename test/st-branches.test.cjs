'use strict';
// Conversation branches (checkpoints) of the App conversation: the version 5 storage, the scope
// limit and reclaim rules, and the service operations. A real SQLite store in a temporary
// directory and an injected runner; no network and no model.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {DatabaseSync}=require('node:sqlite');
const {SocialStore}=require('../src/bot/social-store.cjs');
const {MAX_BRANCHES}=require('../src/bot/st/branch-store.cjs');
const {stScopeFor,stBranchScopeFor,localOperationResult,MAIN_BRANCH_NAME}=require('../src/bot/local-companion.cjs');
const settings=require('../src/bot/st/local-settings.cjs');
const {fixture,card,deferred}=require('./st-local-fixture.cjs');
const temp=t=>{const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-st-branch-'));t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return dir;};
const A='aaaaaaaaaaaaaaaa',B='bbbbbbbbbbbbbbbb',C='cccccccccccccccc';
const numbered=()=>async(_args,count)=>({outcome:'reply_ended',text:'REPLY_'+count});
const mira=()=>card('Mira',{description:'Keeper of the light.',first_mes:'Hello.'});

test('storage: version 4 migrates to 5 in place only for a store opened with branches; the default store is unchanged',t=>{
  const root=temp(t),file=path.join(root,'social-memory.sqlite');let at=1000;
  const raw=(sql,all)=>{const db=new DatabaseSync(file);try{return all?db.prepare(sql).all():db.exec(sql);}finally{db.close();}};
  const tables=()=>raw("SELECT name FROM sqlite_master WHERE type='table'",true).map(row=>row.name);
  // Today's earlier build: version 4, no branch tables.
  let store=new SocialStore({root,now:()=>at++});
  store.append('main',{id:'m1',role:'user',text:'ONE'});store.append('main',{id:'m2',role:'assistant',text:'TWO'});store.addSwipe('main','m2','TWO_B');store.setWorldInfoState('main','{"turn":2}');const fact=store.remember('main',{text:'A fact'});
  assert.equal(raw('PRAGMA user_version',true)[0].user_version,4);assert(!tables().includes('branches'));
  assert.throws(()=>store.branches('main'),{code:'social_invalid_input'});assert.throws(()=>store.registerConversation('main'),{code:'social_invalid_input'});assert.equal(store.available,true);
  // The App conversation's store: same file, version 6 (5: branches, 6: group speaker columns), every row kept.
  const open=(options={})=>new SocialStore({root,now:()=>at++,maxScopes:100,branches:true,...options});
  store=open();assert.equal(store.available,true);assert.equal(raw('PRAGMA user_version',true)[0].user_version,6);assert(tables().includes('branches'));assert(tables().includes('conversation_scopes'));
  assert.deepEqual(store.history('main').map(row=>row.text),['ONE','TWO_B']);assert.deepEqual(store.message('main','m2').swipes,['TWO','TWO_B']);assert.equal(store.worldInfoState('main'),'{"turn":2}');assert.deepEqual(store.facts('main').map(row=>row.id),[fact.id]);
  assert.deepEqual(store.branches('main'),[]);store=open();assert.equal(store.available,true);assert.equal(raw('PRAGMA user_version',true)[0].user_version,6);
  // A store without the option still reads a version 6 file and leaves the number alone.
  const plain=new SocialStore({root,now:()=>at++});assert.equal(plain.available,true);assert.equal(plain.history('main').length,2);assert.equal(raw('PRAGMA user_version',true)[0].user_version,6);assert.throws(()=>plain.branches('main'),{code:'social_invalid_input'});
  raw('PRAGMA user_version=7;');assert.equal(open().available,false);assert.equal(new SocialStore({root}).available,false);
  for(const bad of [{maxScopes:0},{maxScopes:101},{maxScopes:2.5},{branches:1}])assert.throws(()=>new SocialStore({root:temp(t),...bad}),{code:'social_invalid_input'});
  // A fresh branch-enabled database starts at version 6.
  const fresh=temp(t);assert.equal(new SocialStore({root:fresh,branches:true}).available,true);
  const db=new DatabaseSync(path.join(fresh,'social-memory.sqlite'));assert.equal(db.prepare('PRAGMA user_version').get().user_version,6);db.close();
});

test('storage: a branch copies the conversation up to a message with its alternatives, edits and lorebook state',t=>{
  let at=1000;const store=new SocialStore({root:temp(t),now:()=>at++,maxScopes:100,branches:true});
  for(const [id,role,text] of [['m1','assistant','GREETING'],['m2','user','QUESTION'],['m3','assistant','ANSWER'],['m4','user','LATER']])store.append('main',{id,role,text,at:500});
  store.addSwipe('main','m3','ANSWER_B');store.editMessage('main','m2','QUESTION_EDITED');store.setWorldInfoState('main','{"turn":3}');
  const created=store.createBranch('main',{id:A,scope:'branch-a',sourceScope:'main',messageId:'m3',name:'  First fork  '});
  assert.deepEqual(created,{id:A,name:'First fork',parentBranchId:null,forkedFromMessageId:'m3',createdAt:created.createdAt,messages:3});
  // Same timestamps: insertion order decides, so "up to and including" is exact.
  assert.deepEqual(store.history('branch-a',10,{details:true}),store.history('main',10,{details:true}).slice(0,3));assert.deepEqual(store.message('branch-a','m3').swipes,['ANSWER','ANSWER_B']);
  assert.equal(store.history('branch-a',10,{details:true})[1].edited,true);assert.equal(store.worldInfoState('branch-a'),'{"turn":3}');assert.deepEqual(store.facts('branch-a'),[]);
  // The copy is independent in both directions.
  store.append('branch-a',{id:'b1',role:'user',text:'ONLY_IN_BRANCH'});store.editMessage('branch-a','m1','BRANCH_GREETING');store.removeMessage('main','m4');
  assert.deepEqual(store.history('main').map(row=>row.text),['GREETING','QUESTION_EDITED','ANSWER_B']);assert.deepEqual(store.history('branch-a').map(row=>row.text),['BRANCH_GREETING','QUESTION_EDITED','ANSWER_B','ONLY_IN_BRANCH']);
  // A branch of a branch; listing, lookup and rename.
  const child=store.createBranch('main',{id:B,scope:'branch-b',sourceScope:'branch-a',parentId:A,messageId:'b1',name:'Child'});assert.deepEqual([child.parentBranchId,child.messages],[A,4]);
  const grand=store.createBranch('main',{id:C,scope:'branch-c',sourceScope:'branch-b',parentId:B,messageId:'m1',name:'Grandchild'});assert.equal(grand.messages,1);
  assert.deepEqual(store.branches('main').map(row=>[row.id,row.parentBranchId,row.messages]),[[A,null,4],[B,A,4],[C,B,1]]);assert.deepEqual(store.branch('main',B),child);assert.equal(store.branch('main','dddddddddddddddd'),null);assert.deepEqual(store.branches('other'),[]);
  assert.equal(store.renameBranch('main',B,'Renamed child').name,'Renamed child');assert.throws(()=>store.renameBranch('main','dddddddddddddddd','x'),{reason:'branch_not_found'});assert.throws(()=>store.renameBranch('other',B,'x'),{reason:'branch_not_found'});
  // Refusals leave everything as it was.
  const bad=[{id:A,scope:'x',sourceScope:'main',messageId:'m1',name:'dup'},{id:'nope',scope:'x',sourceScope:'main',messageId:'m1',name:'n'},{id:'dddddddddddddddd',scope:'x',sourceScope:'main',messageId:'m1',name:''},{id:'dddddddddddddddd',scope:'x',sourceScope:'main',messageId:'m1',name:'n'.repeat(61)},
    {id:'dddddddddddddddd',scope:'x',sourceScope:'main',messageId:'m1',name:'a\nb'},{id:'dddddddddddddddd',scope:'main',sourceScope:'main',messageId:'m1',name:'n'},{id:'dddddddddddddddd',scope:'branch-a',sourceScope:'main',messageId:'m1',name:'n'},{id:'dddddddddddddddd',scope:'x',sourceScope:'main',messageId:'',name:'n'}];
  for(const value of bad)assert.throws(()=>store.createBranch('main',value),{code:'social_invalid_input'},JSON.stringify(value));
  assert.throws(()=>store.createBranch('main',{id:'dddddddddddddddd',scope:'x',sourceScope:'main',messageId:'missing',name:'n'}),{reason:'message_not_found'});
  assert.throws(()=>store.createBranch('main',{id:'dddddddddddddddd',scope:'x',sourceScope:'branch-a',messageId:'m1',name:'n'}),{reason:'branch_not_found'});
  assert.throws(()=>store.createBranch('main',{id:'dddddddddddddddd',scope:'x',sourceScope:'main',parentId:A,messageId:'m1',name:'n'}),{reason:'branch_not_found'});
  assert.equal(store.available,true);assert.equal(store.branches('main').length,3);assert.equal(store.messageCount('x'),0);
  // Removing a branch erases its copy and re-parents its children to its parent.
  assert.deepEqual(store.removeBranch('main',B),{removed:true});assert.equal(store.messageCount('branch-b'),0);assert.equal(store.worldInfoState('branch-b'),'');
  assert.deepEqual(store.branches('main').map(row=>[row.id,row.parentBranchId]),[[A,null],[C,A]]);assert.throws(()=>store.removeBranch('main',B),{reason:'branch_not_found'});
  assert.deepEqual(store.removeBranch('main',A),{removed:true});assert.deepEqual(store.branches('main').map(row=>[row.id,row.parentBranchId,row.messages]),[[C,null,1]]);
  assert.deepEqual(store.removeBranches('main'),{removed:1});assert.deepEqual(store.branches('main'),[]);assert.equal(store.messageCount('branch-c'),0);assert.equal(store.messageCount('main'),3);
  // At most MAX_BRANCHES per conversation.
  for(let i=0;i<MAX_BRANCHES;i++)store.createBranch('main',{id:i.toString(16).padStart(16,'0'),scope:'many-'+i,sourceScope:'main',messageId:'m1',name:'Branch '+i});
  assert.throws(()=>store.createBranch('main',{id:'dddddddddddddddd',scope:'many-x',sourceScope:'main',messageId:'m1',name:'n'}),{reason:'branch_limit'});assert.equal(store.branches('main').length,MAX_BRANCHES);
});

test('storage: forgetting or correcting a fact drops the root conversation and every branch copy in one step',t=>{
  let at=1000;const store=new SocialStore({root:temp(t),now:()=>at++,maxScopes:100,branches:true});
  store.append('main',{id:'m1',role:'user',text:'my secret is BLUE'});store.append('main',{id:'m2',role:'assistant',text:'noted: BLUE'});store.setWorldInfoState('main','{"turn":1}');
  const fact=store.remember('main',{text:'secret BLUE',sourceIds:['m1']}),other=store.remember('main',{text:'likes tea'});
  store.createBranch('main',{id:A,scope:'branch-a',sourceScope:'main',messageId:'m2',name:'Fork'});store.createBranch('main',{id:B,scope:'branch-b',sourceScope:'branch-a',parentId:A,messageId:'m2',name:'Fork 2'});
  store.append('branch-b',{id:'fix',role:'user',text:'更正：GREEN'});store.append('unrelated',{id:'u1',role:'user',text:'KEPT'});store.setWorldInfoState('unrelated','{"turn":7}');
  // A correction typed in a branch keeps that one message; it cannot be a source of the root's fact.
  assert.throws(()=>store.correctFact('main',fact.id,{text:'secret GREEN',sourceIds:['fix']}),{code:'social_invalid_input'});assert.equal(store.messageCount('branch-a'),2);
  assert.throws(()=>store.correctFact('main',fact.id,{text:'secret GREEN',keepIds:'fix'}),{code:'social_invalid_input'});
  assert.equal(store.correctFact('main',fact.id,{text:'secret GREEN',keepIds:['fix']}).text,'secret GREEN');
  assert.equal(store.messageCount('main'),0);assert.equal(store.messageCount('branch-a'),0);assert.deepEqual(store.history('branch-b').map(row=>row.id),['fix']);
  for(const scope of ['main','branch-a','branch-b'])assert.equal(store.worldInfoState(scope),'');
  assert.deepEqual(store.history('unrelated').map(row=>row.text),['KEPT']);assert.equal(store.worldInfoState('unrelated'),'{"turn":7}');assert.equal(store.branches('main').length,2);
  store.append('branch-a',{id:'again',role:'assistant',text:'GREEN it is'});store.forgetFact('main',fact.id);
  assert.equal(store.messageCount('branch-a'),0);assert.equal(store.messageCount('branch-b'),0);assert.deepEqual(store.facts('main').map(row=>row.id),[other.id]);
});

test('storage: the scope limit is per store, branches count, and reclaim never takes a registered conversation or a branch',t=>{
  let at=Date.UTC(2026,0,1);
  // Default: twenty scopes, exactly as before.
  const plain=new SocialStore({root:temp(t),now:()=>at++});for(let i=0;i<20;i++)plain.append('scope-'+i,{role:'user',text:'x'});
  assert.throws(()=>plain.append('scope-20',{role:'user',text:'x'}),{reason:'scope_limit'});
  // A small local store: three slots.
  const store=new SocialStore({root:temp(t),now:()=>at++,maxScopes:3,branches:true});
  store.append('main',{id:'m1',role:'user',text:'ONE'});store.setWorldInfoState('idle','{"turn":1}');
  store.createBranch('main',{id:A,scope:'branch-a',sourceScope:'main',messageId:'m1',name:'Fork'});
  // Full. An unregistered scope with nothing in it is reclaimed for the new branch...
  store.createBranch('main',{id:B,scope:'branch-b',sourceScope:'main',messageId:'m1',name:'Fork 2'});assert.equal(store.worldInfoState('idle'),'');assert.equal(store.branches('main').length,2);
  // ...but nothing else may be: a third branch is refused with a clear reason and nothing is copied.
  assert.throws(()=>store.createBranch('main',{id:C,scope:'branch-c',sourceScope:'main',messageId:'m1',name:'Fork 3'}),error=>error.reason==='scope_limit'&&/scope limit reached/.test(error.message));
  assert.equal(store.branches('main').length,2);assert.equal(store.messageCount('branch-c'),0);assert.equal(store.available,true);
  // An emptied branch and an emptied root stay registered and are never reclaimed.
  store.removeMessage('branch-a','m1');store.setWorldInfoState('branch-a','{"turn":4}');store.removeMessage('main','m1');store.setWorldInfoState('main','{"turn":5}');at+=40*86400000;
  assert.throws(()=>store.append('newcomer',{role:'user',text:'x'}),{reason:'scope_limit'});assert.throws(()=>store.setWorldInfoState('newcomer','{}'),{reason:'scope_limit'});
  assert.equal(store.worldInfoState('branch-a'),'{"turn":4}');assert.equal(store.worldInfoState('main'),'{"turn":5}');assert.equal(store.branch('main',A).messages,0);
  // Removing a branch frees its slot.
  store.removeBranch('main',B);assert.equal(store.append('newcomer',{role:'user',text:'x'}).text,'x');
  // A registered conversation without branches is protected the same way; an unregistered idle one is not.
  const two=new SocialStore({root:temp(t),now:()=>at++,maxScopes:2,branches:true});
  assert.equal(two.registerConversation('kept'),true);assert.equal(two.registerConversation('kept'),true);two.setWorldInfoState('kept','{"turn":1}');two.setWorldInfoState('loose','{"turn":2}');
  two.append('third',{role:'user',text:'x'});assert.equal(two.worldInfoState('loose'),'');assert.equal(two.worldInfoState('kept'),'{"turn":1}');
  assert.throws(()=>two.append('fourth',{role:'user',text:'x'}),{reason:'scope_limit'});assert.equal(two.worldInfoState('kept'),'{"turn":1}');
  two.removeBranches('kept');two.append('fourth',{role:'user',text:'x'});assert.equal(two.worldInfoState('kept'),'');
});

test('service: branch from a message, switch, continue independently and return to the main conversation',async t=>{
  const f=fixture(t,{execute:numbered()}),a=f.characters.add({card:mira()});await f.open(a.id);
  assert.deepEqual(f.service.stSnapshot().branch,{id:null,name:MAIN_BRANCH_NAME});assert.equal(f.service.stSnapshot().branchCount,0);assert.deepEqual(f.service.branches(),[]);assert.equal(f.service.stSnapshot().settings.branchId,null);
  await f.service.localReply('first');await f.service.localReply('second');
  const main=f.history();assert.deepEqual(main.map(row=>row.text),['Hello.','first','REPLY_1','second','REPLY_2']);
  const fork=f.service.branchFrom(main[2].id,'  Other path ');
  assert.deepEqual(fork,{id:fork.id,name:'Other path',parentBranchId:null,forkedFromMessageId:main[2].id,createdAt:fork.createdAt,messages:3});assert.match(fork.id,/^[0-9a-f]{16}$/);
  assert.deepEqual(f.service.branches(),[{...fork,active:false}]);assert.equal(f.service.snapshot().st.branchCount,1);assert.equal(f.service.localSnapshot().state,'active');assert.equal(f.history().length,5);
  // Switching is a settings change that retires the run, like choosing another character.
  const view=f.service.localSnapshot().historyId;
  const switched=f.service.stConfigure({branchId:fork.id});assert.deepEqual(switched.branch,{id:fork.id,name:'Other path'});assert.equal(switched.settings.branchId,fork.id);
  await f.service.localStop();assert.equal(f.service.localSnapshot().state,'stopped');assert.deepEqual(f.history().map(row=>row.text),['Hello.','first','REPLY_1']);assert.notEqual(f.service.localSnapshot().historyId,view);
  await f.service.localStart();assert.equal(f.scope(),stBranchScopeFor(f.root,a.id,fork.id));assert.deepEqual(f.history().map(row=>row.text),['Hello.','first','REPLY_1']);
  await f.service.localReply('other second');assert.match(f.calls.at(-1).prompt,/Mira: REPLY_1\n/);assert.doesNotMatch(f.calls.at(-1).prompt,/REPLY_2|: second\n/);
  assert.deepEqual(f.history().map(row=>row.text),['Hello.','first','REPLY_1','other second','REPLY_3']);assert.deepEqual(f.service.branches().map(row=>[row.name,row.messages,row.active]),[['Other path',5,true]]);
  // Message operations act on the active branch only.
  await f.service.localMessage({action:'edit',id:main[2].id,text:'BRANCH_EDIT'});assert.equal(f.store().message(stScopeFor(f.root,a.id),main[2].id).text,'REPLY_1');
  // A branch of the branch records its parent; the active branch cannot be removed.
  const child=f.service.branchFrom(f.history().at(-1).id);assert.deepEqual([child.name,child.parentBranchId,child.messages],['分支 2',fork.id,5]);
  assert.throws(()=>f.service.branchRemove(fork.id),{code:'branch_active'});assert.deepEqual(await localOperationResult(()=>f.service.branchRemove(fork.id)),{ok:false,code:'branch_active'});
  assert.equal(f.service.branchRename(child.id,'Deeper').name,'Deeper');
  // Back to the main conversation: untouched.
  f.service.stConfigure({branchId:null});await f.service.localStop();await f.service.localStart();assert.equal(f.scope(),stScopeFor(f.root,a.id));assert.deepEqual(f.history(),main);
  assert.deepEqual(f.service.stSnapshot().branch,{id:null,name:MAIN_BRANCH_NAME});
  // Removing the parent keeps its child, re-parented to the main conversation.
  assert.deepEqual(f.service.branchRemove(fork.id),{removed:true});assert.deepEqual(f.service.branches().map(row=>[row.id,row.parentBranchId,row.messages,row.active]),[[child.id,null,5,false]]);
  assert.equal(f.store().messageCount(stBranchScopeFor(f.root,a.id,fork.id)),0);
  // Refusals.
  assert.throws(()=>f.service.stConfigure({branchId:fork.id}),{code:'branch_not_found'});assert.throws(()=>f.service.stConfigure({branchId:'nope'}),{code:'invalid_request'});
  assert.throws(()=>f.service.branchFrom('missing'),{code:'message_not_found'});assert.throws(()=>f.service.branchFrom(main[0].id,'n'.repeat(61)),{code:'invalid_request'});assert.throws(()=>f.service.branchFrom(5),{code:'invalid_request'});assert.throws(()=>f.service.branchFrom(main[0].id,7),{code:'invalid_request'});
  assert.throws(()=>f.service.branchRename(fork.id,'x'),{code:'branch_not_found'});assert.throws(()=>f.service.branchRename(child.id,'  '),{code:'invalid_request'});assert.throws(()=>f.service.branchRemove('nope'),{code:'invalid_request'});assert.throws(()=>f.service.branchRemove(fork.id),{code:'branch_not_found'});
  // Busy while a reply is in flight.
  const entered=deferred(),finish=deferred();f.state.execute=async()=>{entered.resolve();return finish.promise;};const pending=f.service.localReply('wait');await entered.promise;
  assert.throws(()=>f.service.branchFrom(main[0].id),{code:'busy'});assert.throws(()=>f.service.branchRemove(child.id),{code:'busy'});assert.throws(()=>f.service.stConfigure({branchId:child.id}),{code:'busy'});
  finish.resolve({outcome:'reply_ended',text:'DONE'});await pending;
  // The choice survives a restart of the service; a branch that no longer exists falls back to main.
  f.service.stConfigure({branchId:child.id});await f.service.localStop();
  const again=f.make();again.configure({key:'fixture-api-key'});assert.deepEqual(again.stSnapshot().branch,{id:child.id,name:'Deeper'});assert.equal(again.localSnapshot().history.length,5);
  again.localManager()._store().removeBranch(stScopeFor(f.root,a.id),child.id);again.localManager()._branchChanged();
  assert.deepEqual(again.stSnapshot().branch,{id:null,name:MAIN_BRANCH_NAME});assert.equal(again.stSnapshot().branchCount,0);assert.equal(again.localSnapshot().history.at(-1).text,'DONE');
});

test('service: memory facts are shared by all branches of a character; erasing one drops every copy',async t=>{
  const f=fixture(t,{execute:numbered()}),a=f.characters.add({card:mira()}),root=stScopeFor(f.root,a.id);await f.open(a.id);
  await f.service.localReply('记住：the lamp is BLUE');await f.service.localReply('tell me');const main=f.history();
  const fork=f.service.branchFrom(main.at(-1).id,'Fork');f.service.stConfigure({branchId:fork.id});await f.service.localStop();await f.service.localStart();
  // The branch sees the character's facts in the prompt, the memory view and the commands.
  await f.service.localReply('and now?');assert.match(f.calls.at(-1).prompt,/the lamp is BLUE/);assert.deepEqual(f.service.localSnapshot().memory.facts.map(fact=>fact.text),['the lamp is BLUE']);
  assert.match((await f.service.localReply('查看记忆')).text,/the lamp is BLUE/);
  // A fact remembered in a branch belongs to the character.
  assert.match((await f.service.localReply('记住：the door is RED')).text,/^记住了：the door is RED/);
  assert.deepEqual(f.store().facts(root).map(fact=>fact.text).sort(),['the door is RED','the lamp is BLUE']);assert.deepEqual(f.store().facts(f.scope()),[]);
  f.service.stConfigure({branchId:null});await f.service.localStop();await f.service.localStart();
  assert.deepEqual(f.service.localSnapshot().memory.facts.map(fact=>fact.text).sort(),['the door is RED','the lamp is BLUE']);assert.deepEqual(f.history(),main);
  // Correcting from the branch: the main conversation and the branch copy both go; the correction stays.
  f.service.stConfigure({branchId:fork.id});await f.service.localStop();await f.service.localStart();const blue=f.store().facts(root).find(fact=>/BLUE/.test(fact.text));
  assert.match((await f.service.localReply(`更正 ${blue.id.slice(0,8)}：the lamp is GREEN`)).text,/本地记忆已改为：the lamp is GREEN/);
  assert.deepEqual(f.history().map(row=>row.text),[`更正 ${blue.id.slice(0,8)}：the lamp is GREEN`,'本地记忆已改为：the lamp is GREEN']);assert.equal(f.store().messageCount(root),0);
  assert(!JSON.stringify([f.store().history(root,120),f.history()]).includes('BLUE'));assert.equal(f.service.branches().length,1);
  // Forgetting from the memory page (main conversation) clears the branch as well.
  f.service.stConfigure({branchId:null});await f.service.localStop();await f.service.localStart();await f.service.localReply('the door is RED, right?');
  const view=f.service.localSnapshot().memory,red=view.facts.find(fact=>/RED/.test(fact.text));
  await f.service.localMemory({memoryId:view.id,action:'forget',id:red.id,revision:red.revision});
  assert.equal(f.store().messageCount(root),0);assert.equal(f.store().messageCount(stBranchScopeFor(f.root,a.id,fork.id)),0);assert.deepEqual(f.store().facts(root).map(fact=>fact.text),['the lamp is GREEN']);
});

test('service: clearing a conversation removes its branches; another character starts on its own main conversation',async t=>{
  const f=fixture(t,{execute:numbered()}),a=f.characters.add({card:mira()}),b=f.characters.add({card:card('Beta',{first_mes:'I am Beta.'})});await f.open(a.id);await f.service.localReply('one');
  const fork=f.service.branchFrom(f.history().at(-1).id,'Fork');f.service.stConfigure({branchId:fork.id});await f.service.localStop();await f.service.localStart();await f.service.localReply('two');
  assert.deepEqual(f.service.stConversations().map(item=>[item.name,item.messages,item.branches]),[['Mira',3,1]]);
  // Choosing another character leaves the branch behind; coming back starts on main unless a branch is named.
  assert.equal(f.service.stConfigure({characterId:b.id}).settings.branchId,null);await f.service.localStop();await f.service.localStart();assert.deepEqual(f.history().map(row=>row.text),['I am Beta.']);assert.deepEqual(f.service.branches(),[]);
  assert.throws(()=>f.service.stConfigure({branchId:fork.id}),{code:'branch_not_found'});assert.throws(()=>f.service.branchFrom('missing'),{code:'message_not_found'});
  assert.deepEqual(f.service.stConfigure({characterId:a.id,branchId:fork.id}).branch,{id:fork.id,name:'Fork'});await f.service.localStop();await f.service.localStart();assert.equal(f.history().at(-1).text,'REPLY_2');
  // Clearing while the branch is active: every copy goes, the setting returns to main, the run is retired.
  assert.deepEqual(f.service.stClearConversation(a.id),{cleared:true});await f.service.localStop();
  assert.equal(f.service.stSnapshot().settings.branchId,null);assert.deepEqual(f.service.branches(),[]);assert.equal(f.store().messageCount(stScopeFor(f.root,a.id)),0);assert.equal(f.store().messageCount(stBranchScopeFor(f.root,a.id,fork.id)),0);
  assert.deepEqual(f.service.stConversations().map(item=>item.name),['Beta']);
  await f.service.localStart();assert.deepEqual(f.history().map(row=>row.text),['Hello.']);
  // Clearing on the main conversation keeps the run and greets again.
  f.service.branchFrom(f.history()[0].id);assert.deepEqual(f.service.stClearConversation(a.id),{cleared:true});assert.equal(f.service.localSnapshot().state,'active');assert.deepEqual(f.history().map(row=>row.text),['Hello.']);assert.deepEqual(f.service.branches(),[]);
  // Built-in persona or no libraries: no branches.
  f.service.stConfigure({characterId:null});await f.service.localStop();assert.deepEqual(f.service.branches(),[]);assert.throws(()=>f.service.branchFrom('x'),{code:'unsupported'});assert.deepEqual(f.service.stSnapshot().branch,{id:null,name:MAIN_BRANCH_NAME});
  const bare=fixture(t,{libraries:false});assert.deepEqual(bare.service.branches(),[]);assert.throws(()=>bare.service.branchFrom('x'),{code:'unavailable'});assert.equal(bare.service.stSnapshot().branch,null);
  // Settings: a branch needs a character, and the id has a fixed shape.
  assert.throws(()=>settings.validate({branchId:A}),{code:'st_settings_invalid'});assert.throws(()=>settings.validate({characterId:A,branchId:'x'}),{code:'st_settings_invalid'});
  assert.equal(settings.validate({characterId:A,branchId:B}).branchId,B);assert.equal(settings.patch(settings.validate({characterId:A,branchId:B}),{characterId:C}).branchId,null);assert.equal(settings.patch(settings.validate({characterId:A,branchId:B}),{characterId:null}).branchId,null);
});
