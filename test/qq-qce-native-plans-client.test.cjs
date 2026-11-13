'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,deferred,flush}=require('./helpers/qq-qce-native-plans-fixture.cjs');
const {QQQCENativePlansClient}=require('../src/bot/qq-qce-native-plans-client.cjs');
test('fixed eight native routes use Bearer only and bounded typed query',async t=>{
 const f=await fixture(t),r=f.addPlan(),createBody={...r,name:'Synthetic created',enabled:false};delete createBody.id;await f.client.list();await f.client.plan(r.id);await f.client.history(r.id,25);await f.client.targets('group',1);
 for(const command of [{action:'create',body:createBody},{action:'enable',nativePlanId:r.id,body:{enabled:true}},{action:'run',nativePlanId:r.id,body:{}},{action:'triggerAll',body:{includeDisabled:true}},{action:'remove',nativePlanId:r.id,body:null}])assert.equal((await f.client.mutate(command)).outcome,'accepted');
 assert.deepEqual(f.writes().map(r=>[r.method,r.path]),[['POST','/api/scheduled-exports'],['PUT',`/api/scheduled-exports/${r.id}`],['POST',`/api/scheduled-exports/${r.id}/trigger`],['POST','/api/scheduled-exports/trigger-all'],['DELETE',`/api/scheduled-exports/${r.id}`]]);for(const row of f.state.requests){assert.equal(row.headers['x-forwarded-for'],undefined);assert.equal(row.headers['x-real-ip'],undefined);assert.equal(row.headers['x-access-token'],undefined);assert(!JSON.stringify(row.query).includes(f.clientOptions.token));}
 for(const o of [{host:'localhost'},{port:40654},{triggerTimeoutMs:300001},{token:'invalid'}])assert.throws(()=>new QQQCENativePlansClient({...f.clientOptions,...o}),{code:'invalid_request'});
});
test('valid envelope with invalid history preserves submitted/received unknown and no replay',async t=>{
 const f=await fixture(t),r=f.addPlan();f.state.writeMode='malformed';const result=await f.client.mutate({action:'run',nativePlanId:r.id,body:{}});assert.deepEqual([result.submission,result.bridgeResponse,result.outcome],['submitted','received','unknown']);assert.equal(f.writes().length,1);
});
test('redirect, oversized JSON, encoded content and unauthorized errors have fixed safe failures',async t=>{
 const f=await fixture(t);for(const [mode,code]of [['redirect','redirect_rejected'],['large','response_too_large'],['encoded','invalid_response'],['auth','unauthorized']]){f.state.before=(_row,res,_send,error)=>{if(mode==='auth')error('PRIVATE_SYNTHETIC_TOKEN',403);else{res.statusCode=mode==='redirect'?302:200;res.setHeader('Content-Type','application/json');if(mode==='redirect')res.setHeader('Location','https://example.invalid/private');if(mode==='encoded')res.setHeader('Content-Encoding','gzip');res.end(mode==='large'?'x'.repeat(2097153):'{}');}return true;};await assert.rejects(f.client.list(),e=>e.code===code&&!e.message.includes('PRIVATE_SYNTHETIC'));}
});
test('send-marker cancellation is definitely not submitted, while timeout and lost replies never replay',async t=>{
 const f=await fixture(t),r=f.addPlan(),controller=new AbortController();let result=await f.client.mutate({action:'enable',nativePlanId:r.id,body:{enabled:true}},{signal:controller.signal,onAttempt:()=>controller.abort()});assert.equal(result.outcome,'not_submitted');await flush();assert.equal(f.writes().length,0);
 for(const mode of ['disconnect','timeout']){f.state.writeMode=mode;result=await f.client.mutate({action:'enable',nativePlanId:r.id,body:{enabled:true}});assert.equal(result.outcome,'unknown');}assert.equal(f.writes().length,2);
});
test('single trigger has an independent wait budget; owned close settles held real HTTP',async t=>{
 const f=await fixture(t),r=f.addPlan(),client=new QQQCENativePlansClient({...f.clientOptions,timeoutMs:20,triggerTimeoutMs:500});t.after(()=>client.close());f.state.afterWrite=()=>new Promise(resolve=>setTimeout(resolve,50));assert.equal((await client.mutate({action:'run',nativePlanId:r.id,body:{}})).outcome,'accepted');
 f.state.afterWrite=null;const entered=deferred();f.state.before=()=>{entered.resolve();return new Promise(()=>{});};const pending=client.list();await entered.promise;client.close();await assert.rejects(pending,{code:'cancelled'});assert.equal(client.pending,null);
});
