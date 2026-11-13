'use strict';
// Synthetic encrypted-vault contract and local temporary files only.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {BotService}=require('../src/bot/service.cjs');
const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from('fixture-encrypted:'+s),decryptString:b=>b.toString().slice('fixture-encrypted:'.length)};
const OLD='synthetic-old-bridge-token',NEXT='synthetic-new-bridge-token';
function fixture(t,{saved=true}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-config-transaction-')),service=new BotService({root,vault});
  if(saved)service.configure({channel:'qq',mode:'codex',workspace:root,qqOwnerId:'12345678',qqAccountId:'87654321',qqUrl:'ws://127.0.0.1:3001/',qqToken:OLD});
  t.after(async()=>{await service.disconnect();service.journal.close?.();service.socialStore.close?.();assert.equal(path.dirname(root),os.tmpdir());assert.match(path.basename(root),/^arcade-config-transaction-/);fs.rmSync(root,{recursive:true,force:true});});
  const config=path.join(root,'bot-config.json'),secret=path.join(root,'bot-vault.json');
  return {root,service,config,secret,oldConfig:saved?fs.readFileSync(config):null,oldSecret:saved?fs.readFileSync(secret):null,oldFingerprint:service.vaultFingerprint};
}
const patch={qqUrl:'ws://127.0.0.1:3002/',qqToken:NEXT};

test('configuration staging failure never changes the old vault, settings or in-memory credentials',t=>{
  const f=fixture(t),write=fs.writeFileSync;t.mock.method(fs,'writeFileSync',(file,...args)=>{if(String(file).startsWith(f.config+'.'))throw Error('injected config stage failure');return write(file,...args);});
  assert.throws(()=>f.service.configure(patch),/stage failure/);assert.deepEqual(fs.readFileSync(f.secret),f.oldSecret);assert.deepEqual(fs.readFileSync(f.config),f.oldConfig);assert.equal(f.service.secret.qqToken,OLD);assert.equal(f.service.vaultFingerprint,f.oldFingerprint);assert.equal(f.service.credentialState,'ready');
});

test('configuration commit failure atomically restores the exact previous encrypted vault',t=>{
  const f=fixture(t),rename=fs.renameSync;t.mock.method(fs,'renameSync',(from,to)=>{if(to===f.config)throw Error('injected config commit failure');return rename(from,to);});
  assert.throws(()=>f.service.configure(patch),{code:'configuration_save_failed'});assert.deepEqual(fs.readFileSync(f.secret),f.oldSecret);assert.deepEqual(fs.readFileSync(f.config),f.oldConfig);assert.equal(f.service.secret.qqToken,OLD);assert.equal(f.service.config.qqUrl,'ws://127.0.0.1:3001/');assert.equal(f.service.vaultFingerprint,f.oldFingerprint);assert.equal(f.service.credentialState,'ready');assert.equal(fs.readdirSync(f.root).some(name=>name.endsWith('.tmp')),false);
});

test('a first-save config failure removes only the exact new vault and returns to the empty state',t=>{
  const f=fixture(t,{saved:false}),rename=fs.renameSync;t.mock.method(fs,'renameSync',(from,to)=>{if(to===f.config)throw Error('injected commit failure');return rename(from,to);});
  assert.throws(()=>f.service.configure({channel:'qq',qqOwnerId:'12345678',...patch}),{code:'configuration_save_failed'});assert.equal(fs.existsSync(f.secret),false);assert.equal(fs.existsSync(f.config),false);assert.deepEqual(f.service.secret,{});assert.equal(f.service.credentialState,'empty');assert.equal(f.service.vaultFingerprint,null);assert.equal(f.service.config.channel,'wechat');
});

test('credential commit failure never commits the staged new connection settings',t=>{
  const f=fixture(t),rename=fs.renameSync;t.mock.method(fs,'renameSync',(from,to)=>{if(to===f.secret)throw Error('injected vault commit failure');return rename(from,to);});
  assert.throws(()=>f.service.configure(patch),/vault commit failure/);assert.deepEqual(fs.readFileSync(f.secret),f.oldSecret);assert.deepEqual(fs.readFileSync(f.config),f.oldConfig);assert.equal(f.service.secret.qqToken,OLD);assert.equal(f.service.credentialState,'ready');
});

