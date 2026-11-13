'use strict';
// Actual main, registry, session and client. Authenticator and HTTPS are inert doubles.
const test=require('node:test'),assert=require('node:assert/strict');
const {fixture,add,base,hold,until,EXPECTED,CANDIDATE}=require('./helpers/qq-remote-login-main-fixture.cjs');
const {nativeResponse}=require('./helpers/qq-remote-passkey-fixture.cjs');
function setup(t){
 const calls=[],signals=[],state={gate:null,after:null,available:0,closed:0};
 const bridge={async availability(){state.available++;return {protocol:1,supported:true,apiVersion:4,platformAuthenticatorAvailable:false,abiVerified:true};},async close(){state.closed++;return {closed:true};}};
 for(const [method,kind]of [['create','register'],['get','authenticate']])bridge[method]=async(input,options)=>{options.assertCurrent();calls.push({kind,input:structuredClone(input)});signals.push(options.signal);await state.gate?.promise;const response=nativeResponse(kind,input);await state.after?.(kind,input,response);return response;};
 const f=fixture(t,{passkeyBridge:bridge});t.after(()=>state.gate?.resolve());return {...f,native:{calls,signals,state,bridge}};
}
const verifies=f=>f.requests.filter(r=>r.route.endsWith('Verify'));
async function preview(f,row){
 Object.assign(f.state,{isLogin:true,online:true,coreReady:true,phase:'ready',qr:''});
 const read=await f.invoke('Read',base(row));assert.equal(read.ok,true,JSON.stringify(read));
 const p=await f.invoke('PasskeyPreview',{...base(row),observationId:read.profile.observationId});assert.equal(p.ok,true,JSON.stringify(p));return {...base(row),ticketId:p.preview.ticketId,expectedDigest:p.preview.expectedDigest};
}

test('main Passkey availability is local only and exposes no native handle or AI credentials',async t=>{
 const f=setup(t),row=await add(f),result=await f.invoke('PasskeyAvailability',base(row));
 assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.availability.supported,true);assert.equal(result.availability.platformAuthenticatorAvailable,false);
 assert.equal(f.requests.length,0);assert.equal(f.native.calls.length,0);assert.equal(f.native.state.available,1);
 assert.doesNotMatch(JSON.stringify(result),/parentHwnd|ownerPid|abiVerified|Credential/);
 assert.equal([...f.handlers.keys()].filter(key=>key.startsWith('arcade:qqRemote')).length,37);
 assert.equal([...f.handlers.keys()].filter(key=>key.startsWith('arcade:qqTransfer')&&!key.startsWith('arcade:qqTransferLocal')).length,17);
 assert.equal([...f.handlers.keys()].filter(key=>key.startsWith('arcade:qqTransferLocal')).length,8);
});

test('main refuses a foreign sender and renderer-owned native options before any ceremony',async t=>{
 const f=setup(t),row=await add(f);
 await assert.rejects(f.invoke('PasskeyAuthenticate',base(row),{sender:{},senderFrame:{}}),/Untrusted sender/);
 for(const key of ['origin','rpId','parentHwnd','ownerPid','publicKey','response','credential'])assert.equal((await f.invoke('PasskeyAuthenticate',{...base(row),[key]:'synthetic-untrusted'})).ok,false);
 assert.equal(f.requests.length,0);assert.equal(f.native.calls.length,0);assert.equal(f.native.state.available,0);
});

test('main registration captures its real window/PID and consumes one confirmation',async t=>{
 const f=setup(t),row=await add(f),request=await preview(f,row);assert.equal(f.native.calls.length,0);
 const result=await f.invoke('PasskeyConfirm',request);assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.change.outcome,'acknowledged');
 assert.equal(result.change.authenticated,false);assert.equal(result.change.persistenceVerified,false);assert.equal(verifies(f).length,1);
 const input=f.native.calls[0].input;assert.equal(input.parentHwnd,'0x1234');assert.equal(input.ownerPid,4242);assert.equal(input.origin,'https://remote.arcade.invalid');assert.deepEqual(input.publicKey.pubKeyCredParams.map(p=>p.alg),[-7,-257]);
 assert.doesNotMatch(JSON.stringify(result),/clientDataJSON|attestationObject|syntheticMainPasskeyCredential|parentHwnd/);
 assert.equal((await f.invoke('PasskeyConfirm',request)).ok,false);assert.equal(verifies(f).length,1);
});

