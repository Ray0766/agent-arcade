'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const official=require('@larksuiteoapi/node-sdk');
const {BotService}=require('../src/bot/service.cjs');
const {FeishuClient}=require('../src/bot/feishu.cjs');
const {createFeishuSDKTransport}=require('../src/bot/feishu-sdk.cjs');
const APP='cli_0123456789abcdef',OWNER='ou_owner_12345678',BOT='ou_bot_12345678',NOW=1793920000000;
const until=async predicate=>{const end=Date.now()+6000;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,10));assert(predicate(),'Synthetic service condition did not settle');};

// Real service, client, SDK HTTP/event adapters, Dispatcher and SQLite journal.
// Only the SDK network and model executor are synthetic; writes stay in temp.
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-service-feishu-')),services=[],connections=[],claims=[],active=new Set();
  const vault={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};
  function make({directory=root,bot=BOT,execute=async()=>({outcome:'reply_ended',text:'Synthetic response'})}={}){
    const service=new BotService({root:directory,vault,runnerFactory:()=>execute,
      claimIdentity:value=>{const key=JSON.stringify(value);if(active.has(key))throw Object.assign(Error('used'),{code:'account_in_use'});active.add(key);claims.push(value);return()=>active.delete(key);},
      feishuClientFactory:options=>{
        const connection={...options,bot,sends:[],closes:0,events:0};connections.push(connection);
        const sdk={...official,WSClient:class{
          constructor(options){this.options=options;connection.ws=this;}
          getConnectionStatus(){return {state:'connected'};}
          async start({eventDispatcher}){this.dispatcher=eventDispatcher;this.options.onReady();}
          close(options){assert.deepEqual(options,{force:true});connection.closes++;}
        },defaultHttpInstance:{request:async request=>{
          if(request.url.endsWith('/tenant_access_token/internal'))return {code:0,tenant_access_token:'synthetic-token',expire:3600};
          if(request.url.endsWith('/bot/v3/info'))return {code:0,bot:{open_id:connection.bot}};
          assert(request.url.endsWith('/im/v1/messages'));connection.sends.push(request.data);
          if(connection.sendFailure)throw Error('synthetic raw secret must not escape');
          return {code:0,data:{message_id:'om_receipt_'+String(connection.sends.length).padStart(8,'0')}};
        }}};
        connection.emit=async(id,text,change=()=>{})=>{
          const event={schema:'2.0',header:{event_id:'fixture_'+id,event_type:'im.message.receive_v1',app_id:options.appId,tenant_key:'tenant_fixture'},
            event:{sender:{sender_type:'user',sender_id:{open_id:options.ownerId}},message:{message_id:id,chat_id:'oc_private_12345678',chat_type:'p2p',message_type:'text',create_time:String(NOW),content:JSON.stringify({text})}}};
          change(event);await connection.ws.dispatcher.invoke(event,{needCheck:false});connection.events++;
        };
        connection.reconnect=()=>{connection.ws.options.onReconnecting();connection.ws.options.onReconnected();};
        return new FeishuClient({...options,now:()=>NOW,pollTimeoutMs:20,transportFactory:args=>createFeishuSDKTransport({...args,sdk})});
      }});
    services.push(service);return service;
  }
  function configure(service,extra={}){service.configure({mode:'api',channel:'feishu',workspace:root,key:'synthetic-provider-key',feishuAppId:APP,feishuOwnerId:OWNER,feishuAppSecret:'synthetic-app-secret',...extra});}
  t.after(async()=>{for(const service of services.reverse())await service.disconnect();assert(root.startsWith(os.tmpdir()));fs.rmSync(root,{recursive:true,force:true});});
  return {root,make,configure,connections,claims,active};
}

test('Feishu service requires exact owner approval before a real temp-file write; quotes and denial cannot authorize',async t=>{
  const f=fixture(t),file=path.join(f.root,'approved.txt'),denied=path.join(f.root,'denied.txt'),decisions=[],prompts=[];
  const service=f.make({execute:async({prompt,request})=>{prompts.push(prompt);const target=prompt==='deny this write'?denied:file;
    const result=await request({kind:'permission',tool:'Write',input:{file_path:target,content:'approved synthetic bytes'}});decisions.push(result);
    if(result.allow)fs.writeFileSync(target,'approved synthetic bytes');return {outcome:'reply_ended',text:'Synthetic permission result'};}});
  f.configure(service);await service.connect();const c=f.connections.at(-1);
  await c.emit('om_write_task_0001','write this file');await until(()=>service.dispatcher.pending.size===1);
  const code=service.dispatcher.snapshot().pending[0].code;
  await c.emit('om_wrong_owner_001',`/allow ${code}`,event=>event.event.sender.sender_id.open_id='ou_foreign_12345678');
  await c.emit('om_quote_allow_001',`/allow ${code}`,event=>event.event.message.parent_id='om_prior_message_001');
  await until(()=>service.incomingCount===2);assert.equal(fs.existsSync(file),false);assert.equal(service.dispatcher.pending.size,1);
  assert.equal(prompts.length,1);assert(c.sends.some(send=>JSON.parse(send.content).text.includes('不会执行控制或授权')));
  await c.emit('om_exact_allow_001',`/allow ${code}`);await until(()=>fs.existsSync(file));await service.dispatcher.whenIdle();
  assert.equal(fs.readFileSync(file,'utf8'),'approved synthetic bytes');assert.deepEqual(decisions,[{allow:true}]);
  await c.emit('om_deny_task_00001','deny this write');await until(()=>service.dispatcher.pending.size===1);
  await c.emit('om_exact_deny_0001',`/deny ${service.dispatcher.snapshot().pending[0].code}`);await until(()=>decisions.length===2);await service.dispatcher.whenIdle();
  assert.equal(decisions[1].allow,false);assert.equal(fs.existsSync(denied),false);assert.equal(prompts.length,2);
  assert(c.sends.every(send=>send.receive_id===OWNER&&send.msg_type==='text'));
  assert.equal(service.socialScope,null);assert.equal(service.snapshot().recovery.storage,'sqlite');
});

