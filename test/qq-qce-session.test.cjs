'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {fixture,ACCOUNT,flush,deferred}=require('./helpers/qq-qce-fixture.cjs');
const {QQQCESession,qceRequest,qceResult}=require('../src/bot/qq-qce-session.cjs');
test('production session reads four transient paths, previews one field and sends once',async t=>{
 const f=await fixture(t),r=await f.session.read(f.input);assert.equal(r.qqAccountId,ACCOUNT);assert.equal(r.profile.scope.accountIsolated,false);assert.equal(r.profile.effects.nullBaselineHealthVerified,false);
 const p=f.session.preview({...f.input,observationId:r.profile.observationId,field:'customOutputDir',value:'D:\\Synthetic-QCE\\new'});assert.equal(f.writes().length,0);
 const out=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(out.change.outcome,'accepted');assert.equal(out.change.observation.state,'match');assert.equal(out.change.effects.durablePersistenceVerified,false);
 assert.deepEqual(f.writes()[0].body,{customOutputDir:'D:\\Synthetic-QCE\\new'});await assert.rejects(f.session.confirm({...f.input,ticketId:p.preview.ticketId}),{code:'stale_ticket'});assert.equal(f.writes().length,1);
 assert.ok(!JSON.stringify(r).includes('PRIVATE_SYNTHETIC'));assert.ok(!JSON.stringify(out).includes('D:\\\\Synthetic'));
});
test('explicit reset and scheduled default use only chosen field',async t=>{
 const f=await fixture(t);f.state.paths.customScheduledExportDir='D:\\Synthetic-QCE\\old';const p=await f.preview('customScheduledExportDir',null);
 const r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'accepted');assert.deepEqual(f.writes()[0].body,{customScheduledExportDir:null});
});
test('Dismiss returns to editing without network and retains only unconsumed bounded observation',async t=>{
 const f=await fixture(t),p=await f.preview(),count=f.state.requests.length;f.session.dismiss(f.input);
 await assert.rejects(f.session.confirm({...f.input,ticketId:p.preview.ticketId}),{code:'stale_ticket'});
 const next=f.session.preview({...f.input,observationId:p.preview.observationId,field:'customOutputDir',value:'D:\\Synthetic-QCE\\other'});assert.notEqual(next.preview.ticketId,p.preview.ticketId);assert.equal(f.state.requests.length,count);
 f.session.dismiss(f.input);f.state.mono+=300000;assert.throws(()=>f.session.preview({...f.input,observationId:p.preview.observationId,field:'customOutputDir',value:null}),{code:'expired_ticket'});
});
test('complete four-field baseline detects another effective path change',async t=>{
 const f=await fixture(t),p=await f.preview();f.state.paths.currentScheduledExportsDir='D:\\Synthetic-QCE\\changed';
 const r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'not_submitted');assert.equal(r.change.code,'baseline_changed');assert.equal(f.writes().length,0);
});
test('unknown error response remains unknown even with matching independent readback',async t=>{
 const f=await fixture(t),p=await f.preview();f.state.writeMode='error';const r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});
 assert.equal(r.change.outcome,'unknown');assert.equal(r.change.bridgeResponse,'received');assert.equal(r.change.observation.state,'match');assert.equal(f.writes().length,1);
});
test('wrong version, offline, mismatch and identity changing across GET deny read',async t=>{
 const f=await fixture(t);for(const [key,value,code]of [['version','6.3.2','qce_version_unsupported'],['online',false,'qq_offline'],['account','100002','qq_mismatch']]){
  const old=f.state[key];f.state[key]=value;await assert.rejects(f.session.read(f.input),{code});f.state[key]=old;
 }
 f.state.onGet=()=>{f.state.account='100002';};await assert.rejects(f.session.read(f.input),{code:'qq_mismatch'});assert.equal(f.writes().length,0);
});
test('final monotonic expiry after main verification prevents PUT; wall time cannot extend it',async t=>{
 const f=await fixture(t),p=await f.preview();let count=0;f.state.verify=()=>{if(++count===2)f.state.mono+=300000;};f.state.now-=999999;
 const r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'not_submitted');assert.equal(r.change.code,'expired_ticket');assert.equal(f.writes().length,0);
});
test('scope change during awaited pre-read stops final PUT',async t=>{
 const f=await fixture(t),p=await f.preview();f.state.onGet=()=>{f.binding.contextKey='synthetic-context-2';};
 const r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'not_submitted');assert.equal(f.writes().length,0);
});
test('Dismiss during fresh pre-read consumes ticket and stops not-yet-sent confirmation',async t=>{
 const f=await fixture(t),p=await f.preview(),gate=deferred(),entered=deferred();f.state.onGet=async()=>{entered.resolve();await gate.promise;};
 const pending=f.session.confirm({...f.input,ticketId:p.preview.ticketId});await entered.promise;f.session.dismiss(f.input);gate.resolve();const r=await pending;
 assert.equal(r.change.outcome,'not_submitted');assert.equal(r.change.code,'cancelled');assert.equal(f.writes().length,0);
});
test('close in final verification microtask creates no client or socket',async t=>{
 const f=await fixture(t);f.state.verify=()=>queueMicrotask(()=>f.session.closeCurrent());await assert.rejects(f.session.read(f.input),{code:'changed'});assert.equal(f.created.length,0);assert.equal(f.state.requests.length,0);
});
test('endpoint identity and credential revision changes revoke tickets',async t=>{
 const f=await fixture(t),p=await f.preview();f.endpoint.endpointId='synthetic-replaced-listener';let r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'not_submitted');assert.equal(f.writes().length,0);
 await f.session.closeCurrent();f.endpoint.endpointId='synthetic-owned-listener';const next=await f.preview();f.binding.credentialRevision=randomUUID();await assert.rejects(f.session.confirm({...f.input,ticketId:next.preview.ticketId}),{code:'changed'});
});
test('late acknowledged response retains captured scope after close',async t=>{
 const f=await fixture(t),p=await f.preview(),gate=deferred(),entered=deferred();const client=f.session.session.client;
 client.setConfig=async(field,value,options)=>{options.assertCurrent();options.onAttempt();entered.resolve();await gate.promise;return {submission:'submitted',bridgeResponse:'received',outcome:'accepted'};};
 const pending=f.session.confirm({...f.input,ticketId:p.preview.ticketId});await entered.promise;const closing=f.session.closeCurrent();gate.resolve();const r=await pending;await closing;
 assert.equal(r.change.outcome,'accepted');assert.equal(r.change.observation.state,'unavailable');assert.equal(r.panelId,f.input.panelId);
});
test('unexpected mutation throw or malformed return cannot be called not submitted',async t=>{
 const f=await fixture(t);for(const malformed of [false,true]){const p=await f.preview();f.session.session.client.setConfig=async(field,value,options)=>{options.onAttempt();if(malformed)return {outcome:'accepted'};throw Error('SYNTHETIC_PRIVATE_FAILURE');};
  const r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'unknown');assert.equal(r.change.submission,'submitted');assert.ok(!JSON.stringify(r).includes('PRIVATE_FAILURE'));
 }
});
test('old panel close cannot retire a replacement and no authority fields pass validator',async t=>{
 const f=await fixture(t);await f.session.read(f.input);const next={...f.input,panelId:randomUUID()};await f.session.read(next);const client=f.session.session.client;await f.session.closeOwned(f.input);assert.equal(client.closed,false);
 for(const extra of [{url:'http://example.invalid'},{port:123},{pluginId:'napcat-plugin-qce'},{qqAccountId:ACCOUNT}])assert.throws(()=>qceRequest({...next,...extra}),{code:'invalid_request'});
 const r=await qceResult({...next,token:'secret'},()=>{throw Error('SECRET_PRIVATE_PATH');});assert.equal(r.ok,false);assert.deepEqual(Object.keys(r).sort(),['accountId','code','ok','panelId']);
});
