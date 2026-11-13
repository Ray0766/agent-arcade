'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const L=require('../src/bot/qq-remote-login-policy.cjs');
const {fixture,EXPECTED,TOKEN,CANDIDATE,URL_A,URL_B,deferred}=require('./helpers/qq-remote-login-fixture.cjs');
const {remoteResult}=require('../src/bot/qq-remote-session.cjs');

test('refresh restarting is projected only from its exact success shape; explicit unsent remains unsent',async()=>{
 const {QQRemoteClient}=require('../src/bot/qq-remote-client.cjs');
 for(const variant of ['exact','malformed','unsent']){
  const client=new QQRemoteClient({origin:'https://remote.arcade.invalid',token:TOKEN,expectedQQ:EXPECTED,transport:{close(){},async request(route,o){
   if(route==='login')return {code:0,data:{Credential:'syntheticCredential'}};
   o.onAttempt();if(variant==='unsent')throw Object.assign(Error('Synthetic abort'),{code:'cancelled',submitted:false});
   return {code:0,data:{qrcodeurl:variant==='exact'?'':'invalid',restarting:true}};
  }}});
  await client.authenticate();const r=await client.mutateLogin('refreshQR');assert.equal(r.restarting,variant==='exact');assert.equal(r.outcome,variant==='exact'?'acknowledged':variant==='unsent'?'not_submitted':'unknown');client.close();
 }
});
test('production Session/client/transport completes cached QR plus two explicit writes over real private-CA TLS',async t=>{
 const https=require('node:https'),tls=require('node:tls'),{QQRemoteTransport}=require('../src/bot/qq-remote-transport.cjs'),{QQRemoteClient}=require('../src/bot/qq-remote-client.cjs'),pem=require('./helpers/qq-remote-tls-fixture.cjs');
 const f=fixture(t),requests=[],sockets=new Set();let qr=URL_A,lookups=0,connections=0;
 const server=https.createServer({cert:pem.cert,key:pem.key},(req,res)=>{const chunks=[];req.on('data',c=>chunks.push(c));req.on('end',()=>{
  const body=chunks.length?JSON.parse(Buffer.concat(chunks).toString()):{};requests.push({method:req.method,path:req.url,body});let data;
  if(req.url==='/api/auth/login')data={Credential:'syntheticTLSCredential'};
  else if(req.url==='/api/base/GetNapCatVersion')data={version:'4.18.42'};
  else if(req.url==='/api/QQLogin/CheckLoginStatus')data={isLogin:false,isOffline:false,coreReady:false,qrLoginAccepted:false,loginPhase:'waiting_qrcode',qrcodeurl:qr,loginError:''};
  else if(req.url==='/api/QQLogin/GetQQLoginInfo')data={uin:'',online:false};
  else if(req.url==='/api/QQLogin/GetQuickLoginList')data=[EXPECTED];
  else if(req.url==='/api/QQLogin/GetQQLoginQrcode')data={qrcode:qr};
  else if(req.url==='/api/QQLogin/RefreshQRcode'){qr=URL_B;data={qrcodeurl:qr};}
  else if(req.url==='/api/QQLogin/SetQuickLogin')data=null;
  else{res.writeHead(400);res.end();return;}
  res.writeHead(200,{'content-type':'application/json'});res.end(JSON.stringify({code:0,data}));
 });});
 server.on('connection',s=>{sockets.add(s);s.on('close',()=>sockets.delete(s));});server.on('tlsClientError',()=>{});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 t.after(async()=>{await f.session.closeCurrent();for(const s of sockets)s.destroy();await new Promise(resolve=>server.close(resolve));});
 const entry=f.registry.capture(f.input.remoteId),origin='https://remote.arcade.invalid:'+server.address().port;
 f.registry.update({remoteId:entry.remoteId,revision:entry.revision,patch:{origin,trust:{caPem:pem.caPem}}});
 // Routing/address metadata is synthetic; CA/hostname, same-socket TLS and HTTP are real.
 f.session.clientFactory=entry=>new QQRemoteClient({...entry,now:()=>f.state.now,transport:new QQRemoteTransport({origin:entry.origin,...entry.trust,lookup:async()=>{lookups++;return [{address:'198.51.100.20',family:4}];},connect:options=>{connections++;const socket=tls.connect({...options,host:'127.0.0.1',family:4});Object.defineProperty(socket,'remoteAddress',{get:()=>options.host});return socket;}})});
 const r=await f.open();f.tick();const image=await f.session.loginQRCode(f.req(r));assert.match(image.qr.pngDataUrl,/^data:image\/png;base64,/);
 let p=await f.session.loginPreview({...f.req(r),observationId:image.login.observationId,operation:'refreshQR'});assert.equal((await f.confirm(p)).change.outcome,'acknowledged');
 f.tick();const observed=await f.session.loginObserve(f.req(r));p=await f.session.loginPreview({...f.req(r),observationId:observed.login.observationId,operation:'quickLogin'});assert.equal((await f.confirm(p)).change.outcome,'acknowledged');
 assert.equal(requests.filter(r=>r.path==='/api/QQLogin/RefreshQRcode').length,1);const quick=requests.filter(r=>r.path==='/api/QQLogin/SetQuickLogin');assert.equal(quick.length,1);assert.deepEqual(quick[0].body,{uin:EXPECTED});assert.equal(requests.some(r=>r.path.includes('SetQuickLoginQQ')),false);assert.equal(lookups,requests.length);assert.equal(connections,requests.length);
});


