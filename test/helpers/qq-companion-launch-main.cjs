'use strict';
// Production main IPC + AccountManager/BotService/QQClient. Only runtime
// observations and the loopback OneBot peer are synthetic; no QQ/model login.
const assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const {WebSocket,WebSocketServer}=require('ws');
const {AccountManager}=require('../../src/bot/account-manager.cjs');
const {QQClient}=require('../../src/bot/qq.cjs');
const ACCOUNT='100001',OWNER='900001',REVISION='11111111-1111-4111-8111-111111111111';
function defer(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
async function createFixture({onChange=()=>{}}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-launch-main-'));
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise(resolve=>server.once('listening',resolve));
  const requests=[],clients=[],events=[];let modelFactories=0,modelCalls=0,connections=0,proofHold=null,refreshHold=null,startHold=null,proofCalls=0,refreshes=0,starts=0,replyAccount=ACCOUNT,ownerFriend=true;
  server.on('connection',socket=>{connections++;socket.on('message',bytes=>{const message=JSON.parse(bytes);requests.push(message);let data;
    if(message.action==='get_login_info')data={user_id:replyAccount,nickname:'Synthetic'};
    else if(message.action==='get_status')data={online:true,good:true};
    else if(message.action==='get_friend_list')data=ownerFriend?[{user_id:OWNER}]:[];
    else assert.fail('Unexpected fixture request '+message.action);
    socket.send(JSON.stringify({echo:message.echo,status:'ok',retcode:0,data}));
  });});
  const vault={isEncryptionAvailable:()=>true,encryptString:s=>Buffer.from(s),decryptString:b=>b.toString()};
  const manager=new AccountManager({root,vault,onChange:()=>{events.push('account-change');onChange();},qqClientFactory:options=>{const client=new QQClient({...options,socketFactory:(...args)=>new WebSocket(...args)});clients.push(client);return client;},runnerFactory:()=>{modelFactories++;return async()=>{modelCalls++;return {outcome:'reply_ended',text:'synthetic'};};}});
  const service=manager.current(),url=`ws://127.0.0.1:${server.address().port}`;
  service.configure({mode:'api',channel:'qq',qqUrl:url,qqAccountId:ACCOUNT,qqOwnerId:OWNER,qqToken:'SYNTHETIC_BRIDGE_TOKEN',key:'SYNTHETIC_API_KEY'});
  service.socialConfigure({enabled:true,proactiveMessages:false,qzonePosts:false});
  const configBytes=fs.readFileSync(path.join(root,'bot-config.json')),vaultBytes=fs.readFileSync(path.join(root,'bot-vault.json'));
  const endpoint={ownershipVerified:true,endpointId:'synthetic-owned-endpoint'};
  const runtime={async getConnection(id){assert.equal(id,ACCOUNT);proofCalls++;await proofHold?.promise;return {...endpoint};}};
  const connection={accountId:ACCOUNT,url,token:'SYNTHETIC_BRIDGE_TOKEN',serverName:'synthetic'};
  const row={accountId:ACCOUNT,management:'owned',processRunning:true,canStart:false,recoveryRequired:false,reason:null,runtimeRevision:REVISION,login:{state:'online',identityVerified:true,accountId:ACCOUNT,online:true},bridges:[{serverName:'synthetic',enabled:true,loopbackOnly:true,hasToken:true,port:server.address().port}]};
  const console={runtime,epoch:0,refreshRevision:0,closed:false,busy:new Set(),installationSettings:{current:{kind:'legacy'}},state:{desktopRunning:false,instances:[row]},clients:new Map([[ACCOUNT,{publicId:REVISION,endpointId:endpoint.endpointId}]]),
    check(r,e){if(this.closed||r!==this.runtime||e!==this.epoch)throw Object.assign(Error('Changed'),{code:'changed'});},
    profiles(){return {connection:()=>({...connection})};},snapshot(){return structuredClone(this.state);},
    async refresh(){refreshes++;await refreshHold?.promise;return this.snapshot();},
    async perform(kind,args,beforeStop,options){assert.equal(kind,'start');assert.equal(args.accountId,ACCOUNT);this.busy.add(ACCOUNT);try{await startHold?.promise;options.assertCurrent();starts++;row.management='owned';row.processRunning=true;row.canStart=false;row.login={state:'online',identityVerified:true,accountId:ACCOUNT,online:true};return {state:this.snapshot()};}finally{this.busy.delete(ACCOUNT);}}
  };
  const main=path.resolve(__dirname,'../../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main),handlers=new Map(),windowEvents=new Map(),appEvents=new Map();
  const win={visible:true,minimized:false,isDestroyed:()=>false,isVisible(){return this.visible;},isMinimized(){return this.minimized;},on(event,fn){windowEvents.set(event,fn);},webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../../src/ui/index.html')).href}}};
  const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,structuredClone,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(name,fn){appEvents.set(name,fn);}},ipcMain:{handle(name,fn){handlers.set(name,fn);}}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:fromMain(id)};
  const lifecycle=source.split('\n').find(line=>line.includes("for(const event of ['hide','minimize'])win.on(event,()=>void qqCompanionLaunch"));assert(lifecycle);
  vm.runInNewContext(source+`\nmodule.exports={setup:(a,w,q,notify)=>{accounts=a;bot=a.current();win=w;qqConsole=q;publish=notify;initializeQQCompanionLaunch();registerQQCompanionLaunchHandlers();${lifecycle}\n},get launch(){return qqCompanionLaunch;},get shutdown(){return shutdownTask;},get cleanedUp(){return cleanedUp;},register,setQuitting:value=>quitting=value,close:()=>qqCompanionLaunch.close(),snapshot:()=>({bot:bot.snapshot(),accounts:accounts.snapshot(),qqRuntime:qqConsole.snapshot(),qqCompanionLaunch:qqCompanionLaunch.snapshot()})};`,context,{filename:main});
  const api=context.module.exports;api.setup(manager,win,console,()=>{events.push('launch-change');onChange();});
  const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  const invoke=(name,value,ev=event)=>handlers.get('arcade:'+name)(ev,structuredClone(value));
  let disposed=false;
  async function close(){if(disposed)return;disposed=true;proofHold?.resolve();refreshHold?.resolve();startHold?.resolve();await api.close();for(const client of clients)client.close();await manager.close();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));const real=fs.realpathSync(root),base=fs.realpathSync(os.tmpdir());assert(real.startsWith(base+path.sep)&&path.basename(real).startsWith('arcade-launch-main-'));fs.rmSync(real,{recursive:true,force:true});}
  return {root,service,manager,console,runtime,connection,row,endpoint,win,api,invoke,clients,requests,events,configBytes,vaultBytes,close,quit(){appEvents.get('before-quit')({preventDefault(){}});return api.shutdown;},
    hide(){win.visible=false;windowEvents.get('hide')();},minimize(){win.minimized=true;windowEvents.get('minimize')();},
    get proofCalls(){return proofCalls;},get modelFactories(){return modelFactories;},get modelCalls(){return modelCalls;},get connections(){return connections;},get refreshes(){return refreshes;},get starts(){return starts;},
    set proofHold(v){proofHold=v;},set refreshHold(v){refreshHold=v;},set startHold(v){startHold=v;},set replyAccount(v){replyAccount=v;},set ownerFriend(v){ownerFriend=v;}};
}
module.exports={createFixture,defer,ACCOUNT,OWNER,REVISION};