test('a vault rename that wrote before reporting failure is recognized and rolled back',t=>{
  const f=fixture(t),rename=fs.renameSync;
  t.mock.method(fs,'renameSync',(from,to)=>{rename(from,to);if(to===f.secret&&!String(from).endsWith('.restore.tmp'))throw Error('injected vault post-commit error');});
  assert.throws(()=>f.service.configure(patch),{code:'configuration_save_failed'});assert.deepEqual(fs.readFileSync(f.secret),f.oldSecret);assert.deepEqual(fs.readFileSync(f.config),f.oldConfig);assert.equal(f.service.secret.qqToken,OLD);assert.equal(f.service.vaultFingerprint,f.oldFingerprint);assert.equal(f.service.credentialState,'ready');
});

test('an uncertain config rename that committed both desired files is treated as saved',t=>{
  const f=fixture(t),rename=fs.renameSync;t.mock.method(fs,'renameSync',(from,to)=>{rename(from,to);if(to===f.config)throw Error('injected post-commit error');});
  f.service.configure(patch);assert.equal(f.service.secret.qqToken,NEXT);assert.equal(f.service.config.qqUrl,patch.qqUrl);assert.equal(JSON.parse(fs.readFileSync(f.config,'utf8')).qqUrl,patch.qqUrl);assert.notDeepEqual(fs.readFileSync(f.secret),f.oldSecret);assert.equal(f.service.credentialState,'ready');
});

test('a different writer vault is retained and failed rollback locks the service',t=>{
  const f=fixture(t),rename=fs.renameSync,foreign=Buffer.from(JSON.stringify({data:Buffer.from('opaque-foreign-fixture').toString('base64')}));
  t.mock.method(fs,'renameSync',(from,to)=>{if(to===f.config){fs.writeFileSync(f.secret,foreign);throw Error('injected concurrent change');}return rename(from,to);});
  assert.throws(()=>f.service.configure(patch),{code:'configuration_rollback_failed'});assert.deepEqual(fs.readFileSync(f.secret),foreign);assert.deepEqual(fs.readFileSync(f.config),f.oldConfig);assert.equal(f.service.credentialState,'locked');assert.deepEqual(f.service.secret,{});assert.match(f.service.snapshot().problem,/rollback could not be verified/);assert.throws(()=>f.service.configure(patch),{code:'credentials_locked'});
});

test('rollback filesystem failure is explicit and keeps the uncertain ciphertext intact',t=>{
  const f=fixture(t),rename=fs.renameSync;let newCipher;
  t.mock.method(fs,'renameSync',(from,to)=>{if(to===f.config){newCipher=fs.readFileSync(f.secret);throw Error('injected config commit failure');}if(String(from).endsWith('.restore.tmp'))throw Error('injected rollback failure');return rename(from,to);});
  assert.throws(()=>f.service.configure(patch),{code:'configuration_rollback_failed'});assert.deepEqual(fs.readFileSync(f.secret),newCipher);assert.deepEqual(fs.readFileSync(f.config),f.oldConfig);assert.equal(f.service.credentialState,'locked');assert.deepEqual(f.service.secret,{});assert.equal(f.service.config.qqUrl,'ws://127.0.0.1:3001/');
});

test('a concurrent settings writer is not overwritten and our credentials roll back',t=>{
  const f=fixture(t),rename=fs.renameSync,foreign=Buffer.from(JSON.stringify({channel:'qq',mode:'codex',qqUrl:'ws://127.0.0.1:3999/'}));
  t.mock.method(fs,'renameSync',(from,to)=>{rename(from,to);if(to===f.secret&&!String(from).endsWith('.restore.tmp'))fs.writeFileSync(f.config,foreign);});
  assert.throws(()=>f.service.configure(patch),{code:'configuration_save_failed'});assert.deepEqual(fs.readFileSync(f.config),foreign);assert.deepEqual(fs.readFileSync(f.secret),f.oldSecret);assert.equal(f.service.secret.qqToken,OLD);assert.equal(f.service.credentialState,'ready');
});
