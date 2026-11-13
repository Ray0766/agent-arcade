'use strict';
// Synthetic encrypted envelopes. No OS profile, helper process or real key.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createHash}=require('node:crypto');
const {AccountManager}=require('../src/bot/account-manager.cjs');
const {BotService}=require('../src/bot/service.cjs');
const hash=text=>createHash('sha256').update(text).digest('hex');
const envelope=value=>JSON.stringify({data:Buffer.from(value).toString('base64')});
const vault={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text),decryptString:bytes=>{const text=bytes.toString();if(text==='old-profile-only')throw Error('wrong profile');return text;}};
function fixture(t,{factory}={}){
  const temp=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-account-migrate-')),root=path.join(temp,'manager'),source=path.join(temp,'source');fs.mkdirSync(root);fs.mkdirSync(source);
  const original=envelope('old-profile-only');fs.writeFileSync(path.join(source,'bot-config.json'),JSON.stringify({mode:'deepseek',channel:'qq'}));fs.writeFileSync(path.join(source,'bot-vault.json'),original);fs.writeFileSync(path.join(source,'memory-marker.txt'),'retained-memory');
  const managers=[],manager=new AccountManager({root,vault,...(factory?{serviceFactory:factory}: {})});managers.push(manager);manager.add({name:'Existing Whale',root:source});const id=manager.selectedId;
  t.after(async()=>{for(const m of managers){await m.close();for(const s of m.services.values())s.journal?.close?.();}assert(temp.startsWith(os.tmpdir()));fs.rmSync(temp,{recursive:true,force:true});});
  return {root,source,original,manager,id,managers};
}
function migrateFixture(options){
  const bytes=envelope(JSON.stringify({deepseekKey:'private-migration-fixture-key',qqToken:'private-migration-fixture-token'}));
  fs.writeFileSync(path.join(options.targetRoot,'bot-vault.json'),bytes);return {migrated:true,targetVaultSha256:hash(bytes)};
}

test('migration adopts only a new encrypted copy and persists the fixed managed vault path',async t=>{
  const {root,source,original,manager,id,managers}=fixture(t),previous=manager.get(id),ticket=manager.captureCredentialMigration(id);
  const result=await manager.migrateCredentials(ticket,options=>{assert.equal(options.sourceRoot,source);assert.equal(options.targetRoot,path.join(root,'credential-profiles',id));assert.deepEqual(options.registeredRoots,[root,source]);return migrateFixture(options);});
  assert.deepEqual(result,{migrated:true});assert.notEqual(manager.get(id),previous);assert.equal(manager.get(id).snapshot().credentialState,'ready');assert.equal(manager.get(id).snapshot().hasKey,true);
  assert.equal(manager.get(id).file,path.join(root,'credential-profiles',id,'bot-vault.json'));assert.equal(fs.readFileSync(path.join(source,'bot-vault.json'),'utf8'),original);assert.equal(fs.readFileSync(path.join(source,'memory-marker.txt'),'utf8'),'retained-memory');
  const saved=JSON.parse(fs.readFileSync(path.join(root,'companions.json'),'utf8'));assert.equal(saved.accounts.find(x=>x.id===id).managedVault,true);assert.doesNotMatch(JSON.stringify(manager.snapshot()),/private-migration-fixture/);
  const reopened=new AccountManager({root,vault});managers.push(reopened);assert.equal(reopened.get(id).snapshot().credentialState,'ready');assert.equal(reopened.get(id).file,manager.get(id).file);
});

test('registry managedVault accepts booleans only before constructing any service',t=>{
  const {root,source}=fixture(t);
  for(const flag of [1,'true',null,{},[]]){
    fs.writeFileSync(path.join(root,'companions.json'),JSON.stringify({version:1,accounts:[{id:'primary',name:'Existing',root:source,managedVault:flag}],selectedId:'primary'}));let builds=0;
    assert.throws(()=>new AccountManager({root,serviceFactory:()=>{builds++;}}),/managed credential flag/);assert.equal(builds,0);
  }
});

