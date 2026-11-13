'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {fixture,add,base,hold,until,EXPECTED,TOKEN,CANDIDATE,QR}=require('./helpers/qq-remote-login-main-fixture.cjs');
const scope=(row,login)=>({...base(row),loginId:login.loginId});
const effects=f=>f.requests.filter(r=>['qqRefreshQR','qqQuickLogin'].includes(r.route));
async function open(f,row,extra={}){const r=await f.invoke('LoginOpen',{...base(row),...extra});assert.equal(r.ok,true,JSON.stringify(r));assert(r.login);return r.login;}

test('actual main encodes a cached login QR without using AI credentials or generating a new code',async t=>{
  const f=fixture(t),row=await add(f);assert.equal(f.requests.length,0);
  const login=await open(f,row);assert.equal(login.state,'waiting_qrcode');assert.equal(login.onlineVerified,false);
  f.advance();const result=await f.invoke('LoginQRCode',scope(row,login));assert.equal(result.ok,true,JSON.stringify(result));
  assert.match(result.qr.pngDataUrl,/^data:image\/png;base64,iVBOR/);assert.equal(result.qr.serverExpiryKnown,false);
  assert.equal(result.qr.loginId,login.loginId);assert.equal(result.login.qrId,result.qr.qrId);assert.equal(f.state.encodes,1);
  assert.equal(effects(f).length,0);assert.doesNotMatch(JSON.stringify(result),/synthetic-login-main-qr-canary|txz\.qq|synthetic-login-main-old/);
  assert.doesNotMatch(JSON.stringify(f.api.fullSnapshot()),/remote\.arcade|synthetic-login-main|syntheticLoginCredential/);
  assert.equal(fs.existsSync(path.join(f.root,'bot-vault.json')),false);
});

test('actual main rejects foreign senders and renderer-selected targets before a remote request',async t=>{
  const f=fixture(t),row=await add(f);
  await assert.rejects(f.invoke('LoginOpen',base(row),{sender:{},senderFrame:{}}),/Untrusted sender/);
  for(const field of ['url','token','uin','route'])assert.equal((await f.invoke('LoginOpen',{...base(row),[field]:'synthetic-untrusted'})).ok,false);
  assert.equal(f.requests.length,0);
  const login=await open(f,row);f.advance();assert.equal((await f.invoke('LoginQRCode',{...scope(row,login),url:QR})).ok,false);
  assert.equal(f.state.encodes,0);assert.equal(effects(f).length,0);
});

test('closing during actual QR encoding removes the late image without cancelling remote QQ',async t=>{
  const f=fixture(t),row=await add(f),login=await open(f,row);f.advance();f.state.encodeGate=hold();
  const pending=f.invoke('LoginQRCode',scope(row,login));await until(()=>f.state.encodes===1);
  const closing=f.invoke('LoginClose',scope(row,login));f.state.encodeGate.resolve();
  const result=await pending;assert.equal(result.ok,false);assert.equal(result.qr,undefined);assert.equal((await closing).ok,true);
  assert.equal(effects(f).length,0);assert.equal(f.requests.filter(r=>r.route==='logout').length,0);
});

test('profile switching out and back invalidates an in-flight login image in the real main lifecycle',async t=>{
  const f=fixture(t),row=await add(f),login=await open(f,row);f.advance();f.state.encodeGate=hold();
  const pending=f.invoke('LoginQRCode',scope(row,login));await until(()=>f.state.encodes===1);
  f.accounts.selectedId='second';f.api.observe();f.accounts.selectedId='first';f.state.encodeGate.resolve();
  assert.equal((await pending).ok,false);assert.equal((await f.invoke('LoginObserve',scope(row,login))).ok,false);
  assert.equal(effects(f).length,0);
});

test('an old login Close cannot retire a replacement in the same registry panel',async t=>{
  const f=fixture(t),row=await add(f),first=await open(f,row),second=await open(f,row);assert.notEqual(first.loginId,second.loginId);
  assert.equal((await f.invoke('LoginClose',scope(row,first))).ok,true);f.advance();
  const result=await f.invoke('LoginObserve',scope(row,second));assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.login.loginId,second.loginId);
  f.state.minimized=true;f.events.minimize();assert.equal((await f.invoke('LoginObserve',scope(row,second))).ok,false);
});

test('temporary pending-rotation login never selects or clears retained credentials',async t=>{
  const f=fixture(t),row=await add(f),registry=f.api.panel().registry;
  await registry.withOperation({remoteId:row.remoteId,revision:row.revision},lease=>{lease.prepareRotation(CANDIDATE);lease.recordRotation('unknown');});
  f.state.token=CANDIDATE;const before=registry.capture(row.remoteId);
  const choice=await f.invoke('LoginOpen',base(row));assert.equal(choice.ok,true);assert.equal(choice.challenge.type,'credential_recovery');assert.equal(f.requests.length,0);
  const login=await open(f,row,{choice:'candidate'});assert.equal(login.pendingRotation,true);assert.equal(login.credentialChoice,'candidate');
  assert.deepEqual(registry.capture(row.remoteId),before);
  f.state.isLogin=true;f.state.phase='ready';f.state.coreReady=true;f.state.online=true;f.state.qr='';f.advance();
  const result=await f.invoke('LoginObserve',scope(row,login));assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.login.onlineVerified,true);assert.equal(result.login.actualQQ,EXPECTED);
  assert.deepEqual(registry.capture(row.remoteId),before);assert.equal(before.token,TOKEN);
  assert.equal((await f.invoke('Preview',{...base(row),observationId:result.login.observationId,operation:'requestRestart',value:{}})).ok,false);
  assert.equal(effects(f).length,0);
});

test('credential recovery without a pending rotation does not authenticate or read again',async t=>{
  const f=fixture(t),row=await add(f);await open(f,row);const before=f.requests.length;
  const result=await f.invoke('ResolveCredential',{...base(row),choice:'current'});
  assert.equal(result.ok,false);assert.equal(result.code,'invalid_rotation');assert.equal(f.requests.length,before);
});

test('quick-login confirmation is scoped at the final send and cannot become a persistent auto-login setting',async t=>{
  const f=fixture(t),row=await add(f),login=await open(f,row);
  const preview=await f.invoke('LoginPreview',{...scope(row,login),observationId:login.observationId,operation:'quickLogin'});
  assert.equal(preview.ok,true,JSON.stringify(preview));assert.equal(effects(f).length,0);
  f.state.before=route=>{if(route==='qqQuickLogin')f.state.visible=false;};
  const confirm={...scope(row,login),ticketId:preview.preview.ticketId,expectedDigest:preview.preview.expectedDigest};
  const result=await f.invoke('LoginConfirm',confirm);assert.equal(effects(f).length,0);
  assert.equal(result.ok,true,JSON.stringify(result));assert.equal(result.change.submission,'not_submitted');assert.equal(result.change.loginVerified,false);
  f.state.visible=true;assert.equal((await f.invoke('LoginConfirm',confirm)).ok,false);assert.equal(effects(f).length,0);
});