test('durable Feishu dedup survives service recreation and separates application, actual bot and owner',async t=>{
  const f=fixture(t),runs=[];const make=bot=>f.make({bot,execute:async({prompt})=>{runs.push(prompt);return {outcome:'reply_ended',text:'Synthetic reply'};}});
  let service=make(BOT);f.configure(service);await service.connect();await f.connections.at(-1).emit('om_shared_message_01','first');await until(()=>runs.length===1);await service.disconnect();
  service=make(BOT);await service.connect();const c=f.connections.at(-1);
  await c.emit('om_shared_message_01','must not replay');await c.emit('om_restart_marker_01','restart marker');await until(()=>runs.includes('restart marker'));
  assert.deepEqual(runs,['first','restart marker']);await service.disconnect();
  for(const [extra,bot,label] of [
    [{feishuAppId:'cli_fedcba9876543210',feishuAppSecret:'synthetic-other-secret'},BOT,'other app'],
    [{feishuOwnerId:'ou_other_owner_12345'},BOT,'other owner'],
    [{},'ou_other_bot_123456','other bot']]){
    service=make(bot);service.configure(extra);await service.connect();await f.connections.at(-1).emit('om_shared_message_01',label);await until(()=>runs.includes(label));await service.disconnect();
  }
  assert.equal(runs.length,5);assert(f.claims.every(claim=>claim.channel==='feishu'&&claim.accountId.startsWith('cli_')));
});

test('same actual bot/app cannot connect twice; another app has an independent identity claim',async t=>{
  const f=fixture(t),a=f.make(),b=f.make({directory:path.join(f.root,'second')}),c=f.make({directory:path.join(f.root,'third')});
  f.configure(a);f.configure(b);f.configure(c,{feishuAppId:'cli_fedcba9876543210'});
  await a.connect();await b.connect();await c.connect();
  assert.equal(a.status,'connected');assert.equal(b.status,'disconnected');assert.match(b.problem,/already connected/);assert.equal(c.status,'connected');
  assert.equal(f.active.size,2);assert.equal(f.connections[1].closes,1);await a.disconnect();assert.equal(c.status,'connected');assert.equal(f.active.size,1);
});

test('explicit disconnect denies pending tools and ignores late events without reconnecting',async t=>{
  const f=fixture(t);let decision,runs=0;
  const service=f.make({execute:async({request})=>{runs++;decision=await request({kind:'permission',tool:'Write',input:{file_path:path.join(f.root,'never.txt'),content:'never'}});return {outcome:'reply_ended',text:'not sent after close'};}});
  f.configure(service);await service.connect();const c=f.connections.at(-1);await c.emit('om_waiting_task_001','ask permission');await until(()=>service.dispatcher.pending.size===1);
  await service.disconnect();const sends=c.sends.length;assert.equal(decision.allow,false);assert.equal(f.active.size,0);
  await c.emit('om_late_task_00001','late request');c.reconnect();await new Promise(setImmediate);
  assert.equal(runs,1);assert.equal(c.sends.length,sends);assert.equal(service.status,'disconnected');assert.equal(f.connections.length,1);
});

test('changed bot identity on SDK reconnect closes the service and revokes its pending permission',async t=>{
  const f=fixture(t);let decision;
  const service=f.make({execute:async({request})=>{decision=await request({kind:'permission',tool:'Write',input:{file_path:path.join(f.root,'never.txt'),content:'never'}});return {outcome:'reply_ended',text:'not sent'};}});
  f.configure(service);await service.connect();const c=f.connections.at(-1);await c.emit('om_identity_task_01','wait');await until(()=>service.dispatcher.pending.size===1);
  c.bot='ou_changed_bot_12345';c.reconnect();await until(()=>service.status==='disconnected');
  assert.equal(decision.allow,false);assert.match(service.problem,/身份已变化/);assert.equal(f.active.size,0);assert(c.closes>=1);
});

test('unknown Feishu send is not counted accepted or automatically retried by the service',async t=>{
  const f=fixture(t);let runs=0;const service=f.make({execute:async()=>{runs++;return {outcome:'reply_ended',text:'Synthetic reply'};}});
  f.configure(service);await service.connect();const c=f.connections.at(-1);c.sendFailure=true;
  await c.emit('om_unknown_send_01','hello');await until(()=>c.sends.length===1);await service.dispatcher.whenIdle();
  assert.equal(service.outgoingAccepted,0);assert.equal(runs,1);assert.equal(c.sends.length,1);assert.doesNotMatch(JSON.stringify(service.snapshot()),/synthetic raw secret/);
});
