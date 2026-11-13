'use strict';
// Synthetic vault/HTTP behavior only. No remote, real credential or OS encryption claim.
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {randomUUID,createHash}=require('node:crypto');
const {RemoteNapCatRegistry}=require('../../src/bot/qq-remote-registry.cjs');
const {QQRemoteClient}=require('../../src/bot/qq-remote-client.cjs');
const {QQRemoteSession}=require('../../src/bot/qq-remote-session.cjs');
const {validateRemoteOrigin,validateRemoteTrust}=require('../../src/bot/qq-remote-transport.cjs');
const EXPECTED='100001',TOKEN='synthetic-old-token-1',CANDIDATE='synthetic-new-token-2';
const WRITE=new Set(['networkWrite','rotateToken','twoFactorEnable','twoFactorDisable','certificateUpload','certificateDelete','restart']);
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function fixture(t,overrides={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'arcade-remote-session-'));
 const state={now:Date.parse('2026-11-06T00:00:00Z'),mono:0,context:'synthetic-context-1',token:TOKEN,actualQQ:EXPECTED,isLogin:true,version:'4.18.42',twoFactor:{enable2FA:false,hasSecret:false},network:{host:'::',port:6099,loginRate:10,disableWebUI:false,accessControlMode:'none',ipWhitelist:[],ipBlacklist:[],enableXForwardedFor:false},before:null,after:null,writeCode:0,writeError:false,vaultAvailable:true,clients:0};
 const vault={isEncryptionAvailable:()=>state.vaultAvailable,encryptString:s=>Buffer.from(s).map(v=>v^0x5a),decryptString:b=>Buffer.from(b).map(v=>v^0x5a).toString()};
 const registry=new RemoteNapCatRegistry({root,vault,validateOrigin:validateRemoteOrigin,validateTrust:validateRemoteTrust});
 const item=registry.create({label:'Synthetic remote',origin:'https://remote.arcade.invalid',expectedQQ:EXPECTED,token:TOKEN,trust:{},associatedProfileId:null});
 const input={remoteId:item.remoteId,panelId:randomUUID()},requests=[],writes=[],clients=[];
 function transport(){let closed=false;return {close(){closed=true;},async request(route,options={}){
  const failure=(code,submitted=false)=>Object.assign(new Error(`Synthetic ${code}`),{code,submitted});
  if(closed)throw failure('closed');if(options.signal?.aborted)throw failure('cancelled');await state.before?.(route,options);options.assertCurrent?.();if(options.signal?.aborted)throw failure('cancelled');
  options.onAttempt?.();requests.push({route,body:structuredClone(options.body),credential:options.credential});if(WRITE.has(route))writes.push({route,body:structuredClone(options.body)});
  let response;
  if(route==='login'){const hash=createHash('sha256').update(state.token+'.napcat').digest('hex');response=options.body.hash!==hash?{code:-1,data:null}:state.twoFactor.enable2FA&&!options.body.totpCode?{code:0,data:{require2FA:true}}:state.twoFactor.enable2FA&&options.body.totpCode!=='123456'?{code:-1,data:null}:{code:0,data:{Credential:'syntheticCredential',require2FA:false}};}
  else if(route==='version')response={code:0,data:{version:state.version}};
  else if(route==='qqStatus')response={code:0,data:{isLogin:state.isLogin,isOffline:!state.isLogin}};
  else if(route==='qqInfo')response={code:0,data:{uin:state.actualQQ,online:true}};
  else if(route==='networkRead')response={code:0,data:structuredClone(state.network)};
  else if(route==='twoFactorStatus')response={code:0,data:structuredClone(state.twoFactor)};
  else if(route==='twoFactorGenerate'){const secret='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';response={code:0,data:{secret,qrCodeUrl:`otpauth://totp/NapCat%3ANapCat%20WebUI?secret=${secret}&issuer=NapCat&algorithm=SHA1&digits=6&period=30`}};}
  else if(WRITE.has(route)){if(route==='networkWrite')Object.assign(state.network,options.body);if(route==='rotateToken')state.token=options.body.newToken;if(route==='twoFactorEnable')state.twoFactor={enable2FA:true,hasSecret:true};if(route==='twoFactorDisable')state.twoFactor={enable2FA:false,hasSecret:false};if(state.writeError)throw failure('timeout',true);response={code:state.writeCode,data:null};}
  else response={code:0,data:null};
  await state.after?.(route,options,response);return response;
 }};}
 const options={registry,capture:()=>({...input,contextKey:state.context,entry:registry.capture(item.remoteId)}),clientFactory:entry=>{state.clients++;const c=new QQRemoteClient({...entry,now:()=>state.now,transport:transport()});clients.push(c);return c;},now:()=>state.now,monotonic:()=>state.mono,...overrides};
 const session=new QQRemoteSession(options);
 t.after(async()=>{await session.close();const resolved=path.resolve(root);if(!resolved.startsWith(path.resolve(os.tmpdir())+path.sep))throw Error('Unexpected fixture root');fs.rmSync(resolved,{recursive:true,force:true});});
 return {root,state,registry,item,input,options,session,requests,writes,clients,transport,read:()=>session.read(input),async preview(operation,value){const r=await session.read(input);return session.preview({...input,observationId:r.profile.observationId,operation,value});},confirm:r=>session.confirm({...input,ticketId:r.preview.ticketId,expectedDigest:r.preview.expectedDigest})};
}
module.exports={fixture,EXPECTED,TOKEN,CANDIDATE,deferred,flush};
