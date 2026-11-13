'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),https=require('node:https'),tls=require('node:tls'),net=require('node:net');
const {createHash,X509Certificate}=require('node:crypto');
const {QQRemoteTransport,validateRemoteOrigin,validateRemoteTrust,validateAddress,normalizeAddress,ROUTES,MAX_BODY}=require('../src/bot/qq-remote-transport.cjs');
const material=require('./helpers/qq-remote-tls-fixture.cjs');
const CREDENTIAL='synthetic-remote-management-credential',REMOTE='198.51.100.20';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const reply=(res,value={code:0,data:null},status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value));};
async function fixture(t,{cert=material.cert,handler}={}){
 const requests=[],sockets=new Set(),state={lookups:0,connects:0,secure:0},seen=deferred();
 const server=https.createServer({key:material.key,cert},(req,res)=>{const chunks=[];req.on('data',x=>chunks.push(x));req.on('end',()=>{const row={method:req.method,path:req.url,headers:req.headers,body:Buffer.concat(chunks).toString('utf8')};requests.push(row);seen.resolve(row);if(handler)handler(req,res,row);else reply(res,{code:0,data:{fixture:true},message:'synthetic-sensitive-error-not-returned'});});});
 server.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});server.on('secureConnection',()=>state.secure++);server.on('tlsClientError',()=>{});
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const port=server.address().port,origin=`https://remote.arcade.invalid:${port}`;
 // Explicit test DI: only socket address metadata is mapped. Native TLS,
 // certificate chain, hostname, expiry and SPKI verification remain real.
 const lookup=async()=>{state.lookups++;return [{address:REMOTE,family:4}];};
 const connect=options=>{state.connects++;const socket=tls.connect({...options,host:'127.0.0.1',family:4});Object.defineProperty(socket,'remoteAddress',{configurable:true,get:()=>options.host});return socket;};
 const options={origin,caPem:material.caPem,lookup,connect};const clients=[];const client=extra=>{const c=new QQRemoteTransport({...options,...extra});clients.push(c);return c;};
 t.after(async()=>{for(const c of clients)c.close();for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});
 return {server,requests,state,seen,options,client,port};
}
const read=c=>c.request('version',{credential:CREDENTIAL});
test('canonical HTTPS origins and explicit LAN destinations; forbidden forms never become origins',()=>{
 assert.equal(validateRemoteOrigin('https://REMOTE.example:443/'),'https://remote.example');assert.equal(validateRemoteOrigin('https://192.168.1.20:6099'),'https://192.168.1.20:6099');
 for(const value of ['http://remote.example','https://u:p@remote.example','https://remote.example/api','https://remote.example/?token=synthetic','https://remote.example/#x','https://127.0.0.1','https://127.1','https://[::1]','https://[::ffff:127.0.0.1]','https://localhost','https://a.localhost','https://0.0.0.0','https://169.254.169.254','https://[fe80::1]','https://[ff02::1]'])assert.throws(()=>validateRemoteOrigin(value),{submitted:false});
});
test('address policy canonicalizes mapped IPv6 and rejects restricted ranges',()=>{
 assert.equal(normalizeAddress('::ffff:192.168.1.1'),'192.168.1.1');for(const value of ['10.0.0.2','192.168.1.2','fd00::2','2001:db8::20'])assert.equal(validateAddress(value),normalizeAddress(value));
 for(const value of ['::','::1','::127.0.0.1','::ffff:7f00:1','fe90::1','febf::1','ff02::1','127.2.3.4','0.1.2.3','224.0.0.1','255.255.255.255','169.254.1.2','fe80::1%4','not-an-ip'])assert.throws(()=>validateAddress(value),{code:'address_rejected'});
});
test('trust accepts explicit CA and optional pin, never private keys or leaf-as-CA bypass',()=>{
 assert.deepEqual(validateRemoteTrust(),{});assert.equal(validateRemoteTrust({caPem:material.caPem,spkiSha256:'a'.repeat(64)}).caPem,material.caPem);
 for(const value of [{caPem:material.key},{caPem:material.cert},{caPem:material.caPem+'garbage'},{spkiSha256:'A'.repeat(64)},{rejectUnauthorized:false},{caPem:'x'.repeat(128*1024+1)}])assert.throws(()=>validateRemoteTrust(value),{code:'invalid_config'});
});
test('real private-CA TLS, same socket, one lookup, fixed GET and redacted envelope',async t=>{
 const f=await fixture(t),pin=createHash('sha256').update(new X509Certificate(material.cert).publicKey.export({format:'der',type:'spki'})).digest('hex'),c=f.client({spkiSha256:pin});
 assert.deepEqual(await read(c),{code:0,data:{fixture:true}});assert.equal(f.state.lookups,1);assert.equal(f.state.connects,1);assert.equal(f.state.secure,1);assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,ROUTES.version[1]);assert.equal(f.requests[0].method,'GET');assert.equal(f.requests[0].headers.authorization,`Bearer ${CREDENTIAL}`);assert.equal(f.requests[0].headers.host,`remote.arcade.invalid:${f.port}`);assert.equal(f.requests[0].body,'');
});
test('login carries no authorization and normalizes omitted data without leaking message',async t=>{
 const f=await fixture(t,{handler:(_q,r)=>reply(r,{code:-1,message:'synthetic-refusal-private-detail'})});assert.deepEqual(await f.client().request('login',{body:{hash:'a'.repeat(64)}}),{code:-1,data:null});assert.equal(f.requests[0].headers.authorization,undefined);assert.deepEqual(JSON.parse(f.requests[0].body),{hash:'a'.repeat(64)});
});
test('unknown CA, hostname, expired leaf, and pin mismatch send zero HTTP credentials',async t=>{
 for(const kind of ['unknown-ca','hostname','expired','pin'])await t.test(kind,async t=>{const f=await fixture(t,{cert:kind==='expired'?material.expiredCert:material.cert}),c=f.client({...kind==='unknown-ca'?{caPem:undefined}:{},...kind==='hostname'?{origin:`https://wrong.arcade.invalid:${f.port}`}:{},...kind==='pin'?{spkiSha256:'0'.repeat(64)}:{}});await assert.rejects(read(c),{code:'tls_untrusted',submitted:false});assert.equal(f.requests.length,0);});
});
test('mixed DNS answers reject the entire operation before a connection',async t=>{
 const f=await fixture(t),c=f.client({lookup:async()=>[{address:REMOTE,family:4},{address:'127.0.0.1',family:4}]});await assert.rejects(read(c),{code:'address_rejected',submitted:false});assert.equal(f.state.connects,0);assert.equal(f.requests.length,0);
});
test('actual socket address mismatch rejects before HTTP transmission',async t=>{
 const f=await fixture(t),c=f.client({connect:options=>{const socket=f.options.connect(options);Object.defineProperty(socket,'remoteAddress',{get:()=>'198.51.100.21'});return socket;}});await assert.rejects(read(c),{code:'tls_untrusted',submitted:false});assert.equal(f.requests.length,0);
});
test('late DNS after close cannot create a socket; no second lookup fallback',async t=>{
 const f=await fixture(t),held=deferred(),c=f.client({lookup:()=>held.promise}),pending=read(c);c.close();await assert.rejects(pending,{code:'closed',submitted:false});held.resolve([{address:REMOTE,family:4}]);await tick();assert.equal(f.state.connects,0);assert.equal(f.requests.length,0);
});
test('invalid route/body/credential never enters DNS or TLS',async t=>{
 const f=await fixture(t),c=f.client();for(const [route,options]of [['/api/auth/login',{credential:CREDENTIAL}],['version',{}],['login',{credential:CREDENTIAL}],['version',{credential:CREDENTIAL,body:{}}],['networkWrite',{credential:CREDENTIAL,body:{v:Infinity}}],['networkWrite',{credential:CREDENTIAL,body:{v:'x'.repeat(MAX_BODY)}}],['networkRead',{credential:'synthetic\r\nInjected: 1'}]])await assert.rejects(c.request(route,options),{code:'invalid_request',submitted:false});assert.equal(f.state.lookups,0);assert.equal(f.state.connects,0);
});
test('last guard after real TLS denies changed scope and expiry with zero POST',async t=>{
 for(const code of ['changed','expired_ticket'])await t.test(code,async t=>{const f=await fixture(t);let checks=0,attempts=0;await assert.rejects(f.client().request('networkWrite',{body:{port:6099},credential:CREDENTIAL,assertCurrent:()=>{if(++checks===3)throw Object.assign(Error('synthetic private guard'),{code});},onAttempt:()=>attempts++}),{code,submitted:false});assert.equal(attempts,0);assert.equal(f.requests.length,0);});
});
test('one send marker, exact POST body, nonzero envelope retained without raw error text',async t=>{
 const f=await fixture(t,{handler:(_q,r)=>reply(r,{code:-1,data:{rejected:true},message:'synthetic-private-server-message'})});let attempts=0;assert.deepEqual(await f.client().request('networkWrite',{credential:CREDENTIAL,body:{port:6099},onAttempt:()=>attempts++}),{code:-1,data:{rejected:true}});assert.equal(attempts,1);assert.equal(f.requests[0].method,'POST');assert.equal(f.requests[0].path,ROUTES.networkWrite[1]);assert.deepEqual(JSON.parse(f.requests[0].body),{port:6099});
});
test('synchronous guard cancellation after TLS prevents the send marker and request',async t=>{
 const f=await fixture(t),abort=new AbortController();let checks=0,attempts=0;await assert.rejects(f.client().request('networkWrite',{credential:CREDENTIAL,body:{port:6099},signal:abort.signal,assertCurrent:()=>{if(++checks===3)abort.abort();},onAttempt:()=>attempts++}),{code:'cancelled',submitted:false});assert.equal(attempts,0);assert.equal(f.requests.length,0);
});
test('cancellation in the send-marker callback keeps submitted false and writes no request',async t=>{
 const f=await fixture(t),abort=new AbortController();let markers=0;await assert.rejects(f.client().request('networkWrite',{credential:CREDENTIAL,body:{port:6099},signal:abort.signal,onAttempt:()=>{markers++;abort.abort();}}),{code:'cancelled',submitted:false});assert.equal(markers,1);assert.equal(f.requests.length,0);
});
test('header limit is enforced independently of the bounded JSON body',async t=>{
 const f=await fixture(t,{handler:(_q,r)=>{r.writeHead(200,{'content-type':'application/json','x-synthetic-oversize':'x'.repeat(17000)});r.end('{"code":0,"data":null}');}});await assert.rejects(read(f.client()),{code:'response_too_large',submitted:true});
});
test('each new operation resolves once and rejects a changed unsafe DNS target',async t=>{
 const f=await fixture(t);let lookups=0;const c=f.client({lookup:async()=>[{address:++lookups===1?REMOTE:'127.0.0.1',family:4}]});assert.deepEqual(await read(c),{code:0,data:{fixture:true}});await assert.rejects(read(c),{code:'address_rejected',submitted:false});assert.equal(lookups,2);assert.equal(f.state.connects,1);assert.equal(f.requests.length,1);
});
test('redirect response never follows or forwards credentials',async t=>{
 const f=await fixture(t,{handler:(_q,r)=>{r.writeHead(302,{location:'https://forbidden.arcade.invalid/api/auth/login'});r.end();}});await assert.rejects(read(f.client()),{code:'redirect_rejected',submitted:true});assert.equal(f.state.lookups,1);assert.equal(f.state.connects,1);assert.equal(f.requests.length,1);
});
test('disconnect after mutation is unknown transmission with no automatic replay',async t=>{
 const f=await fixture(t,{handler:(req)=>req.socket.destroy()});let attempts=0;await assert.rejects(f.client().request('restart',{credential:CREDENTIAL,onAttempt:()=>attempts++}),{code:'connection_failed',submitted:true});assert.equal(attempts,1);assert.equal(f.requests.length,1);
});
test('abort after POST preserves submitted while stopping local response wait',async t=>{
 const f=await fixture(t,{handler:()=>{}}),abort=new AbortController(),c=f.client(),pending=c.request('networkWrite',{body:{port:6099},credential:CREDENTIAL,signal:abort.signal});await f.seen.promise;abort.abort();await assert.rejects(pending,{code:'cancelled',submitted:true});assert.equal(f.requests.length,1);
});
test('absolute response deadline survives continuing small chunks',async t=>{
 let interval;const f=await fixture(t,{handler:(_q,r)=>{r.writeHead(200,{'content-type':'application/json'});r.write('{');interval=setInterval(()=>r.write(' '),10);r.on('close',()=>clearInterval(interval));}});t.after(()=>clearInterval(interval));const at=Date.now();await assert.rejects(read(f.client({timeoutMs:150})),{code:'timeout',submitted:true});assert(Date.now()-at<1500);assert.equal(f.requests.length,1);
});
test('response size, encoding, UTF-8 and envelope limits are enforced',async t=>{
 for(const kind of ['length','stream','compressed','utf8','code','depth'])await t.test(kind,async t=>{const f=await fixture(t,{handler:(_q,r)=>{if(kind==='length'){r.writeHead(200,{'content-type':'application/json','content-length':MAX_BODY+1});return r.end('x');}if(kind==='compressed'){r.writeHead(200,{'content-type':'application/json','content-encoding':'gzip'});return r.end('x');}if(kind==='utf8'){r.writeHead(200,{'content-type':'application/json'});return r.end(Buffer.from([0xff]));}if(kind==='stream'){r.writeHead(200,{'content-type':'application/json'});return r.end('x'.repeat(MAX_BODY+1));}if(kind==='code')return reply(r,{code:0.5,data:null});let value=null;for(let i=0;i<34;i++)value={nested:value};reply(r,{code:0,data:value});}});await assert.rejects(read(f.client()),{code:['length','stream'].includes(kind)?'response_too_large':'invalid_response',submitted:true});});
});
test('concurrent requests are refused and close never starts a replacement',async t=>{
 const f=await fixture(t,{handler:()=>{}}),c=f.client(),pending=read(c);await f.seen.promise;await assert.rejects(read(c),{code:'operation_in_progress',submitted:false});c.close();await assert.rejects(pending,{code:'closed',submitted:true});await assert.rejects(read(c),{code:'closed',submitted:false});assert.equal(f.requests.length,1);
});
test('cancel while TLS handshake is pending sends no HTTP and releases its socket',async t=>{
 const sockets=new Set(),seen=deferred(),server=net.createServer(socket=>{sockets.add(socket);seen.resolve();socket.on('close',()=>sockets.delete(socket));});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));});const port=server.address().port,abort=new AbortController();
 const c=new QQRemoteTransport({origin:`https://remote.arcade.invalid:${port}`,caPem:material.caPem,lookup:async()=>[{address:REMOTE,family:4}],connect:options=>{const socket=tls.connect({...options,host:'127.0.0.1'});Object.defineProperty(socket,'remoteAddress',{get:()=>REMOTE});return socket;}});t.after(()=>c.close());const pending=c.request('version',{credential:CREDENTIAL,signal:abort.signal});await seen.promise;abort.abort();await assert.rejects(pending,{code:'cancelled',submitted:false});
});

