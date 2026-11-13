'use strict';
// Public synthetic values; real registry/session/client, no network or user vault.
const {createHash}=require('node:crypto');
const Base=require('./qq-remote-session-fixture.cjs');
const {QQRemoteClient}=require('../../src/bot/qq-remote-client.cjs');
const QR=require('qrcode');
const URL_A='https://txz.qq.com/p?k=synthetic-code-a&f=1600001604',URL_B='https://txz.qq.com/p?k=synthetic-code-b&f=1600001604';
const WRITES=new Set(['qqRefreshQR','qqQuickLogin']);
function fixture(t){
 const f=Base.fixture(t),state={token:Base.TOKEN,version:'4.18.42',status:{isLogin:false,isOffline:false,coreReady:false,qrLoginAccepted:false,loginPhase:'waiting_qrcode',qrcodeurl:URL_A,loginError:''},info:{uin:'',online:false},quick:[Base.EXPECTED],before:null,after:null,writeCode:0,writeError:false,require2FA:false,omitCore:false,clients:0,closed:0};
 const calls=[],writes=[],encodes=[];
 function transport(){let closed=false;return {close(){closed=true;state.closed++;},async request(route,o={}){
  const error=(code,submitted=false)=>Object.assign(new Error('Synthetic transport failure'),{code,submitted});
  if(closed||o.signal?.aborted)throw error('cancelled');
  await state.before?.(route,o);o.assertCurrent?.();if(o.signal?.aborted)throw error('cancelled');
  o.onAttempt?.();calls.push({route,body:structuredClone(o.body)});
  let response;
  if(route==='login'){const hash=createHash('sha256').update(state.token+'.napcat').digest('hex');response=o.body.hash!==hash?{code:-1,data:null}:state.require2FA&&!o.body.totpCode?{code:0,data:{require2FA:true}}:state.require2FA&&o.body.totpCode!=='123456'?{code:-1,data:null}:{code:0,data:{Credential:'syntheticLoginCredential'}};}
  else if(route==='version')response={code:0,data:{version:state.version}};
  else if(route==='qqStatus'){const data=structuredClone(state.status);if(state.omitCore)delete data.coreReady;response={code:0,data};}
  else if(route==='qqInfo')response={code:0,data:structuredClone(state.info)};
  else if(route==='qqQuickList')response={code:0,data:structuredClone(state.quick)};
  else if(route==='qqQRCode')response={code:0,data:{qrcode:state.status.qrcodeurl}};
  else if(WRITES.has(route)){writes.push({route,body:structuredClone(o.body)});if(route==='qqRefreshQR')state.status.qrcodeurl=URL_B;if(state.writeError)throw error('timeout',true);response={code:state.writeCode,data:route==='qqRefreshQR'?{qrcodeurl:state.status.qrcodeurl}:null};}
  else if(route==='networkRead')response={code:0,data:structuredClone(f.state.network)};
  else if(route==='twoFactorStatus')response={code:0,data:structuredClone(f.state.twoFactor)};
  else response={code:0,data:null};
  await state.after?.(route,o,response);return response;
 }};}
 f.session.clientFactory=entry=>{state.clients++;return new QQRemoteClient({...entry,now:()=>f.state.now,transport:transport()});};
 f.session.qrEncoder=async url=>{encodes.push(url);return QR.toDataURL(url,{width:280,margin:4,errorCorrectionLevel:'M'});};
 function tick(ms=3000){f.state.mono+=ms;f.state.now+=ms;}
 function matched(qq=Base.EXPECTED){state.status={...state.status,isLogin:true,isOffline:false,coreReady:true,qrLoginAccepted:false,loginPhase:'ready'};state.info={uin:qq,online:true};}
 const open=extra=>f.session.loginOpen({...f.input,...extra});
 const req=r=>({...f.input,loginId:r.login.loginId});
 const preview=async(operation='refreshQR')=>{const r=await open();const p=await f.session.loginPreview({...req(r),observationId:r.login.observationId,operation});return {r,p};};
 return {...f,server:state,calls,writes,encodes,transport,tick,matched,open,req,preview,confirm:p=>f.session.loginConfirm({...f.input,loginId:p.preview.loginId,ticketId:p.preview.ticketId,expectedDigest:p.preview.expectedDigest})};
}
module.exports={fixture,URL_A,URL_B,...Object.fromEntries(['EXPECTED','TOKEN','CANDIDATE','deferred','flush'].map(k=>[k,Base[k]]))};

