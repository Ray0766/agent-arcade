'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {AccountManager}=require('../src/bot/account-manager.cjs');
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-account-integrity-'));
  t.after(()=>{assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  const factory=options=>({root:options.root,status:'disconnected',config:{channel:'qq',qqUrl:'ws://127.0.0.1:3001',qqOwnerId:'99887766'},snapshot(){return {mode:'claude',channel:'qq',status:this.status,social:{config:{characterId:'claude-ju'}}};},async connect(){this.release=options.claimIdentity({channel:'qq',accountId:'12345678'});this.status='connected';},async disconnect(){this.release?.();this.status='disconnected';}});
  return {root,file:path.join(root,'companions.json'),factory,manager:new AccountManager({root,serviceFactory:factory})};
}

test('malformed existing registry is rejected without silently recreating or overwriting it',t=>{
  const {root,file,factory}=fixture(t),original='{existing account registry was interrupted';
  fs.writeFileSync(file,original);
  assert.throws(()=>new AccountManager({root,serviceFactory:factory}),/registry|invalid|damaged|read/i);
  assert.equal(fs.readFileSync(file,'utf8'),original);
});

test('unsupported registry versions and oversized files fail before constructing services',t=>{
  const {root,file}=fixture(t);let constructions=0;const factory=()=>{constructions++;throw Error('must not create a service');};
  fs.writeFileSync(file,JSON.stringify({version:999,selectedId:'primary',accounts:[{id:'primary',name:'Existing',root}]}));
  assert.throws(()=>new AccountManager({root,serviceFactory:factory}),/registry|version|newer/i);assert.equal(constructions,0);
  fs.writeFileSync(file,JSON.stringify({version:1,selectedId:'primary',accounts:[{id:'primary',name:'Existing',root}],padding:'x'.repeat(1024*1024)}));
  assert.throws(()=>new AccountManager({root,serviceFactory:factory}),/registry|large|size/i);assert.equal(constructions,0);
});

test('an old identity release cannot unlock a newer connection of the same companion',t=>{
  const {manager}=fixture(t);
  manager.add({name:'Other'});const otherId=manager.selectedId;
  const oldRelease=manager.claim('primary',{channel:'qq',accountId:'12345678'});
  const newRelease=manager.claim('primary',{channel:'qq',accountId:'12345678'});
  oldRelease();
  assert.throws(()=>manager.claim(otherId,{channel:'qq',accountId:'12345678'}),/already connected|in use/);
  newRelease();assert.doesNotThrow(()=>manager.claim(otherId,{channel:'qq',accountId:'12345678'}));
});

test('a failed history write keeps the previous identity lease and record intact',t=>{
  const {manager,file}=fixture(t);manager.add({name:'Other'});const otherId=manager.selectedId;
  const release=manager.claim('primary',{channel:'qq',accountId:'12345678'}),lease=manager.claims.get('qq:12345678'),record=manager.accounts[0].qqBinding,stored=fs.readFileSync(file,'utf8');
  manager.save=()=>{throw Error('simulated disk failure');};
  assert.throws(()=>manager.claim('primary',{channel:'qq',accountId:'12345678'}),/disk failure/);assert.equal(manager.claims.get('qq:12345678'),lease);assert.equal(manager.accounts[0].qqBinding,record);assert.equal(fs.readFileSync(file,'utf8'),stored);
  assert.throws(()=>manager.claim(otherId,{channel:'qq',accountId:'12345678'}),{code:'account_in_use'});release();assert.equal(manager.claims.size,0);
});

test('invalid or incomplete identity context fails without rewriting the registry or constructing services',t=>{
  const {root,file}=fixture(t);let constructed=0;
  const base={accountId:'12345678',url:'ws://127.0.0.1:3001',verifiedAt:1,contextVersion:1,ownerId:'99887766',expectedAccountId:''};
  for(const patch of [{ownerId:undefined},{contextVersion:2},{accountId:'000001'},{ownerId:'12345678'},{expectedAccountId:'87654321'},{url:'ws://example.com:3001'}]){
    const stored=JSON.stringify({version:1,selectedId:'primary',accounts:[{id:'primary',name:'Fixture',root,qqBinding:{...base,...patch}}]});fs.writeFileSync(file,stored);
    assert.throws(()=>new AccountManager({root,serviceFactory:()=>{constructed++;}}),/invalid QQ identity/);assert.equal(fs.readFileSync(file,'utf8'),stored);
  }
  assert.equal(constructed,0);
});

test('registry writes that fail leave selected identity, names and service inventory unchanged',t=>{
  const {manager}=fixture(t);const first=manager.current();manager.add({name:'Second'});const secondId=manager.selectedId;manager.select('primary');
  const original=manager.snapshot(),serviceCount=manager.services.size;
  manager.save=()=>{throw Error('simulated disk failure');};
  assert.throws(()=>manager.select(secondId),/disk failure/);assert.equal(manager.selectedId,'primary');assert.equal(manager.current(),first);
  assert.throws(()=>manager.rename(secondId,'Changed'),/disk failure/);assert.equal(manager.accounts.find(item=>item.id===secondId).name,'Second');
  assert.throws(()=>manager.add({name:'Uncommitted'}),/disk failure/);assert.equal(manager.services.size,serviceCount);assert.equal(manager.accounts.length,original.accounts.length);assert.equal(manager.selectedId,'primary');
  assert.throws(()=>manager.remove(secondId),/disk failure/);assert.equal(manager.services.size,serviceCount);assert.equal(manager.accounts.length,original.accounts.length);assert.doesNotThrow(()=>manager.get(secondId));
});

test('a disconnected companion removal never deletes its stored profile or credential bytes',t=>{
  const {manager}=fixture(t);const added=manager.add({name:'Retained'}),id=manager.selectedId;
  fs.writeFileSync(path.join(added.root,'bot-config.json'),'{}');fs.writeFileSync(path.join(added.root,'vault.bin'),'opaque-encrypted-placeholder');
  manager.remove(id);
  assert.equal(fs.readFileSync(path.join(added.root,'vault.bin'),'utf8'),'opaque-encrypted-placeholder');
  assert.equal(manager.accounts.some(item=>item.id===id),false);assert.equal(manager.selectedId,'primary');
});
