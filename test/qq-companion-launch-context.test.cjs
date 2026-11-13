'use strict';
// Production account/service/profile adapter with a real owned loopback WebSocket.
// Window/runtime observations and OS encryption are synthetic; no QQ/model sends.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID}=require('node:crypto');
const {WebSocketServer}=require('ws');
const {AccountManager}=require('../src/bot/account-manager.cjs');
const {QQProfileConfig}=require('../src/bot/qq-profile-config.cjs');
const {createQQCompanionLaunch}=require('../src/bot/qq-companion-launch-context.cjs');
const ACCOUNT='123456789',OWNER='987654321',TOKEN='synthetic-launch-context-onebot-token';
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function fixture(t,{social=true}={}){
  const base=fs.realpathSync(os.tmpdir()),root=fs.mkdtempSync(path.join(base,'arcade-launch-context-'));
  const state={actions:[],connections:0,modelCalls:0,modelFactories:0,connects:0,refreshes:0,starts:0,visible:true,minimized:false,quitting:false,onRequest:null,onRefresh:null};
  const gates=[];const hold=()=>{const g=deferred();gates.push(g);return g;};
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise((resolve,reject)=>{server.once('listening',resolve);server.once('error',reject);});
  server.on('connection',(ws,req)=>{state.connections++;assert.equal(req.headers.authorization,`Bearer ${TOKEN}`);ws.on('message',async raw=>{const request=JSON.parse(raw);state.actions.push(request.action);await state.onRequest?.(request);if(ws.readyState!==1)return;const data=request.action==='get_login_info'?{user_id:ACCOUNT,nickname:'Synthetic companion'}:request.action==='get_status'?{online:true,good:true}:request.action==='get_friend_list'?[{user_id:OWNER,nickname:'Synthetic owner'}]:null;assert.notEqual(data,null,'no model/message/write route is allowed');ws.send(JSON.stringify({status:'ok',retcode:0,echo:request.echo,data}));});});
  const port=server.address().port,file=path.join(root,'onebot.json');
  const profile={network:{websocketServers:[{name:'fixture',enable:true,host:'127.0.0.1',port,token:TOKEN}]}};
  fs.writeFileSync(file,JSON.stringify(profile));
  const vault={isEncryptionAvailable:()=>true,encryptString:text=>Buffer.from(text),decryptString:bytes=>bytes.toString()};
  const accounts=new AccountManager({root,vault,runnerFactory:()=>{state.modelFactories++;return async()=>{state.modelCalls++;throw Error('model invocation forbidden');};}}),service=accounts.current();
  service.configure({mode:'api',channel:'qq',qqAccountId:ACCOUNT,qqOwnerId:OWNER,qqUrl:`ws://127.0.0.1:${port}`,qqToken:TOKEN,key:'synthetic-launch-context-model-key'});
  service.socialConfigure({enabled:social,proactiveMessages:false,qzonePosts:false});
  const runtime={root,instance:id=>{assert.equal(id,ACCOUNT);return {onebotConfigPath:file};},withConfigurationLock(){throw Error('configuration write forbidden');}};
  const profiles=new QQProfileConfig({runtime});
  const row=()=>({accountId:ACCOUNT,management:'owned',processRunning:true,canStart:false,recoveryRequired:false,reason:null,runtimeRevision:'00000000-0000-4000-8000-000000000001',login:{state:'online',online:true,identityVerified:true,accountId:ACCOUNT}});
  const qq={runtime,epoch:1,closed:false,selectionIssue:null,busy:new Set(),installationSettings:{current:{id:'synthetic-installation'}},check(r,e){if(this.runtime!==r||this.epoch!==e||this.closed)throw Object.assign(Error('changed'),{code:'changed'});},profiles:()=>profiles,async refresh(){state.refreshes++;await state.onRefresh?.();return {instances:[row()],desktopRunning:false};},async perform(){state.starts++;throw Error('this fixture starts from an observed running runtime');}};
  const window={isVisible:()=>state.visible,isMinimized:()=>state.minimized,isDestroyed:()=>false};
  const live={accounts,console:qq,window,stopping:new Set(),quitting:false};
  const launch=createQQCompanionLaunch({current:()=>live,connectIntent:async(value,options)=>{state.connects++;assert.equal(value.accountId,'primary');assert.equal(value.qqAccountId,ACCOUNT);await accounts.connect(value.accountId,{assertCurrent:options.assertCurrent});}});
  t.after(async()=>{for(const gate of gates)gate.resolve();await launch.close();await accounts.close();for(const ws of server.clients)ws.terminate();await new Promise(resolve=>server.close(resolve));const real=fs.realpathSync(root);assert(real.startsWith(base+path.sep)&&path.basename(real).startsWith('arcade-launch-context-'));fs.rmSync(real,{recursive:true,force:true});});
  return {root,state,hold,accounts,service,qq,live,launch,file,profile,input:()=>({accountId:'primary',operationId:randomUUID()})};
}

