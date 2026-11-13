'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {EventEmitter}=require('node:events');
const {PassThrough,Writable}=require('node:stream');
const {createHash}=require('node:crypto');
const {migrateApplicationVault,WORKER_FLAG}=require('../src/bot/vault-migration.cjs');
const {run}=require('../src/bot/vault-migration-worker.cjs');

// These are isolated fixture values, not the user's credential store.
const fixtureText=JSON.stringify({apiKey:'TEST-ONLY-DO-NOT-USE',qqToken:'fixture-noncredential'});
function fixture(t){
  const base=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-migration-test-'));
  t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const sourceRoot=path.join(base,'old-account'),sourceProfile=path.join(base,'old-profile'),targetRoot=path.join(base,'new-account');
  for(const dir of [sourceRoot,sourceProfile,targetRoot])fs.mkdirSync(dir);
  const original=JSON.stringify({data:Buffer.from('old-profile-encrypted-fixture').toString('base64')});
  fs.writeFileSync(path.join(sourceRoot,'bot-vault.json'),original);
  const encrypted=new Map();let encryptionCalls=0;
  const vault={isEncryptionAvailable:()=>true,encryptString(text){encryptionCalls++;const buffer=Buffer.from(`destination-encrypted-${encryptionCalls}`);encrypted.set(buffer.toString('hex'),text);return buffer;},decryptString(buffer){return encrypted.get(buffer.toString('hex'));}};
  return {base,sourceRoot,sourceProfile,targetRoot,original,vault,encryptionCalls:()=>encryptionCalls,
    options(){return {electronPath:path.join(base,'Agent Arcade.exe'),sourceRoot,sourceProfile,targetRoot,registeredRoots:[sourceRoot],vault};}};
}
function workerSpawn(f,{profile=f.sourceProfile,locked=false,tamper,afterExit,hang=false}={}){
  const capture={decrypts:0,kills:0,output:'',args:null,options:null};
  const spawnProcess=(_exe,args,options)=>{
    capture.args=args;capture.options=options;
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>{capture.kills++;setImmediate(()=>child.emit('close',1));};
    if(hang){child.stdin.resume();return child;}
    const output=new Writable({write(chunk,_encoding,callback){
      let text=chunk.toString();capture.output+=text;
      if(tamper){const data=JSON.parse(text);if(data.status!=='ready')text=JSON.stringify(tamper(data))+'\n';}
      child.stdout.write(text);callback();
    }});
    const app={getPath:()=>profile,requestSingleInstanceLock:()=>!locked,whenReady:async()=>{},exit(code){afterExit?.();setImmediate(()=>child.emit('close',code));}};
    const safeStorage={isEncryptionAvailable:()=>true,decryptString(){capture.decrypts++;return fixtureText;}};
    void run({electron:{app,safeStorage},stdin:child.stdin,stdout:output}).catch(()=>child.emit('error',Error('fixture worker failure')));
    return child;
  };
  return {spawnProcess,capture};
}

test('own-app migration uses the old profile, encrypted stdio and a new vault, preserving the original',async t=>{
  const f=fixture(t),worker=workerSpawn(f);
  const result=await migrateApplicationVault({...f.options(),spawnProcess:worker.spawnProcess,devAppPath:f.base});
  assert.equal(result.migrated,true);assert.match(result.sourceVaultSha256,/^[a-f0-9]{64}$/);
  assert.match(result.targetVaultSha256,/^[a-f0-9]{64}$/);
  assert.equal(fs.readFileSync(path.join(f.sourceRoot,'bot-vault.json'),'utf8'),f.original);
  const target=JSON.parse(fs.readFileSync(path.join(f.targetRoot,'bot-vault.json'),'utf8'));
  assert.equal(f.vault.decryptString(Buffer.from(target.data,'base64')),fixtureText);
  assert.equal(worker.capture.decrypts,1);assert.equal(f.encryptionCalls(),1);
  assert.deepEqual(worker.capture.args,[f.base,WORKER_FLAG,`--user-data-dir=${f.sourceProfile}`]);
  assert.deepEqual(worker.capture.options.stdio,['pipe','pipe','pipe']);assert.equal(worker.capture.options.windowsHide,true);
  assert.equal(worker.capture.output.includes('TEST-ONLY'),false);assert.equal(JSON.stringify(result).includes('fixture-noncredential'),false);
  assert.equal(fs.readFileSync(path.join(f.targetRoot,'bot-vault.json'),'utf8').includes('TEST-ONLY'),false);
  assert.deepEqual(fs.readdirSync(f.targetRoot),['bot-vault.json']);
});