test('remote QQ sign-in uses four exact authenticated POST routes on verified TLS',async t=>{
 const f=await fixture(t),c=f.client(),routes=[['qqQRCode','/api/QQLogin/GetQQLoginQrcode',{}],['qqRefreshQR','/api/QQLogin/RefreshQRcode',{}],['qqQuickList','/api/QQLogin/GetQuickLoginList',{}],['qqQuickLogin','/api/QQLogin/SetQuickLogin',{uin:'100001'}]];
 let attempts=0;for(const [key,path,body]of routes){assert.deepEqual(await c.request(key,{body,credential:CREDENTIAL,onAttempt:()=>attempts++}),{code:0,data:{fixture:true}});const row=f.requests.at(-1);assert.equal(row.method,'POST');assert.equal(row.path,path);assert.equal(row.headers.authorization,`Bearer ${CREDENTIAL}`);assert.deepEqual(JSON.parse(row.body),body);assert(!row.path.includes(CREDENTIAL));assert(!row.body.includes(CREDENTIAL));}
 assert.equal(attempts,4);assert.equal(f.requests.length,4);assert.equal(f.state.secure,4);assert.equal(f.state.lookups,4);assert.equal(f.state.connects,4);
});

test('remote QQ sign-in rejects route and credential injection before DNS',async t=>{
 const f=await fixture(t),c=f.client();for(const route of ['qqQRCode','qqRefreshQR','qqQuickList','qqQuickLogin']){
  for(const options of [{},{credential:'synthetic\r\nX-Injected: yes'},{credential:'synthetic?token=unsafe'}])await assert.rejects(c.request(route,options),{code:'invalid_request',submitted:false});
  for(const suffix of ['?token=synthetic','#x','/../login'])await assert.rejects(c.request(route+suffix,{credential:CREDENTIAL}),{code:'invalid_request',submitted:false});
 }
 await assert.rejects(c.request('https://other.arcade.invalid/api/QQLogin/GetQQLoginQrcode',{credential:CREDENTIAL}),{code:'invalid_request',submitted:false});assert.equal(f.state.lookups,0);assert.equal(f.state.connects,0);
});

