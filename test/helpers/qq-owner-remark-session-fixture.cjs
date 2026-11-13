'use strict';
// Temporary loopback only. All identities, names and credentials are synthetic.
const {once}=require('node:events');
const {WebSocketServer,WebSocket}=require('ws');
const {QQClient}=require('../../src/bot/qq.cjs');
const {QQOwnerRemarkSession}=require('../../src/bot/qq-owner-remark-session.cjs');
const ACCOUNT='87654321',OWNER='12345678',PANEL='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
async function fixture(t,{panelFactory}={}){
  const server=new WebSocketServer({host:'127.0.0.1',port:0});await once(server,'listening');
  const state={account:ACCOUNT,online:true,remark:' Original 🐳 ',nickname:'Synthetic owner',requests:[],mode:'ok',ownerPresent:true,created:[],visible:true,verify:async()=>({verified:true}),captureCount:0,verifyCount:0};
  server.on('connection',socket=>socket.on('message',bytes=>{
    const req=JSON.parse(bytes);state.requests.push(req);state.before?.(req);
    const reply=data=>{if(socket.readyState===1)socket.send(JSON.stringify({echo:req.echo,status:'ok',retcode:0,data}));};
    if(req.action==='get_login_info')reply({user_id:state.account,nickname:'Synthetic self'});
    else if(req.action==='get_status')reply({online:state.online,good:true});
    else if(req.action==='get_friend_list')reply(state.rows??[...(state.ownerPresent?[{user_id:OWNER,nickname:state.nickname,remark:state.remark}]:[]),{user_id:'99999999',nickname:'PRIVATE_OTHER_NAME',remark:'PRIVATE_OTHER_REMARK'}]);
    else if(req.action==='set_friend_remark'){
      if(state.mode!=='stale')state.remark=req.params.remark;
      if(state.writeGate)return state.writeGate(reply,socket,req);
      if(state.mode==='timeout')return;
      if(state.mode==='disconnect')return socket.terminate();
      if(state.mode==='malformed')return reply({});
      if(state.mode==='failed')return socket.send(JSON.stringify({echo:req.echo,status:'failed',retcode:1200,data:null,message:'PRIVATE_RAW_ERROR'}));
      reply(state.mode==='void'?undefined:null);
    }else throw Error('Unexpected fixture action '+req.action);
  }));
  const options={url:`ws://127.0.0.1:${server.address().port}`,token:'synthetic-remark-token',ownerId:OWNER,expectedAccountId:ACCOUNT,receiveOwnerMessages:false,timeoutMs:120,socketFactory:(url,opts)=>new WebSocket(url,opts)};
  const otherClient=new QQClient(options);await otherClient.connect();
  class SyntheticService{}class SyntheticRuntime{}
  const stable={profileId:'synthetic-profile',profile:new SyntheticService(),generation:1,characterId:'synthetic-character',role:'Synthetic role',runtime:new SyntheticRuntime(),installation:{},runtimeEpoch:1,bridgeRevision:'synthetic-revision',endpointId:'synthetic-endpoint',qqAccountId:ACCOUNT,ownerId:OWNER,url:options.url,token:options.token,channel:'qq',status:'disconnected'};
  const input={accountId:stable.profileId,panelId:PANEL};
  const capture=value=>{state.captureCount++;state.onCapture?.(state.captureCount);if(!state.visible)throw Object.assign(Error('hidden'),{code:'changed'});return {...stable,panelId:value.panelId};};
  const manager=new QQOwnerRemarkSession({capture,verifyContext:(...args)=>{state.verifyCount++;return state.verify(...args);},clientFactory:opts=>{const c=new QQClient({...options,...opts});state.created.push(c);return c;},...(panelFactory?{panelFactory}:{})});
  t.after(async()=>{state.release?.();await manager.close();otherClient.close();for(const s of server.clients)s.terminate();await new Promise(resolve=>server.close(resolve));});
  const read=()=>manager.read(input),set=(row,remark='Changed synthetic remark')=>manager.set({...input,ticketId:row.ticketId,remark});
  return {server,state,stable,input,capture,manager,options,otherClient,read,set,writes:()=>state.requests.filter(req=>req.action==='set_friend_remark')};
}
module.exports={fixture,ACCOUNT,OWNER,PANEL,flush,deferred};
