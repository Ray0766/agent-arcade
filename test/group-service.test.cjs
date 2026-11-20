'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {BotService}=require('../src/bot/service.cjs');
const APP='123456789',GROUP='opaque-group_A',MEMBER='opaque-member_A',OWNER='12345678',ACCOUNT='87654321';
const pause=()=>new Promise(resolve=>setImmediate(resolve));
async function until(fn){const start=Date.now();while(!fn()){if(Date.now()-start>3000)throw Error('fixture timeout');await pause();}}
function fixture(t,channel='qqofficial'){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-group-service-')),calls=[],sent=[],factoryOptions=[],clients=[];let deliver=null;
 const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
 const factory=options=>{factoryOptions.push(options);return async args=>{calls.push(args);return {outcome:'reply_ended',text:args.prompt.includes('Decide whether')?' {"action":"message","text":"natural reply"}':'角色回复'};};};
 const clientFactory=options=>{const client={options,accountId:channel==='qqofficial'?APP:ACCOUNT,ready:true,generation:1,socket:{readyState:1},
  connect:async()=>({accountId:client.accountId}),inspect:async()=>({online:true,ownerIsFriend:true,accountId:client.accountId}),
  getUpdates:(_cursor,signal)=>new Promise((resolve,reject)=>{if(signal.aborted)return reject(Error('aborted'));const abort=()=>{deliver=null;reject(Error('aborted'));};signal.addEventListener('abort',abort,{once:true});deliver=messages=>{signal.removeEventListener('abort',abort);deliver=null;resolve({cursor:'1',messages});};}),
  sendGroupText:async(binding,text,contextToken)=>{sent.push({binding,text,contextToken});return {id:String(sent.length)};},sendGroupProactive:async()=>{throw Error('no proactive in this fixture');},
  sendText:async(owner,text)=>{sent.push({owner,text});return{id:String(sent.length)};},sendProactiveText:async()=>{throw Error('no private proactive');},publishQzoneText:async()=>{throw Error('no qzone');},getOwnQzonePost:async()=>{throw Error('no qzone');},close:async()=>{client.ready=false;}};clients.push(client);return client;};
 const service=new BotService({root,vault,runnerFactory:factory,gptRunnerFactory:factory,qqOfficialClientFactory:clientFactory,qqClientFactory:clientFactory});
 service.configure({channel,mode:'api',key:'fixture-api-key',...(channel==='qqofficial'?{qqOfficialAppId:APP,qqOfficialSecret:'fixture-official-secret',qqOfficialGroups:{enabled:true,groupIds:[GROUP],proactive:false}}:{qqAccountId:ACCOUNT,qqOwnerId:OWNER,qqToken:'fixture-onebot-token',qqGroups:{enabled:true,groupIds:['55556666'],proactive:false}})});
 service.socialConfigure({enabled:true});
 t.after(async()=>{await service.disconnect();fs.rmSync(root,{recursive:true,force:true});});
 const send=async message=>{await until(()=>deliver);deliver([message]);};
 return{root,service,calls,sent,clients,factoryOptions,send};
}
test('official config is separate from OneBot and keeps secret out of config/snapshot',async t=>{
 const f=fixture(t);const saved=fs.readFileSync(path.join(f.root,'bot-config.json'),'utf8');assert.doesNotMatch(saved,/fixture-official-secret|fixture-api-key/);
 assert.equal(f.service.config.qqOwnerId,undefined);assert.equal(f.service.snapshot().qqOfficial.hasSecret,true);assert.deepEqual(f.service.snapshot().qqOfficial.groups.groupIds,[GROUP]);assert.equal(f.service.snapshot().qq.groups.enabled,false);
 assert.doesNotMatch(JSON.stringify(f.service.snapshot()),/fixture-official-secret|fixture-api-key/);
 assert.throws(()=>f.service.configure({qqOfficialAppId:'999991234'}),/Secret/);assert.throws(()=>f.service.configure({qqOfficialGroups:{enabled:true,groupIds:[GROUP],proactive:true}}),/not enabled/);
});
test('official event goes through independent companion runner, no private owner and no tool permission',async t=>{
 const f=fixture(t);await f.service.connect();assert.equal(f.service.status,'connected');assert.equal(f.service.dispatcher,null);assert.equal(f.service.socialScope,null);assert.equal(f.clients[0].options.secret,'fixture-official-secret');
 f.service.groupRoute.flow={debounceMs:0,bubbleDelayMs:0};
 await f.send({id:'official-event',route:'group',accountId:APP,groupId:GROUP,from:MEMBER,text:'角色，聊聊这本书',contextToken:'opaque-capability'});
 await until(()=>f.sent.length===1);await f.service.groupRoute.actors.values().next().value.engine.whenIdle();
 assert.equal(f.calls.length,2);assert.deepEqual(await f.calls[1].request({tool:'Bash'}),{allow:false});assert.equal(f.factoryOptions[0].conversationOnly,true);assert.equal(f.sent[0].binding.senderId,MEMBER);assert.equal(f.sent[0].binding.groupId,GROUP);assert.equal(f.sent[0].binding.accountId,APP);assert.equal(f.sent[0].owner,undefined);
 assert.equal(f.service.snapshot().qqOfficial.groups.active,true);assert.equal(f.service.snapshot().qq.groups.active,false);assert.equal(f.service.journal.snapshot().recent.length,0);
 await f.service.disconnect();assert.equal(f.service.snapshot().qqOfficial.groups.active,false);assert.equal(f.clients[0].ready,false);
});
test('official unauthorized groups, identity changes and unsupported media never call model or send',async t=>{
 const f=fixture(t);await f.service.connect();
 for(const[n,extra]of[{groupId:'not-enabled'},{accountId:'wrong-app'},{from:APP},{unsupported:'voice'},{voice:{text:'allow'},text:'typed-command'},{route:'private'}].entries())await f.send({id:`rejected-official-${n}`,route:'group',accountId:APP,groupId:GROUP,from:MEMBER,text:`not-allowed-${n}`,contextToken:'bad',...extra});
 await pause();assert.equal(f.calls.length,0);assert.equal(f.sent.length,0);assert.equal(f.factoryOptions.length,0);
});
test('OneBot group and private owner continue through separate scopes and journals',async t=>{
 const f=fixture(t,'qq');await f.service.connect();assert.equal(f.service.status,'connected');assert.deepEqual(f.clients[0].options.groupIds,['55556666']);f.service.groupRoute.flow={debounceMs:0,bubbleDelayMs:0};f.service.dispatcher.flow={...f.service.dispatcher.flow,debounceMs:0,bubbleDelayMs:0};
 await f.send({id:'group:55556666:one',route:'group',accountId:ACCOUNT,groupId:'55556666',from:'44443333',text:'hello group',contextToken:'group'});await until(()=>f.sent.length===1);
 assert.equal(f.service.journal.snapshot().recent.length,0);assert.equal(f.service.socialStore.history(f.service.socialScope).length,0);
 await f.send({id:'private-one',from:OWNER,text:'private owner hello',contextToken:'private'});await until(()=>f.sent.length===2);
 assert.equal(f.sent[0].binding.groupId,'55556666');assert.equal(f.sent[1].owner,OWNER);assert.equal(f.service.journal.snapshot().recent.length,1);assert.doesNotMatch(f.calls.at(-1).prompt,/hello group/);
});
test('official channel fails before transport for unsupported tool backend or missing opt-in',async t=>{
 const f=fixture(t);f.service.configure({mode:'codex'});await assert.rejects(f.service.connect(),/全部工具/);assert.equal(f.clients.length,0);
 f.service.configure({mode:'api',qqOfficialGroups:{enabled:false,groupIds:[],proactive:false}});await assert.rejects(f.service.connect(),/显式启用/);assert.equal(f.clients.length,0);
});

