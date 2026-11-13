'use strict';
// Real localhost WS and production client; all identities/content are synthetic.
const {once}=require('node:events'),{WebSocketServer,WebSocket}=require('ws');
const assert=require('node:assert/strict');
const {QQClient}=require('../../src/bot/qq.cjs');
const {QQGroupAdmin}=require('../../src/bot/qq-group-admin.cjs');
const {QQGroupAdminTransport}=require('../../src/bot/qq-group-admin-transport.cjs');
const ACCOUNT='87654321',OWNER='12345678',GROUP='23456789',TARGET='45678901',OTHER='34567890';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};};
async function fixture(t){
 const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
 const state={account:ACCOUNT,online:true,role:'owner',name:'Synthetic group',groups:[GROUP,OTHER],members:[ACCOUNT,TARGET],targetRole:'member',card:'Synthetic card',muteUntil:0,whole:0,requests:[],writeMode:'ok',native:null,now:1800000000000,mono:100};
 const member=user=>({group_id:GROUP,user_id:user,nickname:user===ACCOUNT?'Synthetic self':'Synthetic member',role:user===ACCOUNT?state.role:state.targetRole,card:user===ACCOUNT?(state.selfCard??'Self card'):state.card,shut_up_timestamp:user===ACCOUNT?0:state.muteUntil,privateExtra:'PRIVATE_MEMBER'});
 server.on('connection',socket=>socket.on('message',raw=>{
  const request=JSON.parse(raw);state.requests.push(request);state.before?.(request);
  const reply=data=>{if(socket.readyState===1)socket.send(JSON.stringify({status:'ok',retcode:0,echo:request.echo,data}));};
  if(request.action==='get_login_info')reply({user_id:state.account,nickname:'Synthetic identity'});
  else if(request.action==='get_status')reply({online:state.online,good:true});
  else if(request.action==='get_group_list'){assert.deepEqual(request.params,{no_cache:true});reply(state.listOverride??state.groups.map(group_id=>({group_id,group_name:state.listName??state.name,privateExtra:'PRIVATE_LIST'})));}
  else if(request.action==='get_group_member_info'){assert.deepEqual(Object.keys(request.params).sort(),['group_id','no_cache','user_id']);assert.equal(request.params.group_id,GROUP);assert.equal(request.params.no_cache,true);reply((request.params.user_id===ACCOUNT?state.selfOverride:state.targetOverride)??member(request.params.user_id));}
  else if(request.action==='get_group_member_list'){assert.deepEqual(request.params,{group_id:GROUP,no_cache:true});reply(state.membersOverride??state.members.map(member));}
  else if(request.action==='get_group_detail_info'){assert.deepEqual(request.params,{group_id:GROUP});if(state.detailFailure==='timeout')return;if(state.detailFailure==='action_failed')socket.send(JSON.stringify({status:'failed',retcode:1400,echo:request.echo,data:null,message:'PRIVATE_ERROR'}));else reply(state.detailOverride??{group_id:GROUP,groupCode:GROUP,shutUpAllTimestamp:state.whole,group_all_shut:state.whole>0?-1:0,privateExtra:'PRIVATE_DETAIL'});}
  else if(request.action.startsWith('set_group_')){
   const p=request.params;assert.equal(p.group_id,GROUP);
   const keys={set_group_card:['group_id','user_id','card'],set_group_ban:['group_id','user_id','duration'],set_group_whole_ban:['group_id','enable'],set_group_admin:['group_id','user_id','enable'],set_group_kick:['group_id','user_id','reject_add_request'],set_group_leave:['group_id','is_dismiss']}[request.action];assert.ok(keys);assert.deepEqual(Object.keys(p).sort(),keys.sort());
   if(state.writeMode!=='stale'){if(request.action==='set_group_card'){if(p.user_id===ACCOUNT)state.selfCard=p.card;else state.card=p.card;}else if(request.action==='set_group_ban')state.muteUntil=p.duration?Math.floor(state.now/1000)+p.duration:0;else if(request.action==='set_group_whole_ban')state.whole=p.enable?1:0;else if(request.action==='set_group_admin')state.targetRole=p.enable?'admin':'member';else if(request.action==='set_group_kick')state.members=state.members.filter(id=>id!==p.user_id);else if(request.action==='set_group_leave')state.groups=state.groups.filter(id=>id!==GROUP);}
   if(state.writeMode==='timeout')return;if(state.writeMode==='disconnect'){socket.terminate();return;}if(state.writeMode==='failure'){socket.send(JSON.stringify({status:'failed',retcode:1400,echo:request.echo,data:null,message:'PRIVATE_ERROR'}));return;}if(state.writeMode==='wrong-echo'){socket.send(JSON.stringify({status:'ok',retcode:0,echo:'other',data:null}));return;}if(state.writeMode==='malformed-status'){socket.send(JSON.stringify({status:'ok',retcode:'0',echo:request.echo,data:null}));return;}
   reply(state.native);if(state.writeMode==='account-after-ack')state.account='99999999';
  }else assert.fail('Unexpected fixed action '+request.action);
  state.after?.(request);
 }));
 const options={url:`ws://127.0.0.1:${server.address().port}`,token:'synthetic-local-token',ownerId:OWNER,expectedAccountId:ACCOUNT,receiveOwnerMessages:false,timeoutMs:100,socketFactory:(url,options)=>new WebSocket(url,options)};
 const client=new QQClient(options);await client.connect();const binding={profile:{},profileId:'synthetic-profile',generation:1,characterId:'synthetic-character',runtime:{},installation:{},runtimeEpoch:1,bridgeRevision:'synthetic-bridge',endpointId:'synthetic-endpoint',accountId:ACCOUNT,client};
 const transport=new QQGroupAdminTransport({now:()=>state.now}),controller=new QQGroupAdmin({getBinding:()=>binding,transport,now:()=>state.now,monotonic:()=>state.mono,timeoutMs:2000});
 t.after(async()=>{await controller.close();client.close();for(const socket of server.clients)socket.terminate();await new Promise(resolve=>server.close(resolve));});
 const preview=async(operation='card',value='New synthetic card',memberId=['card','ban','admin','kick'].includes(operation)?TARGET:undefined)=>{const row=await controller.read({groupId:GROUP,...(memberId?{memberId}:{})});return controller.preview({observationId:row.observationId,operation,...(['leave','dissolve'].includes(operation)?{}:{value})});};
 return {state,client,binding,controller,transport,preview,options,server,writes:()=>state.requests.filter(row=>row.action.startsWith('set_group_'))};
}
module.exports={fixture,ACCOUNT,OWNER,GROUP,TARGET,OTHER,flush,deferred};
