'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,deferred}=require('./helpers/qq-qce-security-fixture.cjs');
const {QQQCESecurityClient}=require('../src/bot/qq-qce-security-client.cjs');
test('fixed client sends exact routes and no token query or forwarded headers',async t=>{
 const f=await fixture(t);await f.client.whitelist();await f.client.status();
 for(const c of [{action:'addRule',value:'192.0.2.5'},{action:'removeRule',value:'192.0.2.5'},{action:'setDisabled',value:true},{action:'setDisplayHost',value:'example.invalid'}])assert.equal((await f.client.mutate(c)).outcome,'accepted');
 assert.deepEqual(f.writes().map(r=>[r.method,r.path,r.body]),[['POST','/api/security/ip-whitelist',{ip:'192.0.2.5'}],['DELETE','/api/security/ip-whitelist',{ip:'192.0.2.5'}],['PUT','/api/security/ip-whitelist/toggle',{disabled:true}],['POST','/api/server/host',{host:'example.invalid'}]]);
 for(const r of f.state.requests){assert(!r.path.includes('?'));assert.equal(r.headers['x-forwarded-for'],undefined);assert.equal(r.headers['x-real-ip'],undefined);assert.equal(r.headers['x-access-token'],undefined);}
 for(const options of [{host:'localhost'},{port:123},{token:'wrong'}])assert.throws(()=>new QQQCESecurityClient({...f.clientOptions,...options}),{code:'invalid_request'});
});
test('valid envelope with malformed action data preserves submitted/received unknown',async t=>{
 const f=await fixture(t);f.state.writeMode='malformed';const r=await f.client.mutate({action:'addRule',value:'192.0.2.5'});assert.deepEqual([r.submission,r.bridgeResponse,r.outcome],['submitted','received','unknown']);assert.equal(f.writes().length,1);
});
test('error and dropped reply never replay; strict JSON bounds and redirects reject',async t=>{
 const f=await fixture(t);for(const mode of ['error','disconnect']){f.state.writeMode=mode;const r=await f.client.mutate({action:'setDisabled',value:true});assert.equal(r.outcome,'unknown');}assert.equal(f.writes().length,2);
 for(const [kind,code]of [['redirect','redirect_rejected'],['html','invalid_response'],['large','response_too_large']]){
  f.state.handle=(_row,res)=>{if(kind==='redirect'){res.statusCode=302;res.setHeader('Location','http://example.invalid');res.end();}else{res.setHeader('Content-Type',kind==='html'?'text/html':'application/json');res.end('x'.repeat(kind==='large'?70000:1));}return true;};await assert.rejects(f.client.whitelist(),{code});
 }
});
test('final synchronous cancellation marker is still proven not submitted',async t=>{
 const f=await fixture(t),abort=new AbortController();const r=await f.client.mutate({action:'setDisabled',value:true},{signal:abort.signal,onAttempt:()=>abort.abort()});assert.equal(r.outcome,'not_submitted');assert.equal(f.writes().length,0);
});
test('owned close settles an in-flight real HTTP read and fixed auth code stays bounded',async t=>{
 const f=await fixture(t),gate=deferred();f.state.before=()=>{gate.resolve();return new Promise(()=>{});};const pending=f.client.whitelist();await gate.promise;f.client.close();await assert.rejects(pending,{code:'cancelled'});
 const second=new QQQCESecurityClient(f.clientOptions);t.after(()=>second.close());f.state.before=null;f.state.enforce=true;f.state.rules=['::1'];await assert.rejects(second.whitelist(),{code:'ip_not_allowed'});
});