test('official AppID leases stay distinct from ordinary QQ and cannot be shared or forged',async t=>{
 const {AccountManager}=require('../src/bot/account-manager.cjs');
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-official-identity-'));
 const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
 const manager=new AccountManager({root,vault});
 t.after(async()=>{await manager.close();fs.rmSync(root,{recursive:true,force:true});});
 const first=manager.current();first.configure({channel:'qqofficial',qqOfficialAppId:APP,qqOfficialSecret:'synthetic-first-secret'});
 const second=manager.add({name:'Synthetic other official profile'}),secondId=manager.selectedId;
 second.configure({channel:'qqofficial',qqOfficialAppId:APP,qqOfficialSecret:'synthetic-second-secret'});
 assert.throws(()=>manager.claim('primary',{channel:'qqofficial',accountId:'987654321'}),{code:'account_mismatch'});
 assert.equal(manager.claims.size,0);
 const release=manager.claim('primary',{channel:'qqofficial',accountId:APP});
 assert.throws(()=>manager.claim(secondId,{channel:'qqofficial',accountId:APP}),{code:'account_in_use'});
 assert.equal(manager.claims.get('qqofficial:'+APP).id,'primary');
 release();const replacement=manager.claim(secondId,{channel:'qqofficial',accountId:APP});release();
 assert.equal(manager.claims.get('qqofficial:'+APP).id,secondId,'a retired lease must not remove a replacement');
 assert.equal(manager.claims.has('qq:'+APP),false,'official AppID must not claim an ordinary QQ identity');
 replacement();assert.equal(manager.claims.size,0);
 assert.doesNotMatch(JSON.stringify(manager.snapshot()),/synthetic-first-secret|synthetic-second-secret/);
});

