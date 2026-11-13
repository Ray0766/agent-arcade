'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),{randomUUID}=require('node:crypto');
const {BotService}=require('../src/bot/service.cjs'),{AccountManager}=require('../src/bot/account-manager.cjs');
const {MessengerClient}=require('../src/bot/messenger.cjs'),Policy=require('../src/bot/messenger-channel-policy.cjs');
const APP='810000000000000001',PAGE='820000000000000001',OWNER='830000000000000001',ORIGIN='https://synthetic-relay.invalid';
const vault={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()};
const until=async predicate=>{const end=Date.now()+6000;while(!predicate()&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert(predicate(),'Synthetic Messenger condition did not settle');};
const json=(value,status=200,headers={})=>new Response(JSON.stringify(value),{status,headers:{'content-type':'application/json',...headers}});
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-service-messenger-')),services=[],connections=[],active=new Set(),claims=[];let now=Date.now(),seq=0;
 const configure=(service,extra={})=>service.configure({mode:'api',channel:'messenger',workspace:root,key:'synthetic-provider-key',messengerAppId:APP,messengerPageId:PAGE,messengerOwnerId:OWNER,messengerRelayOrigin:ORIGIN,messengerPageAccessToken:'synthetic-page-token',messengerRelayToken:'synthetic-relay-token-32-chars-long',...extra});
 function make({execute=async()=>({outcome:'reply_ended',text:'Synthetic response'}),clientPatch=()=>{},journalFactory}={}){
  let service;
  service=new BotService({root,vault,runnerFactory:()=>execute,...(journalFactory?{journalFactory}:{}),claimIdentity:value=>{const key=JSON.stringify(value);if(active.has(key))throw Object.assign(Error('duplicate'),{code:'account_in_use'});active.add(key);claims.push(value);return()=>active.delete(key);},
   messengerClientFactory:options=>{
    const c={options,session:randomUUID(),me:options.pageId,queue:[],waiting:null,sends:[],acks:[],reads:0,events:[],closed:false};connections.push(c);
    c.push=items=>{if(c.waiting){const done=c.waiting;c.waiting=null;done(items);}else c.queue.push(items);};
    c.message=(text,extra={})=>({id:`synthetic-mid-${++seq}`,from:options.ownerId,text,createdAt:now,...extra});
    c.emit=(text,extra)=>{const message=c.message(text,extra);c.push([message]);return message.id;};
    const fetchImpl=async (url,init)=>{
     const u=new URL(url);assert(['graph.facebook.com','synthetic-relay.invalid'].includes(u.hostname),'No external transport allowed');
     if(u.pathname.endsWith('/me')){if(c.meFailure)return json({},c.meFailure,{'retry-after':'60'});return json({id:c.me});}
     if(u.pathname==='/v1/status')return json({schema:'messenger_relay_v1',appId:options.appId,pageId:options.pageId,ownerId:options.ownerId,sessionId:c.session});
     if(u.pathname==='/v1/pull'){
      c.reads++;let items=c.queue.shift();if(items===undefined)items=await new Promise((resolve,reject)=>{const abort=()=>{c.waiting=null;reject(Error('synthetic aborted'));};if(init.signal.aborted)return abort();init.signal.addEventListener('abort',abort,{once:true});c.waiting=value=>{init.signal.removeEventListener('abort',abort);resolve(value);};});
      if(typeof items==='number')return json({},items,{'retry-after':'60'});
      c.batch=items;c.deliveryId=items.length?randomUUID():null;return json({sessionId:c.session,deliveryId:c.deliveryId,items,expiresAt:now+30000});
     }
     if(u.pathname==='/v1/ack'){
      const body=JSON.parse(init.body);c.acks.push(body.ids);c.events.push('ack');
      // Every raw MID already has a hashed committed row when HTTP ACK begins.
      const namespace=Policy.namespace(options.appId,options.pageId,options.ownerId);
      for(const id of body.ids)assert(service.journal.withDb(db=>db.prepare('SELECT 1 FROM inbound WHERE id=?').get(service.journal.key(namespace,Policy.messageKey(id)))));
      if(c.ackHold)await c.ackHold;if(c.ackUnknown)throw Error('synthetic private network detail');
      return json({acknowledged:true,sessionId:c.session,deliveryId:body.deliveryId});
     }
     if(u.pathname.endsWith('/messages')){const body=JSON.parse(init.body);assert.equal(body.recipient.id,options.ownerId);assert.equal(body.messaging_type,'RESPONSE');c.sends.push(body.message.text);if(c.sendUnknown)throw Error('synthetic private network detail');if(c.sendHold)await c.sendHold;return json({recipient_id:options.ownerId,message_id:`synthetic-out-${++seq}`});}
     throw Error('Unexpected fixture endpoint');
    };
    const client=new MessengerClient({...options,fetchImpl,now:()=>now});const get=client.getUpdates.bind(client),close=client.close.bind(client);
    client.getUpdates=(cursor,signal)=>{now+=5001;return get(cursor,signal);};client.close=()=>{c.closed=true;close();};c.client=client;clientPatch(c,client);return client;
   }});services.push(service);return service;
 }
 t.after(async()=>{for(const s of services.reverse())await s.disconnect();assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
 return {root,make,configure,connections,claims,active};
}

test('Messenger configuration uses separate vault slots, exact bindings and no network on save/resume',async t=>{
 const f=fixture(t),s=f.make();f.configure(s);s.persist({...s.secret,xAccessToken:'synthetic-X-token',feishuAppSecret:'synthetic-feishu-secret'});
 assert.equal(s.snapshot().paired,true);assert.equal(s.snapshot().messenger.hasPageToken,true);assert.equal(s.snapshot().messenger.hasRelayToken,true);assert.equal(s.snapshot().social.supported,false);
 const snapshot=JSON.stringify(s.snapshot()),config=fs.readFileSync(path.join(f.root,'bot-config.json'),'utf8');for(const value of ['synthetic-page-token','synthetic-relay-token-32-chars-long','synthetic-X-token']){assert(!snapshot.includes(value));assert(!config.includes(value));}
 const before=fs.readFileSync(s.file);
 for(const bad of [12,'01','0','1'.repeat(21)])assert.throws(()=>s.configure({messengerPageId:bad}),/decimal/);
 for(const bad of ['http://local.invalid','https://relay.invalid/path','https://user:pass@relay.invalid','https://relay.invalid/?token=secret'])assert.throws(()=>s.configure({messengerRelayOrigin:bad}),/HTTPS/);
 assert.throws(()=>s.configure({messengerPageId:'820000000000000002'}),/new Page token/);assert.throws(()=>s.configure({messengerOwnerId:'830000000000000002'}),/new relay token/);
 assert.throws(()=>s.configure({messengerOptedOut:false}),/explicit local/);assert.throws(()=>s.configure({messengerResume:false}),/explicitly/);assert.throws(()=>s.configure({mode:'native'}),/does not support/);
 assert.throws(()=>s.configure({messengerPageAccessToken:''}),/Page.*token/);assert.deepEqual(fs.readFileSync(s.file),before);
 s.configure({messengerResume:true});assert.equal(f.connections.length,0);assert.equal(s.secret.xAccessToken,'synthetic-X-token');await assert.rejects(s.login(),/personal Facebook login/);
});

test('locked Messenger vault cannot be replaced and missing project does not use WeChat instructions',async t=>{
 const f=fixture(t),s=f.make();f.configure(s);const before=fs.readFileSync(s.file);s.lockCredentials();assert.throws(()=>s.configure({messengerPageAccessToken:'synthetic-new-page-token'}),{code:'credentials_locked'});await assert.rejects(s.connect(),{code:'credentials_locked'});assert.deepEqual(fs.readFileSync(s.file),before);
 const re=f.make();delete re.config.workspace;await assert.rejects(re.connect(),/Messenger Page/);assert.equal(f.connections.length,0);
});

test('real client/service claims the whole batch before ACK, then only direct owner approval writes a temp file',async t=>{
 const f=fixture(t),file=path.join(f.root,'approved.txt'),calls=[];let decision;
 const s=f.make({execute:async({prompt,request})=>{calls.push(prompt);decision=await request({kind:'permission',tool:'Write',input:{file_path:file,content:'Synthetic approved bytes'}});if(decision.allow)fs.writeFileSync(file,'Synthetic approved bytes');return {outcome:'reply_ended',text:'Synthetic result'};}});
 f.configure(s);await s.connect();const c=f.connections[0];c.emit('write this',{id:'m'.repeat(512)});await until(()=>s.dispatcher.pending.size===1);const code=s.dispatcher.snapshot().pending[0].code;
 c.emit(`/allow ${code}`,{quote:{id:null,title:'Messenger referenced content (not fetched)',text:''}});await until(()=>s.incomingCount===2);assert.equal(s.dispatcher.pending.size,1);assert.equal(fs.existsSync(file),false);
 c.emit(`/allow ${code}`);await until(()=>fs.existsSync(file));await s.dispatcher.whenIdle();assert.equal(decision.allow,true);assert.equal(calls.length,1);assert.equal(c.acks.length,3);assert.equal(s.socialScope,null);assert.deepEqual(f.claims,[{channel:'messenger',accountId:PAGE}]);
 assert(!JSON.stringify(s.snapshot().recovery).includes('m'.repeat(512)));
});

test('unknown ACK leaves all durable claims without dispatch; token replacement cannot replay them',async t=>{
 const f=fixture(t),runs=[];let s=f.make({execute:async({prompt})=>{runs.push(prompt);return {outcome:'reply_ended',text:'done'};},clientPatch:c=>{c.ackUnknown=true;}});f.configure(s);await s.connect();const c=f.connections[0];c.push([c.message('first',{id:'old-first'}),c.message('second',{id:'old-second'})]);await until(()=>s.status==='disconnected');assert.equal(runs.length,0);assert.equal(c.acks.length,1);assert.equal(c.sends.length,0);assert.equal(s.snapshot().recovery.recent.length,2);assert.equal(s.snapshot().messenger.check.code,'ack_unknown');
 s=f.make({execute:async({prompt})=>{runs.push(prompt);return {outcome:'reply_ended',text:'done'};}});s.configure({messengerPageAccessToken:'synthetic-rotated-token'});await s.connect();const next=f.connections.at(-1);next.push([next.message('must not replay',{id:'old-first'}),next.message('new')]);await until(()=>runs.length===1);assert.deepEqual(runs,['new']);assert.equal(next.acks[0].length,2);
});

test('failed durable batch and account change stop before ACK or any model work',async t=>{
 for(const kind of ['storage','wrong-owner']){
  const f=fixture(t);let runs=0;const s=f.make({execute:async()=>{runs++;return {outcome:'reply_ended',text:'never'};}});f.configure(s);await s.connect();const c=f.connections[0];
  if(kind==='storage')s.journal.claimBatch=()=>{throw Object.assign(Error('private storage detail'),{code:'journal_unavailable'});};
  c.emit('never',kind==='wrong-owner'?{from:'830000000000000002'}:{});await until(()=>s.status==='disconnected');assert.equal(c.acks.length,0);assert.equal(runs,0);assert.equal(c.closed,true);assert(!s.problem.includes('private storage detail'));
 }
});

test('disconnect during ACK cannot hand its batch to a later generation',async t=>{
 const f=fixture(t);let release,runs=0;const s=f.make({execute:async()=>{runs++;return {outcome:'reply_ended',text:'never'};},clientPatch:c=>{c.ackHold=new Promise(r=>release=r);}});f.configure(s);await s.connect();const c=f.connections[0];c.emit('never');await until(()=>c.acks.length===1);const closing=s.disconnect();release();await closing;await s.loop;assert.equal(runs,0);assert.equal(c.sends.length,0);assert.equal(s.status,'disconnected');
});

test('direct unsubscribe takes priority within a batch, persists independently and local resume never connects',async t=>{
 const f=fixture(t);let runs=0;const s=f.make({execute:async()=>{runs++;return {outcome:'reply_ended',text:'never'};}});f.configure(s);await s.connect();const c=f.connections[0];c.push([c.message('do not start'),c.message(' \n/unsubscribe\t')]);await until(()=>s.status==='disconnected');assert.equal(runs,0);assert.equal(c.sends.length,0);assert.equal(s.snapshot().messenger.optedOut,true);assert.equal(s.config.xOptedOut,undefined);
 const re=f.make();await assert.rejects(re.connect(),/resume/);re.configure({messengerOwnerId:'830000000000000002',messengerRelayToken:'synthetic-other-relay-token-32-chars'});assert.equal(re.snapshot().messenger.optedOut,true);re.configure({messengerResume:true});assert.equal(re.snapshot().messenger.optedOut,false);assert.equal(f.connections.length,1);
});

test('quoted and mixed unsubscribe never stop reception or grant file permission',async t=>{
 const f=fixture(t);let runs=0;const s=f.make({execute:async()=>{runs++;return {outcome:'reply_ended',text:'never'};}});f.configure(s);await s.connect();const c=f.connections[0];c.push([c.message('/unsubscribe',{quote:{id:null,title:'Messenger referenced content (not fetched)',text:''}}),c.message('',{unsupported:'messenger_nontext'})]);await until(()=>s.incomingCount===2);assert.equal(s.config.messengerOptedOut,undefined);assert.equal(runs,0);assert.equal(s.status,'connected');assert.equal(c.sends.length,2);
});

for(const stage of ['result','approval','cancel','rejection'])test(`unknown Messenger ${stage} stops once with a durable unknown and no status replay`,async t=>{
 const f=fixture(t);let decision;const s=f.make({execute:stage==='result'||stage==='rejection'?async()=>({outcome:'reply_ended',text:'Synthetic result'}):async({request})=>{decision=await request({kind:'permission',tool:'Write',input:{file_path:path.join(f.root,'never.txt'),content:'never'}});return {outcome:'reply_ended',text:'never'};}});
 f.configure(s);await s.connect();const c=f.connections[0];if(stage!=='cancel')c.sendUnknown=true;c.emit(stage==='rejection'?'/unsubscribe':'hello',stage==='rejection'?{quote:{id:null,title:'Messenger referenced content (not fetched)',text:''}}:{});
 if(stage==='cancel'){await until(()=>s.dispatcher.pending.size===1&&c.sends.length>0);c.sendUnknown=true;c.emit('/cancel');}
 await until(()=>s.status==='disconnected');await s.dispatcher.whenIdle();const count=c.sends.length;await s.dispatcher.receive({id:'new-status',text:'/status',contextToken:c.client.contextToken});assert.equal(c.sends.length,count);assert.equal(s.snapshot().messenger.check.code,'send_unknown');assert.equal(s.snapshot().recovery.channelDelivery.filter(row=>row.state==='unknown').length,1);assert.equal(s.outgoingAccepted,stage==='cancel'?1:0);if(['approval','cancel'].includes(stage))assert.equal(decision.allow,false);assert(!JSON.stringify(s.snapshot()).includes('private network detail'));
});

test('startup rate limit is disconnected/manual; polling rate limit holds only the captured cancellable connection',async t=>{
 let f=fixture(t),s=f.make({clientPatch:c=>{c.meFailure=429;}});f.configure(s);await s.connect();assert.equal(s.status,'disconnected');assert.equal(s.snapshot().messenger.check.state,'failed');assert.match(s.problem,/手动连接/);assert.equal(f.connections[0].reads,0);
 f=fixture(t);s=f.make();f.configure(s);await s.connect();const c=f.connections[0];c.push(429);await until(()=>s.snapshot().messenger.check?.state==='rate_limited');assert.equal(f.active.size,1);assert.equal(c.reads,1);await s.disconnect();await s.loop;assert.equal(c.closed,true);assert.equal(f.active.size,0);
});

test('closed response window records unsubmitted without disconnect or automatic resend',async t=>{
 const f=fixture(t);let finish;const s=f.make({execute:async()=>{await new Promise(r=>finish=r);return {outcome:'reply_ended',text:'late'};}});f.configure(s);await s.connect();const c=f.connections[0];c.emit('hello');await until(()=>typeof finish==='function');c.client.windowUntil=0;finish();await until(()=>s.snapshot().recovery.channelDelivery.length===1);assert.equal(s.snapshot().recovery.channelDelivery[0].state,'not_submitted');assert.equal(c.sends.length,0);assert.equal(s.status,'connected');assert.match(s.inputProblem,/时间窗口/);
});

test('Page claims are unique across Apps/profiles and journal scope separates App/Page/owner',async t=>{
 const f=fixture(t),manager=new AccountManager({root:f.root,vault});t.after(()=>manager.close());const a=manager.current(),b=manager.add({name:'Synthetic Page profile'}),second=manager.selectedId;f.configure(a);f.configure(b,{messengerAppId:'810000000000000002'});
 const release=manager.claim('primary',{channel:'messenger',accountId:PAGE});assert.throws(()=>manager.claim(second,{channel:'messenger',accountId:PAGE}),{code:'account_in_use'});assert.throws(()=>manager.claim(second,{channel:'messenger',accountId:'820000000000000002'}),{code:'page_changed'});release();manager.claim(second,{channel:'messenger',accountId:PAGE})();
 const scopes=new Set([Policy.namespace(APP,PAGE,OWNER),Policy.namespace('810000000000000002',PAGE,OWNER),Policy.namespace(APP,'820000000000000002',OWNER),Policy.namespace(APP,PAGE,'830000000000000002')]);assert.equal(scopes.size,4);
});

test('new direct opt-out stops a held older model before any ACK wait or late send',async t=>{
 const f=fixture(t);let release;const s=f.make({execute:async()=>{await new Promise(r=>release=r);return {outcome:'reply_ended',text:'must not be sent'};}});f.configure(s);await s.connect();const c=f.connections[0];c.emit('held work');await until(()=>typeof release==='function');const sent=c.sends.length;
 c.ackHold=new Promise(()=>{});c.ackUnknown=true;c.emit('/unsubscribe');await until(()=>s.config.messengerOptedOut===true&&c.closed);assert.equal(c.acks.length,1,'No ACK was attempted for opt-out');assert.equal(s.snapshot().messenger.check.code,'unsubscribed');
 release();await until(()=>s.status==='disconnected');assert.equal(c.sends.length,sent);assert.equal(JSON.parse(fs.readFileSync(path.join(f.root,'bot-config.json'),'utf8')).messengerOptedOut,true);assert(!s.snapshot().recovery.channelDelivery.some(row=>row.state==='unknown'));
});

test('failed opt-out persistence stops this connection without claiming restart persistence',async t=>{
 const f=fixture(t),s=f.make();f.configure(s);await s.connect();const c=f.connections[0],target=path.join(f.root,'bot-config.json'),rename=fs.renameSync;
 fs.renameSync=function(from,to,...rest){if(to===target)throw Object.assign(Error('synthetic config commit failure'),{code:'EIO'});return rename.call(this,from,to,...rest);};
 try{c.emit('/unsubscribe');await until(()=>s.status==='disconnected');}finally{fs.renameSync=rename;}
 assert.equal(c.closed,true);assert.equal(c.acks.length,0);assert.equal(c.sends.length,0);assert.equal(s.snapshot().messenger.optedOut,true);assert.equal(s.snapshot().messenger.check.code,'optout_save_failed');assert.match(s.problem,/未能保存/);assert.equal(JSON.parse(fs.readFileSync(target,'utf8')).messengerOptedOut,undefined);
});
