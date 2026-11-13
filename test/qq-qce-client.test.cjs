'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,TOKEN}=require('./helpers/qq-qce-fixture.cjs');
const {QQQCEClient}=require('../src/bot/qq-qce-client.cjs');
const P=require('../src/bot/qq-qce-policy.cjs');
test('QCE client permits only fixed loopback endpoint and reviewed token policy',()=>{
 for(const change of [{host:'example.com'},{port:40654},{token:'private\r\nheader'},{token:'a'.repeat(64)},{timeoutMs:10001}])assert.throws(()=>new QQQCEClient({token:TOKEN,...change}),{code:'invalid_request'});
});
test('QCE uses only three fixed routes and single-field JSON; raw extras are not config',async t=>{
 const f=await fixture(t);assert.equal((await f.client.system()).version,'5.5.77');const paths=await f.client.config();assert.equal(Object.keys(paths).length,4);
 const r=await f.client.setConfig('customOutputDir','D:\\Synthetic-QCE\\exports');assert.equal(r.outcome,'accepted');
 assert.deepEqual(f.state.requests.map(r=>[r.method,r.path]),[['GET','/api/system/info'],['GET','/api/config'],['PUT','/api/config']]);
 assert.deepEqual(f.writes()[0].body,{customOutputDir:'D:\\Synthetic-QCE\\exports'});assert.ok(f.state.requests.every(r=>r.authorization===`Bearer ${TOKEN}`));assert.ok(!JSON.stringify(paths).includes('SYNTHETIC_UNEXPOSED'));
});
test('path input rejects ambiguous Windows forms and reset is explicit null',()=>{
 for(const p of ['', ' C:\\x','"C:\\x"','C:x','\\x','C:/x','C:\\x\\..\\y','C:\\x.','C:\\CON','\\\\?\\C:\\x','C:\\x\u202e'])assert.throws(()=>P.directory(p),{code:'invalid_path'},p);
 for(const p of [null,'C:\\','D:\\Synthetic folder\\字','\\\\synthetic-host\\share\\folder'])assert.equal(P.directory(p),p);
});
test('error response after single PUT remains received unknown, even if it changed config',async t=>{
 const f=await fixture(t);f.state.writeMode='error';const r=await f.client.setConfig('customOutputDir',null);
 assert.deepEqual(r,{submission:'submitted',bridgeResponse:'received',outcome:'unknown',code:'change_unknown'});assert.equal(f.writes().length,1);assert.ok(!JSON.stringify(r).includes('STACK'));
});
test('successful envelope with malformed four-field projection preserves submitted/received facts',async t=>{
 const f=await fixture(t);f.state.handle=(row,res,send)=>{if(row.method==='PUT'){send({customOutputDir:null});return true;}};
 const r=await f.client.setConfig('customOutputDir',null);assert.equal(r.outcome,'unknown');assert.equal(r.submission,'submitted');assert.equal(r.bridgeResponse,'received');
});
test('lost PUT response is unknown and never retried',async t=>{
 const f=await fixture(t);f.state.writeMode='disconnect';const r=await f.client.setConfig('customScheduledExportDir','C:\\Synthetic-QCE\\scheduled-new');
 assert.equal(r.outcome,'unknown');assert.equal(r.submission,'submitted');assert.equal(r.bridgeResponse,'unavailable');assert.equal(f.writes().length,1);
});
test('redirect, oversized and non-JSON responses are bounded without following them',async t=>{
 const f=await fixture(t);f.state.handle=(row,res)=>{res.writeHead(302,{Location:'http://example.invalid/private'});res.end();return true;};
 await assert.rejects(f.client.config(),{code:'redirect_rejected'});
 f.state.handle=(row,res)=>{res.setHeader('Content-Type','application/json');res.end('x'.repeat(65537));return true;};await assert.rejects(f.client.config(),{code:'response_too_large'});
 f.state.handle=(row,res)=>{res.setHeader('Content-Type','text/html');res.end('<script>private</script>');return true;};await assert.rejects(f.client.config(),{code:'invalid_response'});assert.equal(f.state.requests.length,3);
});
test('final guard and marker-triggered abort send zero HTTP requests',async t=>{
 const f=await fixture(t);const abort=new AbortController();const r=await f.client.setConfig('customOutputDir',null,{signal:abort.signal,onAttempt:()=>abort.abort()});
 assert.equal(r.outcome,'not_submitted');assert.equal(r.submission,'not_submitted');assert.equal(f.state.requests.length,0);
 const r2=await f.client.setConfig('customOutputDir',null,{assertCurrent:()=>{throw Object.assign(Error('synthetic expiry'),{code:'expired_ticket'});}});assert.equal(r2.code,'expired_ticket');assert.equal(f.state.requests.length,0);
});
test('timeout and close abort bounded requests without exposing response error text',async t=>{
 const f=await fixture(t);f.state.handle=()=>true;await assert.rejects(f.client.config(),{code:'timeout'});
 const p=f.client.config();f.client.close();await assert.rejects(p,{code:'cancelled'});assert.throws(()=>f.client.config(),{code:'closed'});
 const r=await f.client.setConfig('customOutputDir',null);assert.equal(r.outcome,'not_submitted');assert.equal(r.code,'closed');
});
