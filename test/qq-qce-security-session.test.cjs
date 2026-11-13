'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{randomUUID}=require('node:crypto');
const {fixture,deferred}=require('./helpers/qq-qce-security-fixture.cjs');
test('five actions work through production session and real loopback with once tickets',async t=>{
 const f=await fixture(t);const actions=[['addRule','192.0.2.5'],['setDisabled',true],['setDisplayHost','example.invalid']];
 for(const [action,value]of actions){const p=await f.preview(action,value),r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'accepted');assert.equal(r.change.observation.state,'match');assert.equal(r.change.effects.persistenceVerified,false);await assert.rejects(f.session.confirm({...f.input,ticketId:p.preview.ticketId}),{code:'stale_ticket'});}
 f.state.rules=['::1'];let p=await f.preview('addCurrent',null),r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'accepted');assert.deepEqual(f.writes().at(-1).body,{ip:'127.0.0.1'});assert(!f.writes().some(v=>v.path.endsWith('add-current')));
 let read=await f.session.read(f.input);p=f.session.preview({...f.input,observationId:read.profile.observationId,action:'removeRule',value:read.profile.state.rules[0].ruleId});r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.observation.state,'match');assert.equal(f.writes().length,5);assert(!JSON.stringify(read).includes('security.json'));assert(!JSON.stringify(read).includes('PRIVATE_SYNTHETIC'));
});
test('self-lock acknowledgment is retained with unavailable readback; empty enabled list remains observable',async t=>{
 const f=await fixture(t);f.state.enforce=true;let r=await f.session.read(f.input),p=f.session.preview({...f.input,observationId:r.profile.observationId,action:'removeRule',value:r.profile.state.rules[0].ruleId});assert.equal(p.preview.effects.mayBlockThisConnection,true);r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'accepted');assert.equal(r.change.observation.state,'unavailable');
 f.state.rules=['127.0.0.1'];r=await f.session.read(f.input);p=f.session.preview({...f.input,observationId:r.profile.observationId,action:'removeRule',value:r.profile.state.rules[0].ruleId});assert.equal(p.preview.after.allowsAll,true);r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.observation.state,'match');
});
test('complete relevant baseline detects source changes but ignores lastAccess bookkeeping',async t=>{
 const f=await fixture(t);for(const [key,value]of [['rules',['127.0.0.1','::1','192.0.2.1']],['displayHost','example.invalid'],['configPath','C:\\Synthetic-QCE\\other.json'],['currentClientIP','::ffff:127.0.0.1']]){const p=await f.preview();f.state[key]=value;const r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.code,'baseline_changed');}assert.equal(f.writes().length,0);
 const p=await f.preview(),r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'accepted');
});
test('error or lost reply stays unknown even if independent observation matches',async t=>{
 const f=await fixture(t);for(const mode of ['error','disconnect']){const p=await f.preview('setDisplayHost',mode+'.invalid');f.state.writeMode=mode;const r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'unknown');assert.equal(r.change.observation.state,'match');}assert.equal(f.writes().length,2);
});
test('Dismiss retains edit baseline and cancels held pre-send confirmation without new request',async t=>{
 const f=await fixture(t),p=await f.preview(),count=f.state.requests.length;f.session.dismiss(f.input);const p2=f.session.preview({...f.input,observationId:p.preview.observationId,action:'addRule',value:'192.0.2.8'});assert.equal(f.state.requests.length,count);
 const entered=deferred(),release=deferred();f.state.onGet=async row=>{if(row.path==='/api/security/ip-whitelist'){entered.resolve();await release.promise;}};const pending=f.session.confirm({...f.input,ticketId:p2.preview.ticketId});await entered.promise;f.session.dismiss(f.input);release.resolve();const r=await pending;assert.equal(r.change.outcome,'not_submitted');assert.equal(r.change.code,'cancelled');assert.equal(f.writes().length,0);
});
test('final monotonic TTL, endpoint and credential changes prevent mutation',async t=>{
 const f=await fixture(t);let p=await f.preview(),calls=0;f.state.verify=()=>{if(++calls===2)f.state.mono+=300000;};f.state.now-=999999;let r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.code,'expired_ticket');
 f.state.verify=null;p=await f.preview();f.endpoint.endpointId='synthetic-replaced';r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'not_submitted');await f.session.closeCurrent();f.endpoint.endpointId='synthetic-owned-listener';p=await f.preview();f.binding.credentialRevision=randomUUID();await assert.rejects(f.session.confirm({...f.input,ticketId:p.preview.ticketId}),{code:'changed'});assert.equal(f.writes().length,0);
});
test('version/QQ mismatch and close during initial verification create no mutation',async t=>{
 const f=await fixture(t);for(const [key,value,code]of [['version','6.3.2','qce_version_unsupported'],['account','100002','qq_mismatch'],['online',false,'qq_offline']]){const old=f.state[key];f.state[key]=value;await assert.rejects(f.session.read(f.input),{code});f.state[key]=old;}
 const count=f.created.length;f.state.verify=()=>queueMicrotask(()=>f.session.closeCurrent());await assert.rejects(f.session.read(f.input),{code:'changed'});assert.equal(f.created.length,count);assert.equal(f.writes().length,0);
});
test('late valid mutation acknowledgment survives close while post-close observation is suppressed',async t=>{
 const f=await fixture(t),p=await f.preview(),entered=deferred(),release=deferred();f.session.session.client.mutate=async(_command,options)=>{options.assertCurrent();options.onAttempt();entered.resolve();await release.promise;return {submission:'submitted',bridgeResponse:'received',outcome:'accepted'};};
 const pending=f.session.confirm({...f.input,ticketId:p.preview.ticketId});await entered.promise;const closing=f.session.closeCurrent();release.resolve();const r=await pending;await closing;assert.equal(r.change.outcome,'accepted');assert.equal(r.change.observation.state,'unavailable');assert.equal(r.panelId,f.input.panelId);
});
test('unrecognized mutation returns cannot become definitely not submitted',async t=>{
 const f=await fixture(t),p=await f.preview();f.session.session.client.mutate=async(_command,options)=>{options.onAttempt();return {outcome:'accepted'};};const r=await f.session.confirm({...f.input,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'unknown');assert.equal(r.change.submission,'submitted');
});
test('old panel Close does not retire a new owner and real malformed success keeps ACK layers',async t=>{
 const f=await fixture(t);await f.session.read(f.input);const next={...f.input,panelId:randomUUID()};await f.session.read(next);const client=f.session.session.client;await f.session.closeOwned(f.input);assert.equal(client.closed,false);
 const read=await f.session.read(next),p=f.session.preview({...next,observationId:read.profile.observationId,action:'addRule',value:'192.0.2.8'});f.state.writeMode='malformed';const r=await f.session.confirm({...next,ticketId:p.preview.ticketId});assert.equal(r.change.outcome,'unknown');assert.equal(r.change.bridgeResponse,'received');assert.equal(r.change.submission,'submitted');assert.equal(r.change.observation.state,'match');
});
