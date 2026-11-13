'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {AccountManager}=require('../src/bot/account-manager.cjs');
function setup(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-accounts-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const services=[];const serviceFactory=options=>{const service={root:options.root,config:{channel:'qq',qqUrl:'ws://127.0.0.1:3001',qqOwnerId:'99887766'},status:'disconnected',snapshot(){return {mode:'claude',channel:'qq',status:this.status,qq:{check:this.check},social:{config:{characterId:'claude-ju'}}};},async connect(){const accountId=this.account||'12345678';this.release=options.claimIdentity({channel:'qq',accountId});this.check={state:'checked',accountId};this.status='connected';},async disconnect(){this.release?.();this.status='disconnected';}};services.push(service);return service;};return {root,services,serviceFactory,manager:new AccountManager({root,serviceFactory})};}
test('switching companions retains independent services and registry after reopen',async t=>{const {manager,root,serviceFactory}=setup(t);const first=manager.current();first.config.qqUrl='ws://127.0.0.1:3001';await manager.connect('primary');const second=manager.add({name:'Whale'});second.config.qqUrl='ws://127.0.0.1:3003';second.account='87654321';await manager.connect(manager.selectedId);manager.select('primary');assert.equal(first.status,'connected');assert.equal(second.status,'connected');await manager.disconnect('primary');assert.equal(second.status,'connected');assert.notEqual(first.root,second.root);await manager.close();const reopened=new AccountManager({root,serviceFactory});assert.equal(reopened.snapshot().accounts.length,2);assert.equal(reopened.selectedId,'primary');});
test('duplicate bridge and actual identity cannot be shared, removing retains data',async t=>{const {manager}=setup(t);await manager.connect('primary');const second=manager.add({name:'Second'}),id=manager.selectedId;await assert.rejects(manager.connect(id),/bridge/);second.config.qqUrl='ws://127.0.0.1:3002';await assert.rejects(manager.connect(id),/already connected/);second.account='87654321';await manager.connect(id);assert.throws(()=>manager.remove(id),/Disconnect/);await manager.disconnect(id);manager.remove(id);assert.equal(fs.existsSync(second.root),true);await manager.close();});
test('existing folders import by reference without reading or copying credential bytes',t=>{const {manager,root}=setup(t);const imported=path.join(root,'retained');fs.mkdirSync(imported);fs.writeFileSync(path.join(imported,'bot-config.json'),'{}');fs.writeFileSync(path.join(imported,'bot-vault.json'),'not-readable-as-json');const service=manager.add({name:'Retained',root:imported});assert.equal(service.root,fs.realpathSync(imported));assert.equal(fs.readFileSync(path.join(imported,'bot-vault.json'),'utf8'),'not-readable-as-json');assert.throws(()=>manager.add({name:'Duplicate',root:imported}),/already registered/);});

test('last verified QQ identity survives restart without reporting a current connection',async t=>{
  const {manager,root,serviceFactory}=setup(t);await manager.connect('primary');await manager.close();
  const reopened=new AccountManager({root,serviceFactory}),state=reopened.snapshot().accounts[0];
  assert.equal(state.accountId,'');assert.equal(state.status,'disconnected');assert.equal(state.qqBinding.accountId,'12345678');assert.equal(state.qqBinding.source,'last_verified');assert.ok(state.qqBinding.verifiedAt>0);
  reopened.current().config.qqUrl='ws://127.0.0.1:4001';assert.equal(reopened.snapshot().accounts[0].qqBinding,null);
});

test('current QQ identity requires connected state and a current lease; a retained check is only history',async t=>{
  const {manager}=setup(t);await manager.connect('primary');
  assert.equal(manager.snapshot().accounts[0].accountId,'12345678');
  await manager.disconnect('primary');let snapshot=manager.snapshot().accounts[0];
  assert.equal(snapshot.accountId,'');assert.equal(snapshot.qqBinding.accountId,'12345678');
  manager.current().status='connected';snapshot=manager.snapshot().accounts[0];assert.equal(snapshot.accountId,'','a stale status/check cannot replace a live identity lease');
  manager.current().status='disconnected';
});

