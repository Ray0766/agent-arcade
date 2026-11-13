'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {BotService}=require('../src/bot/service.cjs');
const {scopeFor}=require('../src/bot/local-companion.cjs');
const {localMainHarness}=require('./helpers/desktop-local-main-harness.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-local-history-')),calls=[];
 const service=new BotService({root,vault:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},runnerFactory:()=>async args=>{calls.push(args);return {outcome:'reply_ended',text:'Synthetic local answer'};},qqClientFactory:()=>assert.fail('History must not open QQ')});
 service.configure({key:'synthetic-history-key'});
 const manager=service.localManager(),store=manager._store(true),scope=scopeFor(root,service.localSnapshot().characterId);
 t.after(async()=>{await service.disconnect();const target=fs.realpathSync(root);assert.equal(path.dirname(target),fs.realpathSync(os.tmpdir()));assert(path.basename(target).startsWith('arcade-local-history-'));fs.rmSync(target,{recursive:true,force:true});});
 return {root,service,manager,store,scope,calls,seed(count=125){for(let i=0;i<count;i++)store.append(scope,{id:'history-'+i,role:i%2?'assistant':'user',text:'Synthetic row '+i,at:100});}};
}
test('real SQLite expands the retained window in order, including equal timestamps, without changing disk rows',t=>{
 const f=fixture(t);f.seed();f.store.append('another-character',{id:'other',role:'user',text:'DO_NOT_MIX',at:100});
 const retained=f.store.history(f.scope,120),before=f.service.localSnapshot();assert.equal(retained.length,120);assert.equal(retained[0].id,'history-5');assert.equal(before.history.length,30);assert(before.hasEarlierHistory);
 for(const limit of [60,90,120]){assert.equal(f.service.localHistory(before.historyId).historyLimit,limit);const s=f.service.localSnapshot();assert.equal(s.historyId,before.historyId);assert.deepEqual(s.history,retained.slice(-limit).map(row=>({...row,edited:false,swipeIndex:0,swipeCount:1})));assert.equal(s.hasEarlierHistory,limit<120);}
 assert.equal(f.service.localHistory(before.historyId).historyLimit,120);assert.deepEqual(f.store.history(f.scope,120),retained);assert.equal(f.calls.length,0);assert.equal(f.service.status,'disconnected');assert.equal(f.service.localSnapshot().state,'stopped');
 assert.doesNotMatch(JSON.stringify(f.service.localSnapshot()),/DO_NOT_MIX|synthetic-history-key/);
});
test('changing the role invalidates the prior view and resets its limit; reopening preserves messages but not expansion',async t=>{
 const f=fixture(t);f.seed(70);const before=f.service.localSnapshot();f.service.localHistory(before.historyId);
 f.service.socialConfigure({characterId:'deepseek-whale'});const next=f.service.localSnapshot();assert.notEqual(next.historyId,before.historyId);assert.equal(next.historyLimit,30);assert.deepEqual(next.history,[]);assert.throws(()=>f.service.localHistory(before.historyId),{code:'changed'});
 f.service.socialConfigure({characterId:before.characterId});const returned=f.service.localSnapshot();assert.equal(returned.history.length,30);assert.notEqual(returned.historyId,before.historyId);assert.equal(f.store.history(f.scope,120).length,70);
 await f.service.disconnect();const {LocalCompanion}=require('../src/bot/local-companion.cjs');const reopened=new LocalCompanion({root:f.root,capture:()=>({mode:'api',character:before.characterId}),createExecute:()=>assert.fail('Read must not create a runner')});try{const s=reopened.snapshot();assert.equal(s.historyLimit,30);assert.deepEqual(s.history,returned.history);assert.notEqual(s.historyId,returned.historyId);}finally{reopened.store?.close?.();}
});
test('reading earlier history does not preempt an active reply or enlarge model context',async t=>{
 const f=fixture(t);f.seed(80);await f.service.localStart();const context=f.service.localConversationContext(),before=f.service.localSnapshot(),abort=new AbortController();
 // A pending request remains in the same engine; expansion is a local read preference.
 let resolve,entered;const observed=[],gate=new Promise(r=>resolve=r),ready=new Promise(r=>entered=r);context.dispatcher.execute=async args=>{observed.push(args);entered(args);await gate;return {outcome:'reply_ended',text:'Synthetic answer'};};
 const pending=f.service.localReply('current',{signal:abort.signal}),args=await ready;f.service.localHistory(before.historyId);assert.equal(args.signal.aborted,false);assert.equal(f.service.localConversationContext().dispatcher,context.dispatcher);assert.equal(f.service.localSnapshot().historyLimit,60);resolve();assert.equal((await pending).outcome,'reply_ended');
 await f.service.localReply('after expansion');assert.match(observed.at(-1).prompt,/Synthetic row 79/);assert.doesNotMatch(observed.at(-1).prompt,/Synthetic row 40(?:\D|$)/);assert(f.service.localSnapshot().history.some(row=>row.text==='Synthetic row 40'));
});
test('forgetting a local fact removes old expanded history from the next snapshot',async t=>{
 const f=fixture(t);f.seed(65);const fact=f.store.upsertFact(f.scope,{text:'SYNTHETIC_LOCAL_FACT',sourceIds:['history-64'],sourceAt:100});await f.service.localStart();f.service.localHistory(f.service.localSnapshot().historyId);assert.equal(f.service.localSnapshot().history.length,60);
 const reply=await f.service.localReply('忘记 '+fact.id.slice(0,8));assert.match(reply.text,/已清除/);const next=f.service.localSnapshot();assert(!next.history.some(row=>row.id.startsWith('history-')));assert.equal(next.hasEarlierHistory,false);assert.equal(f.calls.length,0);
});
test('actual IPC and preload expose history only for the selected App conversation',async()=>{
 const h=localMainHarness(),calls=[];h.a.localHistory=id=>{calls.push(id);return {historyId:id,historyLimit:60};};
 assert.equal((await h.invoke('desktopLocalHistory',{accountId:'a',historyId:'view-a'})).code,'changed');await h.choose();
 assert.deepEqual(await h.invoke('desktopLocalHistory',{accountId:'a',historyId:'view-a'}),{ok:true,historyId:'view-a',historyLimit:60});
 assert.equal((await h.invoke('desktopLocalHistory',{accountId:'b',historyId:'view-a'})).code,'changed');
 for(const value of [{accountId:'a',historyId:'view-a',scope:'foreign'},{accountId:'a',historyId:[]},{accountId:'a',historyId:''}])assert.equal((await h.invoke('desktopLocalHistory',value)).code,'invalid_request');
 await assert.rejects(h.invoke('desktopLocalHistory',{accountId:'a',historyId:'view-a'},{untrusted:true}),/Untrusted sender/);await h.choose('channel');assert.equal((await h.invoke('desktopLocalHistory',{accountId:'a',historyId:'view-a'})).code,'changed');assert.deepEqual(calls,['view-a']);
 const vm=require('node:vm');let exposed,invoked;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/preload.cjs'),'utf8'),{require:id=>{assert.equal(id,'electron');return {contextBridge:{exposeInMainWorld:(_key,value)=>{exposed=value;}},ipcRenderer:{invoke:(...args)=>{invoked=args;},on(){},removeListener(){}}};}});const request={accountId:'a',historyId:'view-a'};exposed.desktopLocalHistory(request);assert.equal(invoked[0],'arcade:desktopLocalHistory');assert.equal(invoked[1],request);
});
