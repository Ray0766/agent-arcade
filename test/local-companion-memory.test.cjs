'use strict';
// Real isolated SQLite and registered main IPC. No provider or channel requests.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {BotService}=require('../src/bot/service.cjs');
const {LocalCompanion,scopeFor,localMemoryResult}=require('../src/bot/local-companion.cjs');
const {localMainHarness}=require('./helpers/desktop-local-main-harness.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
const voice=close=>({close,record(){},snapshot:()=>({status:'speaking',scope:'synthetic-voice',mode:'push-to-talk'}),diagnostics:()=>({events:[]})});
function fixture(t,execute){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-local-memory-')),services=[],calls=[];
 const make=(dir=root)=>{const service=new BotService({root:dir,vault,runnerFactory:()=>async args=>{calls.push(args);return execute?execute(args):{outcome:'reply_ended',text:'Synthetic reply'};},qqClientFactory:()=>assert.fail('Memory must not open QQ')});services.push(service);return service;};
 const service=make();
 t.after(async()=>{for(const item of services)await item.disconnect().catch(()=>{});const target=fs.realpathSync(root);assert.equal(path.dirname(target),fs.realpathSync(os.tmpdir()));assert(path.basename(target).startsWith('arcade-local-memory-'));fs.rmSync(target,{recursive:true,force:true});});
 const memory=()=>service.localSnapshot().memory;
 const edit=(action,values={},options)=>service.localMemory({memoryId:memory().id,action,...values},options);
 return {root,service,make,calls,memory,edit};
}
test('paused real SQLite CRUD needs neither API key nor QQ and reopens in the same role only',async t=>{
 const f=fixture(t),s=f.service;assert.equal(s.localSnapshot().reason,'credentials_missing');assert.equal(f.memory().available,true);
 s.socialStore.remember('qq-control',{text:'QQ_ONLY'});const qq=s.socialStore.facts('qq-control');
 await f.edit('remember',{text:'LOCAL_ONLY'});const fact=f.memory().facts[0];assert.equal(fact.revision,1);assert.deepEqual(fact.sourceIds,[]);
 const store=s.localManager().store,scope=scopeFor(f.root,s.localSnapshot().characterId);store.append(scope,{id:'old-derived',role:'assistant',text:'LOCAL_ONLY paraphrase'});store.setNotes(scope,'LOCAL_ONLY note');
 await f.edit('correct',{id:fact.id,revision:fact.revision,text:'LOCAL_CORRECTED'});assert.equal(f.memory().facts[0].revision,2);assert.deepEqual(store.history(scope),[]);assert.equal(store.getNotes(scope),'');
 const reopened=f.make();assert.equal(reopened.localSnapshot().memory.facts[0].text,'LOCAL_CORRECTED');assert.notEqual(reopened.localSnapshot().memory.id,f.memory().id);
 s.socialConfigure({characterId:'deepseek-whale'});assert.deepEqual(f.memory().facts,[]);await f.edit('remember',{text:'OTHER_ROLE'});s.socialConfigure({characterId:'claude-ju'});assert.equal(f.memory().facts[0].text,'LOCAL_CORRECTED');
 const otherDir=path.join(f.root,'other-profile');fs.mkdirSync(otherDir);assert.deepEqual(f.make(otherDir).localSnapshot().memory.facts,[]);
 const corrected=f.memory().facts[0];await f.edit('forget',{id:corrected.id,revision:corrected.revision});assert.deepEqual(f.memory().facts,[]);assert.deepEqual(s.socialStore.facts('qq-control'),qq);assert.equal(f.calls.length,0);assert.equal(s.status,'disconnected');
});
test('unsupported runner and locked credentials do not block valid local data management',async t=>{
 const f=fixture(t);f.service.configure({mode:'codex'});assert.equal(f.service.localSnapshot().supported,false);assert.equal(f.memory().available,true);await f.edit('remember',{text:'OFFLINE_DATA'});
 const before=f.memory().id;f.service.lockCredentials();assert.notEqual(f.memory().id,before);assert.equal(f.memory().available,true);await f.edit('remember',{text:'LOCKED_DATA'});assert.equal(f.memory().facts.length,2);assert.equal(f.calls.length,0);
 const invalid=new LocalCompanion({root:f.root,capture:()=>({mode:'api',character:'not-a-catalog-role'}),createExecute:()=>assert.fail()});assert.deepEqual(invalid.snapshot().memory,{id:null,available:false,reason:'unavailable',facts:[]});
});
test('fact revision and scope tickets reject stale correction or erasure without changing records',async t=>{
 const f=fixture(t);await f.edit('remember',{text:'ORIGINAL'});const before=f.memory(),fact=before.facts[0];await f.edit('correct',{id:fact.id,revision:1,text:'NEWER'});
 for(const action of ['correct','forget'])await assert.rejects(f.edit(action,{id:fact.id,revision:1,...(action==='correct'?{text:'STALE'}:{})}),{code:'fact_changed'});
 await assert.rejects(f.edit('forget',{id:'not-owned',revision:1}),{code:'fact_not_found'});assert.equal(f.memory().facts[0].text,'NEWER');
 f.service.socialConfigure({characterId:'deepseek-whale'});await assert.rejects(f.service.localMemory({memoryId:before.id,action:'remember',text:'WRONG_ROLE'}),{code:'changed'});assert.deepEqual(f.memory().facts,[]);
});
test('request validation is exact, bounded and projects only safe error codes',async t=>{
 const f=fixture(t),id=f.memory().id;
 for(const request of [{memoryId:id,action:'constructor'}, {memoryId:id,action:'remember',text:'x',scope:'qq'}, {memoryId:id,action:'forget',id:'a'}, {memoryId:id,action:'correct',id:'a',revision:0,text:'x'}])await assert.rejects(f.service.localMemory(request),{code:'invalid_request'});
 for(const text of ['', ' '.repeat(10),'x'.repeat(501),'x\u0000y'])await assert.rejects(f.edit('remember',{text}),{code:'invalid_memory'});
 assert.deepEqual(await localMemoryResult(()=>{throw Object.assign(Error('PRIVATE_BODY'),{code:'constructor'});}),{ok:false,code:'unavailable'});assert.deepEqual(f.memory().facts,[]);
});
test('editing cancels and waits for the actual old local prompt, refuses concurrent inputs and omits late text',async t=>{
 const entered=deferred(),finish=deferred(),f=fixture(t,async args=>{entered.resolve(args);return finish.promise;});f.service.configure({key:'synthetic-key'});await f.edit('remember',{text:'OLD_FACT'});await f.service.localStart();const fact=f.memory().facts[0];
 const reply=f.service.localReply('synthetic pending question'),args=await entered.promise;let complete=false;const mutation=f.edit('correct',{id:fact.id,revision:1,text:'NEW_FACT'}).then(()=>complete=true);
 assert.equal(args.signal.aborted,true);assert.equal(f.memory().reason,'busy');assert.throws(()=>f.service.localReply('racing input'),{code:'busy'});await assert.rejects(f.service.localStart(),{code:'busy'});await assert.rejects(f.edit('remember',{text:'RACING_FACT'}),{code:'busy'});
 await new Promise(r=>setImmediate(r));assert.equal(complete,false);assert.equal(f.memory().facts[0].text,'OLD_FACT');finish.resolve({outcome:'reply_ended',text:'LATE_OLD_FACT'});assert.equal((await reply).outcome,'cancelled');await mutation;
 assert.equal(f.memory().facts[0].text,'NEW_FACT');assert.doesNotMatch(JSON.stringify(f.service.localSnapshot()),/LATE_OLD_FACT/);assert.equal(f.service.localSnapshot().state,'active');
});
test('a typed memory command already awaiting an old turn is cancelled before the visual write',async t=>{
 const entered=deferred(),finish=deferred(),f=fixture(t,async()=>{entered.resolve();return finish.promise;});f.service.configure({key:'synthetic-key'});await f.service.localStart();const old=f.service.localReply('old question');await entered.promise;
 const typed=f.service.localReply('记住：STALE_TYPED_FACT');const mutation=f.edit('remember',{text:'EXPLICIT_VISUAL_FACT'});finish.resolve({outcome:'reply_ended',text:'late'});await old;assert.equal((await typed).outcome,'cancelled');await mutation;assert.deepEqual(f.memory().facts.map(x=>x.text),['EXPLICIT_VISUAL_FACT']);
});
test('selection/config changes during preparation reject the old write and failed cleanup never writes',async t=>{
 for(const change of ['selection','role','key','stop'])await t.test(change,async t=>{
  const f=fixture(t),gate=deferred();let current=true;f.service.configure({key:'synthetic-key'});await f.service.localStart();const pending=f.edit('remember',{text:'STALE_WRITE'},{assertCurrent:()=>{if(!current)throw Object.assign(Error('changed'),{code:'changed'});},prepare:()=>gate.promise});
  if(change==='selection')current=false;if(change==='role')f.service.socialConfigure({characterId:'deepseek-whale'});if(change==='key')f.service.configure({key:'changed-key'});if(change==='stop')await f.service.localStop();
  gate.resolve();await assert.rejects(pending,{code:'changed'});assert(!JSON.stringify(f.memory()).includes('STALE_WRITE'));
 });
 const f=fixture(t);await assert.rejects(f.edit('remember',{text:'NOT_SAVED'},{prepare:async()=>{throw Error('Synthetic cleanup failure');}}));assert.deepEqual(f.memory().facts,[]);await f.edit('remember',{text:'EXPLICIT_RETRY'});assert.equal(f.memory().facts[0].text,'EXPLICIT_RETRY');
});
test('actual registered IPC edits local data from the relationship page without choosing or starting App chat',async t=>{
 const f=fixture(t),h=localMainHarness();h.accounts.services.set('a',f.service);h.api.setup(f.service,h.accounts,h.win);
 const request={accountId:'a',memoryId:f.memory().id,action:'remember',text:'IPC_LOCAL_ONLY'};
 assert.equal(h.api.desktopConversations.kind(),'channel');assert.deepEqual(await h.invoke('desktopLocalMemory',request),{ok:true,accountId:'a',memoryId:request.memoryId,action:'remember'});assert.equal(f.memory().facts[0].text,'IPC_LOCAL_ONLY');assert.equal(f.calls.length,0);assert.equal(f.service.localSnapshot().state,'stopped');assert.equal(h.runtimes.length,0);
 assert.equal((await h.invoke('desktopLocalMemory',{...request,accountId:'b'})).code,'changed');assert.equal((await h.invoke('desktopLocalMemory',{...request,scope:'qq'})).code,'invalid_request');await assert.rejects(h.invoke('desktopLocalMemory',request,{untrusted:true}),/Untrusted sender/);
 let exposed,invoked;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_key,value)=>exposed=value},ipcRenderer:{invoke:(...args)=>invoked=args,on(){},removeListener(){}}})});exposed.desktopLocalMemory(request);assert.deepEqual(invoked,['arcade:desktopLocalMemory',request]);
});
test('actual IPC stops only owned local playback before a mutation; failure leaves data intact and QQ audio untouched',async t=>{
 const f=fixture(t),h=localMainHarness();h.accounts.services.set('a',f.service);h.api.setup(f.service,h.accounts,h.win);const request=()=>({accountId:'a',memoryId:f.memory().id,action:'remember',text:'AFTER_AUDIO'});let local=0,qq=0;
 const previous=voice(async()=>{local++;throw Error('cleanup not confirmed');});h.api.installVoice('a',previous,{kind:'local'});
 assert.equal((await h.invoke('desktopLocalMemory',request())).ok,false);assert.equal(local,1);assert.deepEqual(f.memory().facts,[]);
 previous.close=async()=>{local++;};h.api.installVoice('a',voice(async()=>{qq++;}),{kind:'channel'});assert.equal((await h.invoke('desktopLocalMemory',request())).ok,true);assert.equal(qq,0);assert.equal(local,2);
 h.api.installVoice('a',voice(async()=>{local++;}),{kind:'local'});assert.equal((await h.invoke('desktopLocalMemory',{...request(),text:'AFTER_EXPLICIT_RETRY'})).ok,true);assert.equal(local,3);
});
test('actual IPC does not write after the selected profile or foreground choice changes while local audio settles',async t=>{
 for(const change of ['profile','source'])await t.test(change,async t=>{
  const f=fixture(t),h=localMainHarness(),gate=deferred();h.accounts.services.set('a',f.service);h.api.setup(f.service,h.accounts,h.win);h.api.installVoice('a',voice(()=>gate.promise),{kind:'local'});
  const pending=h.invoke('desktopLocalMemory',{accountId:'a',memoryId:f.memory().id,action:'remember',text:'OLD_SELECTION'});
  if(change==='profile'){h.accounts.select('b');h.api.setup(h.b,h.accounts,h.win);}else h.api.desktopConversations.invalidate();
  gate.resolve();assert.equal((await pending).code,'changed');assert.deepEqual(f.memory().facts,[]);
 });
});
test('real publish retires App audio before prepare, and the registered mutation waits for that exact retirement',async t=>{
 const f=fixture(t),h=localMainHarness(),gate=deferred();f.service.configure({key:'synthetic-key'});h.accounts.services.set('a',f.service);h.api.setup(f.service,h.accounts,h.win);await h.choose();
 const source={...f.service.localConversationContext(),bot:f.service,accountId:'a'};let closes=0;h.api.installVoice('a',voice(async()=>{closes++;await gate.promise;}),source);f.service.onChange=h.api.publish;
 let settled=false;const pending=h.invoke('desktopLocalMemory',{accountId:'a',memoryId:f.memory().id,action:'remember',text:'AFTER_PUBLISHED_CLOSE'}).then(result=>{settled=true;return result;});
 await new Promise(r=>setImmediate(r));assert.equal(closes,1);assert.equal(h.api.voiceState().voice,null);assert.equal(settled,false);assert.deepEqual(f.memory().facts,[]);
 gate.resolve();assert.equal((await pending).ok,true);assert.equal(f.memory().facts[0].text,'AFTER_PUBLISHED_CLOSE');f.service.onChange=()=>{};
});
test('pending actual App voice startup is retired before memory changes and cannot create its late host',async t=>{
 const f=fixture(t),gate=deferred(),h=localMainHarness({asrCleanup:gate.promise});f.service.configure({key:'synthetic-key'});h.accounts.services.set('a',f.service);h.api.setup(f.service,h.accounts,h.win);await h.choose();
 const snapshot=f.service.localSnapshot(),start=h.invoke('voiceStart',{accountId:'a',panelId:'pending-voice',sourceKind:'local',localGeneration:snapshot.generation,localCharacterId:snapshot.characterId,mode:'push-to-talk'});const ended=assert.rejects(start,/changed|cancelled/);
 await new Promise(r=>setImmediate(r));assert.equal(h.runtimes.length,0);
 assert.equal((await h.invoke('desktopLocalMemory',{accountId:'a',memoryId:f.memory().id,action:'remember',text:'AFTER_PENDING_START'})).ok,true);
 gate.resolve();await ended;assert.equal(h.runtimes.length,0);assert.equal(f.memory().facts[0].text,'AFTER_PENDING_START');
});
test('in-flight App device discovery is awaited, including its owned probe cleanup failure',async t=>{
 for(const fail of [false,true])await t.test(fail?'cleanup failure':'cleanup complete',async t=>{
  const f=fixture(t),gate=deferred(),entered=deferred();let closes=0;
  const h=localMainHarness({capabilities:async options=>{const probe={async close(){closes++;if(fail)throw Error('Synthetic probe cleanup failure');}};entered.resolve();try{await gate.promise;return {selectedBackend:'windows'};}finally{await options.closeRuntime(probe);}}});
  f.service.configure({key:'synthetic-key'});h.accounts.services.set('a',f.service);h.api.setup(f.service,h.accounts,h.win);await h.choose();const s=f.service.localSnapshot();
  const discovery=h.invoke('voiceCapabilities',{accountId:'a',panelId:'probe',sourceKind:'local',localGeneration:s.generation,localCharacterId:s.characterId});const rejected=assert.rejects(discovery);await entered.promise;
  let settled=false;const edit=h.invoke('desktopLocalMemory',{accountId:'a',memoryId:f.memory().id,action:'remember',text:'AFTER_PROBE'}).then(r=>{settled=true;return r;});await new Promise(r=>setImmediate(r));assert.equal(settled,false);assert.deepEqual(f.memory().facts,[]);
  gate.resolve();await rejected;assert.equal((await edit).ok,!fail);assert(closes>=1);assert.equal(f.memory().facts.length,fail?0:1);assert.equal(h.runtimes.length,0);
 });
});