test('pending forget blocks new migration captures and late adoption without treating locked credentials as busy',async t=>{
  const {manager,id}=fixture(t),service=manager.get(id);let release;
  const gate=new Promise(resolve=>{release=resolve;});t.after(()=>release());
  service.friendRequests={close:()=>gate};const forgetting=service.forget();await service.disconnect();
  assert.equal(service.status,'disconnected');assert.equal(service.snapshot().credentialState,'locked');
  assert.throws(()=>manager.captureCredentialMigration(id),{code:'credentials_busy'});
  // Exact current-generation proof isolates the second gate from the existing
  // generation invalidation, without running a migration helper or OS crypto.
  const ticket={id,service,entry:manager.accounts.find(row=>row.id===id),generation:service.generation,config:JSON.stringify(service.config)};
  await assert.rejects(manager.migrateCredentials(ticket,()=>assert.fail('busy migration must not start')),{code:'credentials_busy'});
  release();await forgetting;
});

test('a worker failure leaves the registered service and old vault intact',async t=>{
  const {source,original,manager,id}=fixture(t),before=manager.get(id);
  await assert.rejects(manager.migrateCredentials(manager.captureCredentialMigration(id),()=>{throw Error('synthetic helper refusal');}),/helper refusal/);
  assert.equal(manager.get(id),before);assert.equal(manager.accounts.find(x=>x.id===id).managedVault,false);assert.equal(manager.snapshot().accounts.find(x=>x.id===id).credentialMigration,false);assert.equal(fs.readFileSync(path.join(source,'bot-vault.json'),'utf8'),original);
});

test('unreadable new credentials roll back the service and remove only the newly owned copy',async t=>{
  const {source,original,manager,id}=fixture(t,{factory:options=>new BotService({...options,vault:options.vaultFile?{...vault,decryptString(){throw Error('new profile failure');}}:vault})}),before=manager.get(id);
  await assert.rejects(manager.migrateCredentials(manager.captureCredentialMigration(id),migrateFixture),/new credential copy/);
  assert.equal(manager.get(id),before);assert.equal(manager.accounts.find(x=>x.id===id).managedVault,false);assert.equal(fs.existsSync(path.join(manager.managedCredentialRoot(id),'bot-vault.json')),false);assert.equal(fs.readFileSync(path.join(source,'bot-vault.json'),'utf8'),original);
});

test('registry save failure rolls back adoption without replacing the source vault or original service',async t=>{
  const {root,source,original,manager,id}=fixture(t),before=manager.get(id),registry=fs.readFileSync(path.join(root,'companions.json'),'utf8');manager.save=()=>{throw Error('synthetic registry write failure');};
  await assert.rejects(manager.migrateCredentials(manager.captureCredentialMigration(id),migrateFixture),/registry write/);
  assert.equal(manager.get(id),before);assert.equal(manager.accounts.find(x=>x.id===id).managedVault,false);assert.equal(fs.readFileSync(path.join(root,'companions.json'),'utf8'),registry);assert.equal(fs.existsSync(path.join(manager.managedCredentialRoot(id),'bot-vault.json')),false);assert.equal(fs.readFileSync(path.join(source,'bot-vault.json'),'utf8'),original);
});

test('changed identity, connection generation or configuration invalidates migration before adoption',async t=>{
  const {manager,id}=fixture(t),before=manager.get(id),ticket=manager.captureCredentialMigration(id);before.config.channel='wechat';
  await assert.rejects(manager.migrateCredentials(ticket,()=>assert.fail('stale ticket must not launch helper')),/companion changed/);
  const current=manager.captureCredentialMigration(id);
  await assert.rejects(manager.migrateCredentials(current,options=>{const result=migrateFixture(options);before.generation++;return result;}),/companion changed/);
  assert.equal(manager.get(id),before);assert.equal(manager.accounts.find(x=>x.id===id).managedVault,false);assert.equal(fs.existsSync(path.join(manager.managedCredentialRoot(id),'bot-vault.json')),false);
});

test('a target copy changed by another writer is never adopted or deleted during rollback',async t=>{
  const {manager,id}=fixture(t),replacement='another-writer-encrypted-copy';
  await assert.rejects(manager.migrateCredentials(manager.captureCredentialMigration(id),options=>{const result=migrateFixture(options);fs.writeFileSync(path.join(options.targetRoot,'bot-vault.json'),replacement);return result;}),/copy changed/);
  assert.equal(fs.readFileSync(path.join(manager.managedCredentialRoot(id),'bot-vault.json'),'utf8'),replacement);assert.equal(manager.accounts.find(x=>x.id===id).managedVault,false);
});

