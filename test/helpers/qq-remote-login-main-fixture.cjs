'use strict';
// Actual Electron main IPC wiring, with an isolated storage double and inert
// fixed-route remote responses. Never reads an existing account or credential.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path'),vm=require('node:vm');
const {createHash}=require('node:crypto');
const {createRequire}=require('node:module');
const {pathToFileURL}=require('node:url');
const sessionModule=require('../../src/bot/qq-remote-session.cjs');
const {QQRemoteClient}=require('../../src/bot/qq-remote-client.cjs');
const MAIN=path.resolve(__dirname,'../../src/main.cjs'),SOURCE=fs.readFileSync(MAIN,'utf8'),fromMain=createRequire(MAIN);
const PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',EXPECTED='1000001';
const TOKEN='synthetic-login-main-old-1',CANDIDATE='synthetic-login-main-new-2';
const QR='https://txz.qq.com/p?synthetic-login-main-qr-canary=1';
const hold=()=>{let resolve;return {promise:new Promise(r=>{resolve=r;}),resolve:value=>resolve(value)};};
async function until(fn){const end=Date.now()+3000;while(Date.now()<end){if(fn())return;await new Promise(r=>setTimeout(r,1));}throw Error('Synthetic main fixture wait exceeded');}
function fixture(t,{passkeyBridge,fileTransportFactory}={}){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-remote-login-main-')),handlers=new Map(),events={},requests=[];
  const state={visible:true,minimized:false,mono:0,now:Date.parse('2026-11-07T00:00:00Z'),token:TOKEN,encodes:0,encodeGate:null,before:null,after:null,
    version:'4.18.42',actualQQ:EXPECTED,isLogin:false,isOffline:false,phase:'waiting_qrcode',coreReady:false,accepted:false,online:false,qr:QR,quick:[EXPECTED],
    nativeHandle:Buffer.from('3412000000000000','hex'),passkeyVerifyError:false,
    pickerGate:null,pickerResult:null,pickerCalls:[],
    network:{host:'::',port:6099,loginRate:10,disableWebUI:false,accessControlMode:'none',ipWhitelist:[],ipBlacklist:[],enableXForwardedFor:false}};
  const vault={isEncryptionAvailable:()=>true,encryptString:value=>Buffer.from(value).map(b=>b^0x5a),decryptString:value=>Buffer.from(value).map(b=>b^0x5a).toString()};
  const services=new Map([['first',{generation:1}],['second',{generation:1}]]);
  for(const service of services.values())Object.defineProperty(service,'secret',{get(){throw Error('Remote login must not read companion credentials');}});
  const accounts={selectedId:'first',get(id){if(!services.has(id))throw Error('Missing synthetic service');return services.get(id);},snapshot:()=>({accounts:[]})};
  const win={id:1,getNativeWindowHandle:()=>state.nativeHandle,isVisible:()=>state.visible,isMinimized:()=>state.minimized,isDestroyed:()=>false,on:(name,fn)=>{events[name]=fn;},webContents:{mainFrame:{url:pathToFileURL(path.resolve(__dirname,'../../src/ui/index.html')).href},send(){}}};
  function transport(){let closed=false;return {close(){closed=true;},async request(route,options={}){
    const fail=(code,submitted=false)=>Object.assign(Error('Synthetic transport boundary'),{code,submitted});
    if(closed||options.signal?.aborted)throw fail('cancelled');await state.before?.(route,options);options.assertCurrent?.();
    if(closed||options.signal?.aborted)throw fail('cancelled');options.onAttempt?.();if(closed||options.signal?.aborted)throw fail('cancelled');
    requests.push({route,body:structuredClone(options.body),credential:options.credential});let data;
    if(route==='login'){
      const expected=createHash('sha256').update(state.token+'.napcat').digest('hex');
      if(options.body.hash!==expected)return {code:-1,data:null};data={Credential:'syntheticLoginCredential',require2FA:false};
    }else if(route==='passkeyRegistrationOptions'||route==='passkeyAuthenticationOptions')data=require('./qq-remote-passkey-fixture.cjs').publicKey(route==='passkeyRegistrationOptions'?'register':'authenticate');
    else if(route==='passkeyRegistrationVerify'||route==='passkeyAuthenticationVerify'){
      if(state.passkeyVerifyError)throw fail('timeout',true);
      data=route==='passkeyRegistrationVerify'?{verified:true}:{Credential:'syntheticMainPasskeyCredential'};
    }else if(route==='version')data={version:state.version};
    else if(route==='qqStatus')data={isLogin:state.isLogin,isOffline:state.isOffline,loginPhase:state.phase,coreReady:state.coreReady,qrLoginAccepted:state.accepted,qrcodeurl:state.qr,loginError:''};
    else if(route==='qqInfo')data={uin:state.actualQQ,online:state.online};
    else if(route==='qqQuickList')data=structuredClone(state.quick);
    else if(route==='qqQRCode')data={qrcode:state.qr};
    else if(route==='qqRefreshQR')data={qrcodeurl:state.qr};
    else if(route==='qqQuickLogin')data=null;
    else if(route==='networkRead')data=structuredClone(state.network);
    else if(route==='twoFactorStatus')data={enable2FA:false,hasSecret:false};
    else throw fail('invalid_request');
    const response={code:0,data};await state.after?.(route,options,response);return response;
  }};}
  class BoundSession extends sessionModule.QQRemoteSession{
    constructor(options){super({...options,now:()=>state.now,monotonic:()=>state.mono,
      // Keep the actual main capture, normalizing only the VM realm's prototype.
      getPasskeyContext:()=>structuredClone(options.getPasskeyContext()),
      qrEncoder:async value=>{state.encodes++;const png=await options.qrEncoder(value);await state.encodeGate?.promise;return png;},
      clientFactory:entry=>new QQRemoteClient({...entry,transport:transport(),...(fileTransportFactory?{fileTransport:fileTransportFactory({state,requests})}:{}),now:()=>state.now})});}
  }
  const context={__dirname:path.dirname(MAIN),module:{exports:{}},process:{argv:[],platform:'win32',pid:4242,env:{AGENT_ARCADE_HOME:root,LOCALAPPDATA:root}},Buffer,URL,structuredClone,AbortController,setInterval,clearInterval,
    require:id=>id==='electron'?{app:{requestSingleInstanceLock:()=>false,quit(){},on(){}},safeStorage:vault,ipcMain:{handle(name,fn){handlers.set(name,fn);}},dialog:{
      async showOpenDialog(parent,options){if(!fileTransportFactory)throw Error('No native picker expected');state.pickerCalls.push({kind:'open',parent,options});return state.pickerGate?state.pickerGate.promise:state.pickerResult||{canceled:true,filePaths:[]};},
      async showSaveDialog(parent,options){if(!fileTransportFactory)throw Error('No native picker expected');state.pickerCalls.push({kind:'save',parent,options});return state.pickerGate?state.pickerGate.promise:state.pickerResult||{canceled:true};}
    }}:id==='./core/files.cjs'?{readJSON:(_file,fallback)=>fallback,atomicJSON(){},drainInbox:()=>[]}:id==='./bot/qq-remote-session.cjs'?{...sessionModule,QQRemoteSession:BoundSession}:id==='./auth/windows-webauthn.cjs'&&passkeyBridge?{WindowsWebAuthn:class{constructor(){return passkeyBridge;}}}:fromMain(id)};
  const hide=SOURCE.split('\n').find(line=>line.includes("for(const event of ['hide','minimize'])")&&line.includes('closeRemoteManagement'));
  vm.runInNewContext(SOURCE+`\nmodule.exports={setup:(a,w)=>{accounts=a;win=w;initializeRemoteManagement();${hide}},registerRemoteHandlers,closeRemoteManagement,fullSnapshot,observe:()=>remotePanel.observe(),panel:()=>remotePanel};`,context,{filename:MAIN});
  const api=context.module.exports;api.setup(accounts,win);api.registerRemoteHandlers();
  const event={sender:win.webContents,senderFrame:win.webContents.mainFrame};
  const invoke=(name,value={panelId:PANEL},ev=event)=>handlers.get('arcade:qqRemote'+name)(ev,value);
  t.after(async()=>{state.encodeGate?.resolve();state.pickerGate?.resolve({canceled:true,filePaths:[]});await api.closeRemoteManagement({permanent:true});const resolved=path.resolve(root);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected synthetic fixture root');fs.rmSync(resolved,{recursive:true,force:true});});
  return {root,state,requests,handlers,events,services,accounts,win,event,api,invoke,advance(ms=3001){state.mono+=ms;state.now+=ms;}};
}
async function add(f){await f.invoke('List');const result=await f.invoke('Create',{panelId:PANEL,value:{label:'Synthetic login server',origin:'https://remote.arcade.invalid',expectedQQ:EXPECTED,token:TOKEN,trust:{},associatedProfileId:null}});if(!result.ok)throw Error('Synthetic registration failed');return {...result.registration,panelId:PANEL};}
const base=row=>({panelId:row.panelId,remoteId:row.remoteId});
module.exports={fixture,add,base,hold,until,PANEL,EXPECTED,TOKEN,CANDIDATE,QR};
