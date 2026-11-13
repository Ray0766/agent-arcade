'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {DatabaseSync}=require('node:sqlite');
const {SocialStore}=require('../src/bot/social-store.cjs');
const {BotService}=require('../src/bot/service.cjs');
const {SocialCompanion,scopeFor}=require('../src/bot/social-companion.cjs');

function directory(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-scoped-db-'));
  t.after(()=>{const target=path.resolve(root);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert(path.basename(target).startsWith('arcade-scoped-db-'));fs.rmSync(target,{recursive:true,force:true});});
  return root;
}
function observed(store){
  const counts={opens:0,begins:0,commits:0,rollbacks:0,closes:0},instances=[];
  class ObservedDatabase extends DatabaseSync{
    constructor(...args){super(...args);counts.opens++;instances.push(this);}
    exec(sql){if(/BEGIN IMMEDIATE/.test(sql))counts.begins++;if(sql==='COMMIT')counts.commits++;if(sql==='ROLLBACK')counts.rollbacks++;return super.exec(sql);}
    close(){counts.closes++;return super.close();}
  }
  store.DatabaseSync=ObservedDatabase;return {counts,instances};
}
const invalid=()=>Object.assign(Error('Synthetic invalid input'),{code:'social_invalid_input'});

test('one synchronous projection reuses a connection, not transactions, data or locks',t=>{
  const store=new SocialStore({root:directory(t)}),scope='scope';store.setNotes(scope,'first');
  const {counts,instances}=observed(store);
  store.withConnection(()=>{
    assert.equal(store.getNotes(scope),'first');
    store.withConnection(()=>assert.deepEqual(store.history(scope),[]));
    // Another connection can write between the two original transactions.
    const other=new DatabaseSync(store.file);
    try{other.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE');other.prepare('UPDATE scoped_notes SET text=? WHERE scope=?').run('second',store.scope(scope));other.exec('COMMIT');}finally{other.close();}
    assert.equal(store.getNotes(scope),'second');
    assert.deepEqual(counts,{opens:1,begins:3,commits:3,rollbacks:0,closes:0});
  });
  assert.equal(counts.closes,1);assert.throws(()=>instances[0].prepare('SELECT 1'));
  assert.equal(store.withConnection(()=>store.getNotes(scope)),'second');
  assert.deepEqual(counts,{opens:2,begins:4,commits:4,rollbacks:0,closes:2});
});

test('invalid input rolls back only its own transaction and discards the shared connection',t=>{
  const store=new SocialStore({root:directory(t)}),scope='scope',key=store.scope(scope),{counts,instances}=observed(store);
  store.withConnection(()=>{
    store.setNotes(scope,'committed');
    assert.throws(()=>store.withDb(db=>{db.prepare('UPDATE scoped_notes SET text=? WHERE scope=?').run('must roll back',key);throw invalid();}),{code:'social_invalid_input'});
    assert.equal(store.available,true);assert.equal(counts.closes,1);assert.throws(()=>instances[0].prepare('SELECT 1'));
    assert.equal(store.getNotes(scope),'committed');
  });
  assert.deepEqual(counts,{opens:2,begins:3,commits:2,rollbacks:1,closes:2});
  assert.equal(new SocialStore({root:path.dirname(store.file)}).getNotes(scope),'committed');
});

test('storage failure rolls back, closes immediately and prevents another read in the projection',t=>{
  const store=new SocialStore({root:directory(t)}),scope='scope';store.setNotes(scope,'original');
  const {counts}=observed(store);
  store.withConnection(()=>{
    assert.throws(()=>store.withDb(db=>{db.prepare('UPDATE scoped_notes SET text=? WHERE scope=?').run('uncommitted',store.scope(scope));throw Error('Synthetic disk failure');}),{code:'social_storage_unavailable'});
    assert.equal(store.available,false);assert.equal(counts.closes,1);
    assert.throws(()=>store.getNotes(scope),{code:'social_storage_unavailable'});
  });
  assert.deepEqual(counts,{opens:1,begins:1,commits:0,rollbacks:1,closes:1});
  assert.equal(new SocialStore({root:path.dirname(store.file)}).getNotes(scope),'original');
});

test('outer callback failure releases its connection and does not undo committed transactions',t=>{
  const store=new SocialStore({root:directory(t)}),{counts,instances}=observed(store);
  assert.throws(()=>store.withConnection(()=>{store.setNotes('scope','retained');throw invalid();}),{code:'social_invalid_input'});
  assert.equal(store.available,true);assert.equal(counts.closes,1);assert.throws(()=>instances[0].prepare('SELECT 1'));
  assert.equal(store.getNotes('scope'),'retained');assert.equal(counts.opens,2);assert.equal(counts.closes,2);
});

test('sync-only callbacks reject async functions before invocation and retain delayed rejection failure',async t=>{
  const store=new SocialStore({root:directory(t)}),{counts}=observed(store);let called=false;
  const asyncCallback=async()=>{called=true;};
  assert.throws(()=>store.withConnection(asyncCallback),{code:'social_invalid_input'});
  assert.throws(()=>store.withDb(asyncCallback),{code:'social_invalid_input'});assert.equal(called,false);assert.equal(counts.opens,0);
  assert.throws(()=>store.withConnection(()=>{store.getNotes('scope');return Promise.resolve('invalid result');}),{code:'social_invalid_input'});
  assert.equal(counts.closes,1);assert.equal(store.available,true);
  assert.throws(()=>store.withConnection(()=>store.withDb(()=>Promise.reject(Error('Synthetic delayed failure')))),{code:'social_invalid_input'});
  await Promise.resolve();assert.equal(store.available,false);assert.match(store.problem,/unavailable/);
  assert.equal(counts.opens,2);assert.equal(counts.closes,2);assert.equal(counts.rollbacks,1);
  // This rejects internal callback misuse; it does not cancel arbitrary work
  // a normal function might have already started before returning a Promise.
});

test('follow-up expiration still updates and commits on every read within a shared connection',t=>{
  let now=100000;const root=directory(t),store=new SocialStore({root,now:()=>now});
  store.scheduleFollowup('scope',{id:'planned',text:'Synthetic follow-up',dueAt:now+1000,expiresAt:now+2000,timeZone:'UTC'});
  const {counts}=observed(store);
  store.withConnection(()=>{assert.equal(store.followups('scope')[0].state,'pending');now+=2001;assert.equal(store.followups('scope')[0].state,'missed');});
  assert.deepEqual(counts,{opens:1,begins:2,commits:2,rollbacks:0,closes:1});
  assert.equal(new SocialStore({root,now:()=>now}).followups('scope')[0].state,'missed');
});

test('a close failure stays unavailable after initialization and does not escape service snapshots',t=>{
  let closed=0;
  class CloseFailure extends DatabaseSync{close(){super.close();closed++;throw Error('Synthetic close uncertainty');}}
  const broken=new SocialStore({root:directory(t),loadSqlite:()=>({DatabaseSync:CloseFailure})});
  assert.equal(closed,1);assert.equal(broken.available,false);assert.match(broken.problem,/unavailable/);
  const deny=()=>assert.fail('No account or model operation');
  const service=new BotService({root:directory(t),vault:{isEncryptionAvailable:()=>true,encryptString:x=>Buffer.from(x),decryptString:x=>x.toString()},clientFactory:deny,qqClientFactory:deny});
  service.config.mode='api';service.config.channel='qq';service.socialStore.configure({enabled:true});
  service.socialScope=scopeFor({accountId:'23456789',ownerId:'12345678',characterId:'claude-ju'});
  service.socialStore.append(service.socialScope,{id:'synthetic',role:'user',text:'Retained data'});
  service.dispatcher=new SocialCompanion({store:service.socialStore,scope:service.socialScope,execute:deny,send:deny,tickMs:0});
  t.after(()=>{service.dispatcher.cancel();service.dispatcher=null;});
  service.socialStore.DatabaseSync=CloseFailure;
  assert.doesNotThrow(()=>service.snapshot());assert.equal(service.socialStore.available,false);
  const later=service.snapshot();assert.deepEqual(later.social.history,[]);assert.equal(later.social.problem,'本地记忆无法读取，陪伴活动已暂停。');
  assert.equal(closed,2); // No replacement connection after an uncertain close.
});