test('unregistered sources, existing targets and the original destination are rejected before launching',async t=>{
  const f=fixture(t);let launches=0;const spawnProcess=()=>{launches++;};
  await assert.rejects(migrateApplicationVault({...f.options(),registeredRoots:[f.targetRoot],spawnProcess}),{code:'UNREGISTERED_SOURCE'});
  await assert.rejects(migrateApplicationVault({...f.options(),targetRoot:f.sourceRoot,spawnProcess}),{code:'INVALID_MIGRATION'});
  fs.writeFileSync(path.join(f.targetRoot,'bot-vault.json'),'already-exists');
  await assert.rejects(migrateApplicationVault({...f.options(),spawnProcess}),{code:'TARGET_EXISTS'});
  assert.equal(launches,0);assert.equal(fs.readFileSync(path.join(f.targetRoot,'bot-vault.json'),'utf8'),'already-exists');
});

test('a running old app or mismatched profile never decrypts or writes credentials',async t=>{
  const f=fixture(t);
  for(const config of [{locked:true},{profile:f.targetRoot}]){
    const worker=workerSpawn(f,config);
    await assert.rejects(migrateApplicationVault({...f.options(),spawnProcess:worker.spawnProcess}),{code:config.locked?'PROFILE_IN_USE':'PROFILE_MISMATCH'});
    assert.equal(worker.capture.decrypts,0);assert.equal(f.encryptionCalls(),0);
  }
  assert.equal(fs.existsSync(path.join(f.targetRoot,'bot-vault.json')),false);
});

test('a replay nonce or altered ciphertext is rejected before destination encryption',async t=>{
  const f=fixture(t);
  for(const tamper of [value=>({...value,nonce:'0'.repeat(64)}),value=>({...value,ciphertext:(value.ciphertext[0]==='A'?'B':'A')+value.ciphertext.slice(1)})]){
    const worker=workerSpawn(f,{tamper});
    await assert.rejects(migrateApplicationVault({...f.options(),spawnProcess:worker.spawnProcess}),{code:'INVALID_RESPONSE'});
  }
  assert.equal(f.encryptionCalls(),0);assert.equal(fs.existsSync(path.join(f.targetRoot,'bot-vault.json')),false);
});

test('timeout terminates the owned child and does not create a destination vault',async t=>{
  const f=fixture(t),worker=workerSpawn(f,{hang:true});
  await assert.rejects(migrateApplicationVault({...f.options(),spawnProcess:worker.spawnProcess,timeoutMs:100}),{code:'MIGRATION_TIMEOUT'});
  assert.equal(worker.capture.kills,1);assert.equal(fs.existsSync(path.join(f.targetRoot,'bot-vault.json')),false);
  assert.equal(fs.readFileSync(path.join(f.sourceRoot,'bot-vault.json'),'utf8'),f.original);
});

