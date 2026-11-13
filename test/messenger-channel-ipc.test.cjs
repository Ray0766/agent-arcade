'use strict';
// Actual trusted main handlers and production account/service storage. Inert
// Messenger transport only: no network, relay deployment, model or messages.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),os=require('node:os'),vm=require('node:vm');
const {createRequire}=require('node:module'),{pathToFileURL}=require('node:url');
const {AccountManager}=require('../src/bot/account-manager.cjs');
const main=path.resolve(__dirname,'../src/main.cjs'),source=fs.readFileSync(main,'utf8'),fromMain=createRequire(main);
const vault={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value),decryptString:value=>value.toString()};
function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-messenger-ipc-')),handlers=new Map(),calls=[];
  const manager=new AccountManager({root,vault,runnerFactory:()=>async()=>{throw Error('No fixture model allowed');},messengerClientFactory:options=>{
    calls.push(options);return {accountId:options.pageId,connect:async()=>{},getUpdates:(_cursor,signal)=>new Promise(resolve=>{const done=()=>resolve({deliveryId:null,messages:[]});signal.addEventListener('abort',done,{once:true});if(signal.aborted)done();}),close(){},sendText(){throw Error('No fixture send allowed');}};
  }});
  const contents={mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../src/ui/index.html')).href}},context={__dirname:path.dirname(main),module:{exports:{}},process:{argv:[],env:{}},URL,AbortController,setInterval,clearInterval,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},ipcMain:{handle:(name,fn)=>handlers.set(name,fn)}}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:fromMain(id)};
  const line=name=>{const start=source.indexOf(`    register('${name}',`),end=source.indexOf('\n',start);assert(start>=0);return source.slice(start,end);};
  const start=source.indexOf('    const connectCompanion=id=>{'),end=source.indexOf("    register('accountConnect',",start);assert(start>=0&&end>start);
  vm.runInNewContext(source+`\nmodule.exports={setup:(manager,contents)=>{accounts=manager;bot=manager.current();win={webContents:contents};},bind:()=>{${source.slice(start,end)}${['botConfigure','botConnect','accountConnect'].map(line).join('\n')}}};`,context,{filename:main});
  context.module.exports.setup(manager,contents);context.module.exports.bind();const event={sender:contents,senderFrame:contents.mainFrame};
  t.after(async()=>{await manager.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,manager,calls,event,invoke:(name,value,eventOverride=event)=>handlers.get(`arcade:${name}`)(eventOverride,name==='botConfigure'&&['key','qqToken','feishuAppSecret','xAccessToken','messengerPageAccessToken','messengerRelayToken'].some(key=>Object.hasOwn(value,key))?{profileId:manager.selectedId,expectedMode:manager.current().config.mode||'api',expectedChannel:manager.current().config.channel||'wechat',...value}:value)};
}
const settings=n=>({channel:'messenger',messengerAppId:`1000000000000000000${n}`,messengerPageId:`2000000000000000000${n}`,messengerOwnerId:`3000000000000000000${n}`,messengerRelayOrigin:'https://relay.example.invalid',messengerPageAccessToken:`synthetic-page-token-${n}`,messengerRelayToken:`synthetic-relay-token-for-this-page-${n}`});
test('trusted configure stores two Messenger credentials without returning them or connecting',async t=>{
  const f=fixture(t),patch=settings(1),result=await f.invoke('botConfigure',patch);
  assert.equal(result.status,'disconnected');assert.equal(result.paired,true);assert.equal(result.messenger.pageId,patch.messengerPageId);assert.equal(result.messenger.hasPageToken,true);assert.equal(result.messenger.hasRelayToken,true);assert.equal(f.calls.length,0);
  const publicBytes=JSON.stringify(result);assert(!publicBytes.includes(patch.messengerPageAccessToken));assert(!publicBytes.includes(patch.messengerRelayToken));
  await f.invoke('botConfigure',{channel:'messenger'});assert.equal(f.manager.current().secret.messengerPageAccessToken,patch.messengerPageAccessToken);assert.equal(f.manager.current().secret.messengerRelayToken,patch.messengerRelayToken);
});
test('untrusted main sender cannot mutate Messenger secrets or opt-out',async t=>{
  const f=fixture(t);await f.invoke('botConfigure',settings(2));const service=f.manager.current();service.config.messengerOptedOut=true;
  for(const event of [{sender:{},senderFrame:f.event.senderFrame},{sender:f.event.sender,senderFrame:{...f.event.senderFrame}},{sender:f.event.sender,senderFrame:{url:'https://untrusted.invalid'}}])await assert.rejects(f.invoke('botConfigure',{messengerResume:true,messengerRelayToken:'synthetic-foreign-token-with-32chars'},event),/Untrusted sender/);
  assert.equal(service.config.messengerOptedOut,true);assert.equal(service.secret.messengerRelayToken,settings(2).messengerRelayToken);
  await assert.rejects(f.invoke('botConfigure',{messengerOptedOut:false}),/explicit local/);
  const resumed=await f.invoke('botConfigure',{messengerResume:true});assert.equal(resumed.messenger.optedOut,false);assert.equal(resumed.status,'disconnected');assert.equal(f.calls.length,0);
});
test('configuration rejects noncanonical IDs and non-origin HTTPS addresses before replacing saved credentials',async t=>{
  const f=fixture(t),original=settings(3);await f.invoke('botConfigure',original);
  for(const bad of [{messengerPageId:123},{messengerOwnerId:'01'},{messengerAppId:'1'.repeat(21)},{messengerOwnerId:original.messengerPageId},...['http://relay.example.invalid','https://user:pass@relay.example.invalid','https://relay.example.invalid/path','https://relay.example.invalid/?secret=x'].map(messengerRelayOrigin=>({messengerRelayOrigin})),{messengerPageAccessToken:''},{messengerRelayToken:''}])await assert.rejects(f.invoke('botConfigure',bad));
  assert.equal(f.manager.current().config.messengerPageId,original.messengerPageId);assert.equal(f.manager.current().secret.messengerPageAccessToken,original.messengerPageAccessToken);assert.equal(f.manager.current().secret.messengerRelayToken,original.messengerRelayToken);assert.equal(f.calls.length,0);
});
test('changed identity requires corresponding fresh credentials and forbids legacy Channels',async t=>{
  const f=fixture(t),original=settings(4);await f.invoke('botConfigure',original);
  await assert.rejects(f.invoke('botConfigure',{messengerPageId:settings(5).messengerPageId}),/new Page token/);
  await assert.rejects(f.invoke('botConfigure',{messengerOwnerId:settings(5).messengerOwnerId}),/new relay token/);
  await assert.rejects(f.invoke('botConfigure',{mode:'native'}),/does not support/);
  assert.equal(f.manager.current().config.mode,'api');assert.equal(f.manager.current().config.messengerOwnerId,original.messengerOwnerId);
  const changed=await f.invoke('botConfigure',settings(5));assert.equal(changed.messenger.pageId,settings(5).messengerPageId);assert.equal(changed.status,'disconnected');
});
test('registered companion connect routes exact Page credentials without using the selected profile',async t=>{
  const f=fixture(t),first=settings(6),second=settings(7);await f.invoke('botConfigure',{...first,mode:'api',key:'synthetic-model-key-1',workspace:f.root});
  const other=f.manager.add({name:'Synthetic second Page'}),id=f.manager.selectedId;other.configure({...second,mode:'api',key:'synthetic-model-key-2',workspace:f.root});
  await f.invoke('accountConnect','primary');await f.invoke('accountConnect',id);assert.equal(f.calls.length,2);assert.equal(f.calls[0].pageAccessToken,first.messengerPageAccessToken);assert.equal(f.calls[0].relayToken,first.messengerRelayToken);assert.equal(f.calls[1].pageAccessToken,second.messengerPageAccessToken);assert.equal(f.calls[1].ownerId,second.messengerOwnerId);assert.equal(f.manager.claims.size,2);
  assert.equal(other.snapshot().messenger.check.state,'verified');await assert.rejects(f.invoke('botConfigure',{messengerResume:true}),/Disconnect/);
});
