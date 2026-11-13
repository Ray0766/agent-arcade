'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture,deferred}=require('./helpers/qq-remote-session-fixture.cjs');
const request=f=>({...f.input,remoteRevision:f.registry.capture(f.input.remoteId).revision});
const options={assertCurrent(){}};
test('transfer scope reuses completed 2FA and performs fresh version/actual-account reads only',async t=>{
 const f=fixture(t);f.state.twoFactor={enable2FA:true,hasSecret:true};await f.session.read({...f.input,totpCode:'123456'});const before=f.requests.length,clients=f.state.clients;
 assert.deepEqual(await f.session.verifyTransferScope(request(f),options),{verified:true});assert.deepEqual(f.requests.slice(before).map(v=>v.route),['version','qqStatus','qqInfo']);assert.equal(f.state.clients,clients);assert.equal(f.writes.length,0);
});
test('unopened session and a 2FA challenge are not authenticated transfer authority',async t=>{const f=fixture(t);await assert.rejects(f.session.verifyTransferScope(request(f),options));f.state.twoFactor={enable2FA:true,hasSecret:true};const r=await f.read();assert.equal(r.challenge.type,'totp');const n=f.requests.length;await assert.rejects(f.session.verifyTransferScope(request(f),options));assert.equal(f.requests.length,n);});
test('changed version, actual account and logout refuse transfer proof',async t=>{
 for(const patch of [{version:'4.18.41'},{actualQQ:'100002'},{isLogin:false}])await t.test(JSON.stringify(patch),async t=>{const f=fixture(t);await f.read();Object.assign(f.state,patch);await assert.rejects(f.session.verifyTransferScope(request(f),options));assert.equal(f.writes.length,0);});
});
test('wrong parent, stale revision, cancellation and asynchronous assert refuse before network',async t=>{
 const f=fixture(t);await f.read();const n=f.requests.length;
 for(const patch of [{panelId:randomUUID()},{remoteId:randomUUID()},{remoteRevision:randomUUID()},{url:'https://invalid.example'}])await assert.rejects(f.session.verifyTransferScope({...request(f),...patch},options));
 await assert.rejects(f.session.verifyTransferScope(request(f),{signal:AbortSignal.abort(),assertCurrent(){}}));await assert.rejects(f.session.verifyTransferScope(request(f),{assertCurrent:async()=>{}}));assert.equal(f.requests.length,n);
});
test('parent lease blocks changes during proof and child closure invalidates the late result',async t=>{
 const f=fixture(t);await f.read();const gate=deferred(),entered=deferred();let current=true;f.state.after=async route=>{if(route==='version'){entered.resolve();await gate.promise;}};
 const proof=f.session.verifyTransferScope(request(f),{assertCurrent(){if(!current)throw Object.assign(Error('synthetic'),{code:'changed'});}});await entered.promise;
 assert.throws(()=>f.registry.update({remoteId:f.input.remoteId,revision:f.item.revision,patch:{label:'Changed'}}),e=>e.code==='operation_in_progress');current=false;gate.resolve();await assert.rejects(proof);assert.equal(f.writes.length,0);
});
test('unknown credential rotation cannot grant helper proof',async t=>{
 const f=fixture(t),p=await f.preview('rotateToken',{newToken:'synthetic-new-token-2'});f.state.writeError=true;await f.confirm(p);await f.read();const n=f.requests.length;await assert.rejects(f.session.verifyTransferScope(request(f),options));assert.equal(f.requests.length,n);
});