test('history is bound to normalized URL, owner and explicit expected-account configuration',async t=>{
  const {manager}=setup(t),service=manager.current();await manager.connect('primary');await manager.disconnect('primary');
  service.config.qqUrl='ws://127.0.0.1:3001/';assert.equal(manager.snapshot().accounts[0].qqBinding.accountId,'12345678','equivalent URL remains associated');
  service.config.qqOwnerId='88776655';let state=manager.snapshot().accounts[0];assert.equal(state.qqBinding,null);assert.equal(state.qqOwnerId,'88776655');assert.equal(state.expectedQQAccountId,'');
  service.config.qqOwnerId='99887766';service.config.qqAccountId='12345678';state=manager.snapshot().accounts[0];assert.equal(state.qqBinding,null,'a newly pinned account requires a fresh observation');assert.equal(state.expectedQQAccountId,'12345678');
  await manager.connect('primary');await manager.disconnect('primary');assert.equal(manager.snapshot().accounts[0].qqBinding.accountId,'12345678');
  service.config.qqAccountId='87654321';assert.equal(manager.snapshot().accounts[0].qqBinding,null);await assert.rejects(manager.connect('primary'),{code:'account_mismatch'});
});

test('legacy URL-only history is retained but not attached to an unrecorded current owner',async t=>{
  const {manager,root,serviceFactory}=setup(t);await manager.connect('primary');await manager.close();
  const file=path.join(root,'companions.json'),stored=JSON.parse(fs.readFileSync(file,'utf8')),binding=stored.accounts[0].qqBinding;
  delete binding.contextVersion;delete binding.ownerId;delete binding.expectedAccountId;fs.writeFileSync(file,JSON.stringify(stored));
  const reopened=new AccountManager({root,serviceFactory});assert.equal(reopened.snapshot().accounts[0].qqBinding,null);assert.equal(reopened.accounts[0].qqBinding.accountId,'12345678');reopened.save();assert.equal(JSON.parse(fs.readFileSync(file,'utf8')).accounts[0].qqBinding.accountId,'12345678');
  await reopened.connect('primary');assert.equal(reopened.snapshot().accounts[0].qqBinding.source,'last_verified');assert.equal(reopened.accounts[0].qqBinding.contextVersion,1);await reopened.close();
});

test('equivalent bridge URLs cannot be opened by two companions',async t=>{
  const {manager}=setup(t);await manager.connect('primary');const second=manager.add({name:'Second'});second.config.qqUrl='ws://127.0.0.1:3001/';second.account='87654321';await assert.rejects(manager.connect(manager.selectedId),/bridge/);await manager.close();
});

test('failed identity-record persistence cannot acquire a social account lease',async t=>{
  const {manager}=setup(t);manager.save=()=>{throw Error('Disk unavailable');};
  await assert.rejects(manager.connect('primary'),/Disk unavailable/);
  assert.equal(manager.claims.size,0);assert.equal(manager.accounts[0].qqBinding,undefined);assert.equal(manager.current().status,'disconnected');
});

test('coding account tabs use each backend persona despite unconfigured companion defaults',t=>{
  const {manager}=setup(t),claude=manager.current(),codex=manager.add({name:'Dragon'}),deepseek=manager.add({name:'Whale'});
  for(const [service,mode]of [[claude,'claude'],[codex,'codex'],[deepseek,'deepseek']])service.snapshot=()=>({mode,channel:'qq',status:'disconnected',social:{supported:mode!=='codex',config:{enabled:false,characterId:'claude-ju'}}});
  assert.deepEqual(manager.snapshot().accounts.map(account=>account.characterId),['claude-ju','codex-dragon','deepseek-whale']);
});

test('only enabled and supported companion settings override the backend portrait',t=>{
  const {manager}=setup(t),service=manager.current();
  const cases=[
    {mode:'deepseek',social:{supported:true,config:{enabled:true,characterId:'gemini-cat'}},expected:'gemini-cat'},
    {mode:'deepseek',social:{supported:true,config:{enabled:false,characterId:'gemini-cat'}},expected:'deepseek-whale'},
    {mode:'codex',social:{supported:false,config:{enabled:true,characterId:'claude-ju'}},expected:'codex-dragon'},
    {mode:'gpt',expected:'codex-dragon'},
    {mode:'native',expected:'claude-ju'},
    {mode:'api',social:{supported:false},expected:'claude-ju'},
  ];
  for(const {expected,...state}of cases){service.snapshot=()=>state;assert.equal(manager.snapshot().accounts[0].characterId,expected,JSON.stringify(state));}
});
