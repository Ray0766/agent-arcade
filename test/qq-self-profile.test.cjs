'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {QQSelfProfile,valueFor}=require('../src/bot/qq-self-profile.cjs');
const ACCOUNT='87654321',flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
function fixture(t){
 const state={nickname:' Synthetic nickname ',signature:'Original signature',now:1_800_000_000_000,mono:100,writes:[],reads:0};
 const client={accountId:ACCOUNT,expectedAccountId:ACCOUNT,generation:1,ready:true,closed:false,socket:{readyState:1}};
 const binding={profile:{},profileId:'fixture-profile',generation:1,characterId:'fixture-character',runtime:{},installation:{},runtimeEpoch:1,bridgeRevision:'fixture-bridge',endpointId:'fixture-endpoint',client,accountId:ACCOUNT};
 const row=()=>({accountId:ACCOUNT,source:'bridge-observed',fetchedAt:new Date(state.now).toISOString(),nickname:{supported:true,value:state.nickname},signature:{supported:true,value:state.signature}});
 const transport={async read(b,opts){state.reads++;opts.assertCurrent();return row();},async write(b,change,opts){opts.assertCurrent();if(state[change.field]!==change.expectedValue)return {outcome:'not_submitted',code:'baseline_changed'};state.writes.push(change);state[change.field]=change.value;return {outcome:'accepted',acknowledgement:'bridge-action-only'};}};
 const controller=new QQSelfProfile({getBinding:()=>binding,transport,now:()=>state.now,monotonic:()=>state.mono,timeoutMs:30000});t.after(()=>controller.close());
 const draft=async(field='signature',value='New signature')=>{const read=await controller.read();return controller.preview({observationId:read.observationId,field,value});};
 return {controller,state,client,binding,transport,row,draft};
}
test('private read, explicit preview and single confirmation do not expose arbitrary source fields or global text',async t=>{
 const f=fixture(t),original=f.transport.read;f.transport.read=async(...args)=>({...await original(...args),privateExtra:'DO_NOT_PROJECT'});
 const read=await f.controller.read();assert.equal(read.values.nickname,f.state.nickname);assert.equal(read.cacheMayBeStale,true);assert(!JSON.stringify(read).includes('DO_NOT_PROJECT'));assert.deepEqual(f.controller.snapshot(),{busy:false,available:true});
 const preview=f.controller.preview({observationId:read.observationId,field:'signature',value:'New signature'});assert.equal(f.state.writes.length,0);assert.equal(preview.before,'Original signature');
 const out=await f.controller.confirm({ticketId:preview.ticketId});assert.equal(out.outcome,'accepted');assert.equal(out.observation.state,'observed_match');assert.equal(f.state.reads,2);assert.equal(f.state.writes.length,1);
 await assert.rejects(f.controller.confirm({ticketId:preview.ticketId}),{code:'stale_ticket'});
});
test('explicit field policy preserves bytes and never guesses unsupported original values',async t=>{
 for(const [field,value]of [['nickname',' 空格 '],['nickname','🐳'.repeat(60)],['signature',''],['signature','🐳'.repeat(120)]])assert.equal(valueFor(field,value),value);
 for(const [field,value]of [['nickname',' '],['nickname','a'.repeat(61)],['signature','a'.repeat(121)],['signature','x\n'],['signature','x\u202e'],['signature','\ud800'],['avatar','x']])assert.throws(()=>valueFor(field,value),{code:'invalid_value'});
 const f=fixture(t);f.transport.read=async()=>({...f.row(),signature:{supported:false,reason:'original_unsupported'}});const read=await f.controller.read();assert.equal(read.values.signature,null);assert.equal(read.capabilities.readable.signature,false);assert.throws(()=>f.controller.preview({observationId:read.observationId,field:'signature',value:'safe'}),{code:'original_unsupported'});
});
test('renderer-shaped target, extra field and arbitrary asset/path cannot enter previews',async t=>{
 const f=fixture(t),read=await f.controller.read();for(const extra of [{accountId:'12345678'},{path:'C:/private.png'},{url:'https://invalid.example'},{friendId:'12345678'}])assert.throws(()=>f.controller.preview({observationId:read.observationId,field:'nickname',value:'New',...extra}),{code:'invalid_request'});assert.equal(f.state.writes.length,0);
});
test('all main and connection binding changes invalidate the old preview without a write',async t=>{
 const cases={profile:{},profileId:'other-profile',generation:2,characterId:'other-character',runtime:{},installation:{},runtimeEpoch:2,bridgeRevision:'other-bridge',endpointId:'other-endpoint'};
 for(const [key,value]of Object.entries(cases)){const f=fixture(t),p=await f.draft();f.binding[key]=value;const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.outcome,'not_submitted',key);assert.equal(f.state.writes.length,0,key);}
 for(const change of [f=>f.client.generation++,f=>f.client.socket={readyState:1},f=>f.client.accountId='12345678',f=>f.client.ready=false]){const f=fixture(t),p=await f.draft();change(f);const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.outcome,'not_submitted');assert.equal(f.state.writes.length,0);}
});
test('monotonic expiry cannot be extended by wall-clock rollback',async t=>{
 const f=fixture(t),p=await f.draft();f.state.now-=86400000;f.state.mono+=300001;const result=await f.controller.confirm({ticketId:p.ticketId});assert.equal(result.outcome,'not_submitted');assert.equal(result.code,'expired_ticket');assert.equal(f.state.writes.length,0);
});
test('changed baseline is not overwritten and the consumed ticket cannot be retried',async t=>{
 const f=fixture(t),p=await f.draft();f.state.signature='Changed elsewhere';const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.outcome,'not_submitted');assert.equal(out.code,'baseline_changed');assert.equal(f.state.writes.length,0);await assert.rejects(f.controller.confirm({ticketId:p.ticketId}),{code:'stale_ticket'});
});
test('unknown, throwing and malformed invoked writes do not retry or issue speculative readback',async t=>{
 for(const mode of ['unknown','throw','malformed']){const f=fixture(t),p=await f.draft();f.transport.write=async()=>{f.state.writes.push(mode);if(mode==='throw')throw Error('PRIVATE_RAW_FAILURE');return mode==='malformed'?{}:{outcome:'unknown',code:'PRIVATE_RAW_FAILURE'};};const result=await f.controller.confirm({ticketId:p.ticketId});assert.equal(result.outcome,'unknown');assert.equal(result.code,'change_unknown');assert.equal(f.state.reads,1);assert.equal(f.state.writes.length,1);assert(!JSON.stringify(result).includes('PRIVATE_RAW_FAILURE'));}
});
test('accepted stays accepted when bounded readback differs, fails, or context changes',async t=>{
 for(const mode of ['different','read-failed','context']){const f=fixture(t),p=await f.draft();f.transport.write=async()=>{if(mode==='read-failed')f.transport.read=async()=>{throw Error('PRIVATE_READ');};if(mode==='context')f.binding.runtimeEpoch++;return {outcome:'accepted',acknowledgement:'bridge-action-only'};};const result=await f.controller.confirm({ticketId:p.ticketId});assert.equal(result.outcome,'accepted');assert.equal(result.observation.state,mode==='different'?'observed_different':'unavailable');}
});
test('close waits for the invoked operation and preserves its late acceptance',async t=>{
 const f=fixture(t),p=await f.draft(),held=deferred();f.transport.write=async()=>held.promise;const changing=f.controller.confirm({ticketId:p.ticketId});await flush();let settled=false;const closing=f.controller.close().then(()=>{settled=true;});await flush();assert.equal(settled,false);held.resolve({outcome:'accepted',acknowledgement:'bridge-action-only'});assert.equal((await changing).outcome,'accepted');await closing;assert.equal(f.controller.snapshot().available,false);
});
test('aborted before invocation and explicit dismissal have no side effects',async t=>{
 const f=fixture(t),p=await f.draft(),abort=new AbortController();abort.abort();const out=await f.controller.confirm({ticketId:p.ticketId},{signal:abort.signal});assert.equal(out.outcome,'not_submitted');assert.equal(out.code,'cancelled');const next=await f.draft();f.controller.dismiss();await assert.rejects(f.controller.confirm({ticketId:next.ticketId}),{code:'stale_ticket'});assert.equal(f.state.writes.length,0);
});
test('single flight rejects duplicate confirmation and late read under another scope',async t=>{
 const f=fixture(t),gate=deferred();f.transport.read=async()=>{await gate.promise;return f.row();};const pending=f.controller.read();await flush();await assert.rejects(f.controller.read(),{code:'operation_in_progress'});f.binding.runtimeEpoch++;gate.resolve();await assert.rejects(pending,{code:'changed'});assert.equal(f.controller.baseline,null);
});
test('editing can revoke only the previous preview while preserving the exact observed baseline',async t=>{
 const f=fixture(t),row=await f.controller.read(),first=f.controller.preview({observationId:row.observationId,field:'signature',value:'First proposal'});f.controller.discardPreview();await assert.rejects(f.controller.confirm({ticketId:first.ticketId}),{code:'stale_ticket'});
 const second=f.controller.preview({observationId:row.observationId,field:'signature',value:'Second proposal'});assert.equal(second.before,'Original signature');assert.notEqual(second.ticketId,first.ticketId);assert.equal((await f.controller.confirm({ticketId:second.ticketId})).outcome,'accepted');assert.equal(f.state.writes.length,1);
});

test('nickname ticket captures the observed signature and refuses signature-style acceptance',async t=>{
 const f=fixture(t),p=await f.draft('nickname','New nickname');let change;
 f.transport.write=async(_b,value)=>{change=value;return {outcome:'accepted',acknowledgement:'bridge-action-only'};};const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(change.expectedSignature,'Original signature');assert.equal(out.outcome,'unknown');assert.equal(out.field,'nickname');assert.equal(out.preservationGuaranteed,false);assert.equal(f.state.reads,1);await assert.rejects(f.controller.confirm({ticketId:p.ticketId}),{code:'stale_ticket'});
});

test('signature previews and receipts remain free of nickname whole-profile claims',async t=>{
 const f=fixture(t),p=await f.draft();assert.equal(p.mutationScope,undefined);const out=await f.controller.confirm({ticketId:p.ticketId});assert.equal(out.acknowledgement,'bridge-action-only');assert.equal(out.mutationScope,undefined);assert.equal(out.outcome,'accepted');
});
