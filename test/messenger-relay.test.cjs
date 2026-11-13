'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{createHmac}=require('node:crypto');
const {MessengerRelay}=require('../src/bot/messenger-relay.cjs');
const {projectWebhook,text,TTL,WINDOW,MAX_BODY}=require('../src/bot/messenger-transport.cjs');
const APP='11000000001',PAGE='22000000001',OWNER='33000000001',NOW=1793930000000;
const APP_SECRET='a'.repeat(32),VERIFY='v'.repeat(32),AUTH='r'.repeat(43);
const sign=bytes=>'sha256='+createHmac('sha256',APP_SECRET).update(bytes).digest('hex');
const event=(overrides={})=>({sender:{id:OWNER},recipient:{id:PAGE},timestamp:NOW,message:{mid:'m_synthetic_1',text:'hello 💬'},...overrides});
const encode=(rows=[event()])=>Buffer.from(JSON.stringify({object:'page',entry:[{id:PAGE,time:NOW,messaging:rows}]}));
function fixture(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-messenger-relay-')),file=path.join(dir,'relay.sqlite');let now=NOW;
  const options={databaseFile:file,appId:APP,pageId:PAGE,ownerId:OWNER,appSecret:APP_SECRET,verifyToken:VERIFY,authToken:AUTH,now:()=>now};const instances=[];
  const make=changes=>{const r=new MessengerRelay({...options,...changes});instances.push(r);return r;};const relay=make();
  t.after(()=>{for(const r of instances)r.close();assert(fs.realpathSync(dir).toLowerCase().startsWith(fs.realpathSync(os.tmpdir()).toLowerCase()+path.sep));fs.rmSync(dir,{recursive:true,force:true});});
  return {relay,make,file,setNow:v=>{now=v;},push:(r,rows)=>{const b=encode(rows);return r.receive(b,sign(b));},pull:r=>r.pull({sessionId:r.sessionId,after:NOW})};}

