'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {AccountManager}=require('../src/bot/account-manager.cjs');
const {BotService}=require('../src/bot/service.cjs');
const {SocialCompanion,scopeFor}=require('../src/bot/social-companion.cjs');
const vault={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-account-summary-')),services=[];
  const noChannel=()=>assert.fail('No channel may be constructed');
  const runnerFactory=()=>{const execute=async()=>assert.fail('No model may be called');execute.close=async()=>{};return execute;};
  const manager=new AccountManager({root,serviceFactory:options=>{
    const service=new BotService({...options,vault,runnerFactory,clientFactory:noChannel,qqClientFactory:noChannel,feishuClientFactory:noChannel,xClientFactory:noChannel,messengerClientFactory:noChannel});services.push(service);return service;
  }});
  t.after(async()=>{for(const service of services){service.dispatcher?.cancel();service.dispatcher=null;await service.localStop();}const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert(path.basename(target).startsWith('arcade-account-summary-'));fs.rmSync(target,{recursive:true,force:true});});
  return {root,manager,services};
}
function legacyRows(manager){
  const saved=new Map([...manager.services.values()].map(service=>[service,Object.getOwnPropertyDescriptor(service,'accountSnapshot')]));
  try{for(const service of saved.keys())service.accountSnapshot=()=>service.snapshot();return manager.snapshot();}
  finally{for(const [service,descriptor]of saved){if(descriptor)Object.defineProperty(service,'accountSnapshot',descriptor);else delete service.accountSnapshot;}}
}
function populate(service,index){
  const accountId=String(23456780+index),ownerId='12345678';
  Object.assign(service.config,{mode:'api',channel:'qq',qqUrl:`ws://127.0.0.1:${3001+index}`,qqAccountId:accountId,qqOwnerId:ownerId});
  service.socialStore.configure({enabled:true});
  service.socialScope=scopeFor({accountId,ownerId,characterId:'claude-ju'});
  service.socialStore.append(service.socialScope,{id:'synthetic-user',role:'user',text:'Synthetic QQ history'});
  service.socialStore.upsertFact(service.socialScope,{text:'Synthetic QQ fact',sourceIds:['synthetic-user']});
  service.socialStore.setNotes(service.socialScope,'Synthetic private notes');
  service.dispatcher=new SocialCompanion({store:service.socialStore,scope:service.socialScope,execute:async()=>assert.fail('No model'),send:async()=>assert.fail('No send'),tickMs:0});
  service.secret.key='synthetic-key';service.credentialState='ready';
  return accountId;
}
function countTransactions(stores){
  const counts={opened:0,begun:0,committed:0,closed:0};
  class ObservedDatabase extends DatabaseSync{
    constructor(...args){super(...args);counts.opened++;}
    exec(sql){if(/BEGIN IMMEDIATE/.test(sql))counts.begun++;if(sql==='COMMIT')counts.committed++;return super.exec(sql);}
    close(){super.close();counts.closed++;}
  }
  for(const store of stores)store.DatabaseSync=ObservedDatabase;
  return {counts,reset:()=>{for(const key of Object.keys(counts))counts[key]=0;}};
}

