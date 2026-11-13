'use strict';
// Synthetic OS-crypto fixtures only. No real keys, keychain or account access.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BotService}=require('../src/bot/service.cjs');
const fakeVault=()=>({isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text),decryptString:bytes=>bytes.toString()});
const stored=value=>JSON.stringify({data:Buffer.from(JSON.stringify(value)).toString('base64')});
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-vault-lock-')),services=[];
  t.after(async()=>{for(const service of services){await service.disconnect();service.journal.close?.();}assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  return {root,file:path.join(root,'bot-vault.json'),open:options=>{const service=new BotService({root,vault:fakeVault(),...options});services.push(service);return service;}};
}

test('a decrypt failure locks the vault and config, QQ preparation and empty persistence cannot replace it',async t=>{
  const {root,file,open}=fixture(t),original=stored({deepseekKey:'private-key-fixture',qqToken:'private-token-fixture'});
  fs.writeFileSync(file,original);let encrypts=0,clients=0;
  const vault={...fakeVault(),encryptString(){encrypts++;throw Error('must not encrypt');},decryptString(){throw Error('private-decrypt-detail');}};
  const service=open({vault,clientFactory:()=>{clients++;throw Error('must not login');}});
  assert.equal(service.snapshot().credentialState,'locked');assert.deepEqual(service.secret,{});assert.match(service.snapshot().problem,/locked/);
  assert.doesNotMatch(JSON.stringify(service.snapshot()),/private-key|private-token|private-decrypt-detail|"data"/);
  service.configure({mode:'deepseek',channel:'qq',qqOwnerId:'12345678',workspace:root});
  assert.equal(service.snapshot().credentialState,'locked');assert.match(service.snapshot().problem,/locked/);
  assert.throws(()=>service.persist({}),{code:'credentials_locked'});
  assert.throws(()=>service.configure({key:'replacement-key-fixture'}),{code:'credentials_locked'});
  assert.throws(()=>service.prepareQQ(),{code:'credentials_locked'});
  assert.throws(()=>service.qqSetupToken(),{code:'credentials_locked'});
  assert.throws(()=>service.testQQ(),{code:'credentials_locked'});
  await assert.rejects(service.connect(),{code:'credentials_locked'});
  service.configure({channel:'wechat'});await assert.rejects(service.login(),{code:'credentials_locked'});
  assert.equal(encrypts,0);assert.equal(clients,0);assert.equal(fs.readFileSync(file,'utf8'),original);
  assert.equal(JSON.parse(fs.readFileSync(path.join(root,'bot-config.json'),'utf8')).mode,'deepseek');
});

test('encryption unavailable with an existing vault locks before decryption and never silently starts empty',t=>{
  const {file,open}=fixture(t),original=stored({key:'private-fixture-key'});fs.writeFileSync(file,original);let decrypts=0;
  const service=open({vault:{...fakeVault(),isEncryptionAvailable:()=>false,decryptString(){decrypts++;throw Error('must not decrypt');}}});
  assert.equal(service.snapshot().credentialState,'locked');assert.equal(service.snapshot().hasKey,false);assert.equal(decrypts,0);
  assert.throws(()=>service.persist({}),{code:'credentials_locked'});assert.equal(fs.readFileSync(file,'utf8'),original);
});

test('malformed, oversized and invalid decrypted vaults are locked and left byte-for-byte intact',t=>{
  const {file,open}=fixture(t);
  for(const original of ['{interrupted','null','{}',JSON.stringify({data:'not base64!'}),stored(null),stored([]),'x'.repeat(64001)]){
    fs.writeFileSync(file,original);const service=open();assert.equal(service.snapshot().credentialState,'locked');
    assert.throws(()=>service.persist({}),{code:'credentials_locked'});assert.equal(fs.readFileSync(file,'utf8'),original);
  }
});

test('a new profile without encryption cannot create plaintext credentials or a fake ready state',t=>{
  const {file,open}=fixture(t),service=open({vault:{...fakeVault(),isEncryptionAvailable:()=>false}});
  assert.equal(service.snapshot().credentialState,'empty');assert.throws(()=>service.configure({key:'private-fixture-key'}),/encryption/);
  assert.equal(service.snapshot().credentialState,'empty');assert.equal(service.snapshot().hasKey,false);assert.equal(fs.existsSync(file),false);
});

test('loss of encryption after opening preserves the encrypted file and locks subsequent writes',t=>{
  const {file,open}=fixture(t),vault=fakeVault(),service=open({vault});service.configure({key:'private-fixture-key'});
  const original=fs.readFileSync(file,'utf8');assert.equal(service.snapshot().credentialState,'ready');
  vault.isEncryptionAvailable=()=>false;assert.throws(()=>service.persist({}),{code:'credentials_locked'});
  assert.equal(service.snapshot().credentialState,'locked');assert.equal(service.snapshot().hasKey,false);assert.equal(fs.readFileSync(file,'utf8'),original);
});

test('a newly appearing or externally replaced vault is not overwritten by stale in-memory credentials',t=>{
  const {file,open}=fixture(t);const first=open(),external=stored({key:'external-owner-fixture'});fs.writeFileSync(file,external);
  assert.throws(()=>first.persist({}),{code:'credentials_locked'});assert.equal(fs.readFileSync(file,'utf8'),external);
  const second=open();assert.equal(second.snapshot().credentialState,'ready');const replaced=stored({key:'another-owner-fixture'});fs.writeFileSync(file,replaced);
  assert.throws(()=>second.configure({key:'stale-replacement-fixture'}),{code:'credentials_locked'});assert.equal(fs.readFileSync(file,'utf8'),replaced);
});

test('a custom current-profile vault never reads, replaces or forgets the old root vault',async t=>{
  const {root,file,open}=fixture(t),old='opaque-old-profile-vault';fs.writeFileSync(file,old);
  const vaultFile=path.join(root,'current-profile','credentials.json'),service=open({vaultFile});
  assert.equal(service.file,vaultFile);assert.equal(service.snapshot().credentialState,'empty');
  service.configure({mode:'deepseek',key:'new-profile-fixture-key'});assert.equal(service.snapshot().credentialState,'ready');assert.equal(fs.readFileSync(file,'utf8'),old);
  const reloaded=open({vaultFile});assert.equal(reloaded.snapshot().hasKey,true);assert.equal(reloaded.snapshot().credentialState,'ready');
  assert.doesNotMatch(JSON.stringify(reloaded.snapshot()),/new-profile-fixture-key|opaque-old-profile-vault/);
  await reloaded.forget();assert.equal(reloaded.snapshot().credentialState,'empty');assert.equal(fs.existsSync(vaultFile),false);assert.equal(fs.readFileSync(file,'utf8'),old);
});

test('only explicit forgetting removes a locked selected vault and permits replacement',async t=>{
  const {file,open}=fixture(t);fs.writeFileSync(file,stored({key:'old-private-key'}));
  const service=open({vault:{...fakeVault(),decryptString(){throw Error('locked');}}});assert.equal(service.snapshot().credentialState,'locked');
  service.configure({budget:0.5});assert.equal(fs.existsSync(file),true);assert.match(service.snapshot().problem,/locked/);
  await service.forget();assert.equal(fs.existsSync(file),false);assert.equal(service.snapshot().credentialState,'empty');assert.doesNotMatch(service.snapshot().problem,/locked/);
  service.configure({key:'explicit-new-fixture-key'});assert.equal(service.snapshot().credentialState,'ready');assert.equal(service.snapshot().hasKey,true);
});

test('application-supplied vault overrides must be absolute paths',t=>{
  const {open}=fixture(t);for(const vaultFile of ['relative.json','',{},null])assert.throws(()=>open({vaultFile}),/absolute credential vault path/);
});