test('Dismiss during held QR encoder or preview preread cannot resurrect display/ticket',async t=>{
 for(const kind of ['qr','preview'])await t.test(kind,async t=>{
  const f=fixture(t),r=await f.open(),held=deferred(),entered=deferred();f.tick();
  let action;
  if(kind==='qr'){const encoder=f.session.qrEncoder;f.session.qrEncoder=async url=>{entered.resolve();await held.promise;return encoder(url);};action=f.session.loginQRCode(f.req(r));}
  else{f.server.before=async route=>{if(route==='qqQuickList'){entered.resolve();await held.promise;}};action=f.session.loginPreview({...f.req(r),observationId:r.login.observationId,operation:'refreshQR'});}
  await entered.promise;f.session.loginDismiss(f.req(r));held.resolve();await assert.rejects(action,e=>e.code==='changed');assert.equal(f.session.session.ticket,null);assert.equal(f.session.session.qr,null);assert.equal(f.writes.length,0);
 });
});
test('Dismiss during confirm preread cancels unsent request without undoing late acknowledgements',async t=>{
 const f=fixture(t),{r,p}=await f.preview(),held=deferred(),entered=deferred();
 f.server.before=async route=>{if(route==='qqQuickList'){entered.resolve();await held.promise;}};
 const action=f.confirm(p);await entered.promise;f.session.loginDismiss(f.req(r));held.resolve();const result=await action;assert.equal(result.change.submission,'not_submitted');assert.equal(result.change.code,'changed');assert.equal(f.writes.length,0);
});
test('Resolve without pending rotation in login substate is rejected with zero extra authentication or reads',async t=>{
 const f=fixture(t);await f.open();const count=f.calls.length;await assert.rejects(f.session.resolveCredential({...f.input,choice:'current'}),e=>e.code==='invalid_rotation');assert.equal(f.calls.length,count);
});

