'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const {WebSocket,WebSocketServer}=require('ws');
const {AccountManager}=require('../src/bot/account-manager.cjs');
const {QQClient}=require('../src/bot/qq.cjs');
const ACCOUNT='100001',OWNER='900001',REVISION='11111111-1111-4111-8111-111111111111';
const tick=()=>new Promise(resolve=>setImmediate(resolve));
function defer(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function until(fn){for(let i=0;i<80;i++){if(fn())return;await tick();}assert.fail('fixture condition not reached');}
async function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-qq-intent-'));
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(resolve=>server.once('listening',resolve));
  const requests=[],clients=[];let modelFactories=0,modelCalls=0,connections=0,proofHold=null,proofCalls=0,replyAccount=ACCOUNT,ownerFriend=true;
  server.on('connection',socket=>{connections++;socket.on('message',bytes=>{const row=JSON.parse(bytes);requests.push(row);let data;
    if(row.action==='get_login_info')data={user_id:replyAccount,nickname:'Synthetic'};
    else if(row.action==='get_status')data={online:true,good:true};
    else if(row.action==='get_friend_list')data=ownerFriend?[{user_id:OWNER}]:[];
    else assert.fail('unexpected fixture request '+row.action);
    socket.send(JSON.stringify({echo:row.echo,status:'ok',retcode:0,data}));
  });});
  const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const manager=new AccountManager({root,vault,qqClientFactory:options=>{const client=new QQClient({...options,socketFactory:(...args)=>new WebSocket(...args),timeoutMs:150});clients.push(client);return client;},runnerFactory:()=>{modelFactories++;return async()=>{modelCalls++;return {outcome:'reply_ended',text:'synthetic'};};}});
  const service=manager.current(),url=`ws://127.0.0.1:${server.address().port}`;
  service.configure({mode:'api',channel:'qq',workspace:root,qqUrl:url,qqAccountId:ACCOUNT,qqOwnerId:OWNER,qqToken:'SYNTHETIC_BRIDGE_TOKEN',key:'SYNTHETIC_API_KEY'});
  const configBytes=fs.readFileSync(path.join(root,'bot-config.json')),vaultBytes=fs.readFileSync(path.join(root,'bot-vault.json'));
  const endpoint={ownershipVerified:true,endpointId:'synthetic-owned-endpoint'};
  const runtime={async getConnection(id){assert.equal(id,ACCOUNT);proofCalls++;await proofHold?.promise;return {...endpoint};}};
  const connection={accountId:ACCOUNT,url,token:'SYNTHETIC_BRIDGE_TOKEN',serverName:'synthetic'};
  const row={accountId:ACCOUNT,management:'owned',processRunning:true,recoveryRequired:false,reason:null,runtimeRevision:REVISION,login:{state:'online',identityVerified:true,accountId:ACCOUNT,online:true},bridges:[{serverName:'synthetic',enabled:true,loopbackOnly:true,hasToken:true,port:server.address().port}]};
  const console={runtime,epoch:0,refreshRevision:0,closed:false,busy:new Set(),installationSettings:{current:{kind:'legacy'}},state:{desktopRunning:false,instances:[row]},clients:new Map([[ACCOUNT,{publicId:REVISION,endpointId:endpoint.endpointId}]]),check(r,e){if(this.closed||r!==this.runtime||e!==this.epoch)throw Object.assign(Error('changed'),{code:'changed'});},profiles(){return {connection:()=>({...connection})};}};
  const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main),handlers=new Map();
  const win={visible:true,minimized:false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href}}};
  const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},ipcMain:{handle(name,fn){handlers.set(name,fn);}}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:fromMain(id)};
  const registration=source.split('\n').find(line=>line.includes("register('accountConnect'")),legacy=source.match(/const connectCompanion=id=>\{[\s\S]*?\n    \};/)?.[0];assert(registration&&legacy);
  vm.runInNewContext(source+`\nmodule.exports={captureQQConnectIntent,ownerRemarkPanel,stopping:qqStopping,setup:(a,w,q)=>{accounts=a;bot=a.current();win=w;qqConsole=q;},bind:()=>{${legacy}\n${registration}},setQuitting:value=>quitting=value};`,context,{filename:main});
  const api=context.module.exports;api.setup(manager,win,console);api.bind();
  const input={accountId:'primary',qqAccountId:ACCOUNT,runtimeRevision:REVISION},event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  const invoke=(value=input,ev=event)=>handlers.get('arcade:accountConnect')(ev,value);
  t.after(async()=>{proofHold?.resolve();for(const client of clients)client.close();await manager.close();for(const s of server.clients)s.terminate();await new Promise(resolve=>server.close(resolve));fs.rmSync(root,{recursive:true,force:true});});
  return {root,service,manager,console,runtime,connection,row,endpoint,win,api,input,invoke,clients,requests,configBytes,vaultBytes,get proofCalls(){return proofCalls;},get modelFactories(){return modelFactories;},get modelCalls(){return modelCalls;},get connections(){return connections;},set proofHold(v){proofHold=v;},set replyAccount(v){replyAccount=v;},set ownerFriend(v){ownerFriend=v;}};
}