test('main rejects zero or malformed native window handles before prompting',async t=>{
 for(const handle of [Buffer.alloc(8),Buffer.alloc(3),'0x1234']){
  const f=setup(t),row=await add(f);f.state.nativeHandle=handle;
  const result=await f.invoke('PasskeyAuthenticate',base(row));assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.change.submission,'not_submitted');
  assert.equal(f.native.calls.length,0);assert.equal(verifies(f).length,0);assert.equal(result.change.authenticated,false);
 }
});

test('minimizing during a native ceremony aborts the signal and suppresses a late verify',async t=>{
 const f=setup(t),row=await add(f);f.native.state.gate=hold();
 const pending=f.invoke('PasskeyAuthenticate',base(row));await until(()=>f.native.calls.length===1);
 f.state.minimized=true;f.events.minimize();assert.equal(f.native.signals[0].aborted,true);f.native.state.gate.resolve();
 const result=await pending;assert.equal(result.change.submission,'not_submitted');assert.equal(result.profile,undefined);assert.equal(verifies(f).length,0);
 f.state.minimized=false;assert.equal((await f.invoke('PasskeyPreview',{...base(row),observationId:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'})).ok,false);
});

test('main account switch away and back cannot revive an old native ceremony',async t=>{
 const f=setup(t),row=await add(f);f.native.state.gate=hold();
 const pending=f.invoke('PasskeyAuthenticate',base(row));await until(()=>f.native.calls.length===1);
 f.accounts.selectedId='second';f.api.observe();f.accounts.selectedId='first';f.native.state.gate.resolve();
 const result=await pending;assert.equal(result.change.submission,'not_submitted');assert.equal(result.profile,undefined);assert.equal(verifies(f).length,0);
});

test('main Passkey authentication hands its exact client to QR login without token recovery',async t=>{
 const f=setup(t),row=await add(f),registry=f.api.panel().registry;
 await registry.withOperation({remoteId:row.remoteId,revision:row.revision},lease=>{lease.prepareRotation(CANDIDATE);lease.recordRotation('unknown');});
 const before=registry.capture(row.remoteId),result=await f.invoke('PasskeyAuthenticate',base(row));
 assert.equal(result.change.authenticated,true,JSON.stringify(result));assert.equal(result.profile.identity,'logged_out');assert.equal(result.profile.capabilities.network.allowed,false);
 const session=f.api.panel().session,old=session.session,client=old.client;
 const login=await f.invoke('LoginOpen',base(row));assert.equal(login.ok,true,JSON.stringify(login));assert.equal(login.login.credentialChoice,'passkey');
 assert.equal(login.login.onlineVerified,false);assert.equal(login.login.expectedQQ,EXPECTED);assert.equal(old.client,null);assert.equal(session.session.client,client);
 assert.equal(f.requests.filter(r=>r.route==='login').length,0);assert.deepEqual(registry.capture(row.remoteId),before);
 for(const req of f.requests.filter(r=>r.route.startsWith('passkey')))assert.equal(req.credential,undefined);
 await f.invoke('LoginClose',{...base(row),loginId:login.login.loginId});assert.equal(client.closed,true);
});

test('main lost registration verify retains unknown and cannot replay the ticket',async t=>{
 const f=setup(t),row=await add(f),request=await preview(f,row);f.state.passkeyVerifyError=true;
 const result=await f.invoke('PasskeyConfirm',request);assert.equal(result.change.outcome,'unknown');assert.equal(result.change.automaticRetry,false);
 assert.equal(verifies(f).length,1);assert.equal((await f.invoke('PasskeyConfirm',request)).ok,false);assert.equal(verifies(f).length,1);
});
