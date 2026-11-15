'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module');
const {fixture,deferred}=require('./st-local-fixture.cjs');
const {scopeFor}=require('../src/bot/local-companion.cjs');
const settings=require('../src/bot/st/local-settings.cjs');

test('App-only built-in role restores private chat/memory without changing provider, credentials or social policy',async t=>{
 const f=fixture(t),s=f.service;
 s.socialStore.configure({proactiveMessages:true,qzonePosts:true});
 const social=JSON.stringify(s.socialStore.config()),config=JSON.stringify(s.config),secret=JSON.stringify(s.secret),binding=s.localBinding();
 await s.localStart();await s.localReply('记住：JU_ONLY_FACT');await s.localReply('JU_ONLY_HISTORY');
 const juScope=scopeFor(f.root,'claude-ju');
 s.stConfigure({builtinPersonaId:'deepseek-whale',characterId:null,groupId:null});await s.localStop();await s.localStart();
 assert.equal(s.localSnapshot().characterId,'deepseek-whale');assert.equal(s.localConversationContext().scope,scopeFor(f.root,'deepseek-whale'));
 assert.equal(f.history().length,0);assert.equal((await s.localReply('查看记忆')).text.includes('JU_ONLY_FACT'),false);
 await s.localReply('记住：WHALE_ONLY_FACT');await s.localReply('WHALE_ONLY_HISTORY');assert(f.calls.at(-1).prompt.includes('鲸鱼娘'));
 s.stConfigure({builtinPersonaId:'claude-ju'});await s.localStop();await s.localStart();
 assert.equal(s.localConversationContext().scope,juScope);assert(f.history().some(row=>row.text==='JU_ONLY_HISTORY'));assert(!f.history().some(row=>row.text==='WHALE_ONLY_HISTORY'));
 assert((await s.localReply('查看记忆')).text.includes('JU_ONLY_FACT'));assert(!(await s.localReply('查看记忆')).text.includes('WHALE_ONLY_FACT'));
 assert.equal(JSON.stringify(s.socialStore.config()),social);assert.equal(JSON.stringify(s.config),config);assert.equal(JSON.stringify(s.secret),secret);assert.deepEqual(s.localBinding(),binding);
 await s.localStop();const reopened=f.make();assert.equal(reopened.stSnapshot().settings.builtinPersonaId,'claude-ju');await reopened.localStart();assert.equal(reopened.localSnapshot().characterId,'claude-ju');
 await reopened.localStop();reopened.stConfigure({builtinPersonaId:null});await reopened.localStart();assert.equal(reopened.localSnapshot().characterId,binding.character);
});

test('busy App role changes are rejected and a stopped late model reply cannot appear under the next role',async t=>{
 const ready=deferred(),reply=deferred(),f=fixture(t,{execute:async()=>{ready.resolve();return reply.promise;}}),s=f.service;
 await s.localStart();const running=s.localReply('still running');await ready.promise;
 assert.equal(s.localSnapshot().busy,true);assert.throws(()=>s.stConfigure({builtinPersonaId:'deepseek-whale'}),{code:'busy'});
 assert.equal(s.stSnapshot().settings.builtinPersonaId,null);
 const stopping=s.localStop();reply.resolve({outcome:'reply_ended',text:'LATE_JU_REPLY'});await stopping;assert.equal((await running).outcome,'cancelled');
 s.stConfigure({builtinPersonaId:'deepseek-whale'});await s.localStart();assert.equal(s.localSnapshot().busy,false);assert(!f.history().some(row=>row.text==='LATE_JU_REPLY'));
});

test('App-only selection works with a connected social channel without writing or disconnecting it',async t=>{
 const f=fixture(t),s=f.service;s.socialStore.configure({proactiveMessages:true,qzonePosts:true});s.status='connected';
 const before=s.socialStore.config();s.stConfigure({builtinPersonaId:'deepseek-whale'});await s.localStart();
 assert.equal(s.status,'connected');assert.deepEqual(s.socialStore.config(),before);assert.equal(s.localSnapshot().characterId,'deepseek-whale');
 // The fixture has no real channel to disconnect at teardown.
 s.status='disconnected';
});

test('old settings default to the original profile role, and arbitrary role identifiers are rejected',()=>{
 const base=settings.defaults();delete base.builtinPersonaId;assert.equal(settings.validate(base).builtinPersonaId,null);
 for(const id of ['unknown','../claude-ju',{},true])assert.throws(()=>settings.patch(base,{builtinPersonaId:id}),{code:'st_settings_invalid'});
 assert.equal(settings.patch(base,{builtinPersonaId:'deepseek-whale'}).builtinPersonaId,'deepseek-whale');
});

test('the production stConfigure handler rejects a stale rendered profile before changing any settings',()=>{
 const file=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(file,'utf8'),start=source.indexOf('function registerSTHandlers(){'),end=source.indexOf("  register('stConversations'",start),head=source.slice(start,end)+'\n}';
 const handlers=new Map(),calls=[],service={stConfigure:value=>{calls.push(value);return value;}},other={};
 const context={require:createRequire(file),register:(name,fn)=>handlers.set(name,fn),publish:()=>{},bot:service,accounts:{selectedId:'primary',get:id=>id==='primary'?service:other}};
 vm.runInNewContext(head+'\nregisterSTHandlers();',context,{filename:file});
 const invoke=handlers.get('stConfigure');assert.throws(()=>invoke({profileId:'other',builtinPersonaId:'deepseek-whale'}),{code:'changed'});assert.equal(calls.length,0);
 invoke({profileId:'primary',builtinPersonaId:'deepseek-whale'});assert.equal(calls.length,1);assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{builtinPersonaId:'deepseek-whale'});
 invoke({streaming:false});assert.equal(calls.length,2);
});


test('each saved profile persists its own independent App role selection',async t=>{
 const first=fixture(t),second=fixture(t);
 first.service.stConfigure({builtinPersonaId:'deepseek-whale'});
 assert.equal(second.service.stSnapshot().settings.builtinPersonaId,null);
 second.service.stConfigure({builtinPersonaId:'codex-dragon'});
 await first.service.localStart();await second.service.localStart();
 assert.equal(first.service.localSnapshot().characterId,'deepseek-whale');assert.equal(second.service.localSnapshot().characterId,'codex-dragon');
 assert.notEqual(first.scope(),second.scope());
 await first.service.localStop();const reopened=first.make();await reopened.localStart();assert.equal(reopened.localSnapshot().characterId,'deepseek-whale');
 assert.equal(second.service.localSnapshot().characterId,'codex-dragon');
});
