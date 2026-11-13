'use strict';
// Real local WebSocket/QQClient/BotService protocol checks. Accounts, login
// replies, vault and AI executor are synthetic; no Tencent/NapCat acceptance.
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {once}=require('node:events');
const {WebSocketServer}=require('ws');
const {QQClient}=require('../src/bot/qq.cjs');
const {BotService}=require('../src/bot/service.cjs');
const {scopeFor}=require('../src/bot/social-companion.cjs');
const OWNER='12345678',ACCOUNT='87654321',OTHER='76543210',TOKEN='synthetic-binding-test-token';
const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
async function until(predicate){const end=Date.now()+1500;while(!predicate()&&Date.now()<end)await new Promise(resolve=>setTimeout(resolve,5));assert(predicate(),'fixture state not reached');}
async function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-qq-binding-')),server=new WebSocketServer({host:'127.0.0.1',port:0});
  const state={account:ACCOUNT,actions:[],sockets:[],runners:0};const clients=[];let service;
  t.after(async()=>{await service?.disconnect();service?.journal.close?.();for(const client of clients)await client.close();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(root),os.tmpdir());assert.match(path.basename(root),/^arcade-qq-binding-/);fs.rmSync(root,{recursive:true,force:true});});
  server.on('connection',(socket,request)=>{
    assert.equal(request.headers.authorization,`Bearer ${TOKEN}`);state.sockets.push(socket);
    socket.on('message',raw=>{
      const message=JSON.parse(raw.toString());state.actions.push(message.action);let data;
      if(message.action==='get_login_info')data={user_id:Number(state.account),nickname:'Fixture'};
      else if(message.action==='get_status')data={online:true,good:true};
      else if(message.action==='get_friend_list')data=[{user_id:Number(OWNER)}];
      else assert.fail(`unexpected fixture action ${message.action}`);
      socket.send(JSON.stringify({status:'ok',retcode:0,echo:message.echo,data}));
    });
  });await once(server,'listening');
  const url=`ws://127.0.0.1:${server.address().port}/`;
  service=new BotService({root,vault,codexRunnerFactory:()=>{state.runners++;return async()=>({outcome:'reply_ended',text:'fixture'});}});
  service.configure({channel:'qq',mode:'codex',workspace:root,qqOwnerId:OWNER,qqAccountId:ACCOUNT,qqToken:TOKEN,qqUrl:url});
  return {root,state,service,client:(options={})=>{const client=new QQClient({url,token:TOKEN,ownerId:OWNER,expectedAccountId:ACCOUNT,pollTimeoutMs:5,...options});clients.push(client);return client;}};
}

test('account binding is validated, persisted and visible; changing it clears only active social scope',async t=>{
  const {root,service}=await fixture(t);assert.equal(service.snapshot().qq.expectedAccountId,ACCOUNT);
  const before=fs.readFileSync(path.join(root,'bot-config.json'),'utf8');
  for(const qqAccountId of ['',null,'wrong','1234','9007199254740992'])assert.throws(()=>service.configure({qqAccountId}),{code:'invalid_owner'});
  assert.throws(()=>service.configure({qqAccountId:OWNER}),/must differ/);assert.throws(()=>service.configure({qqOwnerId:ACCOUNT}),/must differ/);assert.equal(fs.readFileSync(path.join(root,'bot-config.json'),'utf8'),before);
  const scope=scopeFor(ACCOUNT,OWNER,'claude-ju');service.socialScope=scope;service.socialStore.append(scope,{id:'before',role:'user',text:'fixture-private-fact'});service.socialStore.configure({proactiveMessages:true,qzonePosts:true});service.qqCheck={state:'checked'};
  service.configure({qqAccountId:Number(OTHER)});assert.equal(service.snapshot().qq.expectedAccountId,OTHER);assert.equal(service.qqCheck,null);assert.equal(service.socialScope,null);assert.deepEqual(service.socialSnapshot().history,[]);assert.equal(service.socialSnapshot().config.proactiveMessages,false);assert.equal(service.socialSnapshot().config.qzonePosts,false);assert.equal(service.socialStore.history(scope)[0].text,'fixture-private-fact');
  const restored=new BotService({root,vault});assert.equal(restored.snapshot().qq.expectedAccountId,OTHER);restored.journal.close?.();restored.socialStore.close?.();
});