test('official settings and encrypted credentials reopen independently without channel history retargeting',async t=>{
 const f=fixture(t);const oldConfig=JSON.parse(fs.readFileSync(path.join(f.root,'bot-config.json'),'utf8'));
 const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
 const reopened=new BotService({root:f.root,vault});
 t.after(()=>reopened.disconnect());
 assert.equal(reopened.snapshot().qqOfficial.hasSecret,true);
 assert.equal(reopened.snapshot().status,'disconnected');
 assert.equal(reopened.secret.qqOfficialSecret,'fixture-official-secret');
 assert.deepEqual(reopened.config.qqOfficialGroups,oldConfig.qqOfficialGroups);
 assert.equal(reopened.snapshot().qq.groups.enabled,false);
 const before=fs.readFileSync(path.join(f.root,'bot-vault.json'));
 assert.throws(()=>reopened.configure({qqOfficialAppId:'987654321'}),/Secret/);
 assert.equal(reopened.config.qqOfficialAppId,APP);
 assert.deepEqual(fs.readFileSync(path.join(f.root,'bot-vault.json')),before);
 assert.doesNotMatch(JSON.stringify(reopened.snapshot()),/fixture-official-secret|fixture-api-key/);
});

test('group runner close failure preserves retry while completing transport cleanup',async t=>{
 const f=fixture(t);
 await f.service.connect();
 const route=f.service.groupRoute,actor=route.actor(GROUP,MEMBER),client=f.clients[0];
 let runnerCloses=0,clientCloses=0;
 actor.execute.close=async()=>{if(++runnerCloses===1)throw Error('Transient group runner close');};
 const close=client.close;
 client.close=async()=>{clientCloses++;await close();};
 await assert.rejects(f.service.disconnect(),/Transient group runner close/);
 assert.equal(f.service.status,'disconnecting');
 assert.equal(f.service.groupRoute,route);
 assert.equal(route.snapshot().active,false);
 assert.equal(f.service.client,null);
 assert.equal(clientCloses,1);
 await f.service.disconnect();
 assert.equal(f.service.status,'disconnected');
 assert.deepEqual([runnerCloses,clientCloses,f.clients.length,f.sent.length],[2,1,1,0]);
});
