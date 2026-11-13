'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const http=require('node:http');
const {createHash}=require('node:crypto');
const {NapCatWebUI}=require('../src/bot/napcat-webui.cjs');
const token='local-test-token',accountId='123456789';
async function fixture(t,handler){
  const calls=[];const server=http.createServer(async(req,res)=>{let raw='';for await(const data of req)raw+=data;calls.push({path:req.url,authorization:req.headers.authorization,body:JSON.parse(raw)});
    if(req.url==='/api/auth/login'){res.end(JSON.stringify({code:0,data:{Credential:'testCredential'}}));return;}
    handler(req,res,calls);
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const client=new NapCatWebUI({port:server.address().port,token,accountId,timeout:300});t.after(()=>client.close());
  return {client,calls,server};
}
const send=(res,data)=>res.end(JSON.stringify({code:0,data}));
test('authenticated local status verifies both online state and the exact account; secrets stay private',async t=>{
  const {client,calls}=await fixture(t,(req,res)=>send(res,req.url.endsWith('CheckLoginStatus')?{isLogin:true,isOffline:false,loginPhase:'logged_in'}:{uin:accountId,online:true,avatarUrl:'https://untrusted.invalid/avatar'}));
  assert.deepEqual(await client.status(),{state:'online',online:true,identityVerified:true,accountId,phase:'logged_in'});
  assert.equal(calls[0].body.hash,createHash('sha256').update(token+'.napcat').digest('hex'));
  assert.equal(calls[1].authorization,'Bearer testCredential');
  await client.status();assert.equal(calls.filter(c=>c.path.endsWith('/login')).length,1);
  assert.ok(!JSON.stringify(client).includes(token));assert.ok(!JSON.stringify(client).includes('testCredential'));
});
test('a scanned QR or ready worker cannot masquerade as an online identified QQ account',async t=>{
  const {client,calls}=await fixture(t,(_req,res)=>send(res,{isLogin:false,isOffline:false,qrLoginAccepted:true,coreReady:false,loginPhase:'initializing'}));
  assert.equal((await client.status()).state,'initializing');assert.equal(calls.length,2);
});
test('a different logged-in account is rejected',async t=>{
  const {client}=await fixture(t,(req,res)=>send(res,req.url.endsWith('CheckLoginStatus')?{isLogin:true,isOffline:false}:{uin:'987654321',online:true}));
  await assert.rejects(client.status(),{code:'account_changed'});
});
test('QR is returned as bounded QQ HTTPS data, never fetched from arbitrary hosts',async t=>{
  let url='https://ntlogin.qq.com/qrlogin?test=1';const {client,calls}=await fixture(t,(_req,res)=>send(res,{qrcode:url}));
  assert.equal((await client.qr()).url,url);url='https://qq.com.attacker.invalid/q';await assert.rejects(client.qr(),{code:'qr_unavailable'});
  url='http://127.0.0.1/secret';await assert.rejects(client.qr(),{code:'qr_unavailable'});assert.equal(calls.length,4);
});
test('refresh while upstream worker reconnects returns pending without another request',async t=>{
  const {client,calls}=await fixture(t,(_req,res)=>send(res,{qrcodeurl:'',restarting:true}));
  assert.deepEqual(await client.qr({refresh:true}),{state:'reconnecting',url:null});assert.equal(calls.length,2);
});
test('quick login is never automatically repeated or reported as verified online',async t=>{
  const {client,calls}=await fixture(t,(_req,res)=>send(res,null));
  assert.deepEqual(await client.quickLogin(),{requested:true,onlineVerified:false});assert.deepEqual(calls[1].body,{uin:accountId});assert.equal(calls.length,2);
});
test('upstream errors cannot disclose response bodies or redirect management requests',async t=>{
  let redirect=false;const {client,calls}=await fixture(t,(_req,res)=>{if(redirect){res.writeHead(302,{location:'http://example.invalid/private'});res.end();}else res.end(JSON.stringify({code:-1,message:'PRIVATE_TOKEN_SAMPLE'}));});
  await assert.rejects(client.status(),error=>error.code==='request_rejected'&&!error.message.includes('PRIVATE'));
  redirect=true;await assert.rejects(client.status(),{code:'http_error'});assert.equal(calls.length,3);
});
test('oversized replies are bounded and pending work can be cancelled when the panel closes',async t=>{
  let stall=false;const {client}=await fixture(t,(_req,res)=>{if(!stall)res.end('x'.repeat(140*1024));});
  await assert.rejects(client.status(),{code:'response_too_large'});stall=true;
  const controller=new AbortController();const pending=client.status({signal:controller.signal});controller.abort();await assert.rejects(pending,{code:'cancelled'});
  const closing=client.status();client.close();await assert.rejects(closing,error=>['cancelled','closed'].includes(error.code));
});
test('two-factor requirement is explicit and no security setting is changed',async t=>{
  const server=http.createServer((_req,res)=>send(res,{require2FA:true}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close());
  const client=new NapCatWebUI({port:server.address().port,token,accountId});await assert.rejects(client.status(),{code:'two_factor_required'});client.close();
});
test('unresponsive endpoints time out',async t=>{const {client}=await fixture(t,()=>{});await assert.rejects(client.status(),{code:'timeout'});});
