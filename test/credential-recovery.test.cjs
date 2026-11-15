'use strict';
// Synthetic cryptography; real encrypted-file lifecycle and SQLite retention.
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BotService}=require('../src/bot/service.cjs');
const {SocialStore}=require('../src/bot/social-store.cjs');
const encrypted=secret=>JSON.stringify({data:Buffer.from(JSON.stringify(secret)).toString('base64')});
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-credential-retry-')),file=path.join(root,'bot-vault.json'),original=encrypted({key:'fixture-old-key',deepseekKey:'fixture-other-key',token:'fixture-channel-token'});
 fs.writeFileSync(file,original);let locked=true,decrypts=0;
 const vault={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text),decryptString:bytes=>{decrypts++;if(locked)throw Error('PRIVATE_PROVIDER_ERROR');return bytes.toString();}};
 const service=new BotService({root,vault});
 t.after(async()=>{await service.localStop();await service.disconnect();fs.rmSync(root,{recursive:true,force:true});});
 return {root,file,original,vault,service,unlock:()=>{locked=false;},decrypts:()=>decrypts};
}

test('explicit retry reopens only the same encrypted file and never rewrites it or starts a connection',async t=>{
 const f=fixture(t);assert.equal(f.service.credentialState,'locked');f.unlock();
 const answer=await f.service.retryCredentials();assert.deepEqual(answer,{recovered:true});
 assert.equal(f.service.credentialState,'ready');assert.equal(f.service.status,'disconnected');assert.equal(f.service.secret.deepseekKey,'fixture-other-key');assert.equal(f.service.secret.token,'fixture-channel-token');
 assert.equal(fs.readFileSync(f.file,'utf8'),f.original);assert.doesNotMatch(JSON.stringify(f.service.snapshot()),/fixture-old-key|fixture-other-key|fixture-channel-token/);
});

test('denied Keychain retry remains locked with fixed safe guidance and intact ciphertext',async t=>{
 const f=fixture(t),answer=await f.service.retryCredentials();
 assert.deepEqual(answer,{recovered:false,code:process.platform==='darwin'?'keychain_restart_required':'credential_open_failed'});
 assert.equal(f.service.credentialState,'locked');assert.deepEqual(f.service.secret,{});assert.equal(fs.readFileSync(f.file,'utf8'),f.original);
 assert.doesNotMatch(JSON.stringify(answer),/PRIVATE_PROVIDER_ERROR|fixture-/);
});

test('retry refuses changed files and stale scope before adopting credentials',async t=>{
 const f=fixture(t);f.unlock();
 fs.writeFileSync(f.file,encrypted({key:'replacement-fixture'}));assert.deepEqual(await f.service.retryCredentials(),{recovered:false,code:'vault_changed'});
 fs.writeFileSync(f.file,f.original);const count=f.decrypts();assert.deepEqual(await f.service.retryCredentials({isCurrent:()=>false}),{recovered:false,code:'credential_scope_changed'});assert.equal(f.decrypts(),count);
 f.vault.decryptString=bytes=>{fs.writeFileSync(f.file,encrypted({key:'late-fixture'}));return bytes.toString();};
 assert.deepEqual(await f.service.retryCredentials(),{recovered:false,code:'vault_changed'});assert.deepEqual(f.service.secret,{});
});

test('an in-flight retry serializes other recovery and rejects a changed backend after local cleanup',async t=>{
 const f=fixture(t);f.unlock();let release;f.service.localStop=()=>new Promise(resolve=>{release=resolve;});
 const pending=f.service.retryCredentials();assert.deepEqual(await f.service.retryCredentials(),{recovered:false,code:'credentials_busy'});
 f.service.config.mode='deepseek';release();assert.deepEqual(await pending,{recovered:false,code:'credential_scope_changed'});
 f.service.localStop=async()=>{};assert.equal(fs.readFileSync(f.file,'utf8'),f.original);
});

test('reset first verifies an encrypted backup and retains real SQLite conversation, memory and configuration',async t=>{
 const f=fixture(t),scope='a'.repeat(64),local=new SocialStore({root:path.join(f.root,'local-companion')});
 local.append(scope,{id:'before-reset',role:'user',text:'Retain this local conversation',at:Date.now()});
 local.upsertFact(scope,{id:'b'.repeat(32),text:'Retain this private memory'});
 f.service.socialStore.append(scope,{id:'channel-before-reset',role:'user',text:'Retain this channel conversation',at:Date.now()});
 const beforeLocal=local.history(scope,20),beforeFacts=local.facts(scope),beforeChannel=f.service.socialStore.history(scope,20),config=JSON.stringify(f.service.config);
 const prepared=f.service.prepareCredentialReset();assert.equal(prepared.prepared,true);assert.equal(fs.readFileSync(f.file,'utf8'),f.original);
 assert.deepEqual(await f.service.resetCredentials({ticket:prepared.ticket}),{reset:true,allProfileCredentials:true,conversationsRetained:true,encryptedBackupKept:true});
 assert.equal(f.service.credentialState,'empty');assert.equal(fs.existsSync(f.file),false);assert.equal(JSON.stringify(f.service.config),config);
 const backups=fs.readdirSync(path.join(f.root,'credential-recovery'));assert.equal(backups.length,1);
 const backup=path.join(f.root,'credential-recovery',backups[0]);assert.equal(fs.readFileSync(backup,'utf8'),f.original);
 if(process.platform!=='win32'){assert.equal(fs.statSync(backup).mode&0o777,0o600);assert.equal(fs.statSync(path.dirname(backup)).mode&0o777,0o700);}
 assert.deepEqual(local.history(scope,20),beforeLocal);assert.deepEqual(local.facts(scope),beforeFacts);assert.deepEqual(f.service.socialStore.history(scope,20),beforeChannel);
 assert.deepEqual(await f.service.resetCredentials({ticket:prepared.ticket}),{reset:false,code:'credential_reset_expired'});
 f.unlock();f.service.configure({key:'fixture-new-key'});assert.equal(fs.readFileSync(backup,'utf8'),f.original);assert.deepEqual(local.history(scope,20),beforeLocal);
});

test('failed backup, scope change or replaced ciphertext cannot retire the original vault',async t=>{
 const f=fixture(t),first=f.service.prepareCredentialReset();fs.writeFileSync(path.join(f.root,'credential-recovery'),'blocked');
 assert.deepEqual(await f.service.resetCredentials({ticket:first.ticket}),{reset:false,code:'credential_backup_failed'});assert.equal(fs.readFileSync(f.file,'utf8'),f.original);
 const second=f.service.prepareCredentialReset();assert.deepEqual(await f.service.resetCredentials({ticket:second.ticket,isCurrent:()=>false}),{reset:false,code:'credential_scope_changed'});
 const third=f.service.prepareCredentialReset(),replacement=encrypted({key:'separate-writer'});fs.writeFileSync(f.file,replacement);
 assert.deepEqual(await f.service.resetCredentials({ticket:third.ticket}),{reset:false,code:'vault_changed'});assert.equal(fs.readFileSync(f.file,'utf8'),replacement);
});