test('remote QQ login writes recheck scope, expiry and abort at the last send guard',async t=>{
 for(const route of ['qqRefreshQR','qqQuickLogin'])for(const code of ['changed','expired_ticket','login_expired','cancelled'])await t.test(`${route}: ${code}`,async t=>{
  const f=await fixture(t),abort=new AbortController();let checks=0,attempts=0;await assert.rejects(f.client().request(route,{credential:CREDENTIAL,body:route==='qqQuickLogin'?{uin:'100001'}:{},signal:abort.signal,assertCurrent:()=>{if(++checks!==4)return;if(code==='cancelled')abort.abort();else throw Object.assign(Error('synthetic scoped refusal'),{code});},onAttempt:()=>attempts++}),{code,submitted:false});assert.equal(checks,4);assert.equal(f.state.connects,1);assert.equal(attempts,0);assert.equal(f.requests.length,0);
 });
});

test('remote QR refresh disconnect and quick-login cancellation preserve attempted uncertainty without replay',async t=>{
 await t.test('refresh response lost',async t=>{const f=await fixture(t,{handler:req=>req.socket.destroy()});let attempts=0;await assert.rejects(f.client().request('qqRefreshQR',{credential:CREDENTIAL,onAttempt:()=>attempts++}),{code:'connection_failed',submitted:true});assert.equal(attempts,1);assert.equal(f.requests.length,1);assert.equal(f.requests[0].path,'/api/QQLogin/RefreshQRcode');});
 await t.test('quick login cancelled after write',async t=>{const f=await fixture(t,{handler:()=>{}}),abort=new AbortController();let attempts=0;const pending=f.client().request('qqQuickLogin',{credential:CREDENTIAL,body:{uin:'100001'},signal:abort.signal,onAttempt:()=>attempts++});await f.seen.promise;abort.abort();await assert.rejects(pending,{code:'cancelled',submitted:true});assert.equal(attempts,1);assert.equal(f.requests.length,1);assert.deepEqual(JSON.parse(f.requests[0].body),{uin:'100001'});});
});

