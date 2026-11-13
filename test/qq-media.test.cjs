'use strict';
// Synthetic images and a real loopback WebSocket server, never a QQ account.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {once}=require('node:events');const {WebSocketServer,WebSocket}=require('ws');
const {QQClient}=require('../src/bot/qq.cjs');
const {QQOwnerImage,canonicalImage,dimensions,readSelected}=require('../src/bot/qq-media.cjs');const {png,native}=require('./helpers/fixture-image.cjs');
const OWNER='12345678',ACCOUNT='87654321';
async function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-media-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));const image=path.join(root,'synthetic.png');fs.writeFileSync(image,png());
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');const requests=[];const state={account:ACCOUNT,online:true,generation:1,scopeId:'synthetic-profile:character-a',send:'ok',statusGate:null,sendGate:null};
  server.on('connection',ws=>ws.on('message',raw=>{const value=JSON.parse(raw);requests.push(value);const reply=data=>ws.send(JSON.stringify({echo:value.echo,status:'ok',retcode:0,data}));
    if(value.action==='get_login_info')reply({user_id:state.account});else if(value.action==='get_status'){if(state.statusGate)state.statusGate(reply);else reply({online:state.online,good:true});}
    else if(value.action==='send_private_msg'){if(state.sendGate)state.sendGate(reply);else if(state.send==='ok'){ws.send(JSON.stringify({echo:'wrong-echo',status:'ok',retcode:0,data:{message_id:999}}));reply({message_id:42});}else if(state.send==='missing')reply({});else if(state.send==='disconnect')ws.terminate();}
    else assert.fail(`unexpected action: ${value.action}`);
  }));
  const client=new QQClient({url:`ws://127.0.0.1:${server.address().port}`,token:'synthetic-token-only',ownerId:OWNER,expectedAccountId:ACCOUNT,timeoutMs:200,socketFactory:(url,options)=>new WebSocket(url,options)});await client.connect();
  const value=()=>({status:'connected',channel:'qq',generation:state.generation,scopeId:state.scopeId,accountId:ACCOUNT,ownerId:OWNER,role:'Synthetic companion',client});const manager=new QQOwnerImage({nativeImage:native(),getBinding:value});
  t.after(async()=>{await manager.close();await client.close();for(const ws of server.clients)ws.terminate();await new Promise(resolve=>server.close(resolve));});return {root,image,manager,client,state,requests};
}
test('selection requires valid local images and exposes only canonical preview plus exact recipient',async t=>{
  const f=await fixture(t),original=fs.readFileSync(f.image),draft=await f.manager.select(f.image);assert.equal(draft.kind,'image');assert.equal(draft.recipient.ownerId,OWNER);assert.equal(draft.recipient.accountId,ACCOUNT);assert.equal(draft.width,2);assert.equal(draft.height,2);assert(draft.preview.startsWith('data:image/png;base64,'));assert(!Buffer.from(draft.preview.split(',')[1],'base64').includes(Buffer.from('PRIVATE_FIXTURE_METADATA')));assert.doesNotMatch(JSON.stringify(draft),/synthetic\.png|sha256|filePath/);assert(fs.readFileSync(f.image).equals(original));assert.deepEqual(f.requests.map(x=>x.action),['get_login_info','get_status']);assert.doesNotMatch(JSON.stringify(f.manager.snapshot()),/base64|preview/);
});
test('preflight rejects oversized dimensions and animation before native decoding',()=>{
  let calls=0;const decoder={createFromBuffer(){calls++;assert.fail();}},oversize=png();oversize.writeUInt32BE(9000,16);
  assert.throws(()=>canonicalImage(oversize,'.png',decoder),{code:'image_too_large'});assert.throws(()=>canonicalImage(png(2,2,{animated:true}),'.png',decoder),{code:'image_animated'});assert.throws(()=>dimensions(Buffer.from('GIF89a'),'.gif'),{code:'image_format'});assert.equal(calls,0);
});
test('local path validation rejects URLs, network paths, disguised files and linked sources',async t=>{
  const f=await fixture(t);for(const file of ['https://example.test/a.png','//server/share/a.png','\\\\server\\share\\a.png',path.join(f.root,'file.png:stream')])await assert.rejects(f.manager.select(file));
  const bad=path.join(f.root,'bad.png');fs.writeFileSync(bad,'not an image');await assert.rejects(f.manager.select(bad),{code:'image_invalid'});const linked=path.join(f.root,'linked.png');fs.linkSync(f.image,linked);await assert.rejects(readSelected(linked),{code:'unsafe_file'});assert(!f.requests.some(x=>x.action==='send_private_msg'));
});
test('single-use send has fixed private image schema, checks current login and online, and requires matching receipt',async t=>{
  const f=await fixture(t),draft=await f.manager.select(f.image);assert.deepEqual(await f.manager.send({ticketId:draft.ticketId}),{ticketId:draft.ticketId,outcome:'accepted',messageId:'42',kind:'image'});
  assert.deepEqual(f.requests.map(x=>x.action),['get_login_info','get_status','get_login_info','get_status','get_login_info','send_private_msg']);const send=f.requests.at(-1);assert.equal(send.params.user_id,OWNER);assert.deepEqual(Object.keys(send.params).sort(),['message','user_id']);assert.equal(send.params.message.length,1);assert.equal(send.params.message[0].type,'image');assert.deepEqual(Object.keys(send.params.message[0].data),['file']);assert(send.params.message[0].data.file.startsWith('base64://'));const bytes=Buffer.from(send.params.message[0].data.file.slice(9),'base64');assert(!bytes.includes(Buffer.from('PRIVATE_FIXTURE_METADATA')));
  await assert.rejects(f.manager.send({ticketId:draft.ticketId}),{code:'stale_ticket'});assert.equal(f.requests.filter(x=>x.action==='send_private_msg').length,1);assert.equal(f.manager.snapshot().draft,null);
});
test('renderer cannot specify recipient, action, URL, local file, encoded image or group',async t=>{
  const f=await fixture(t),draft=await f.manager.select(f.image);for(const extra of [{ownerId:'99999999'},{action:'send_group_msg'},{url:'https://example.test'},{file:f.image},{data:'base64://x'},{group_id:OWNER}])await assert.rejects(f.manager.send({ticketId:draft.ticketId,...extra}),{code:'invalid_request'});assert(f.manager.snapshot().draft);assert(!f.requests.some(x=>x.action==='send_private_msg'));
});
test('connection generation change consumes stale ticket without submitting from the new connection',async t=>{
  const f=await fixture(t),draft=await f.manager.select(f.image);f.state.generation++;const result=await f.manager.send({ticketId:draft.ticketId});assert.equal(result.outcome,'not_sent');assert.equal(result.code,'changed');assert(!f.requests.some(x=>x.action==='send_private_msg'));assert.equal(f.manager.snapshot().last,null);await assert.rejects(f.manager.send({ticketId:draft.ticketId}),{code:'stale_ticket'});
});
test('same-name character replacement cannot inherit a preview from the same account and socket',async t=>{
  const f=await fixture(t),draft=await f.manager.select(f.image);f.state.scopeId='synthetic-profile:character-b';const result=await f.manager.send({ticketId:draft.ticketId});assert.equal(result.outcome,'not_sent');assert.equal(result.code,'changed');assert.equal(f.manager.snapshot().last,null);assert(!f.requests.some(x=>x.action==='send_private_msg'));
});
test('silent upstream account change and offline state are rejected before image submission',async t=>{
  for(const mode of ['account','offline'])await t.test(mode,async t=>{const f=await fixture(t),draft=await f.manager.select(f.image);if(mode==='account')f.state.account='22222222';else f.state.online=false;const result=await f.manager.send({ticketId:draft.ticketId});assert.equal(result.outcome,'not_sent');assert.equal(result.code,mode==='account'?'account_mismatch':'account_offline');assert(!f.requests.some(x=>x.action==='send_private_msg'));});
});
test('timeout, malformed receipt and disconnect are unknown outcomes with no replay',async t=>{
  for(const mode of ['timeout','missing','disconnect'])await t.test(mode,async t=>{const f=await fixture(t),draft=await f.manager.select(f.image);f.state.send=mode;const result=await f.manager.send({ticketId:draft.ticketId});assert.equal(result.outcome,'unknown');assert.equal(result.code,'send_unknown');await assert.rejects(f.manager.send({ticketId:draft.ticketId}),{code:'stale_ticket'});assert.equal(f.requests.filter(x=>x.action==='send_private_msg').length,1);});
});
test('cancel during identity checks prevents send and close waits for operation cleanup',async t=>{
  const f=await fixture(t),draft=await f.manager.select(f.image);let entered;const waiting=new Promise(resolve=>entered=resolve);f.state.statusGate=()=>entered();const pending=f.manager.send({ticketId:draft.ticketId});await waiting;await f.manager.close();const result=await pending;assert.equal(result.outcome,'not_sent');assert.equal(result.code,'cancelled');assert(!f.requests.some(x=>x.action==='send_private_msg'));assert.equal(f.manager.snapshot().busy,false);assert.equal(f.client.closed,false,'shared companion client must stay open');
});
test('cancel after submission reports unknown and never retries',async t=>{
  const f=await fixture(t),draft=await f.manager.select(f.image);let entered;const waiting=new Promise(resolve=>entered=resolve);f.state.sendGate=()=>entered();const controller=new AbortController(),pending=f.manager.send({ticketId:draft.ticketId},{signal:controller.signal});await waiting;controller.abort();assert.equal((await pending).outcome,'unknown');await assert.rejects(f.manager.send({ticketId:draft.ticketId}),{code:'stale_ticket'});assert.equal(f.requests.filter(x=>x.action==='send_private_msg').length,1);
});
test('account switch after a matching receipt does not erase acceptance or leak old receipt into new scope',async t=>{
  const f=await fixture(t),draft=await f.manager.select(f.image);f.state.sendGate=reply=>{f.state.generation++;reply({message_id:88});};assert.equal((await f.manager.send({ticketId:draft.ticketId})).outcome,'accepted');assert.equal(f.manager.snapshot().last,null);
});
test('discard and expiry destroy the preview capability without sending',async t=>{
  const f=await fixture(t);let now=100;f.manager.now=()=>now;let draft=await f.manager.select(f.image);assert.deepEqual(f.manager.discard({ticketId:draft.ticketId}),{discarded:true});await assert.rejects(f.manager.send({ticketId:draft.ticketId}),{code:'stale_ticket'});draft=await f.manager.select(f.image);now=draft.expiresAt;const result=await f.manager.send({ticketId:draft.ticketId});assert.equal(result.outcome,'not_sent');assert.equal(result.code,'expired_ticket');assert(!f.requests.some(x=>x.action==='send_private_msg'));
});
test('fixed QQ client method rejects other recipients and noncanonical payloads before any request',async t=>{
  const f=await fixture(t),before=f.requests.length,valid=canonicalImage(png(),'.png',native()).bytes;
  for(const [recipient,bytes] of [['99999999',valid],[OWNER,png()],[OWNER,Buffer.from('file:///private')],[OWNER,Buffer.alloc(4*1024*1024+1)]]){const result=await f.client.sendOwnerImage(recipient,bytes,'fixture');assert.equal(result.outcome,'not_sent');}
  assert.equal(f.requests.length,before);assert.equal(f.client.ready,true);
});
