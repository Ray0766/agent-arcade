'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {MessageJournal,MAX_RECORDS}=require('../src/bot/journal.cjs');
const temp=t=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-messenger-batch-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;};
test('durable batch distinguishes all claimed from new IDs across database reopen and exact namespaces',t=>{
 const root=temp(t);let journal=new MessageJournal({root});assert.equal(journal.claim('scope-a','old','api'),true);
 assert.deepEqual(journal.claimBatch('scope-a',['old','new'],'api'),{claimedIds:['old','new'],newIds:['new']});journal=new MessageJournal({root});
 assert.deepEqual(journal.claimBatch('scope-a',['old','new'],'api'),{claimedIds:['old','new'],newIds:[]});assert.deepEqual(journal.claimBatch('scope-b',['old','new'],'api').newIds,['old','new']);
 assert(!JSON.stringify(journal.snapshot()).includes('scope-a'));assert(!JSON.stringify(journal.snapshot()).includes('"new"'));
});
test('batch capacity failure commits none of the incoming IDs',t=>{
 const root=temp(t),journal=new MessageJournal({root}),now=Date.now();
 journal.withDb(db=>{const insert=db.prepare("INSERT INTO inbound(id,mode,state,created_at,updated_at) VALUES(?,'api','received',?,?)");for(let i=0;i<MAX_RECORDS-1;i++)insert.run(journal.key('scope',`seed-${i}`),now,now);});
 assert.throws(()=>journal.claimBatch('scope',['new-1','new-2'],'api'),{code:'journal_unavailable'});
 const reopened=new MessageJournal({root});assert.equal(reopened.withDb(db=>db.prepare('SELECT count(*) AS n FROM inbound').get().n),MAX_RECORDS-1);assert.equal(reopened.claim('scope','new-1','api'),true);
});
test('SQL failure after first batch insert rolls back that entire batch',t=>{
 const root=temp(t),journal=new MessageJournal({root});const blocked=journal.key('scope','second');
 journal.withDb(db=>db.exec(`CREATE TRIGGER synthetic_batch_failure BEFORE INSERT ON inbound WHEN NEW.id='${blocked}' BEGIN SELECT RAISE(ABORT,'synthetic'); END;`));
 assert.throws(()=>journal.claimBatch('scope',['first','second'],'api'),{code:'journal_unavailable'});
 const reopened=new MessageJournal({root});assert.equal(reopened.withDb(db=>db.prepare('SELECT count(*) AS n FROM inbound').get().n),0);
});
test('invalid batch IDs, duplicates and oversize bounds reject before writing',t=>{
 const journal=new MessageJournal({root:temp(t)});
 for(const ids of [[],['duplicate','duplicate'],['x'.repeat(181)],Array.from({length:51},(_,i)=>`id-${i}`)])assert.throws(()=>journal.claimBatch('scope',ids,'api'),{code:'journal_unavailable'});
 assert.equal(journal.withDb(db=>db.prepare('SELECT count(*) AS n FROM inbound').get().n),0);
});
test('retention pruning does not falsely acknowledge a removed stale duplicate',t=>{
 const root=temp(t);let now=1_800_000_000_000;const journal=new MessageJournal({root,now:()=>now});journal.claim('scope','expired','api');now+=31*86400000;
 assert.deepEqual(journal.claimBatch('scope',['expired','fresh'],'api').newIds,['expired','fresh']);
 assert.equal(journal.withDb(db=>db.prepare('SELECT count(*) AS n FROM inbound').get().n),2);
});
