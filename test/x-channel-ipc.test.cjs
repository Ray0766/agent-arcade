'use strict';
// Actual main handler source + real AccountManager/BotService; no X traffic.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const {AccountManager}=require('../src/bot/account-manager.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const vault={isEncryptionAvailable:()=>true,encryptString:v=>Buffer.from(v),decryptString:v=>v.toString()};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-x-ipc-')),handlers=new Map(),calls=[];
  const manager=new AccountManager({root,vault,runnerFactory:()=>async()=>({outcome:'reply_ended',text:'never invoked'}),xClientFactory:options=>{
    calls.push(options);return {accountId:options.expectedAccountId,connect:async()=>{},getUpdates:(_cursor,signal)=>new Promise(resolve=>{const done=()=>resolve({cursor:'',messages:[]});signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();}),close(){},sendText(){throw Error('No fixture send allowed');}};
  }});
  const contents={mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href}};
  const context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:fromMain(id)};
  const line=name=>{const start=source.indexOf(`    register('${name}',`),end=source.indexOf('\n',start);assert(start>=0);return source.slice(start,end);};
  const start=source.indexOf('    const connectCompanion=id=>{'),end=source.indexOf("    register('accountConnect',",start);assert(start>=0&&end>start);
  vm.runInNewContext(source+`\nmodule.exports={setup:(manager,contents)=>{accounts=manager;bot=manager.current();win={webContents:contents};},bind:()=>{${source.slice(start,end)}${['botConfigure','botConnect','accountConnect'].map(line).join('\n')}}};`,context,{filename:main});
  context.module.exports.setup(manager,contents);context.module.exports.bind();const event={sender:contents,senderFrame:contents.mainFrame};
  t.after(async()=>{await manager.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,manager,calls,event,invoke:(name,value,eventOverride=event)=>handlers.get(`arcade:${name}`)(eventOverride,name==='botConfigure'&&['key','qqToken','feishuAppSecret','xAccessToken','messengerPageAccessToken','messengerRelayToken'].some(key=>Object.hasOwn(value,key))?{profileId:manager.selectedId,expectedMode:manager.current().config.mode||'api',expectedChannel:manager.current().config.channel||'wechat',...value}:value)};
}
test('actual configure/connect IPC keeps the X token private and performs no implicit connection',async t=>{
  const f=fixture(t),saved=await f.invoke('botConfigure',{mode:'api',channel:'x',workspace:f.root,key:'synthetic-model-key',xAccountId:'910000000000000031',xOwnerId:'920000000000000031',xAccessToken:'synthetic-x-ipc-token'});
  assert.equal(saved.paired,true);assert.equal(saved.status,'disconnected');assert.equal(saved.x.hasToken,true);assert.equal(f.calls.length,0);assert(!JSON.stringify(saved).includes('synthetic-x-ipc-token'));
  await f.invoke('botConnect');assert.equal(f.manager.current().status,'connected');assert.equal(f.calls.length,1);assert.equal(f.calls[0].ownerId,'920000000000000031');assert.equal(f.manager.current().snapshot().x.check.state,'verified');
  await assert.rejects(f.invoke('botConfigure',{xResume:true}),/Disconnect/);
});
test('main trusted-origin guard rejects token/optout changes; explicit local resume does not call transport',async t=>{
  const f=fixture(t);await f.invoke('botConfigure',{channel:'x',xAccountId:'910000000000000032',xOwnerId:'920000000000000032',xAccessToken:'synthetic-original-token'});
  for(const event of [{sender:{},senderFrame:f.event.senderFrame},{sender:f.event.sender,senderFrame:{...f.event.senderFrame}},{sender:f.event.sender,senderFrame:{url:'https://untrusted.invalid'}}])await assert.rejects(f.invoke('botConfigure',{xAccessToken:'synthetic-foreign-token'},event),/Untrusted sender/);
  const service=f.manager.current();service.config.xOptedOut=true;
  await assert.rejects(f.invoke('botConfigure',{xOptedOut:false}),/explicit local/);assert.equal(service.snapshot().x.optedOut,true);
  const result=await f.invoke('botConfigure',{xResume:true});assert.equal(result.x.optedOut,false);assert.equal(result.status,'disconnected');assert.equal(f.calls.length,0);assert.equal(service.secret.xAccessToken,'synthetic-original-token');
});
test('account-specific connect uses the requested registered profile without mixing tokens or identity',async t=>{
  const f=fixture(t);await f.invoke('botConfigure',{mode:'api',channel:'x',workspace:f.root,key:'synthetic-model-one',xAccountId:'910000000000000033',xOwnerId:'920000000000000033',xAccessToken:'synthetic-first-token'});
  const other=f.manager.add({name:'Second synthetic'}),otherId=f.manager.selectedId;other.configure({mode:'api',channel:'x',workspace:f.root,key:'synthetic-model-two',xAccountId:'910000000000000034',xOwnerId:'920000000000000034',xAccessToken:'synthetic-second-token'});
  await f.invoke('accountConnect','primary');assert.equal(f.calls[0].accessToken,'synthetic-first-token');await f.invoke('accountConnect',otherId);assert.equal(f.calls[1].accessToken,'synthetic-second-token');assert.equal(f.manager.claims.size,2);
});
