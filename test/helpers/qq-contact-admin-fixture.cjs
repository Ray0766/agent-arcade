'use strict';
// Synthetic friend directory over real localhost WS; no external bridge.
const {once}=require('node:events'),{WebSocketServer,WebSocket}=require('ws'),assert=require('node:assert/strict');
const {QQClient}=require('../../src/bot/qq.cjs');
const {QQContactAdmin}=require('../../src/bot/qq-contact-admin.cjs');
const {QQContactAdminTransport}=require('../../src/bot/qq-contact-admin-transport.cjs');
const ACCOUNT='87654321',OWNER='12345678',CONTACT='45678901',TARGET=CONTACT,OTHER='34567890';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function fixture(t){
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 const state={account:ACCOUNT,online:true,friends:[OWNER,CONTACT],nickname:'Synthetic friend',remark:'Synthetic remark',ownerNickname:'Synthetic owner',ownerRemark:'Owner remark',requests:[],writeMode:'ok',native:null,deleteNative:{},deleteApply:true,now:1800000000000,mono:100};
 const rows=()=>state.friends.map(user_id=>({user_id,nickname:user_id===OWNER?state.ownerNickname:state.nickname,remark:user_id===OWNER?state.ownerRemark:state.remark,privateExtra:'PRIVATE_EXTRA'}));
 server.on('connection',socket=>socket.on('message',raw=>{
  const request=JSON.parse(raw);state.requests.push(request);state.before?.(request);const reply=data=>{if(socket.readyState===1)socket.send(JSON.stringify({status:'ok',retcode:0,echo:request.echo,data}));};
  if(request.action==='get_login_info')reply({user_id:state.account,nickname:'Synthetic self'});
  else if(request.action==='get_status')reply({online:state.online,good:true});
  else if(request.action==='get_friend_list'){assert.ok(request.params.no_cache===true||request.params.no_cache===false);reply(state.listOverride??rows());}
  else if(['set_friend_remark','delete_friend'].includes(request.action)){
   const p=request.params;if(request.action==='set_friend_remark'){assert.deepEqual(Object.keys(p).sort(),['remark','user_id']);if(state.writeMode!=='stale'){if(p.user_id===OWNER)state.ownerRemark=p.remark;else state.remark=p.remark;}}
   else {assert.deepEqual(Object.keys(p).sort(),['temp_block','temp_both_del','user_id']);assert.equal(typeof p.temp_block,'boolean');assert.equal(typeof p.temp_both_del,'boolean');if(state.writeMode!=='stale'&&state.deleteApply)state.friends=state.friends.filter(x=>x!==p.user_id);}
   if(state.writeMode==='timeout')return;if(state.writeMode==='disconnect'){socket.terminate();return;}if(state.writeMode==='failure'){socket.send(JSON.stringify({status:'failed',retcode:1400,echo:request.echo,data:null,message:'PRIVATE_ERROR'}));return;}if(state.writeMode==='wrong-echo'){socket.send(JSON.stringify({status:'ok',retcode:0,echo:'other',data:null}));return;}if(state.writeMode==='malformed-status'){socket.send(JSON.stringify({status:'ok',retcode:'0',echo:request.echo,data:null}));return;}
   reply(request.action==='delete_friend'?state.deleteNative:state.native);if(state.writeMode==='account-after-ack')state.account=OTHER;
  }else assert.fail('Unexpected fixed action '+request.action);state.after?.(request);
 }));
 const options={url:`ws://127.0.0.1:${server.address().port}`,token:'synthetic-local-token',ownerId:OWNER,expectedAccountId:ACCOUNT,receiveOwnerMessages:false,timeoutMs:100,socketFactory:(url,options)=>new WebSocket(url,options)};
 const client=new QQClient(options);await client.connect();const binding={profile:{},profileId:'synthetic-profile',generation:1,characterId:'synthetic-character',runtime:{},installation:{},runtimeEpoch:1,bridgeRevision:'synthetic-bridge',endpointId:'synthetic-endpoint',accountId:ACCOUNT,ownerId:OWNER,client};
 const transport=new QQContactAdminTransport({now:()=>state.now}),controller=new QQContactAdmin({getBinding:()=>binding,transport,now:()=>state.now,monotonic:()=>state.mono,timeoutMs:2000});
 t.after(async()=>{await controller.close();client.close();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));});
 const preview=async(operation='remark',value='New synthetic remark',contactId=CONTACT)=>{const read=await controller.read({contactId});return controller.preview({observationId:read.observationId,operation,value});};
 return {state,options,client,binding,controller,transport,preview,server,writes:()=>state.requests.filter(row=>['set_friend_remark','delete_friend'].includes(row.action))};
}
module.exports={fixture,ACCOUNT,OWNER,CONTACT,TARGET,OTHER,flush,deferred};