test('a changed source or concurrently created target aborts without replacing either file',async t=>{
  const f=fixture(t),changed=JSON.stringify({data:Buffer.from('new-source-fixture').toString('base64')});
  const sourceWorker=workerSpawn(f,{afterExit:()=>fs.writeFileSync(path.join(f.sourceRoot,'bot-vault.json'),changed)});
  await assert.rejects(migrateApplicationVault({...f.options(),spawnProcess:sourceWorker.spawnProcess}),{code:'SOURCE_CHANGED'});
  assert.equal(f.encryptionCalls(),0);assert.equal(fs.readFileSync(path.join(f.sourceRoot,'bot-vault.json'),'utf8'),changed);
  const targetWorker=workerSpawn(f,{afterExit:()=>fs.writeFileSync(path.join(f.targetRoot,'bot-vault.json'),'concurrent-target')});
  await assert.rejects(migrateApplicationVault({...f.options(),spawnProcess:targetWorker.spawnProcess}),{code:'TARGET_EXISTS'});
  assert.equal(fs.readFileSync(path.join(f.targetRoot,'bot-vault.json'),'utf8'),'concurrent-target');
  assert.deepEqual(fs.readdirSync(f.targetRoot),['bot-vault.json']);
});

test('oversize worker output is bounded and cannot reach the target',async t=>{
  const f=fixture(t),worker=workerSpawn(f,{tamper:value=>({...value,padding:'x'.repeat(300000)})});
  await assert.rejects(migrateApplicationVault({...f.options(),spawnProcess:worker.spawnProcess}),{code:'INVALID_RESPONSE'});
  assert.equal(f.encryptionCalls(),0);assert.equal(fs.existsSync(path.join(f.targetRoot,'bot-vault.json')),false);
});

test('destination encryption failure reports only a fixed code and keeps the source unchanged',async t=>{
  const f=fixture(t),worker=workerSpawn(f);
  f.vault.encryptString=()=>{throw Error(fixtureText);};
  await assert.rejects(migrateApplicationVault({...f.options(),spawnProcess:worker.spawnProcess}),error=>error.code==='TARGET_WRITE_FAILED'&&!error.message.includes('TEST-ONLY'));
  assert.deepEqual(fs.readdirSync(f.targetRoot),[]);
  assert.equal(fs.readFileSync(path.join(f.sourceRoot,'bot-vault.json'),'utf8'),f.original);
});

test('a post-write crash copy is recovered only after exact comparison with the original profile',async t=>{
  const f=fixture(t),first=workerSpawn(f);
  const initial=await migrateApplicationVault({...f.options(),spawnProcess:first.spawnProcess});
  const file=path.join(f.targetRoot,'bot-vault.json'),before=fs.readFileSync(file),retry=workerSpawn(f);
  const recovered=await migrateApplicationVault({...f.options(),spawnProcess:retry.spawnProcess,recoverTargetSha256:initial.targetVaultSha256});
  assert.equal(recovered.recovered,true);assert.equal(recovered.targetVaultSha256,initial.targetVaultSha256);
  assert.equal(retry.capture.decrypts,1,'recovery must verify the original through its own profile');
  assert.equal(f.encryptionCalls(),1,'recovery must not rewrite the existing encrypted copy');
  assert.ok(fs.readFileSync(file).equals(before));assert.equal(fs.readFileSync(path.join(f.sourceRoot,'bot-vault.json'),'utf8'),f.original);
});

test('an unrelated readable target and a concurrently changed recovery target are retained unchanged',async t=>{
  const f=fixture(t),file=path.join(f.targetRoot,'bot-vault.json');
  const bytes=Buffer.from(JSON.stringify({data:f.vault.encryptString(JSON.stringify({different:'synthetic-account'})).toString('base64')}));
  fs.writeFileSync(file,bytes);const fingerprint=createHash('sha256').update(bytes).digest('hex'),worker=workerSpawn(f);
  await assert.rejects(migrateApplicationVault({...f.options(),spawnProcess:worker.spawnProcess,recoverTargetSha256:fingerprint}),{code:'TARGET_EXISTS'});
  assert.ok(fs.readFileSync(file).equals(bytes));
  const changed=JSON.stringify({data:Buffer.from('another-writer-fixture').toString('base64')});
  const racing=workerSpawn(f,{afterExit:()=>fs.writeFileSync(file,changed)});
  await assert.rejects(migrateApplicationVault({...f.options(),spawnProcess:racing.spawnProcess,recoverTargetSha256:fingerprint}),{code:'TARGET_CHANGED'});
  assert.equal(fs.readFileSync(file,'utf8'),changed);
});
