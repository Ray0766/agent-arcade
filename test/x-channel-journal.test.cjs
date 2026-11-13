'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {MessageJournal}=require('../src/bot/journal.cjs');
test('X delivery metadata preserves API acceptance, unknown and unsubmitted; abandoned attempts reopen as unknown',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-x-journal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
  let journal=new MessageJournal({root});for(const state of ['accepted','unknown','not_submitted']){journal.attemptDelivery('synthetic-private-scope',state);journal.completeDelivery('synthetic-private-scope',state,state);}journal.attemptDelivery('synthetic-private-scope','crashed');
  assert.equal(journal.snapshot().channelDelivery.filter(row=>row.state==='attempted').length,1);journal=new MessageJournal({root});
  const rows=journal.snapshot().channelDelivery;assert.equal(rows.filter(row=>row.state==='unknown').length,2);assert.equal(rows.filter(row=>row.state==='accepted').length,1);assert.equal(rows.filter(row=>row.state==='not_submitted').length,1);assert(!JSON.stringify(rows).includes('synthetic-private-scope'));
  assert.throws(()=>journal.completeDelivery('synthetic-private-scope','crashed','accepted'),{code:'journal_unavailable'});
});
test('same delivery ID is independently scoped and journal clear removes delivery metadata',t=>{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-x-journal-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const journal=new MessageJournal({root});
  journal.attemptDelivery('scope-a','same');journal.attemptDelivery('scope-b','same');journal.completeDelivery('scope-a','same','accepted');journal.completeDelivery('scope-b','same','not_submitted');assert.equal(journal.snapshot().channelDelivery.length,2);journal.clear();assert.deepEqual(journal.snapshot().channelDelivery,[]);
});