test('passkey routes bind Origin to verified target and keep authentication requests credential-free',async t=>{
 const f=await fixture(t),c=f.client(),routes=[
  ['passkeyRegistrationOptions','generate-registration-options',true,{}],
  ['passkeyRegistrationVerify','verify-registration',true,{response:{id:'synthetic-public-key-response'}}],
  ['passkeyAuthenticationOptions','generate-authentication-options',false,{}],
  ['passkeyAuthenticationVerify','verify-authentication',false,{response:{id:'synthetic-public-key-response'}}],
 ];
 for(const [key,suffix,authenticated,body]of routes){
  await c.request(key,{body,...(authenticated?{credential:CREDENTIAL}:{}),origin:'https://untrusted.arcade.invalid',headers:{origin:'https://untrusted.arcade.invalid'}});
  const row=f.requests.at(-1);assert.equal(row.method,'POST');assert.equal(row.path,'/api/auth/passkey/'+suffix);assert.equal(row.headers.origin,f.options.origin);assert.equal(row.headers.host,`remote.arcade.invalid:${f.port}`);assert.equal(row.headers.authorization,authenticated?`Bearer ${CREDENTIAL}`:undefined);assert.deepEqual(JSON.parse(row.body),body);
 }
 assert.equal(f.requests.length,4);assert.equal(f.state.lookups,4);assert.equal(f.state.secure,4);
 await read(c);assert.equal(f.requests.at(-1).headers.origin,undefined);
});