test('raw HMAC precedes parsing; Unicode text and multiple exact owner entries remain bounded',()=>{
  const bytes=encode();assert.equal(projectWebhook(bytes,sign(bytes),{appSecret:APP_SECRET,pageId:PAGE,ownerId:OWNER,now:NOW})[0].text,'hello 💬');assert(text('💬'));
  assert.throws(()=>projectWebhook(Buffer.from('{broken'),'sha256='+'0'.repeat(64),{appSecret:APP_SECRET,pageId:PAGE,ownerId:OWNER,now:NOW}),{code:'invalid_signature'});
  for(const header of [undefined,'sha1='+'0'.repeat(40),'sha256='+'0'.repeat(64),sign(bytes).toUpperCase()])assert.throws(()=>projectWebhook(bytes,header,{appSecret:APP_SECRET,pageId:PAGE,ownerId:OWNER,now:NOW}),{code:'invalid_signature'});
  const invalid=Buffer.from([123,34,120,34,58,34,255,34,125]);assert.throws(()=>projectWebhook(invalid,sign(invalid),{appSecret:APP_SECRET,pageId:PAGE,ownerId:OWNER,now:NOW}),{code:'invalid_response'});
});
test('foreign Pages/owners, wrong recipient, echoes and postbacks never enter the fixed owner queue',t=>{
  const f=fixture(t),rows=[event({sender:{id:'99'}}),event({recipient:{id:'99'}}),event({message:{mid:'m_echo',text:'/allow',is_echo:true}}),event({message:undefined,postback:{payload:'/allow'}}),event()];
  const body={object:'page',entry:[{id:'99',messaging:[event()]},{id:PAGE,messaging:rows}]},b=Buffer.from(JSON.stringify(body));assert.equal(f.relay.receive(b,sign(b)).accepted,1);
  assert.equal(f.pull(f.relay).items.length,1);
});
test('mixed/unknown message wrappers are unsupported; references do not include quoted instructions',t=>{
  const f=fixture(t);f.push(f.relay,[event({message:{mid:'m_1',text:'/allow code',attachments:[{payload:{url:'https://must-not-fetch.invalid'}}]}}),
    event({message:{mid:'m_2',text:'/allow code',reply_to:{mid:'old',text:'PRIVATE quoted body'}}}),event({message:{mid:'m_3',text:'/allow code',quick_reply:{payload:'other'}}})]);
  const batch=f.pull(f.relay);assert.equal(batch.items[0].unsupported,'messenger_nontext');assert.equal(batch.items[1].quote.text,'');assert.equal(batch.items[2].unsupported,'messenger_nontext');
  assert(!JSON.stringify(batch).includes('PRIVATE'));assert(!JSON.stringify(batch).includes('must-not-fetch'));
});
test('duplicate delivery is durable across relay restart; a conflicting MID rolls back the whole delivery',t=>{
  const f=fixture(t);assert.equal(f.push(f.relay,[event()]).accepted,1);f.relay.close();const next=f.make();assert.equal(f.push(next,[event()]).accepted,0);
  assert.throws(()=>f.push(next,[event({message:{mid:'m_new',text:'new'}}),event({message:{mid:'m_synthetic_1',text:'different'}})]),{code:'event_conflict'});
  assert.equal(f.pull(next).items.length,1);
});
test('ACK is exact one-use and requires the current relay session; restart does not erase unacknowledged payload',t=>{
  const f=fixture(t);f.push(f.relay,[event()]);const old=f.pull(f.relay);
  assert.throws(()=>f.relay.acknowledge({sessionId:f.relay.sessionId,deliveryId:old.deliveryId,ids:['m_other']}),{code:'stale_batch'});
  f.relay.close();const next=f.make();assert.throws(()=>next.acknowledge({sessionId:old.sessionId,deliveryId:old.deliveryId,ids:['m_synthetic_1']}),{code:'changed'});
  const batch=f.pull(next),args={sessionId:next.sessionId,deliveryId:batch.deliveryId,ids:batch.items.map(x=>x.id)};
  assert(next.acknowledge(args).acknowledged);assert.throws(()=>next.acknowledge(args),{code:'stale_batch'});assert.equal(f.pull(next).items.length,0);
  assert.equal(f.push(next,[event()]).accepted,0);assert.equal(next.db.prepare('SELECT payload FROM inbox').get().payload,null);
});
test('payload TTL clears old text without allowing webhook replay; an old event never creates a new window',t=>{
  const f=fixture(t);f.push(f.relay,[event()]);f.setNow(NOW+TTL);assert.equal(f.pull(f.relay).items.length,0);
  assert.equal(f.push(f.relay,[event()]).accepted,0);assert.equal(f.relay.db.prepare('SELECT payload FROM inbox').get().payload,null);
  f.setNow(NOW+27*60*60*1000);assert.equal(f.push(f.relay,[event()]).accepted,0);assert.equal(f.relay.db.prepare('SELECT COUNT(*) n FROM inbox').get().n,0);
});
test('queue capacity and oversized bodies reject without evicting already admitted commands',t=>{
  const f=fixture(t);const rows=Array.from({length:100},(_,i)=>event({message:{mid:`m_${i}`,text:'task'}}));assert.equal(f.push(f.relay,rows).accepted,100);
  assert.throws(()=>f.push(f.relay,[event({message:{mid:'m_overflow',text:'overflow'}})]),{code:'queue_full'});assert.equal(f.relay.db.prepare('SELECT COUNT(*) n FROM inbox').get().n,100);
  assert.throws(()=>f.relay.receive(Buffer.alloc(MAX_BODY+1),''),{code:'body_too_large'});assert.equal(f.relay.db.prepare('SELECT COUNT(*) n FROM inbox').get().n,100);
});
test('future timestamps and malformed target events cannot partially commit a batch',t=>{
  const f=fixture(t);for(const change of [{timestamp:NOW+30001},{timestamp:'not-number'},{message:{mid:42,text:'x'}}])assert.throws(()=>f.push(f.relay,[event(),event(change)]),{code:'invalid_event'});
  assert.equal(f.relay.db.prepare('SELECT COUNT(*) n FROM inbox').get().n,0);
  f.push(f.relay,[event({timestamp:NOW-WINDOW-1})]);assert.equal(f.relay.db.prepare('SELECT COUNT(*) n FROM inbox').get().n,0);
});
test('persisted store rejects another Page/owner/App and hard-linked database',t=>{
  const f=fixture(t);f.relay.close();for(const changes of [{pageId:'88'},{ownerId:'99'},{appId:'77'}])assert.throws(()=>f.make(changes),{code:'scope_changed'});
  const alias=f.file+'.alias';fs.linkSync(f.file,alias);assert.throws(()=>f.make(),{code:'unsafe_store'});
});
module.exports={APP,PAGE,OWNER,NOW,APP_SECRET,VERIFY,AUTH,event,encode,sign};
test('an incompatible existing SQLite page size cannot silently raise the fixed database bound',t=>{
  const f=fixture(t);f.relay.close();const other=path.join(path.dirname(f.file),'large-pages.sqlite'),{DatabaseSync}=require('node:sqlite'),db=new DatabaseSync(other);
  db.exec('PRAGMA page_size=65536; CREATE TABLE placeholder (id INTEGER);');db.close();
  assert.throws(()=>f.make({databaseFile:other}),{code:'unsafe_store'});
});
test('explicit maintenance removes expired payload even without a desktop pull',t=>{
  const f=fixture(t);f.push(f.relay,[event()]);f.setNow(NOW+TTL+1);assert.deepEqual(f.relay.prune(),{pruned:true});
  const row=f.relay.db.prepare('SELECT payload,fingerprint FROM inbox').get();assert.equal(row.payload,null);assert.equal(row.fingerprint.length,64);
});