test('context launches a configured workspace-free companion through production service and owned WS with no model invocation',async t=>{
  const f=await fixture(t);assert.equal(f.service.snapshot().workspace,'');assert.equal(f.launch.inspect({accountId:'primary'}).available,true);assert.equal(f.state.connections,0);
  const result=await f.launch.launch(f.input());assert.equal(result.outcome,'connected');assert.equal(result.connectionVerified,true);assert.equal(result.qqRunning,true);assert.equal(result.startAttempted,false);assert.equal(f.service.status,'connected');assert.equal(f.accounts.snapshot().accounts[0].accountId,ACCOUNT);assert.equal(f.state.modelCalls,0);assert.equal(f.state.modelFactories,1);assert.equal(f.state.starts,0);assert(f.state.actions.length>=3);assert(f.state.actions.every(v=>['get_login_info','get_status','get_friend_list'].includes(v)));assert.doesNotMatch(JSON.stringify(result),/synthetic-launch-context|127\.0\.0\.1/);
});
test('context keeps the workspace prerequisite for dispatch mode and refuses locked or duplicated QQ registrations',async t=>{
  const f=await fixture(t,{social:false});assert.equal(f.launch.inspect({accountId:'primary'}).available,false);f.service.socialConfigure({enabled:true});assert.equal(f.launch.inspect({accountId:'primary'}).available,true);
  const other=f.accounts.add({name:'Synthetic duplicate'});other.configure({mode:'api',channel:'qq',qqAccountId:ACCOUNT,qqOwnerId:OWNER,qqUrl:f.service.config.qqUrl,qqToken:TOKEN,key:'synthetic-second-key'});f.accounts.select('primary');assert.equal(f.launch.inspect({accountId:'primary'}).available,false);f.accounts.remove(f.accounts.accounts[1].id);
  f.service.lockCredentials();assert.equal(f.launch.inspect({accountId:'primary'}).reason,'credentials_locked');assert.equal(f.state.connections,0);assert.equal(f.state.starts,0);
});
test('context rejects private configuration and lifecycle drift after a held refresh before any connection',async t=>{
  for(const kind of ['secret','owner','profile-file','generation','window','runtime','installation','persona','migration'])await t.test(kind,async t=>{
    const f=await fixture(t),entered=f.hold(),release=f.hold();f.state.onRefresh=async()=>{entered.resolve();await release.promise;};const operation=f.launch.launch(f.input());await entered.promise;
    if(kind==='secret')f.service.secret.key='synthetic-changed-in-place';
    if(kind==='owner')f.service.config.qqOwnerId='777777777';
    if(kind==='profile-file'){f.profile.network.websocketServers[0].token='synthetic-replaced-onebot-token';fs.writeFileSync(f.file,JSON.stringify(f.profile));}
    if(kind==='generation')f.service.generation++;
    if(kind==='window')f.state.minimized=true;
    if(kind==='runtime')f.qq.runtime={...f.qq.runtime};
    if(kind==='installation')f.qq.installationSettings.current={...f.qq.installationSettings.current};
    if(kind==='persona')f.service.socialConfigure({characterId:'codex-dragon'});
    if(kind==='migration')f.accounts.credentialMigrations.add('primary');
    release.resolve();const result=await operation;assert.equal(result.connectionVerified,false);assert.equal(f.state.connects,0);assert.equal(f.state.connections,0);assert.equal(f.state.modelFactories,0);assert.equal(f.state.starts,0);
  });
});
test('context rejects a profile switch during real WS identity verification and retires only its connecting service',async t=>{
  const f=await fixture(t),entered=f.hold(),release=f.hold();const other=f.accounts.add({name:'Unrelated synthetic companion'}),otherId=f.accounts.selectedId;f.accounts.select('primary');
  f.state.onRequest=async request=>{if(request.action==='get_login_info'){entered.resolve();await release.promise;}};
  const operation=f.launch.launch(f.input());await entered.promise;f.accounts.select(otherId);release.resolve();const result=await operation;
  assert.equal(result.connectionVerified,false);assert.equal(f.service.status,'disconnected');assert.equal(other.status,'disconnected');assert.equal(f.accounts.selectedId,otherId);assert.equal(f.state.modelFactories,0);assert.equal(f.state.modelCalls,0);assert.equal(f.state.starts,0);
});
test('context explicit cancellation during real friendship read never constructs a model or retries connection',async t=>{
  const f=await fixture(t),entered=f.hold(),release=f.hold();f.state.onRequest=async request=>{if(request.action==='get_friend_list'){entered.resolve();await release.promise;}};
  const input=f.input(),operation=f.launch.launch(input);await entered.promise;const closing=f.launch.cancel(input);release.resolve();const result=await operation,cancelled=await closing;
  assert.equal(result.connectionVerified,false);assert.equal(cancelled.cancelled,true);assert.equal(cancelled.settled,true);assert.equal(f.service.status,'disconnected');assert.equal(f.state.connects,1);assert.equal(f.state.connections,1);assert.equal(f.state.modelFactories,0);assert.equal(f.state.starts,0);
});
test('context cannot start QQ while an earlier credential forget still owns cleanup after a second disconnect',async t=>{
  const f=await fixture(t),release=f.hold();f.service.friendRequests={close:()=>release.promise};const forgetting=f.service.forget();
  await f.service.disconnect();assert.equal(f.service.status,'disconnected');assert.equal(f.service.forgetting,true);assert.equal(f.service.snapshot().credentialState,'ready');
  const observed=f.launch.inspect({accountId:'primary'});release.resolve();await forgetting;
  assert.equal(observed.available,false,'a disconnected snapshot must not bypass the active credential-clear owner');assert.equal(f.state.refreshes,0);assert.equal(f.state.starts,0);assert.equal(f.state.connections,0);
});