test('both setup test and task connection reject the wrong initial account before dispatch',async t=>{
  const {service,state}=await fixture(t);state.account=OTHER;
  const checked=await service.testQQ();assert.equal(checked.qq.check.code,'account_mismatch');assert.equal(checked.qq.check.state,'failed');assert.match(checked.problem,/绑定的账号不一致/);assert.equal(state.runners,0);assert.deepEqual(state.actions,['get_login_info']);
  state.actions.length=0;await service.connect();assert.equal(service.status,'disconnected');assert.equal(service.dispatcher,null);assert.equal(state.runners,0);assert.deepEqual(state.actions,['get_login_info']);assert.match(service.problem,/绑定的账号不一致/);
  state.account=ACCOUNT;await service.connect();assert.equal(service.status,'connected');assert.equal(service.qqCheck.accountId,ACCOUNT);assert.equal(state.runners,1);assert.equal(service.snapshot().qq.expectedAccountId,ACCOUNT);await service.disconnect();
});

test('real WS reconnect rechecks the pinned account and can recover after selecting the correct login',async t=>{
  const {state,client:create}=await fixture(t),client=create();await client.connect();assert.equal(client.accountId,ACCOUNT);
  state.sockets.at(-1).terminate();await until(()=>!client.ready);state.account=OTHER;
  await assert.rejects(client.connect(),{code:'account_mismatch'});assert.equal(client.ready,false);assert.equal(client.accountId,ACCOUNT);
  state.account=ACCOUNT;await client.connect();assert.equal(client.ready,true);assert.equal(state.actions.filter(x=>x==='get_login_info').length,3);
  const event={post_type:'message',message_type:'private',sub_type:'friend',self_id:Number(ACCOUNT),user_id:Number(OWNER),message_id:1,time:Math.ceil(Date.now()/1000),message:[{type:'text',data:{text:'fixture-only'}}]};
  state.sockets.at(-1).send(JSON.stringify(event));await until(()=>client.queue.length===1);assert.equal((await client.getUpdates()).messages[0].text,'fixture-only');
});

test('active proactive check rejects a changed account without sending or widening the destination',async t=>{
  const {state,client:create}=await fixture(t),client=create();await client.connect();state.account=OTHER;
  await assert.rejects(client.sendProactiveText(OWNER,'fixture-only','fixture-id'),{code:'account_mismatch'});assert.equal(client.ready,false);assert.equal(state.actions.at(-1),'get_login_info');assert.equal(state.actions.includes('send_private_msg'),false);
});

test('profiles without a binding retain existing identity checks and optional constructor validation is strict',async t=>{
  const {root,client:create}=await fixture(t);const client=create({expectedAccountId:undefined});await client.connect();assert.equal(client.accountId,ACCOUNT);
  assert.throws(()=>create({expectedAccountId:OWNER}),{code:'owner_is_agent_account'});assert.throws(()=>create({expectedAccountId:''}),{code:'invalid_owner'});
  const configFile=path.join(root,'bot-config.json'),config=JSON.parse(fs.readFileSync(configFile,'utf8'));delete config.qqAccountId;fs.writeFileSync(configFile,JSON.stringify(config));const restored=new BotService({root,vault});assert.equal(restored.snapshot().qq.expectedAccountId,'');restored.journal.close?.();restored.socialStore.close?.();
});

test('wrong-account poll failure stops automatic reconnect immediately with the bounded reason',async t=>{
  const {service}=await fixture(t),controller=new AbortController();service.controller=controller;let attempts=0;
  await service.poll({getUpdates:async()=>{attempts++;throw Object.assign(Error('untrusted bridge text'),{code:'account_mismatch'});}},controller.signal,null,service.generation,{channel:'qq'});
  assert.equal(attempts,1);assert.equal(service.status,'disconnected');assert.match(service.problem,/绑定的账号不一致/);assert.doesNotMatch(service.problem,/untrusted/);
});