test('in-flight migration blocks duplicate starts, removal and connection but permits viewing another account',async t=>{
  const {manager,id}=fixture(t);let finish;const running=manager.migrateCredentials(manager.captureCredentialMigration(id),options=>new Promise(resolve=>{finish=()=>resolve(migrateFixture(options));}));
  assert.equal(manager.snapshot().accounts.find(x=>x.id===id).credentialMigration,true);assert.throws(()=>manager.captureCredentialMigration(id),/already in progress/);assert.throws(()=>manager.remove(id),/migration/);await assert.rejects(manager.connect(id),/migration/);
  manager.select('primary');finish();await running;assert.equal(manager.selectedId,'primary');assert.equal(manager.get(id).snapshot().credentialState,'ready');
});

test('only registered disconnected locked accounts may start migration and existing targets are not overwritten',async t=>{
  const {manager,id}=fixture(t);assert.throws(()=>manager.captureCredentialMigration('unregistered'),/not found/);assert.throws(()=>manager.captureCredentialMigration('primary'),/locked/);
  const service=manager.get(id);service.status='connected';assert.throws(()=>manager.captureCredentialMigration(id),/disconnected/);service.status='disconnected';
  const target=path.join(manager.managedCredentialRoot(id,{create:true}),'bot-vault.json');fs.writeFileSync(target,'retained-target');
  await assert.rejects(manager.migrateCredentials(manager.captureCredentialMigration(id),()=>assert.fail('must not overwrite')),/not overwritten/);assert.equal(fs.readFileSync(target,'utf8'),'retained-target');
});

test('a verified crash copy can be adopted without rewriting the old or new vault',async t=>{
  const {source,original,manager,id}=fixture(t),targetRoot=manager.managedCredentialRoot(id,{create:true});
  const receipt=migrateFixture({targetRoot}),target=path.join(targetRoot,'bot-vault.json'),before=fs.readFileSync(target);
  const result=await manager.migrateCredentials(manager.captureCredentialMigration(id),options=>{
    assert.equal(options.recoverTargetSha256,receipt.targetVaultSha256);return {...receipt,recovered:true};
  });
  assert.deepEqual(result,{migrated:true,recovered:true});assert.equal(manager.get(id).snapshot().credentialState,'ready');
  assert.ok(fs.readFileSync(target).equals(before));assert.equal(fs.readFileSync(path.join(source,'bot-vault.json'),'utf8'),original);
});

test('failed registry adoption preserves a verified crash copy for a later retry',async t=>{
  const {manager,id}=fixture(t),targetRoot=manager.managedCredentialRoot(id,{create:true});
  const receipt=migrateFixture({targetRoot}),target=path.join(targetRoot,'bot-vault.json'),before=fs.readFileSync(target),save=manager.save.bind(manager);
  manager.save=()=>{throw Error('synthetic registry failure');};
  const recover=async options=>{assert.equal(options.recoverTargetSha256,receipt.targetVaultSha256);return {...receipt,recovered:true};};
  await assert.rejects(manager.migrateCredentials(manager.captureCredentialMigration(id),recover),/registry failure/);
  assert.ok(fs.readFileSync(target).equals(before));assert.equal(manager.get(id).snapshot().credentialState,'locked');
  manager.save=save;assert.equal((await manager.migrateCredentials(manager.captureCredentialMigration(id),recover)).recovered,true);
});

test('an existing target without an exact recovery receipt remains unadopted and untouched',async t=>{
  const {manager,id}=fixture(t),targetRoot=manager.managedCredentialRoot(id,{create:true}),receipt=migrateFixture({targetRoot});
  const target=path.join(targetRoot,'bot-vault.json'),before=fs.readFileSync(target);
  await assert.rejects(manager.migrateCredentials(manager.captureCredentialMigration(id),()=>receipt),/verified recovery receipt/);
  assert.equal(manager.get(id).snapshot().credentialState,'locked');assert.ok(fs.readFileSync(target).equals(before));
});