test('passkey authentication boundaries reject missing or unexpected credentials before DNS',async t=>{
 const f=await fixture(t),c=f.client();
 for(const route of ['passkeyRegistrationOptions','passkeyRegistrationVerify'])await assert.rejects(c.request(route),{code:'invalid_request',submitted:false});
 for(const route of ['passkeyAuthenticationOptions','passkeyAuthenticationVerify'])await assert.rejects(c.request(route,{credential:CREDENTIAL}),{code:'invalid_request',submitted:false});
 for(const route of ['version','qqStatus','qqQuickLogin','networkWrite'])await assert.rejects(c.request(route),{code:'invalid_request',submitted:false});
 assert.equal(f.state.lookups,0);assert.equal(f.requests.length,0);
});

test('passkey final TLS guard preserves expiry and prevents every options or verification POST',async t=>{
 for(const route of ['passkeyRegistrationOptions','passkeyRegistrationVerify','passkeyAuthenticationOptions','passkeyAuthenticationVerify'])await t.test(route,async t=>{
  const f=await fixture(t);let checks=0,attempts=0;
  await assert.rejects(f.client().request(route,{...(route.startsWith('passkeyRegistration')?{credential:CREDENTIAL}:{}),assertCurrent:()=>{if(++checks===4)throw Object.assign(Error('synthetic expired ceremony'),{code:'passkey_expired'});},onAttempt:()=>attempts++}),{code:'passkey_expired',submitted:false});
  assert.equal(checks,4);assert.equal(f.state.connects,1);assert.equal(attempts,0);assert.equal(f.requests.length,0);
 });
});