test('real SQLite account rows match full snapshots without reading each companion history',async t=>{
  const {manager,services}=fixture(t);manager.add({name:'Dragon'});manager.add({name:'Whale'});
  for(const [index,service]of services.entries()){
    const accountId=populate(service,index),id=manager.accounts[index].id;
    manager.claim(id,{channel:'qq',accountId});service.qqCheck={state:'checked',accountId};service.status='connected';
    await service.localStart();const local=service.localConversationContext();
    service.localManager().store.append(local.scope,{id:'synthetic-local',role:'user',text:'Synthetic local history'});
  }
  const measured=countTransactions(services.flatMap(service=>[service.socialStore,service.localManager().store]));
  const expected=legacyRows(manager),before={...measured.counts};
  assert.equal(before.opened,6);assert.equal(before.begun,27);assert.equal(before.committed,27);assert.equal(before.closed,6);
  measured.reset();const actual=manager.snapshot();assert.deepEqual(actual,expected);
  assert.deepEqual(measured.counts,{opened:0,begun:0,committed:0,closed:0});
  assert.doesNotMatch(JSON.stringify(actual),/Synthetic QQ|Synthetic local|synthetic-key|private notes/);
  const full=manager.current().snapshot();
  assert.equal(full.social.history[0].text,'Synthetic QQ history');assert.equal(full.social.facts[0].text,'Synthetic QQ fact');
  assert.equal(full.local.state,'active');assert.equal(full.local.history[0].text,'Synthetic local history');
  assert.equal(full.tasks.messages[0].text,'Synthetic QQ history');assert.deepEqual(measured.counts,{opened:2,begun:9,committed:9,closed:2});
  t.diagnostic('Three real SQLite-backed account rows: 27 read transactions / 6 scoped connections -> 0; selected full snapshot retains 9 transactions / 2 scoped connections and both histories.');
});

test('summary matches all account fields across identity, credentials, configuration and busy changes',t=>{
  const {manager}=fixture(t),service=manager.current(),accountId=populate(service,0);
  const release=manager.claim('primary',{channel:'qq',accountId});service.qqCheck={state:'checked',accountId};service.status='connected';
  const compare=()=>assert.deepEqual(manager.snapshot(),legacyRows(manager));
  compare();manager.rename('primary','Updated role label');service.socialStore.configure({characterId:'deepseek-whale',name:'Updated persona'});compare();
  service.dispatcher.current={};compare();service.dispatcher.current=null;service.dispatcher.initiative={};compare();service.dispatcher.initiative=null;service.dispatcher.queue=[{}];compare();service.dispatcher.queue=[];
  service.inputProblem='Input issue';compare();service.problem='Connection issue';compare();service.credentialProblem='Locked fixture';service.credentialState='locked';compare();
  manager.credentialMigrations.add('primary');compare();manager.credentialMigrations.clear();
  service.config.qqOwnerId='87654321';compare();assert.equal(manager.snapshot().accounts[0].qqBinding,null);
  service.config.qqOwnerId='12345678';service.config.qqAccountId='34567890';compare();assert.equal(manager.snapshot().accounts[0].accountId,'');
  service.config.qqAccountId=accountId;release();compare();assert.equal(manager.snapshot().accounts[0].accountId,'');
  for(const mode of ['codex','deepseek','native','gpt']){service.config.mode=mode;compare();}
  service.config.channel='wechat';compare();service.status='disconnected';compare();
  service.socialStore.available=false;service.dispatcher.current={};compare();service.dispatcher.current=null;
});

test('summary keeps background local scope retirement and full local state through stop',async t=>{
  const {manager}=fixture(t),service=manager.current();populate(service,0);await service.localStart();
  const before=service.localConversationContext();assert.equal(service.snapshot().local.state,'active');
  service.config.budget=0.5; // Simulate a binding change before the next observation.
  manager.snapshot();assert.equal(before.dispatcher.stopped,true);await service.localStop();
  assert.equal(service.snapshot().local.state,'stopped');assert.deepEqual(manager.snapshot(),legacyRows(manager));
});

test('account-only snapshots do not create unused App managers or retain old role/credential summaries',t=>{
  const {manager}=fixture(t),service=manager.current();
  assert.equal(service.localCompanion,undefined);const first=manager.snapshot();assert.equal(service.localCompanion,undefined);
  service.config.mode='deepseek';service.credentialState='locked';service.credentialProblem='Fresh locked state';
  const next=manager.snapshot();assert.equal(next.accounts[0].characterId,'deepseek-whale');assert.equal(next.accounts[0].credentialState,'locked');assert.equal(next.accounts[0].problem,'Fresh locked state');
  assert.notDeepEqual(first,next);assert.equal(service.localCompanion,undefined);
});
