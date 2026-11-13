'use strict';
// Actual SQLite and service lifecycle; inert providers, vault and channels only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {BotService}=require('../src/bot/service.cjs');
const {AccountManager}=require('../src/bot/account-manager.cjs');
const {scopeFor}=require('../src/bot/local-companion.cjs');
const {scopeFor:qqScope}=require('../src/bot/social-companion.cjs');
const {publicCatalog}=require('../src/core/personas.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
function fixture(t,options={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-local-chat-')),services=[],calls=[],factories=[],closed=[];
 const factory=kind=>input=>{factories.push({kind,input});const run=async args=>{calls.push({kind,args});return options.execute?options.execute(args):{outcome:'reply_ended',text:'只在这里回复。'};};if(options.close!==false)run.close=async()=>{closed.push(kind);await options.close?.();};return run;};
 const rejectChannel=()=>assert.fail('Independent local chat must not construct a channel client');
 const make=(dir=root)=>{const service=new BotService({root:dir,vault,clientFactory:rejectChannel,qqClientFactory:rejectChannel,feishuClientFactory:rejectChannel,xClientFactory:rejectChannel,messengerClientFactory:rejectChannel,runnerFactory:factory('api'),claudeProgramRunnerFactory:factory('claude'),codexRunnerFactory:factory('codex'),deepseekRunnerFactory:factory('deepseek'),gptRunnerFactory:factory('gpt'),geminiRunnerFactory:factory('gemini'),doubaoRunnerFactory:factory('doubao')});services.push(service);return service;};
 const service=make();t.after(async()=>{for(const s of services)await s.disconnect().catch(()=>{});const p=path.resolve(root);assert.equal(path.dirname(p),path.resolve(os.tmpdir()));assert(path.basename(p).startsWith('arcade-local-chat-'));fs.rmSync(p,{recursive:true,force:true});});return {root,service,make,services,calls,factories,closed};
}
test('saved APIs and local Claude start without QQ pairing, project, channel construction or model call',async t=>{
 for(const mode of ['api','claude','deepseek','gpt','gemini','doubao'])await t.test(mode,async t=>{
  const f=fixture(t);f.service.configure({mode,...(mode==='claude'?{}:{key:'fixture-api-key-'+mode})});assert.equal(f.service.config.workspace,undefined);assert.equal(f.service.localSnapshot().canStart,true);
  const configFile=path.join(f.root,'social-config.json'),before=fs.existsSync(configFile)?fs.readFileSync(configFile):null;
  const snapshot=await f.service.localStart();assert.equal(snapshot.state,'active');assert.equal(f.calls.length,0);assert.equal(f.service.status,'disconnected');assert.equal(f.service.client,undefined);assert.equal(f.service.dispatcher,null);assert.equal(f.service.socialScope,null);
  const opts=f.factories[0].input;assert.equal(opts.conversationOnly,true);assert.deepEqual(opts.persona,{enabled:false,selection:'default'});assert.equal(opts.workspace,path.join(f.root,'local-companion','workspace'));assert.equal(opts.budget,1);assert(!Object.hasOwn(f.service.localConversationContext(),'owner'));
  assert.equal((await f.service.localReply('你好')).outcome,'reply_ended');assert.equal(f.calls.length,1);assert.deepEqual(await f.calls[0].args.request({tool:'Write'}),{allow:false});assert(!Object.hasOwn(f.calls[0].args,'resume'));assert(!Object.hasOwn(f.calls[0].args,'image'));assert(f.calls[0].args.prompt.length<=6000);
  assert.doesNotMatch(JSON.stringify(f.service.localSnapshot()),/fixture-api-key-|127\.0\.0\.1|social-workspace/);assert.equal(f.service.localSnapshot().history.length,2);assert.deepEqual(fs.existsSync(configFile)?fs.readFileSync(configFile):null,before);assert.equal(fs.existsSync(path.join(f.root,'social-scope.json')),false);
 });
});
test('Codex and legacy Channels remain unsupported; missing or locked credentials cannot start',async t=>{
 const f=fixture(t);for(const mode of ['codex','native']){f.service.configure({mode});assert.equal(f.service.localSnapshot().reason,'unsupported');await assert.rejects(f.service.localStart(),{code:'unsupported'});}f.service.configure({mode:'api'});await assert.rejects(f.service.localStart(),{code:'credentials_missing'});f.service.lockCredentials();await assert.rejects(f.service.localStart(),{code:'credentials_locked'});assert.equal(f.factories.length,0);
});
test('local memory has real view/correct/forget commands but cannot publish, schedule or touch QQ memory',async t=>{
 const f=fixture(t);f.service.configure({key:'fixture-api-key'});const scope=qqScope('12345678','87654321','claude-ju');f.service.socialStore.append(scope,{id:'qq-old',role:'user',text:'QQ_ONLY_PRIVATE'});f.service.socialScope=scope;
 await f.service.localStart();let r=await f.service.localReply('记住：喜欢晴天');assert.match(r.text,/记住了/);assert.equal(f.calls.length,0);r=await f.service.localReply('查看记忆');const code=r.text.match(/[a-f0-9]{8}/)[0];assert.match(r.text,/喜欢晴天/);
 assert.match((await f.service.localReply('更正 '+code+'：喜欢雨天')).text,/喜欢雨天/);assert.match((await f.service.localReply('查看记忆')).text,/喜欢雨天/);assert.doesNotMatch((await f.service.localReply('查看记忆')).text,/喜欢晴天/);
 for(const text of ['回访 2027-01-01T01:00:00Z | 你好','发布说说：测试'])assert.match((await f.service.localReply(text)).text,/不会主动联系/);
 const c=f.service.localConversationContext();assert.equal(c.dispatcher.timer,undefined);assert.deepEqual(await c.dispatcher.consider(),{action:'wait',reason:'local_only'});assert.throws(()=>c.dispatcher.publishDraft('x'),{code:'unavailable'});assert.equal(f.service.localManager().store.followups(c.scope).length,0);assert.equal(f.service.localManager().store.actions(c.scope).length,0);
 await f.service.localReply('你好');assert.doesNotMatch(f.calls.at(-1).args.prompt,/QQ_ONLY_PRIVATE/);assert.match((await f.service.localReply('忘记 '+code)).text,/已清除/);assert.match((await f.service.localReply('查看记忆')).text,/还没有/);assert.equal(f.service.socialStore.history(scope)[0].text,'QQ_ONLY_PRIVATE');
});
test('cancel and stop await a provider without close, and ignore its late reply',async t=>{
 const entered=deferred(),finish=deferred(),f=fixture(t,{close:false,execute:async args=>{entered.resolve(args);return finish.promise;}});f.service.configure({key:'fixture-api-key'});await f.service.localStart();const signal=new AbortController(),reply=f.service.localReply('第一条',{signal:signal.signal});await entered.promise;signal.abort();let stopped=false;const stop=f.service.localStop().then(()=>{stopped=true;});await new Promise(r=>setImmediate(r));assert.equal(stopped,false);assert.equal(f.service.localSnapshot().state,'stopping');finish.resolve({outcome:'reply_ended',text:'LATE_PRIVATE_REPLY'});assert.equal((await reply).outcome,'cancelled');await stop;assert.equal(stopped,true);assert(!JSON.stringify(f.service.localSnapshot()).includes('LATE_PRIVATE_REPLY'));assert.equal(f.service.localSnapshot().state,'stopped');
});
test('configuration, key replacement, key locking and clearing retire the exact active local execution',async t=>{
 for(const change of ['config','key','locked','forget','character'])await t.test(change,async t=>{
  const entered=deferred(),finish=deferred(),f=fixture(t,{execute:async args=>{entered.resolve(args);return finish.promise;}});f.service.configure({key:'fixture-api-key'});await f.service.localStart();const before=f.service.localConversationContext();const reply=f.service.localReply('pending');const args=await entered.promise;let changed;
  if(change==='config')f.service.configure({budget:0.5});if(change==='key')f.service.configure({key:'different-fixture-key'});if(change==='locked')f.service.lockCredentials();if(change==='forget')changed=f.service.forget();if(change==='character')f.service.socialConfigure({characterId:'deepseek-whale'});
  assert.equal(args.signal.aborted,true);assert.throws(()=>f.service.localConversationContext());finish.resolve({outcome:'reply_ended',text:'OLD_RESULT'});assert.equal((await reply).outcome,'cancelled');await changed;await f.service.localStop();assert(!JSON.stringify(f.service.localSnapshot()).includes('OLD_RESULT'));assert(before.generation<f.service.localSnapshot().generation);
 });
});
test('role and profile memory survive restart only in their distinct local scopes',async t=>{
 const f=fixture(t);f.service.configure({key:'fixture-api-key'});await f.service.localStart();await f.service.localReply('记住：LOCAL_ROLE_A');await f.service.localStop();f.service.socialConfigure({characterId:'deepseek-whale'});await f.service.localStart();assert.match((await f.service.localReply('查看记忆')).text,/还没有/);await f.service.localReply('记住：LOCAL_ROLE_B');await f.service.localStop();
 const reopened=f.make();assert.equal(reopened.localSnapshot().state,'stopped');await reopened.localStart();assert.match((await reopened.localReply('查看记忆')).text,/LOCAL_ROLE_B/);await reopened.localStop();reopened.socialConfigure({characterId:'claude-ju'});await reopened.localStart();assert.match((await reopened.localReply('查看记忆')).text,/LOCAL_ROLE_A/);assert.doesNotMatch((await reopened.localReply('查看记忆')).text,/LOCAL_ROLE_B/);
 const other=path.join(f.root,'different-profile');fs.mkdirSync(other);const second=f.make(other);second.configure({key:'fixture-api-key'});await second.localStart();assert.match((await second.localReply('查看记忆')).text,/还没有/);assert.notEqual(scopeFor(other,'claude-ju'),scopeFor(f.root,'claude-ju'));
});
test('a stale Start waiting for old cleanup cannot launch a runner or stop a newer local context',async t=>{
 const close=deferred(),f=fixture(t,{close:()=>close.promise});f.service.configure({key:'fixture-api-key'});await f.service.localStart();const stop=f.service.localStop();let selected=true;const start=f.service.localStart({assertCurrent:()=>{if(!selected)throw Object.assign(Error('changed'),{code:'changed'});}});selected=false;close.resolve();await stop;await assert.rejects(start,{code:'changed'});assert.equal(f.factories.length,1);await f.service.localStart();const current=f.service.localConversationContext();assert.equal(f.service.localSnapshot().state,'active');assert.equal(current.generation,f.service.localSnapshot().generation);
});
test('localStop does not stop the separately existing QQ client or controller; disconnect stops both',async t=>{
 const f=fixture(t);f.service.configure({key:'fixture-api-key'});let qqClose=0,qqStop=0;f.service.client={close:async()=>{qqClose++;}};f.service.dispatcher={stop:async()=>{qqStop++;},whenIdle:async()=>{},snapshot:()=>null};f.service.status='connected';await f.service.localStart();await f.service.localReply('local only');await f.service.localStop();assert.equal(qqClose,0);assert.equal(qqStop,0);await f.service.disconnect();assert.equal(qqClose,1);assert.equal(qqStop,1);
});
test('direct synchronous account removal refuses active local ownership, then succeeds after explicit stop',async t=>{
 const f=fixture(t),manager=new AccountManager({root:f.root,vault,serviceFactory:opts=>f.make(opts.root)});const added=manager.add({name:'Local second'}),id=manager.selectedId;added.configure({key:'fixture-api-key'});await added.localStart();assert.throws(()=>manager.remove(id),{code:'stopping'});assert.equal(manager.get(id),added);await added.localStop();manager.remove(id);assert(!manager.services.has(id));
});
test('maximum valid persona and exact quote-heavy input remain within the original 6000 limit',async t=>{
 const f=fixture(t);f.service.configure({key:'fixture-api-key'});f.service.socialConfigure({name:'名'.repeat(40),description:'述'.repeat(800),speechExamples:[{user:'问'.repeat(240),assistant:'答'.repeat(240)}]});await f.service.localStart();const body='"\\'.repeat(1000);await f.service.localReply(body);assert.equal(f.calls.length,1);assert(f.calls[0].args.prompt.includes(body));assert(f.calls[0].args.prompt.length<=6000);assert(f.calls[0].args.prompt.includes('述'.repeat(800)));
});
test('cancelling a memory command waiting for an older model prevents the new fact mutation',async t=>{
 for(const kind of ['remember','correct','forget'])await t.test(kind,async t=>{
  const entered=deferred(),finish=deferred(),f=fixture(t,{execute:async()=>{entered.resolve();return finish.promise;}});f.service.configure({key:'fixture-api-key'});await f.service.localStart();const remembered=await f.service.localReply('记住：ORIGINAL_FACT'),code=remembered.text.match(/[a-f0-9]{8}/)[0];const old=f.service.localReply('older work');await entered.promise;
  const ac=new AbortController(),text={remember:'记住：CANCELLED_NEW_FACT',correct:'更正 '+code+'：CANCELLED_REPLACEMENT',forget:'忘记 '+code}[kind],pending=f.service.localReply(text,{signal:ac.signal});ac.abort();finish.resolve({outcome:'reply_ended',text:'OLD_REPLY'});await old;assert.equal((await pending).outcome,'cancelled');const facts=f.service.localManager().store.facts(f.service.localConversationContext().scope);assert.equal(facts.length,1);assert.equal(facts[0].text,'ORIGINAL_FACT');
 });
});
test('failed owned close remains unavailable until a new explicit Stop retries that exact executor',async t=>{
 let attempts=0;const f=fixture(t,{close:async()=>{if(++attempts===1)throw Error('synthetic close failed');}});f.service.configure({key:'fixture-api-key'});await f.service.localStart();await assert.rejects(f.service.localStop(),{code:'stop_failed'});assert.equal(f.service.localSnapshot().reason,'stop_failed');assert.equal(f.service.localSnapshot().canStart,false);assert.throws(()=>f.service.assertLocalStopped(),{code:'stopping'});assert.equal(f.factories.length,1);await f.service.localStop();assert.equal(attempts,2);f.service.assertLocalStopped();await f.service.localStart();assert.equal(f.factories.length,2);
});
test('temporary Start failure permits a new explicit attempt but never retries automatically',async t=>{
 const f=fixture(t);f.service.configure({key:'fixture-api-key'});const original=f.service.runnerFactory;let attempts=0;f.service.runnerFactory=opts=>{if(++attempts===1)throw Error('synthetic setup failure');return original(opts);};await assert.rejects(f.service.localStart(),{code:'start_failed'});assert.equal(f.service.localSnapshot().canStart,true);assert.equal(attempts,1);await f.service.localStart();assert.equal(attempts,2);assert.equal(f.service.localSnapshot().available,true);
});
test('a guard rejection after runner construction retains a failed cleanup for explicit Stop',async t=>{
 let attempts=0,valid=true;const f=fixture(t,{close:async()=>{if(++attempts===1)throw Error('synthetic failed late-start cleanup');}});f.service.configure({key:'fixture-api-key'});const original=f.service.runnerFactory;f.service.runnerFactory=opts=>{const result=original(opts);valid=false;return result;};await assert.rejects(f.service.localStart({assertCurrent:()=>{if(!valid)throw Object.assign(Error('stale'),{code:'changed'});}}),{code:'stop_failed'});assert.equal(f.service.localSnapshot().reason,'stop_failed');assert.equal(f.service.localSnapshot().available,false);await f.service.localStop();assert.equal(attempts,2);assert.equal(f.service.localSnapshot().canStart,true);
});
test('failed local cleanup does not skip the existing QQ cleanup, and no passive retry occurs',async t=>{
 let attempts=0;const f=fixture(t,{close:async()=>{if(++attempts===1)throw Error('owned close incomplete');}});f.service.configure({key:'fixture-api-key'});let qqClose=0;f.service.client={close:async()=>{qqClose++;}};await f.service.localStart();await assert.rejects(f.service.disconnect(),{code:'stop_failed'});assert.equal(qqClose,1);f.service.configure({budget:0.5});await new Promise(r=>setImmediate(r));assert.equal(attempts,1);assert.equal(f.service.localSnapshot().canStart,false);await f.service.localStop();assert.equal(attempts,2);
});
test('credential migration keeps the old service registered until its exact local runner settles',async t=>{
 const entered=deferred(),finish=deferred(),f=fixture(t),manager=new AccountManager({root:f.root,vault,serviceFactory:options=>{const s=new BotService({...options,runnerFactory:()=>async()=>{entered.resolve();return finish.promise;}});f.services.push(s);return s;}});
 const old=manager.add({name:'Migrating local'}),id=manager.selectedId;old.configure({key:'original-fixture-key'});await old.localStart();const reply=old.localReply('pending before migration');await entered.promise;old.lockCredentials();let completed=false;
 const migrate=manager.migrateCredentials(manager.captureCredentialMigration(id),({targetRoot})=>{const bytes=Buffer.from(JSON.stringify({data:Buffer.from(JSON.stringify({key:'new-fixture-api-key'})).toString('base64')}));fs.writeFileSync(path.join(targetRoot,'bot-vault.json'),bytes);return {migrated:true,targetVaultSha256:require('node:crypto').createHash('sha256').update(bytes).digest('hex')};}).then(result=>{completed=true;return result;});
 await new Promise(r=>setImmediate(r));assert.equal(completed,false);assert.equal(manager.get(id),old);finish.resolve({outcome:'reply_ended',text:'LATE_MIGRATED_REPLY'});assert.equal((await reply).outcome,'cancelled');assert.equal((await migrate).migrated,true);assert.notEqual(manager.get(id),old);assert.equal(manager.get(id).localSnapshot().state,'stopped');assert(!JSON.stringify(manager.get(id).localSnapshot()).includes('LATE_MIGRATED_REPLY'));
});

test('local voice keeps command-like speech as conversation without mutating memory or social actions',async t=>{
 const f=fixture(t);f.service.configure({key:'fixture-api-key'});await f.service.localStart();
 const saved=await f.service.localReply('记住：EXPLICIT_TYPED_FACT'),code=saved.text.match(/[a-f0-9]{8}/)[0],context=f.service.localConversationContext(),store=f.service.localManager().store;
 const before=store.facts(context.scope,100),config=store.config();
 const texts=['记住：SPOKEN_NOT_A_FACT','忘记 '+code,'更正 '+code+'：SPOKEN_NOT_A_CORRECTION','查看记忆','发布说说：今天真好','回访 2027-01-01T12:00:00Z | 你好','取消回访 '+code,'/allow CODE','/deny CODE','/cancel','好的','今天有点累，陪我聊一会儿。'];
 for(const text of texts){const result=await f.service.localReply(text,{voice:true});assert.equal(result.outcome,'reply_ended');assert.equal(result.text,'只在这里回复。');}
 assert.equal(f.calls.length,texts.length);assert.deepEqual(store.facts(context.scope,100),before);assert.deepEqual(store.config(),config);assert.deepEqual(store.followups(context.scope,{limit:100}),[]);assert.deepEqual(store.actions(context.scope,100),[]);
 for(let i=0;i<texts.length;i++){const args=f.calls[i].args;assert(args.prompt.includes(texts[i]));assert.match(args.prompt,/Current input kind: local-voice\./);assert.match(args.prompt,/Transcript review confirms wording, not an action/);assert.deepEqual(await args.request({tool:'Write'}),{allow:false});assert(args.prompt.length<=6000);}
 assert(context.dispatcher.snapshot().tasks.every(task=>task.local===true&&task.voice===true&&task.inputKind==='local-voice'));
 assert.equal(f.service.status,'disconnected');assert.equal(f.service.client,undefined);
});

test('local voice origin does not leak to a later typed turn and typed memory controls still work',async t=>{
 const f=fixture(t);f.service.configure({key:'fixture-api-key'});await f.service.localStart();
 await f.service.localReply('记住：SPOKEN_ONLY',{voice:true});
 const saved=await f.service.localReply('记住：TYPED_FACT',{voice:false}),code=saved.text.match(/[a-f0-9]{8}/)[0];assert.match(saved.text,/记住了/);assert.equal(f.calls.length,1);
 assert.match((await f.service.localReply('更正 '+code+'：TYPED_CORRECTED')).text,/已改为/);assert.match((await f.service.localReply('查看记忆')).text,/TYPED_CORRECTED/);
 await f.service.localReply('聊点别的');assert.equal(f.calls.length,2);assert.doesNotMatch(f.calls.at(-1).args.prompt,/Current input kind: local-voice\./);assert.match((await f.service.localReply('忘记 '+code)).text,/已清除/);
 assert.deepEqual(f.service.localManager().store.facts(f.service.localConversationContext().scope,100),[]);
});

test('local voice manual review submits a conversation turn, not permission to execute transcript commands',async t=>{
 const {EventEmitter}=require('node:events'),{VoiceConversation}=require('../src/voice/conversation.cjs');
 const f=fixture(t);f.service.configure({key:'fixture-api-key'});await f.service.localStart();const speech=new EventEmitter(),input=deferred(),played=deferred(),seen=[];
 speech.listen=options=>{speech.options=options;options.onListening();return input.promise;};speech.stopKind=async()=>{};speech.interrupt=async()=>{};speech.close=async()=>{};speech.diagnostics=()=>({events:[]});speech.finishListening=async()=>input.resolve({event:'listen-ended'});speech.speak=async text=>{seen.push(text);played.resolve();};
 const voice=new VoiceConversation({speech,scope:'synthetic-local-voice',respond:(text,options)=>f.service.localReply(text,options)});t.after(()=>voice.close());
 await voice.startListening();speech.options.onTranscript({text:'记住：RAW_SPEECH'});assert.equal(f.calls.length,0);const listening=voice.session.promise;voice.finishListening();await listening;assert.equal(voice.snapshot().status,'reviewing');assert.equal(f.calls.length,0);
 voice.confirmTranscript({draftId:voice.snapshot().draftId,text:'记住：EDITED_SPEECH'});await played.promise;assert.equal(f.calls.length,1);assert(f.calls[0].args.prompt.includes('EDITED_SPEECH'));assert.match(f.calls[0].args.prompt,/Current input kind: local-voice/);assert.deepEqual(seen,['只在这里回复。']);assert.deepEqual(f.service.localManager().store.facts(f.service.localConversationContext().scope,100),[]);
});

test('local voice maximum valid input and persona retain the original prompt cap and complete speech',async t=>{
 const f=fixture(t);f.service.configure({key:'fixture-api-key'});f.service.socialConfigure({name:'名'.repeat(40),description:'述'.repeat(800),speechExamples:[{user:'问'.repeat(240),assistant:'答'.repeat(240)}]});await f.service.localStart();
 const text='"\\'.repeat(1000);await f.service.localReply(text,{voice:true});assert.equal(f.calls.length,1);const prompt=f.calls[0].args.prompt;assert(prompt.length<=6000);assert(prompt.includes(text));assert(prompt.includes('述'.repeat(800)));assert.match(prompt,/Current input kind: local-voice/);
});