test('passkey verify response loss remains one attempted request, without retry or credential fallback',async t=>{
 for(const route of ['passkeyRegistrationVerify','passkeyAuthenticationVerify'])await t.test(route,async t=>{
  const f=await fixture(t,{handler:req=>req.socket.destroy()});let attempts=0;
  await assert.rejects(f.client().request(route,{body:{response:{id:'synthetic-public-key-response'}},...(route==='passkeyRegistrationVerify'?{credential:CREDENTIAL}:{}),onAttempt:()=>attempts++}),{code:'connection_failed',submitted:true});
  assert.equal(attempts,1);assert.equal(f.requests.length,1);assert.equal(f.requests[0].headers.origin,f.options.origin);
 });
});

test('passkey final TLS guard preserves a dismissed ceremony and sends no verify',async t=>{
 const f=await fixture(t);let checks=0,attempts=0;
 await assert.rejects(f.client().request('passkeyAuthenticationVerify',{assertCurrent:()=>{if(++checks===4)throw Object.assign(Error('synthetic dismissed ceremony'),{code:'passkey_cancelled'});},onAttempt:()=>attempts++}),{code:'passkey_cancelled',submitted:false});
 assert.equal(checks,4);assert.equal(attempts,0);assert.equal(f.requests.length,0);
});
