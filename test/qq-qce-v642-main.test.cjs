'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/qq-qce-main-fixture.cjs');
test('actual registered main folders IPC uses installed captured version and exact live registry',async t=>{
 const f=await fixture(t);f.state.installedVersion='6.4.2';f.state.plugins[0].version='6.4.2';f.qce.state.version='6.4.2';await f.save();const p=await f.preview(),r=await f.invoke('Confirm',{...f.input,ticketId:p.ticketId});assert.equal(r.ok,true);assert.equal(r.change.outcome,'accepted');assert.equal(f.qce.writes().length,1);assert(f.state.nativeProofs>0);assert.equal(f.clients.find(c=>c.version==='6.4.2')?.version,'6.4.2');
});
test('actual main rejects registry mismatch before any 6.4.2 QCE HTTP or mutation',async t=>{
 const f=await fixture(t);f.state.installedVersion='6.4.2';await f.save();const r=await f.invoke('Read');assert.equal(r.ok,false);assert.equal(r.code,'qce_version_unsupported');assert.equal(f.qce.state.requests.length,0);assert.equal(f.qce.writes().length,0);
});
test('actual main version replacement invalidates a pending preview and emits no write',async t=>{
 const f=await fixture(t);await f.save();const p=await f.preview();f.state.installedVersion='6.4.2';f.state.plugins[0].version='6.4.2';f.qce.state.version='6.4.2';const r=await f.invoke('Confirm',{...f.input,ticketId:p.ticketId});assert.equal(r.ok,false);assert.equal(r.code,'changed');assert.equal(f.qce.writes().length,0);
});
