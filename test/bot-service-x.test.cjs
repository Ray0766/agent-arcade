'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BotService}=require('../src/bot/service.cjs');
const {AccountManager}=require('../src/bot/account-manager.cjs');
const {XDirectMessageClient,XRateBudget,conversation}=require('../src/bot/x-dm.cjs');
const {XError}=require('../src/bot/x-transport.cjs');
const {sharedRateBudget}=require('../src/bot/x-channel-policy.cjs');
const SELF='910000000000000001',OWNER='920000000000000001';
const vault={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()};
const until=async predicate=>{const end=Date.now()+6000;while(!predicate()&&Date.now()<end)await new Promise(r=>setTimeout(r,10));assert(predicate(),'Synthetic X condition did not settle');};
const envelope=data=>({data,rate:{remaining:null,retryAt:null}});
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-service-x-')),services=[],connections=[],claims=[],active=new Set(),budgets=new Map();let now=Date.now(),seq=930000000000000000n;
  const budgetFor=id=>{if(!budgets.has(id))budgets.set(id,new XRateBudget({now:()=>now}));return budgets.get(id);};
  function make({directory=root,execute=async()=>({outcome:'reply_ended',text:'Synthetic answer'}),clientPatch=()=>{}}={}){
    const service=new BotService({root:directory,vault,runnerFactory:()=>execute,xRateBudgetFor:budgetFor,
      claimIdentity:value=>{const key=JSON.stringify(value);if(active.has(key))throw Object.assign(Error('duplicate'),{code:'account_in_use'});active.add(key);claims.push(value);return()=>active.delete(key);},
      xClientFactory:options=>{
        const c={options,me:options.expectedAccountId,sends:[],reads:0,identities:0,closed:false,queue:[],waiting:null};connections.push(c);
        c.push=value=>{if(c.waiting){const done=c.waiting;c.waiting=null;done(value);}else c.queue.push(value);};
        c.emit=(text,extra={})=>{const id=String(++seq);c.push([{id,event_type:'MessageCreate',sender_id:options.ownerId,dm_conversation_id:conversation(options.expectedAccountId,options.ownerId),created_at:new Date(now).toISOString(),text,...extra}]);return id;};
        const transport={
          async me({assertCurrent}){assertCurrent();c.identities++;if(c.meError)throw c.meError;return envelope({data:{id:c.me}});},
          async events({signal,assertCurrent}){c.reads++;let value=c.queue.shift();if(value===undefined)value=await new Promise((resolve,reject)=>{const abort=()=>{c.waiting=null;reject(new XError('aborted'));};if(signal.aborted)return abort();signal.addEventListener('abort',abort,{once:true});c.waiting=v=>{signal.removeEventListener('abort',abort);resolve(v);};});assertCurrent();if(value instanceof Error)throw value;return envelope({data:value,meta:{result_count:value.length}});},
          async sendText({text,assertCurrent}){assertCurrent();c.sends.push(text);if(c.sendFailure)throw new XError('send_unknown',{submitted:true});return envelope({data:{dm_event_id:String(++seq),dm_conversation_id:conversation(options.expectedAccountId,options.ownerId)}});},
          close(){c.closed=true;}
        };
        const client=new XDirectMessageClient({...options,now:()=>now,sleep:async(ms,signal)=>{if(signal.aborted)throw new XError('aborted');now+=ms;},transportFactory:()=>transport});c.client=client;clientPatch(c,client);return client;
      }});services.push(service);return service;
  }
  function configure(service,extra={}){service.configure({mode:'api',channel:'x',workspace:root,key:'synthetic-provider-key',xAccountId:SELF,xOwnerId:OWNER,xAccessToken:'synthetic-user-access-token',...extra});}
  t.after(async()=>{for(const service of services.reverse()){await service.disconnect();service.journal.close?.();service.socialStore.close?.();}assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  return {root,make,configure,connections,claims,active,budgets};
}

test('X service uses a distinct encrypted slot, strict IDs and no network on save/resume',async t=>{
  const f=fixture(t),s=f.make();f.configure(s);s.configure({mode:'gemini',key:'synthetic-gemini-key'});
  assert.equal(s.secret.xAccessToken,'synthetic-user-access-token');assert.equal(s.secret.geminiKey,'synthetic-gemini-key');
  assert.equal(s.snapshot().paired,true);assert.equal(s.snapshot().x.hasToken,true);assert(!JSON.stringify(s.snapshot()).includes('synthetic-user-access-token'));
  assert(!fs.readFileSync(path.join(f.root,'bot-config.json'),'utf8').includes('synthetic-user-access-token'));
  const before=fs.readFileSync(s.file);
  for(const value of [42,'001','0','1'.repeat(20)])assert.throws(()=>s.configure({xAccountId:value}),/decimal/);
  assert.throws(()=>s.configure({xOwnerId:SELF}),/differ/);assert.throws(()=>s.configure({xAccountId:'12345'}),/new user token/);
  assert.throws(()=>s.configure({xAccessToken:'bad token'}),/access token/);assert.throws(()=>s.configure({mode:'native'}),/does not support/);
  assert.throws(()=>s.configure({xOptedOut:false}),/explicit local/);assert.throws(()=>s.configure({xResume:false}),/explicitly/);
  assert.deepEqual(fs.readFileSync(s.file),before);s.configure({xResume:true});assert.equal(f.connections.length,0);await assert.rejects(s.login(),/does not perform OAuth/);
});

test('locked X credentials cannot be replaced or connected and unrelated credentials are retained',async t=>{
  const f=fixture(t),s=f.make();f.configure(s);s.persist({...s.secret,qqToken:'synthetic-qq-token-123',feishuAppSecret:'synthetic-feishu-secret'});const before=fs.readFileSync(s.file);
  s.lockCredentials();assert.throws(()=>s.configure({xAccessToken:'synthetic-replacement-token'}),{code:'credentials_locked'});await assert.rejects(s.connect(),{code:'credentials_locked'});assert.deepEqual(fs.readFileSync(s.file),before);
  const reopened=f.make();assert.equal(reopened.secret.qqToken,'synthetic-qq-token-123');assert.equal(reopened.secret.feishuAppSecret,'synthetic-feishu-secret');assert.equal(f.connections.length,0);
});

test('real service/client/Dispatcher/journal allow only direct owner approval before an exact temp-file write',async t=>{
  const f=fixture(t),file=path.join(f.root,'approved.txt'),decisions=[],prompts=[];
  const s=f.make({execute:async({prompt,request})=>{prompts.push(prompt);const result=await request({kind:'permission',tool:'Write',input:{file_path:file,content:'Synthetic approved bytes'}});decisions.push(result);if(result.allow)fs.writeFileSync(file,'Synthetic approved bytes');return {outcome:'reply_ended',text:'Synthetic result'};}});
  f.configure(s);await s.connect();const c=f.connections.at(-1);c.emit('write this');await until(()=>s.dispatcher.pending.size===1);const code=s.dispatcher.snapshot().pending[0].code;
  c.emit(`/allow ${code}`,{quote:{id:'123'}});await until(()=>s.incomingCount===2);assert.equal(fs.existsSync(file),false);assert.equal(s.dispatcher.pending.size,1);
  c.emit(`/allow ${code}`);await until(()=>fs.existsSync(file));await s.dispatcher.whenIdle();assert.equal(fs.readFileSync(file,'utf8'),'Synthetic approved bytes');assert.deepEqual(decisions,[{allow:true}]);assert.equal(prompts.length,1);assert.equal(s.socialScope,null);assert.deepEqual(f.claims,[{channel:'x',accountId:SELF}]);
});

test('direct unsubscribe cancels a pending tool, persists across restart, and explicit local resume never connects',async t=>{
  const f=fixture(t);let decision;const s=f.make({execute:async({request})=>{decision=await request({kind:'permission',tool:'Write',input:{file_path:path.join(f.root,'never.txt'),content:'never'}});return {outcome:'reply_ended',text:'must not send'};}});
  f.configure(s);await s.connect();const c=f.connections.at(-1);c.emit('request');await until(()=>s.dispatcher.pending.size===1);
  c.emit('/unsubscribe',{quote:{id:'456'}});await until(()=>s.incomingCount===2);assert.equal(s.config.xOptedOut,undefined);
  c.emit('/unsubscribe',{attachments:{media_keys:['synthetic']}});await until(()=>s.incomingCount===3);assert.equal(s.config.xOptedOut,undefined);
  const sends=c.sends.length;c.emit(' \n/unsubscribe\t');await until(()=>s.status==='disconnected');assert.equal(decision.allow,false);assert.equal(c.sends.length,sends);assert.equal(s.snapshot().x.optedOut,true);assert.equal(f.active.size,0);
  const re=f.make();await assert.rejects(re.connect(),/resume/);assert.equal(f.connections.length,1);
  re.configure({xOwnerId:'920000000000000002'});assert.equal(re.snapshot().x.optedOut,true);re.configure({xResume:true});assert.equal(re.snapshot().x.optedOut,false);assert.equal(f.connections.length,1);
});

test('rate-limited poll holds the exact connection until retryAt and explicit disconnect aborts that wait',async t=>{
  const f=fixture(t),s=f.make();f.configure(s);await s.connect();const c=f.connections.at(-1);const retryAt=Date.now()+60000;c.push(new XError('rate_limited',{retryAt}));await until(()=>s.snapshot().x.check?.state==='rate_limited');
  assert.equal(s.snapshot().x.check.retryAt,retryAt);const calls=c.identities;await new Promise(r=>setTimeout(r,40));assert.equal(c.identities,calls);assert.equal(c.reads,1);assert.equal(f.active.size,1);
  await s.disconnect();await s.loop;assert.equal(s.status,'disconnected');assert.equal(c.closed,true);assert.equal(f.active.size,0);assert.equal(f.connections.length,1);
});

test('startup rate limit returns disconnected with manual-retry text, without starting a poll',async t=>{
  const retryAt=Date.now()+60000,f=fixture(t),s=f.make({clientPatch:c=>{c.meError=new XError('rate_limited',{retryAt});}});f.configure(s);await s.connect();const c=f.connections[0];
  assert.equal(s.status,'disconnected');assert.equal(s.snapshot().x.check.state,'failed');assert.equal(s.snapshot().x.check.retryAt,retryAt);assert.match(s.problem,/手动连接/);assert.equal(c.reads,0);assert.equal(c.closed,true);
});

test('write-budget refusal is durably not_submitted and does not claim the poll is waiting',async t=>{
  const f=fixture(t),s=f.make();f.configure(s);await s.connect();const c=f.connections[0];c.client.rateBudget.block('write',Date.now()+60000);c.emit('hello');await until(()=>s.snapshot().recovery.channelDelivery.some(row=>row.state==='not_submitted'));
  assert.equal(c.sends.length,0);assert.equal(s.status,'connected');assert.equal(s.snapshot().x.check.state,'verified');assert.match(s.inputProblem,/未提交/);assert.equal(s.outgoingAccepted,0);
});

test('fatal X permissions, credits, identity, format and backlog errors stop with fixed text, no reconnect',async t=>{
  for(const code of ['requires_reauthorization','permission_denied','credits_required','account_changed','invalid_response','backlog_limit','seen_limit']){
    const f=fixture(t),s=f.make();f.configure(s);await s.connect();const c=f.connections.at(-1);c.push(Object.assign(Error('secret raw response must not escape'),{code}));await until(()=>s.status==='disconnected');assert.equal(s.snapshot().x.check.code,code);assert.equal(f.connections.length,1);assert(!JSON.stringify(s.snapshot()).includes('secret raw response'));assert.equal(c.closed,true);
  }
});

for(const stage of ['result','approval','cancel'])test(`unknown X ${stage} send stops the dispatcher without self-deadlock or status replay`,async t=>{
  const f=fixture(t);let decision;const s=f.make({execute:stage==='result'?async()=>({outcome:'reply_ended',text:'Synthetic final'}):async({request})=>{decision=await request({kind:'permission',tool:'Write',input:{file_path:path.join(f.root,'never.txt'),content:'never'}});return {outcome:'reply_ended',text:'must not resend'};}});
  f.configure(s);await s.connect();const c=f.connections.at(-1);if(stage!=='cancel')c.sendFailure=true;c.emit('hello');
  if(stage==='cancel'){await until(()=>s.dispatcher.pending.size===1);await until(()=>c.sends.length>0);c.sendFailure=true;c.emit('/cancel');}
  await until(()=>s.status==='disconnected');await s.dispatcher.whenIdle();const count=c.sends.length;await s.dispatcher.receive({id:'999',text:'/status',contextToken:c.client.contextToken});assert.equal(c.sends.length,count);assert.equal(s.snapshot().x.check.code,'send_unknown');assert.equal(s.outgoingAccepted,stage==='cancel'?1:0);if(stage!=='result')assert.equal(decision.allow,false);assert.equal(f.connections.length,1);
  const deliveries=s.snapshot().recovery.channelDelivery;assert.equal(deliveries.filter(row=>row.state==='unknown').length,1);assert.equal(deliveries.filter(row=>row.state==='accepted').length,stage==='cancel'?1:0);assert(!JSON.stringify(deliveries).includes(OWNER));
});

test('unknown quoted-control rejection is journaled once and cannot dispatch or replay',async t=>{
  const f=fixture(t);let models=0;const s=f.make({execute:async()=>{models++;return {outcome:'reply_ended',text:'never'};}});f.configure(s);await s.connect();const c=f.connections[0];c.sendFailure=true;
  c.emit('/unsubscribe',{quote:{id:'123'}});await until(()=>s.status==='disconnected');assert.equal(models,0);assert.equal(c.sends.length,1);assert.equal(s.snapshot().x.optedOut,false);assert.equal(s.outgoingAccepted,0);assert.deepEqual(s.snapshot().recovery.channelDelivery.map(row=>row.state),['unknown']);assert.equal(s.snapshot().recovery.recent[0].state,'rejected');
});

test('durable dedup survives token replacement and changes only with actual self or owner',async t=>{
  const f=fixture(t),runs=[],id='930000000000001111';const make=()=>f.make({execute:async({prompt})=>{runs.push(prompt);return {outcome:'reply_ended',text:'done'};}});
  let s=make();f.configure(s);await s.connect();f.connections.at(-1).emit('first',{id});await until(()=>runs.length===1);await s.disconnect();
  s=make();s.configure({xAccessToken:'synthetic-new-user-token'});await s.connect();const c=f.connections.at(-1);c.emit('must not replay',{id});c.emit('marker');await until(()=>runs.includes('marker'));assert.deepEqual(runs,['first','marker']);await s.disconnect();
  s=make();s.configure({xOwnerId:'920000000000000003'});await s.connect();f.connections.at(-1).emit('other owner',{id});await until(()=>runs.includes('other owner'));assert.equal(runs.length,3);
});

test('shared budget and AccountManager claim keep one actual X identity across profiles',async t=>{
  const f=fixture(t),manager=new AccountManager({root:f.root,vault,serviceFactory:options=>new BotService(options)});t.after(()=>manager.close());
  const a=manager.current(),b=manager.add({name:'Synthetic second'});f.configure(a);f.configure(b);const idB=manager.selectedId;
  assert.equal(a.xRateBudgetFor(SELF),b.xRateBudgetFor(SELF));assert.equal(sharedRateBudget(SELF),a.xRateBudgetFor(SELF));
  const release=manager.claim('primary',{channel:'x',accountId:SELF});assert.throws(()=>manager.claim(idB,{channel:'x',accountId:SELF}),{code:'account_in_use'});assert.throws(()=>manager.claim(idB,{channel:'x',accountId:'12345'}),{code:'account_mismatch'});release();manager.claim(idB,{channel:'x',accountId:SELF})();assert.equal(manager.claims.size,0);
  const budget=sharedRateBudget(SELF);budget.block('read',Date.now()+60000);assert.throws(()=>b.xRateBudgetFor(SELF).quota('read'),{code:'rate_limited'});
});
