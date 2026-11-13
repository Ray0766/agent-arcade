'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {BotService}=require('../src/bot/service.cjs');
const {SocialCompanion,scopeFor}=require('../src/bot/social-companion.cjs');
const {localMainHarness}=require('./helpers/desktop-local-main-harness.cjs');
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-qq-saved-history-')),calls=[];
 const unavailable=()=>{calls.push('external');assert.fail('Saved history must not start a channel, provider or outgoing action');};
 const service=new BotService({root,vault:{isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()},qqClientFactory:unavailable,clientFactory:unavailable,runnerFactory:unavailable});
 service.configure({channel:'qq',mode:'api',qqOwnerId:'12345678',qqAccountId:'87654321'});
 service.socialConfigure({enabled:true,proactiveMessages:false,qzonePosts:false});
 const store=service.socialStore,character=store.config().characterId,scope=scopeFor('87654321','12345678',character);
 // The already-verified channel binding is synthetic; no socket is created.
 service.socialScope=scope;service.dispatcher=new SocialCompanion({store,scope,execute:unavailable,send:unavailable,sendProactive:unavailable,publishPost:unavailable,readPost:unavailable,tickMs:0});
 t.after(async()=>{await service.disconnect();store.close?.();const resolved=fs.realpathSync(root);assert.equal(path.dirname(resolved),fs.realpathSync(os.tmpdir()));assert(path.basename(resolved).startsWith('arcade-qq-saved-history-'));fs.rmSync(resolved,{recursive:true,force:true});});
 return {root,service,store,scope,calls,seed(count=125){for(let i=0;i<count;i++)store.append(scope,{id:'saved-'+i,role:i%2?'assistant':'user',text:'Saved synthetic '+i,at:100});}};
}
test('QQ retained SQLite history expands 60/90/120 in stable order without channels, providers or retention changes',t=>{
 const f=fixture(t);f.seed();for(const scope of ['other-owner','other-character','app-local'])f.store.append(scope,{id:'foreign',role:'user',text:'PRIVATE_SENTINEL',at:100});
 const retained=f.store.history(f.scope,120),initial=f.service.snapshot().tasks;assert.equal(retained.length,120);assert.equal(retained[0].id,'saved-5');assert.equal(initial.messages.length,60);assert(initial.hasEarlierHistory);
 for(const limit of [90,120,120]){assert.deepEqual(f.service.channelHistory(initial.historyId),{historyId:initial.historyId,historyLimit:limit});const current=f.service.snapshot().tasks;assert.equal(current.historyLimit,limit);assert.deepEqual(current.messages.map(x=>x.id),retained.slice(-limit).map(x=>x.id));assert.equal(current.hasEarlierHistory,limit<120);assert.doesNotMatch(JSON.stringify(current),/PRIVATE_SENTINEL/);}
 assert.deepEqual(f.store.history(f.scope,120),retained);assert.deepEqual(f.calls,[]);assert.equal(f.service.status,'disconnected');
});
test('read-only expansion neither cancels an existing turn nor expands the model context',t=>{
 const f=fixture(t);f.seed(100);const dispatcher=f.service.dispatcher,signal=new AbortController(),before=dispatcher.context();dispatcher.current={id:'synthetic-active',controller:signal};
 const id=f.service.snapshot().tasks.historyId;f.service.channelHistory(id);assert.equal(signal.signal.aborted,false);assert.equal(f.service.dispatcher,dispatcher);assert.equal(dispatcher.context(),before);assert.doesNotMatch(before,/Saved synthetic 40(?:\D|$)/);assert(f.service.snapshot().tasks.messages.some(x=>x.text==='Saved synthetic 40'));dispatcher.current=null;assert.deepEqual(f.calls,[]);
});
test('paused QQ companion remains readable, while changed connection/persona or dispatcher rejects the old view',async t=>{
 const f=fixture(t);f.seed(100);const initial=f.service.snapshot().tasks;await f.service.dispatcher.stop();f.service.channelHistory(initial.historyId);assert.equal(f.service.snapshot().tasks.messages.length,90);
 f.service.generation++;const next=f.service.snapshot().tasks;assert.notEqual(next.historyId,initial.historyId);assert.equal(next.historyLimit,60);assert.throws(()=>f.service.channelHistory(initial.historyId),{code:'changed'});
 f.service.configure({qqOwnerId:'12345679'});assert.equal(f.service.snapshot().tasks,null);assert.throws(()=>f.service.channelHistory(next.historyId),{code:'changed'});assert.deepEqual(f.calls,[]);
});
test('clearing or correcting QQ memory removes previously expanded rows without restoring stale text',async t=>{
 const f=fixture(t);f.seed(100);const fact=f.store.upsertFact(f.scope,{text:'SYNTHETIC_OLD_FACT',sourceIds:['saved-98'],sourceAt:100});const id=f.service.snapshot().tasks.historyId;f.service.channelHistory(id);assert.equal(f.service.snapshot().tasks.messages.length,90);
 await f.service.socialEdit({action:'correct',id:fact.id,text:'SYNTHETIC_NEW_FACT'});assert(!f.service.snapshot().tasks.messages.some(x=>x.id==='saved-98'));f.service.socialForget();assert.equal(f.service.snapshot().tasks,null);assert.throws(()=>f.service.channelHistory(id),{code:'changed'});assert.deepEqual(f.calls,[]);
});
test('reading failure returns storage error before changing the window and does not throw from snapshot',t=>{
 const f=fixture(t);f.seed();const id=f.service.snapshot().tasks.historyId,read=f.store.historyWindow.bind(f.store);f.store.historyWindow=()=>{throw Error('PRIVATE_SQL_FAILURE');};assert.throws(()=>f.service.channelHistory(id),{code:'storage_unavailable'});assert.doesNotThrow(()=>f.service.snapshot());f.store.historyWindow=read;assert.equal(f.service.snapshot().tasks.historyLimit,60);assert.deepEqual(f.calls,[]);
});
test('actual registered main and preload restrict saved QQ history to selected channel source, with A/B/A retirement',async t=>{
 const f=fixture(t);f.seed();const h=localMainHarness();h.a.channelHistory=f.service.channelHistory.bind(f.service);h.a.resetChannelHistory=f.service.resetChannelHistory.bind(f.service);
 let id=f.service.snapshot().tasks.historyId;assert.deepEqual(await h.invoke('desktopChannelHistory',{accountId:'a',historyId:id}),{ok:true,historyId:id,historyLimit:90});
 assert.equal((await h.invoke('desktopChannelHistory',{accountId:'b',historyId:id})).code,'changed');
 for(const value of [{accountId:'a',historyId:id,scope:f.scope},{accountId:'a',historyId:[]},{accountId:'a',historyId:''}])assert.equal((await h.invoke('desktopChannelHistory',value)).code,'invalid_request');
 await assert.rejects(h.invoke('desktopChannelHistory',{accountId:'a',historyId:id},{untrusted:true}),/Untrusted sender/);
 await h.choose('local');assert.equal((await h.invoke('desktopChannelHistory',{accountId:'a',historyId:id})).code,'changed');await h.choose('channel');assert.equal((await h.invoke('desktopChannelHistory',{accountId:'a',historyId:id})).code,'changed');id=f.service.snapshot().tasks.historyId;assert.equal((await h.invoke('desktopChannelHistory',{accountId:'a',historyId:id})).historyLimit,90);
 await h.invoke('accountSelect','b');await h.invoke('accountSelect','a');assert.equal((await h.invoke('desktopChannelHistory',{accountId:'a',historyId:id})).code,'changed');assert.deepEqual(f.calls,[]);
 let exposed,invoked;vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../src/preload.cjs'),'utf8'),{require:()=>({contextBridge:{exposeInMainWorld:(_key,value)=>{exposed=value;}},ipcRenderer:{invoke:(...args)=>{invoked=args;},on(){},removeListener(){}}})});const request={accountId:'a',historyId:'view-a'};exposed.desktopChannelHistory(request);assert.equal(invoked[0],'arcade:desktopChannelHistory');assert.equal(invoked[1],request);
});
