'use strict';
// Real loopback OneBot transport + synthetic images; no QQ or external uploads.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {randomUUID,createHash}=require('node:crypto');const {once}=require('node:events');const {WebSocket,WebSocketServer}=require('ws');
const {QQClient}=require('../src/bot/qq.cjs');const {QQAvatarSession,avatarResult}=require('../src/bot/qq-avatar-session.cjs');
const {QQAvatarUploadStore,EXPIRY,MAX_FILES}=require('../src/bot/qq-avatar-store.cjs');const {canonicalImage}=require('../src/bot/qq-media.cjs');const {png,native}=require('./helpers/fixture-image.cjs');
const ACCOUNT='87654321',OWNER='12345678',scope='a'.repeat(64),scope2='b'.repeat(64);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
function temporary(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-avatar-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root;}
const image=()=>canonicalImage(png(),'.png',native()).bytes;
async function fixture(t){
 const root=temporary(t),file=path.join(root,'synthetic.png'),uploadRoot=path.join(root,'uploads');fs.writeFileSync(file,png());
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');const requests=[],clients=[],state={account:ACCOUNT,online:true,reply:'ok',gate:null,statusGate:null,verify:async()=>({verified:true}),now:1000,clock:0};
 server.on('connection',ws=>ws.on('message',raw=>{const q=JSON.parse(raw);requests.push(q);const reply=(data,overrides={})=>ws.send(JSON.stringify({echo:q.echo,status:'ok',retcode:0,...(data===undefined?{}:{data}),...overrides}));
  if(q.action==='get_login_info')reply({user_id:state.account});else if(q.action==='get_status'){if(state.statusGate)state.statusGate(reply);else reply({online:state.online,good:true});}
  else if(q.action==='set_qq_avatar'){
   if(state.gate)return state.gate(reply,q);
   if(state.reply==='disconnect')return ws.terminate();if(state.reply==='timeout')return;
   if(state.reply==='omitted')return reply(undefined);if(state.reply==='object')return reply({});if(state.reply==='failed')return reply(null,{status:'failed',retcode:1200,message:'PRIVATE_FIXTURE_NOT_FOR_OUTPUT'});
   if(state.reply==='wrong-echo')return reply(null,{echo:'unrelated'});reply(null);
  }else assert.fail(`unexpected ${q.action}`);
 }));
 const input={accountId:'profile-fixture',panelId:randomUUID()},profile={},runtime={},installation={};const binding={profileId:input.accountId,panelId:input.panelId,profile,generation:2,characterId:'original-fixture',runtime,installation,runtimeEpoch:1,bridgeRevision:'fixture-revision',qqAccountId:ACCOUNT,ownerId:OWNER,url:`ws://127.0.0.1:${server.address().port}`,token:'synthetic-local-avatar-token',channel:'qq',status:'disconnected',endpointId:'fixture-endpoint'};
 const manager=new QQAvatarSession({nativeImage:native(),uploadRoot,now:()=>state.now,monotonic:()=>state.clock,capture:value=>({...binding,panelId:value.panelId}),verifyContext:(...args)=>state.verify(...args),clientFactory:options=>{const client=new QQClient({...options,timeoutMs:150,socketFactory:(url,opts)=>new WebSocket(url,opts)});clients.push(client);return client;}});
 t.after(async()=>{await manager.close();for(const client of clients)client.close();for(const ws of server.clients)ws.terminate();await new Promise(resolve=>server.close(resolve));});
 return {root,file,uploadRoot,server,state,input,binding,manager,requests,clients,async draft(){await manager.read(input);return (await manager.select(input,{file})).draft;}};
}
test('construction is inert; AI-off read owns a request-only socket and exposes no avatar/path/token',async t=>{
 const f=await fixture(t);assert.equal(fs.existsSync(f.uploadRoot),false);assert.equal(f.clients.length,0);const result=await f.manager.read(f.input);assert.equal(result.qqAccountId,ACCOUNT);assert.equal(result.profile.currentAvatar.state,'unavailable');assert.equal(result.profile.capabilities.currentAvatar,false);assert.equal(f.clients[0].receiveOwnerMessages,false);assert.equal(f.clients[0].allowOwnerVoice,false);assert.doesNotMatch(JSON.stringify(result),/token|uploads|PRIVATE|base64|url/);assert(f.requests.every(q=>['get_login_info','get_status'].includes(q.action)));
});
test('local draft is canonical and successful explicit submit uses only a private random PNG path',async t=>{
 const f=await fixture(t),source=fs.readFileSync(f.file),draft=await f.draft();assert.equal(draft.width,2);assert(!Buffer.from(draft.preview.split(',')[1],'base64').includes(Buffer.from('PRIVATE_FIXTURE_METADATA')));let uploadPath;
 f.state.gate=(reply,q)=>{assert.deepEqual(Object.keys(q.params),['file']);uploadPath=q.params.file;assert.equal(path.dirname(uploadPath),f.uploadRoot);assert.match(path.basename(uploadPath),/^[a-f0-9-]{36}\.png$/);assert(!fs.readFileSync(uploadPath).includes(Buffer.from('PRIVATE_FIXTURE_METADATA')));reply(null);};
 const result=await f.manager.confirm({...f.input,ticketId:draft.ticketId});assert.equal(result.change.outcome,'accepted');assert.equal(result.change.acknowledgement,'bridge-reported-success');assert.equal(result.change.visibleResult,'unverified');assert.equal(result.change.temporaryFile,'removed');assert.equal(fs.existsSync(uploadPath),false);assert.deepEqual(fs.readdirSync(f.uploadRoot),[]);assert(fs.readFileSync(f.file).equals(source));assert.doesNotMatch(JSON.stringify(result),/png|token|url|PRIVATE/);await assert.rejects(async()=>f.manager.confirm({...f.input,ticketId:draft.ticketId}),{code:'stale_ticket'});
});
test('omitted/malformed/failed/unmatched/timeout/disconnected receipts remain unknown and never replay',async t=>{
 for(const mode of ['omitted','object','failed','wrong-echo','timeout','disconnect'])await t.test(mode,async t=>{const f=await fixture(t),draft=await f.draft();f.state.reply=mode;const result=await f.manager.confirm({...f.input,ticketId:draft.ticketId});assert.equal(result.change.outcome,'unknown');assert.equal(result.change.code,'change_unknown');assert.equal(result.change.temporaryFile,'retained');assert.equal(f.requests.filter(q=>q.action==='set_qq_avatar').length,1);assert.equal(fs.readdirSync(f.uploadRoot).length,2);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|synthetic|token|\.png/);await assert.rejects(async()=>f.manager.confirm({...f.input,ticketId:draft.ticketId}));});
});
test('identity/online/context changes reject before staging or upload',async t=>{
 for(const mode of ['account','offline','scope'])await t.test(mode,async t=>{const f=await fixture(t),draft=await f.draft();if(mode==='account')f.state.account='22222222';if(mode==='offline')f.state.online=false;if(mode==='scope')f.binding.runtimeEpoch++;const result=await avatarResult(f.input,()=>f.manager.confirm({...f.input,ticketId:draft.ticketId}));assert(result.ok===false||result.change.outcome==='not_submitted');assert.equal(f.requests.filter(q=>q.action==='set_qq_avatar').length,0);assert.deepEqual(fs.readdirSync(f.uploadRoot),[]);});
});
test('all extra renderer fields and non-square images are rejected',async t=>{
 const f=await fixture(t),draft=await f.draft();for(const extra of [{file:f.file},{url:'https://example.test'},{qqAccountId:ACCOUNT},{ownerId:OWNER},{action:'set_group_portrait'}])await assert.rejects(async()=>f.manager.confirm({...f.input,ticketId:draft.ticketId,...extra}),{code:'invalid_request'});
 fs.writeFileSync(f.file,png(3,2));await assert.rejects(f.manager.select(f.input,{file:f.file}),{code:'image_not_square'});assert.equal(f.requests.filter(q=>q.action==='set_qq_avatar').length,0);
});
test('picker is held under one pending operation; close/ABA/dismiss cannot publish a late selection',async t=>{
 for(const mode of ['close','scope','dismiss'])await t.test(mode,async t=>{const f=await fixture(t);await f.manager.read(f.input);let release;const wait=new Promise(resolve=>release=resolve),pending=f.manager.select(f.input,{pickFile:()=>wait});await assert.rejects(async()=>f.manager.select(f.input,{file:f.file}),{code:'operation_in_progress'});let closing;
  if(mode==='close')closing=f.manager.closeOwned(f.input);else if(mode==='scope')f.binding.runtimeEpoch++;else f.manager.dismiss(f.input);release(f.file);await assert.rejects(pending);await closing;assert.equal(f.requests.filter(q=>q.action==='set_qq_avatar').length,0);
 });
});
test('native picker cancellation clears the old preview but never stages or uploads',async t=>{const f=await fixture(t),draft=await f.draft();assert.equal((await f.manager.select(f.input,{pickFile:async()=>null})).cancelled,true);await assert.rejects(async()=>f.manager.confirm({...f.input,ticketId:draft.ticketId}),{code:'stale_ticket'});assert.deepEqual(fs.readdirSync(f.uploadRoot),[]);});
test('close before final verify prevents even constructing another production client',async t=>{
 const f=await fixture(t);let captures=0;const original=f.manager.capture;f.manager.capture=value=>{const result=original(value);if(++captures===4)queueMicrotask(()=>f.manager.closeCurrent());return result;};await assert.rejects(f.manager.read(f.input));assert.equal(f.clients.length,0);
});
test('closing a submitted operation retains its upload and returns captured unknown',async t=>{
 const f=await fixture(t),draft=await f.draft();let entered;const waiting=new Promise(resolve=>entered=resolve);f.state.gate=()=>entered();const result=f.manager.confirm({...f.input,ticketId:draft.ticketId});await waiting;await f.manager.closeOwned(f.input);const receipt=await result;assert.equal(receipt.accountId,f.input.accountId);assert.equal(receipt.qqAccountId,ACCOUNT);assert.equal(receipt.change.outcome,'unknown');assert.equal(receipt.change.temporaryFile,'retained');
});
test('late successful receipt keeps acceptance even when binding changed; old close cannot close new panel',async t=>{
 const f=await fixture(t),draft=await f.draft();f.state.gate=reply=>{f.binding.runtimeEpoch++;reply(null);};const receipt=await f.manager.confirm({...f.input,ticketId:draft.ticketId});assert.equal(receipt.change.outcome,'accepted');const next={...f.input,panelId:randomUUID()};await f.manager.read(next);await f.manager.closeOwned(f.input);assert.equal(f.manager.session.panelId,next.panelId);assert.equal(f.clients.at(-1).ready,true);
});
test('monotonic expiry and failed runtime reverify consume old capability without writing',async t=>{
 for(const mode of ['expiry','verify'])await t.test(mode,async t=>{const f=await fixture(t),draft=await f.draft();if(mode==='expiry'){f.state.clock=300000;f.state.now=-100;}else f.state.verify=async()=>({verified:false});const result=await f.manager.confirm({...f.input,ticketId:draft.ticketId});assert.equal(result.change.outcome,'not_submitted');await assert.rejects(async()=>f.manager.confirm({...f.input,ticketId:draft.ticketId}),{code:'stale_ticket'});assert.equal(f.requests.filter(q=>q.action==='set_qq_avatar').length,0);});
});
test('expiry during upload fsync is rechecked immediately before the bridge request',async t=>{
 const f=await fixture(t),draft=await f.draft(),store=f.manager._store(),create=store.create.bind(store);store.create=(...args)=>{const upload=create(...args);f.state.clock=300000;return upload;};
 const result=await f.manager.confirm({...f.input,ticketId:draft.ticketId});assert.equal(result.change.outcome,'not_submitted');assert.equal(result.change.code,'expired_ticket');assert.equal(result.change.temporaryFile,'removed');assert.equal(f.requests.filter(q=>q.action==='set_qq_avatar').length,0);assert.deepEqual(fs.readdirSync(f.uploadRoot),[]);
});
test('unknown files survive restart and expiry; explicit verified cleanup never deletes the picker source',async t=>{
 const f=await fixture(t),draft=await f.draft(),original=digest(fs.readFileSync(f.file));f.state.reply='omitted';await f.manager.confirm({...f.input,ticketId:draft.ticketId});const root=f.uploadRoot;f.state.now+=EXPIRY*2;
 const store=new QQAvatarUploadStore({root,now:()=>f.state.now}),scopeHash=createHash('sha256').update(JSON.stringify([f.input.accountId,ACCOUNT])).digest('hex');assert.equal(store.cleanup(scopeHash,{expiredOnly:true}).removed,0);assert.equal(store.summary(scopeHash).retainedCount,1);const cleanup=f.manager.cleanup(f.input);assert.equal(cleanup.cleanup.removed,1);assert.equal(cleanup.retainedCount,0);assert.equal(digest(fs.readFileSync(f.file)),original);
});
test('store keeps exact held identities, rejects replaced/linked images and does not delete changed content',t=>{
 for(const mutation of ['contents','replace','hardlink','record']){const root=temporary(t),store=new QQAvatarUploadStore({root:path.join(root,'spool')}),upload=store.create(image(),scope),replacement=path.join(root,'different.png');
  if(mutation==='contents')fs.writeFileSync(upload.file,png());if(mutation==='replace'){fs.writeFileSync(replacement,image());fs.renameSync(upload.file,path.join(root,'old.png'));fs.renameSync(replacement,upload.file);}if(mutation==='hardlink')fs.linkSync(upload.file,replacement);if(mutation==='record')fs.writeFileSync(upload.file.replace(/\.png$/,'.json'),'{}');
  assert.throws(upload.assertIntact,{code:'upload_file_changed'});assert.equal(upload.discard().removed,false);assert(fs.existsSync(upload.file));assert.equal(store.cleanup(scope).removed,0);
 }
});
test('private spool bounds and scope cleanup cannot evict active/foreign/unknown files',t=>{
 const root=temporary(t),store=new QQAvatarUploadStore({root:path.join(root,'spool')});const active=store.create(image(),scope);assert.equal(store.cleanup(scope).removed,0);active.retain();const foreign=store.create(image(),scope2);foreign.retain();assert.equal(store.cleanup(scope).removed,1);assert.equal(store.summary(scope2).retainedCount,1);
 for(let i=1;i<MAX_FILES;i++){const entry=store.create(image(),scope2);entry.markAttempted();entry.retain();}assert.throws(()=>store.create(image(),scope),{code:'upload_store_full'});assert.equal(store.cleanup(scope).removed,0);
});
test('safe expired prepared/settled artifacts may be cleaned; unknown entries remain untouched',t=>{
 let now=1000;const root=temporary(t),store=new QQAvatarUploadStore({root:path.join(root,'spool'),now:()=>now});for(const phase of ['prepared','settled','attempted']){const entry=store.create(image(),scope);if(phase!=='prepared')entry.markAttempted();if(phase==='settled')entry.markSettled();entry.retain();}now+=EXPIRY+1;assert.equal(store.cleanup(scope,{expiredOnly:true}).removed,2);assert.equal(store.summary(scope).retainedCount,1);const unrelated=path.join(store.root,'unknown.png');fs.writeFileSync(unrelated,image());assert.throws(()=>store.create(image(),scope),{code:'upload_store_unavailable'});assert.equal(store.cleanup(scope).removed,1);assert(fs.existsSync(unrelated));
});