test('Open/QR use only cache reads and local PNG encoding; public results contain no raw QR or credentials',async t=>{
 const f=fixture(t),r=await f.open();assert.equal(r.login.state,'waiting_qrcode');assert.equal(f.writes.length,0);
 await assert.rejects(f.session.loginQRCode(f.req(r)),e=>e.code==='observation_too_soon');f.tick();
 const q=await f.session.loginQRCode(f.req(r));assert.match(q.qr.pngDataUrl,/^data:image\/png;base64,/);assert.equal(q.qr.serverExpiryKnown,false);assert.equal(q.qr.displayUntil,f.state.now+60000);assert.equal(q.login.qrId,q.qr.qrId);assert.deepEqual(f.encodes,[URL_A]);assert.equal(f.writes.length,0);
 const text=JSON.stringify(q);assert.equal(text.includes(URL_A),false);assert.equal(text.includes(TOKEN),false);assert.equal(f.calls.filter(c=>c.route==='qqQRCode').length,1);
});
test('online proof accepts lagging phase, missing coreReady never succeeds, mismatch wins',async t=>{
 const f=fixture(t);f.matched();f.server.status.loginPhase='initializing';let r=await f.open();assert.equal(r.login.state,'matched');assert.equal(r.login.onlineVerified,true);
 f.server.omitCore=true;r=await f.open();assert.equal(r.login.onlineVerified,false);assert.equal(r.login.canRefreshQR,false);
 f.server.info.uin='200002';r=await f.open();assert.equal(r.login.state,'account_mismatch');assert.equal(r.login.canQuickLogin,false);
});
test('scanned/accepted initialization and reconnecting hide QR and refuse effects',async t=>{
 const f=fixture(t);
 for(const phase of ['qrcode_scanned','initializing','reconnecting']){f.server.status.loginPhase=phase;f.server.status.qrLoginAccepted=phase==='initializing';const r=await f.open();assert.equal(r.login.onlineVerified,false);assert.equal(r.login.canShowQRCode,false);assert.equal(r.login.canRefreshQR,false);await assert.rejects(f.session.loginPreview({...f.req(r),observationId:r.login.observationId,operation:'refreshQR'}));}
 assert.equal(f.writes.length,0);
});
test('both explicit operations consume one ticket and quick login targets only expected QQ',async t=>{
 for(const op of ['refreshQR','quickLogin'])await t.test(op,async t=>{const f=fixture(t),{p}=await f.preview(op);assert.equal(p.preview.effects.mayReplaceQRCode,true);const r=await f.confirm(p);assert.equal(r.change.outcome,'acknowledged');assert.equal(r.change.loginVerified,false);assert.equal(r.change.automaticRetry,false);await assert.rejects(f.confirm(p));assert.equal(f.writes.length,1);assert.deepEqual(f.writes[0].body,op==='quickLogin'?{uin:EXPECTED}:{});assert.equal(f.calls.filter(c=>c.route==='networkRead').length,0);});
});
test('quick cached account absent or changed before submission causes zero writes',async t=>{
 const f=fixture(t);f.server.quick=['200002'];let r=await f.open();assert.equal(r.login.quickLoginAvailable,false);await assert.rejects(f.session.loginPreview({...f.req(r),observationId:r.login.observationId,operation:'quickLogin'}),e=>e.code==='quick_login_unavailable');
 f.server.quick=[EXPECTED];const {p}=await f.preview('quickLogin');f.server.quick=[];const result=await f.confirm(p);assert.equal(result.change.submission,'not_submitted');assert.equal(f.writes.length,0);
});
test('nonzero/timeout/malformed write replies remain unknown and are never retried',async t=>{
 for(const kind of ['nonzero','timeout','malformed'])await t.test(kind,async t=>{const f=fixture(t),{p}=await f.preview();if(kind==='nonzero')f.server.writeCode=-1;if(kind==='timeout')f.server.writeError=true;if(kind==='malformed')f.server.after=(route,_o,r)=>{if(route==='qqRefreshQR')r.data={surprise:true};};const r=await f.confirm(p);assert.equal(r.change.outcome,'unknown');assert.equal(f.writes.length,1);await assert.rejects(f.confirm(p));assert.equal(f.writes.length,1);});
});
test('unexpected injected client throw after mutation is conservatively unknown',async t=>{
 const f=fixture(t),{p}=await f.preview();f.session.session.client.mutateLogin=async()=>{throw Error('Synthetic post effect');};const r=await f.confirm(p);assert.equal(r.change.outcome,'unknown');assert.equal(r.change.submission,'attempted');
});
test('wire-time expiry or changed capture sends zero login mutations',async t=>{
 for(const kind of ['ttl','scope'])await t.test(kind,async t=>{const f=fixture(t),{p}=await f.preview();f.server.before=route=>{if(route==='qqRefreshQR'){if(kind==='ttl')f.tick(300000);else f.state.context='replacement';}};const r=await f.confirm(p);assert.equal(r.change.submission,'not_submitted');assert.equal(f.writes.length,0);});
});
test('known response remains captured after close; old login Close cannot affect new login',async t=>{
 const f=fixture(t),{r,p}=await f.preview(),held=deferred(),entered=deferred();f.server.after=async route=>{if(route==='qqRefreshQR'){entered.resolve();await held.promise;}};
 const writing=f.confirm(p);await entered.promise;const closing=f.session.loginClose(f.req(r));held.resolve();const result=await writing;await closing;assert.equal(result.change.outcome,'acknowledged');assert.equal(result.change.loginId,r.login.loginId);
 f.server.after=null;const next=await f.open();await f.session.loginClose(f.req(r));assert.equal(f.session.session.loginId,next.login.loginId);
});
test('close at retirement microtask prevents a login client/socket from being created',async t=>{
 const f=fixture(t),opening=f.open(),closing=f.session.closeCurrent();await assert.rejects(opening);await closing;assert.equal(f.server.clients,0);assert.equal(f.calls.length,0);
});
test('scope close while asynchronous QR encoder is held publishes no image',async t=>{
 const f=fixture(t),r=await f.open(),held=deferred(),entered=deferred();f.session.qrEncoder=async()=>{entered.resolve();return held.promise;};f.tick();const showing=f.session.loginQRCode(f.req(r));await entered.promise;const closing=f.session.closeCurrent();held.resolve('bad-image');await assert.rejects(showing);await closing;assert.equal(f.writes.length,0);
});
test('background QR replacement, displayed deadline and Dismiss revoke old image/ticket',async t=>{
 const f=fixture(t),r=await f.open();f.tick();const q=await f.session.loginQRCode(f.req(r));f.server.status.qrcodeurl=URL_B;f.tick();let o=await f.session.loginObserve(f.req(r));assert.equal(o.login.qrId,null);
 f.tick();await f.session.loginQRCode(f.req(r));f.tick(60000);o=await f.session.loginObserve(f.req(r));assert.equal(o.login.qrId,null);
 const p=await f.session.loginPreview({...f.req(r),observationId:o.login.observationId,operation:'refreshQR'});f.session.loginDismiss(f.req(r));await assert.rejects(f.confirm(p));assert.equal(q.qr.serverExpiryKnown,false);
});
test('observation quota and lifetime are bounded; invalid routes and cross-login nonce rejected',async t=>{
 const f=fixture(t),r=await f.open();f.session.session.observationCount=100;f.tick();await assert.rejects(f.session.loginObserve(f.req(r)),e=>e.code==='observation_limit');
 await assert.rejects(f.session.loginObserve({...f.req(r),loginId:'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'}),e=>e.code==='changed');
 await assert.rejects(f.session.loginOpen({...f.input,url:'https://foreign.invalid'}),e=>e.code==='invalid_request');
 const next=await f.open();f.tick(300000);await assert.rejects(f.session.loginObserve(f.req(next)),e=>e.code==='login_expired');
});
test('pending rotation supports temporary candidate auth, remains unchanged, then original Resolve/Finish after matched QQ',async t=>{
 const f=fixture(t),before=f.registry.capture(f.input.remoteId);await f.registry.withOperation({remoteId:f.input.remoteId,revision:before.revision},async lease=>{lease.prepareRotation(CANDIDATE);lease.recordRotation('unknown');});const pending=f.registry.capture(f.input.remoteId);f.server.token=CANDIDATE;
 assert.equal((await f.open()).challenge.type,'credential_recovery');const r=await f.open({choice:'candidate'});assert.equal(r.login.pendingRotation,true);assert.equal(r.login.credentialChoice,'candidate');assert.deepEqual(f.registry.capture(f.input.remoteId),pending);
 assert.throws(()=>f.session.preview({...f.input,observationId:r.login.observationId,operation:'requestRestart',value:{}}),e=>e.code==='stale_observation');
 f.matched();f.tick();assert.equal((await f.session.loginObserve(f.req(r))).login.state,'matched');assert.deepEqual(f.registry.capture(f.input.remoteId),pending);
 const resolved=await f.session.resolveCredential({...f.input,choice:'candidate'});assert.equal(resolved.resolved,true);assert.ok(f.registry.capture(f.input.remoteId).pendingRotation);await f.session.finishCredentialRecovery({...f.input,resolutionId:resolved.credentialResolution.resolutionId});assert.equal(f.registry.capture(f.input.remoteId).pendingRotation,null);
});
test('TOTP challenge is explicit; local Close clears only temporary session',async t=>{
 const f=fixture(t);f.server.require2FA=true;assert.equal((await f.open()).challenge.type,'totp');const r=await f.open({totpCode:'123456'});assert.equal(r.login.state,'waiting_qrcode');await f.session.loginClose(f.req(r));assert.equal(f.calls.filter(c=>c.route==='login').length,2);assert.equal(f.calls.some(c=>c.route==='logout'),false);assert.equal(f.registry.list().items.length,1);
});
test('QR policy rejects URL ambiguity and unsupported origins without fetching',()=>{
 for(const value of ['https://qq.com/p#','https://@qq.com/p','https://qq.com:444/p','http://qq.com/p','https://qq.com.evil.invalid/p','https://qq.com./p','https://qq.com\\evil/p','https://qq.com/p?x=%0A','https://qq.com/p?x=%E2%80%8B','https://127.0.0.1/p','https://xn--evil.qq.com/p'])assert.throws(()=>L.qrURL(value),e=>e.code==='qr_url_unsupported');
 for(const value of [URL_A,'https://ntlogin.qq.com/qrlogin?sig=synthetic','https://qq.com:443/p'])assert.equal(L.qrURL(value),value);
});
test('result wrapper preserves login correlation without unknown top-level secrets',async t=>{
 const f=fixture(t),r=await remoteResult(f.input,()=>f.open());assert.equal(r.ok,true);assert.equal(r.login.expectedQQ,EXPECTED);const closed=await remoteResult(f.req(r),()=>f.session.loginClose(f.req(r)));assert.equal(closed.loginId,r.login.loginId);assert.equal(closed.closed,true);
});