test('actual main object handler verifies an expected-only profile and reuses its saved credentials',async t=>{
  const f=await fixture(t);f.manager.add({name:'Other selection'});const selected=f.manager.selectedId;
  const before=f.manager.snapshot().accounts.find(row=>row.id==='primary');assert.equal(before.accountId,'');assert.equal(before.qqBinding,null);
  const result=await f.invoke();assert.equal(result.status,'connected');assert.equal(result.qq.check.accountId,ACCOUNT);assert.equal(f.service.generation,1);assert.equal(f.manager.selectedId,selected);
  const after=f.manager.snapshot().accounts.find(row=>row.id==='primary');assert.equal(after.accountId,ACCOUNT);assert.equal(after.qqBinding.accountId,ACCOUNT);assert.equal(f.connections,1);assert.equal(f.modelFactories,1);assert.equal(f.modelCalls,0);
  assert.deepEqual(fs.readFileSync(path.join(f.root,'bot-config.json')),f.configBytes);assert.deepEqual(fs.readFileSync(path.join(f.root,'bot-vault.json')),f.vaultBytes);
  assert(f.requests.every(row=>['get_login_info','get_status','get_friend_list'].includes(row.action)));
});
test('legacy string connection remains compatible and does not require a runtime intent',async t=>{const f=await fixture(t);f.console.state.instances=[];assert.equal((await f.invoke('primary')).status,'connected');assert.equal(f.proofCalls,0);});
test('strict object and trusted-sender validation reject before any connection',async t=>{
  const f=await fixture(t);for(const value of [null,[],{}, {...f.input,key:'forbidden'},{...f.input,ownerId:OWNER},{...f.input,url:'ws://127.0.0.1:1'},{...f.input,qqAccountId:100001},{...f.input,runtimeRevision:'stale'},{...f.input,accountId:''}])await assert.rejects(f.invoke(value),{code:'invalid_request'});
  await assert.rejects(f.invoke(f.input,{sender:{},senderFrame:{}}),/Untrusted sender/);assert.equal(f.connections,0);assert.equal(f.proofCalls,0);
});
test('duplicate candidates and conflicting actual/history never become an authorization',async t=>{
  const f=await fixture(t),second=f.manager.add({name:'Duplicate'});second.configure({channel:'qq',qqAccountId:ACCOUNT,qqOwnerId:OWNER,qqUrl:'ws://127.0.0.1:12345'});
  await assert.rejects(f.invoke(),{code:'changed'});assert.equal(f.connections,0);
  f.manager.remove(f.manager.selectedId);const snapshot=f.manager.snapshot.bind(f.manager);f.manager.snapshot=()=>{const value=snapshot();value.accounts[0].qqBinding={source:'last_verified',accountId:'100002'};return value;};
  await assert.rejects(f.invoke(),{code:'changed'});assert.equal(f.connections,0);
});
test('only exact owned and online runtime metadata enables the object route',async t=>{
  for(const mutate of [f=>f.row.management='external',f=>f.row.login.identityVerified=false,f=>f.row.login.accountId='100002',f=>f.row.login.online=false,f=>f.row.recoveryRequired=true,f=>f.console.state.desktopRunning=true,f=>f.row.runtimeRevision='other',f=>f.service.credentialState='locked']){
    const f=await fixture(t);mutate(f);await assert.rejects(f.invoke());assert.equal(f.connections,0);assert.equal(f.proofCalls,0);
  }
});
test('fresh endpoint await rechecks selection, service/config, owner and installation without opening a socket',async t=>{
  for(const change of [f=>f.manager.selectedId='changed',f=>f.service.generation++,f=>f.service.config={...f.service.config},f=>f.service.config.qqOwnerId='900002',f=>f.service.secret={...f.service.secret},f=>f.console.epoch++,f=>f.console.refreshRevision++,f=>f.console.installationSettings.current={kind:'legacy'},f=>f.console.clients.get(ACCOUNT).endpointId='changed',f=>f.win.visible=false,f=>f.row.management='unknown',f=>f.console.busy.add('qq-setup'),f=>{const added=f.manager.add({name:'Late duplicate'});added.configure({channel:'qq',qqAccountId:ACCOUNT,qqOwnerId:OWNER,qqUrl:'ws://127.0.0.1:12345'});f.manager.selectedId='primary';}]){
    const f=await fixture(t),hold=defer();f.proofHold=hold;const pending=f.invoke();await until(()=>f.proofCalls===1);change(f);hold.resolve();await assert.rejects(pending);assert.equal(f.connections,0);assert.equal(f.clients.length,0);
  }
});
test('management retirement and concurrent duplicate requests are guarded before endpoint verification',async t=>{
  const f=await fixture(t),hold=defer();f.api.ownerRemarkPanel.closeCurrent=()=>hold.promise;const pending=f.invoke();await tick();
  await assert.rejects(f.invoke(),{code:'operation_in_progress'});f.service.config={...f.service.config,qqAccountId:'100002'};hold.resolve();await assert.rejects(pending,{code:'changed'});assert.equal(f.proofCalls,0);assert.equal(f.clients.length,0);
});
test('service ASR retirement awaits preserve the exact intent and reject a thenable guard',async t=>{
  const f=await fixture(t),hold=defer(),close=f.service.closeInboundVoice.bind(f.service);let entered=false;f.service.closeInboundVoice=()=>{entered=true;return hold.promise;};
  const pending=f.invoke();await until(()=>entered);f.service.config={...f.service.config,qqAccountId:'100002'};hold.resolve();await assert.rejects(pending,{code:'changed'});assert.equal(f.clients.length,0);f.service.closeInboundVoice=close;
  await assert.rejects(f.service.connect({assertCurrent:async()=>{}}),{code:'changed'});assert.equal(f.clients.length,0);
});
test('character content changes during retirement invalidate intent without logging or replacing it',async t=>{
  for(const patch of [{name:'Another synthetic name'},{description:'Another synthetic description'},{speechExamples:[{user:'Synthetic user',assistant:'Synthetic assistant'}]}]){
    const f=await fixture(t),hold=defer(),close=f.service.closeInboundVoice.bind(f.service);let entered=false;f.service.closeInboundVoice=()=>{entered=true;return hold.promise;};
    const pending=f.invoke();await until(()=>entered);f.service.socialConfigure(patch);hold.resolve();await assert.rejects(pending,{code:'changed'});assert.equal(f.clients.length,0);f.service.closeInboundVoice=close;
  }
});
test('the connection can disable its own proactive flags without changing the captured character',async t=>{
  const f=await fixture(t);f.service.socialConfigure({enabled:true,proactiveMessages:true,qzonePosts:true});f.service.socialConsent='different-synthetic-scope';
  const result=await f.invoke();assert.equal(result.status,'connected');assert.equal(f.service.socialStore.config().proactiveMessages,false);assert.equal(f.service.socialStore.config().qzonePosts,false);assert.equal(f.modelCalls,0);
});
test('actual QQ identity and the existing owner-friend requirement still block dispatch',async t=>{
  for(const change of [f=>f.replyAccount='100002',f=>f.ownerFriend=false]){const f=await fixture(t);change(f);const out=await f.invoke();assert.equal(out.status,'disconnected');assert.equal(f.modelFactories,0);assert.equal(f.manager.claims.size,0);assert.equal(f.clients[0].closed,true);}
});
test('scope changes during real-client inspect retire only this request before a runner or claim',async t=>{
  const f=await fixture(t),factory=f.service.qqClientFactory;f.service.qqClientFactory=options=>{const client=factory(options),inspect=client.inspect.bind(client);client.inspect=async signal=>{const result=await inspect(signal);f.console.epoch++;return result;};return client;};
  const out=await f.invoke();assert.equal(out.status,'disconnected');assert.equal(f.modelFactories,0);assert.equal(f.manager.claims.size,0);assert.equal(f.clients[0].closed,true);
});
test('native preparation awaits also stop on changed intent and clean only their captured inert resources',async t=>{
  for(const stage of ['launch','process','refresh']){
    const f=await fixture(t),hold=defer();let entered=false,cleaned=0,stops=0;
    f.service.configure({mode:'native'});
    f.service.nativeFactory=async()=>{if(stage==='launch'){entered=true;await hold.promise;}return {command:'inert-fixture-only',cleanup(){cleaned++;}};};
    const process={snapshot:()=>({owned:true}),async stop(){stops++;},async refresh(){if(stage==='refresh'){entered=true;await hold.promise;}}};
    f.service.nativeProcessFactory=async()=>{if(stage==='process'){entered=true;await hold.promise;}return process;};
    const pending=f.invoke();await until(()=>entered);f.console.epoch++;hold.resolve();const out=await pending;assert.equal(out.status,'disconnected');assert.equal(cleaned,1);assert.equal(stops,stage==='launch'?0:1);assert.equal(f.manager.claims.size,0);assert.equal(f.clients[0].closed,true);assert.equal(f.service.dispatcher,null);assert.equal(f.modelCalls,0);
  }
});
test('late guarded cleanup cannot abort or erase a newer connection, inbox or identity lease',async t=>{
  const f=await fixture(t),gate=defer(),cleanup=defer(),factory=f.service.qqClientFactory;let old,oldInbox,closes=0;
  f.service.qqClientFactory=options=>{const client=factory(options);if(!old){old=client;const connect=client.connect.bind(client),close=client.close.bind(client);client.connect=async signal=>{await gate.promise;return connect(signal);};client.close=()=>{close();return ++closes===2?cleanup.promise:undefined;};}return client;};
  const pending=f.invoke();await until(()=>!!old);oldInbox=f.service.friendRequests;await f.service.disconnect();
  const newer=await f.invoke('primary');assert.equal(newer.status,'connected');const current={client:f.service.client,controller:f.service.controller,dispatcher:f.service.dispatcher,inbox:f.service.friendRequests,release:f.service.releaseIdentity,generation:f.service.generation};
  gate.resolve();await until(()=>closes===2);assert.equal(oldInbox.closed,true);cleanup.resolve();await assert.rejects(pending,{code:'changed'});
  assert.equal(f.service.status,'connected');for(const [field,key]of [['client','client'],['controller','controller'],['dispatcher','dispatcher'],['friendRequests','inbox'],['releaseIdentity','release'],['generation','generation']])assert.equal(f.service[field],current[key]);
  assert.equal(current.controller.signal.aborted,false);assert.equal(current.client.closed,false);assert.equal(f.manager.claims.size,1);
});
test('missing provider key and failed fresh proof never alter saved configuration or expose raw errors',async t=>{
  const f=await fixture(t);f.runtime.getConnection=async()=>{throw Error('PRIVATE_TOKEN_PATH');};await assert.rejects(f.invoke(),error=>error.code==='status_unverified'&&!error.message.includes('PRIVATE'));
  f.runtime.getConnection=async()=>f.endpoint;delete f.service.secret.key;await assert.rejects(f.invoke(),/Save the selected provider/);assert.equal(f.clients.length,0);
  assert.deepEqual(fs.readFileSync(path.join(f.root,'bot-config.json')),f.configBytes);assert.deepEqual(fs.readFileSync(path.join(f.root,'bot-vault.json')),f.vaultBytes);
});
