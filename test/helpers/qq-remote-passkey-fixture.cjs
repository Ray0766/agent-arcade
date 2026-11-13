'use strict';
// Synthetic authenticator outputs and fixed HTTP only; no signature/Hello/remote acceptance claim.
const {createHash}=require('node:crypto');
const base=require('./qq-remote-session-fixture.cjs');
const {QQRemoteClient}=require('../../src/bot/qq-remote-client.cjs');
const ORIGIN='https://remote.arcade.invalid',RP='remote.arcade.invalid';
const ID=Buffer.from('synthetic-existing-credential-id').toString('base64url'),NEW_ID=Buffer.from('synthetic-new-credential-id').toString('base64url');
const b64=value=>Buffer.from(value).toString('base64url');
function publicKey(kind){const challenge=b64('synthetic-32-byte-challenge-data!!');return kind==='register'?{challenge,rp:{id:RP,name:'NapCat WebUI'},user:{id:b64('napcat-user'),name:'NapCat User',displayName:''},pubKeyCredParams:[{type:'public-key',alg:-8},{type:'public-key',alg:-7},{type:'public-key',alg:-257}],timeout:60000,attestation:'none',excludeCredentials:[{id:ID,type:'public-key',transports:['usb']}],authenticatorSelection:{userVerification:'preferred'},extensions:{credProps:true},hints:[]}:{rpId:RP,challenge,allowCredentials:[{id:ID,type:'public-key',transports:['usb']}],timeout:60000,userVerification:'preferred'};}
function nativeResponse(kind,input){
 const {origin=ORIGIN,rpId=RP}=input,options=input.publicKey||publicKey(kind),clientDataJSON=b64(JSON.stringify({type:kind==='register'?'webauthn.create':'webauthn.get',challenge:options.challenge,origin,crossOrigin:false}));
 const auth=Buffer.concat([createHash('sha256').update(rpId).digest(),Buffer.from([5,0,0,0,1])]);
 return {id:kind==='register'?NEW_ID:ID,rawId:kind==='register'?NEW_ID:ID,type:'public-key',response:kind==='register'?{clientDataJSON,attestationObject:b64('synthetic-attestation-not-cryptographically-verified'),transports:['usb']}:{clientDataJSON,authenticatorData:auth.toString('base64url'),signature:b64('synthetic-signature-not-cryptographically-verified'),userHandle:b64('napcat-user')},clientExtensionResults:{}};
}
function fixture(t){
 const f=base.fixture(t),nativeCalls=[],passkeyWrites=[];Object.assign(f.state,{passkeyBefore:null,passkeyAfter:null,beforeNative:null,afterNative:null,passkeyOptions:null,passkeyVerifyData:null,passkeyError:false,nativeSupported:true,windowContext:{parentHwnd:'0x1234',ownerPid:1234},qqOnline:true});
 f.session.clientFactory=entry=>{
  f.state.clients++;const fallback=f.transport();let closed=false;
  const transport={close(){closed=true;fallback.close();},async request(route,options={}){
   if(!route.startsWith('passkey')&&!['qqStatus','qqInfo','qqQuickList'].includes(route))return fallback.request(route,options);
   const fail=(code,submitted=false)=>{throw Object.assign(new Error('Synthetic fixture failure'),{code,submitted});};
   if(closed)fail('closed');await f.state.passkeyBefore?.(route,options);options.assertCurrent?.();if(options.signal?.aborted)fail('cancelled');options.onAttempt?.();if(options.signal?.aborted)fail('cancelled');
   f.requests.push({route,body:structuredClone(options.body),credential:options.credential});let response;
   if(route==='passkeyRegistrationOptions'||route==='passkeyAuthenticationOptions')response={code:0,data:f.state.passkeyOptions||publicKey(route==='passkeyRegistrationOptions'?'register':'authenticate')};
   else if(route.endsWith('Verify')){passkeyWrites.push({route,body:structuredClone(options.body)});if(f.state.passkeyError)fail('timeout',true);response={code:0,data:f.state.passkeyVerifyData??(route==='passkeyRegistrationVerify'?{verified:true}:{Credential:'syntheticPasskeyCredential'})};}
   else if(route==='qqStatus')response={code:0,data:{isLogin:f.state.isLogin,isOffline:!f.state.isLogin,coreReady:f.state.isLogin,qrLoginAccepted:f.state.isLogin,loginPhase:f.state.isLogin?'ready':'waiting_qrcode',qrcodeurl:''}};
   else if(route==='qqInfo')response={code:0,data:{uin:f.state.isLogin?f.state.actualQQ:'',online:f.state.isLogin&&f.state.qqOnline}};
   else response={code:0,data:[]};
   await f.state.passkeyAfter?.(route,options,response);return structuredClone(response);
  }};
  const client=new QQRemoteClient({...entry,transport,now:()=>f.state.now});f.clients.push(client);return client;
 };
 const bridge={async availability(){return {protocol:1,supported:f.state.nativeSupported,apiVersion:4,platformAuthenticatorAvailable:false,abiVerified:true};}};
 for(const [method,kind]of [['create','register'],['get','authenticate']])bridge[method]=async(input,options)=>{options.assertCurrent?.();nativeCalls.push({kind,input:structuredClone(input)});await f.state.beforeNative?.(kind,input,options);const response=nativeResponse(kind,input);await f.state.afterNative?.(kind,input,response);return response;};
 f.session.passkeyBridge=bridge;f.session.getPasskeyContext=()=>f.state.windowContext;
 return {...f,nativeCalls,passkeyWrites,bridge,async passkeyPreview(){const r=await f.read();return f.session.passkeyPreview({...f.input,observationId:r.profile.observationId});},passkeyConfirm:r=>f.session.passkeyConfirm({...f.input,ticketId:r.preview.ticketId,expectedDigest:r.preview.expectedDigest}),authenticate:()=>f.session.passkeyAuthenticate(f.input)};
}
module.exports={fixture,publicKey,nativeResponse,ORIGIN,RP,ID,NEW_ID,b64,...Object.fromEntries(['EXPECTED','TOKEN','CANDIDATE','deferred','flush'].map(k=>[k,base[k]]))};
