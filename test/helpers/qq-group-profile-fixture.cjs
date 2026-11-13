'use strict';
// Real localhost WS, synthetic protocol data; never connects to a real bridge.
const {once}=require('node:events'),{WebSocketServer,WebSocket}=require('ws');
const assert=require('node:assert/strict');
const {QQClient}=require('../../src/bot/qq.cjs');
const {QQGroupProfile}=require('../../src/bot/qq-group-profile.cjs');
const {QQGroupProfileTransport}=require('../../src/bot/qq-group-profile-transport.cjs');
const ACCOUNT='87654321',OWNER='12345678',GROUP='23456789',OTHER='34567890';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function fixture(t){
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 const state={account:ACCOUNT,online:true,role:'owner',name:'Synthetic group',groups:[GROUP,OTHER],requests:[],writeMode:'ok',native:null,now:1800000000000,mono:100};
 server.on('connection',socket=>socket.on('message',raw=>{
  const request=JSON.parse(raw);state.requests.push(request);state.before?.(request);
  const reply=data=>{if(socket.readyState===1)socket.send(JSON.stringify({status:'ok',retcode:0,echo:request.echo,data}));};
  if(request.action==='get_login_info')reply({user_id:state.account,nickname:'Synthetic identity'});
  else if(request.action==='get_status')reply({online:state.online,good:true});
  else if(request.action==='get_group_list'){assert.deepEqual(request.params,{no_cache:true});reply(state.listOverride??state.groups.map(group_id=>({group_id,group_name:state.listName??state.name,privateExtra:'PRIVATE_LIST'})));}
  else if(request.action==='get_group_info'){assert.deepEqual(request.params,{group_id:GROUP});reply(state.infoOverride??{group_id:GROUP,group_name:state.name,privateExtra:'PRIVATE_DETAIL'});}
  else if(request.action==='get_group_member_info'){assert.deepEqual(request.params,{group_id:GROUP,user_id:ACCOUNT,no_cache:true});reply(state.memberOverride??{group_id:GROUP,user_id:ACCOUNT,role:state.role,nickname:'PRIVATE_MEMBER',card:'PRIVATE_CARD'});}
  else if(request.action==='set_group_name'){
   assert.deepEqual(Object.keys(request.params).sort(),['group_id','group_name']);assert.equal(request.params.group_id,GROUP);
   if(state.writeMode!=='stale')state.name=request.params.group_name;
   if(state.writeMode==='timeout')return;
   if(state.writeMode==='disconnect'){socket.terminate();return;}
   if(state.writeMode==='failure'){socket.send(JSON.stringify({status:'failed',retcode:1400,echo:request.echo,data:null,message:'PRIVATE_ERROR'}));return;}
   if(state.writeMode==='wrong-echo'){socket.send(JSON.stringify({status:'ok',retcode:0,echo:'other',data:null}));return;}
   if(state.writeMode==='malformed-status'){socket.send(JSON.stringify({status:'ok',retcode:'0',echo:request.echo,data:null}));return;}
   reply(state.native);if(state.writeMode==='account-after-ack')state.account='99999999';
  }else assert.fail('Unexpected fixed action '+request.action);
  state.after?.(request);
 }));
 const options={url:`ws://127.0.0.1:${server.address().port}`,token:'synthetic-local-token',ownerId:OWNER,expectedAccountId:ACCOUNT,receiveOwnerMessages:false,timeoutMs:100,socketFactory:(url,options)=>new WebSocket(url,options)};
 const client=new QQClient(options);await client.connect();
 const binding={profile:{},profileId:'synthetic-profile',generation:1,characterId:'synthetic-character',runtime:{},installation:{},runtimeEpoch:1,bridgeRevision:'synthetic-bridge',endpointId:'synthetic-endpoint',accountId:ACCOUNT,client};
 const transport=new QQGroupProfileTransport({now:()=>state.now});const controller=new QQGroupProfile({getBinding:()=>binding,transport,now:()=>state.now,monotonic:()=>state.mono,timeoutMs:2000});
 t.after(async()=>{await controller.close();client.close();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));});
 const preview=async(value='New synthetic group')=>{const row=await controller.read({groupId:GROUP});return controller.preview({observationId:row.observationId,field:'name',value});};
 return {state,client,binding,controller,transport,preview,options,server,writes:()=>state.requests.filter(row=>row.action==='set_group_name')};
}
module.exports={fixture,ACCOUNT,OWNER,GROUP,OTHER,flush,deferred};
