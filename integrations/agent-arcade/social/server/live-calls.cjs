'use strict';
const {randomUUID}=require('node:crypto');
const {fail}=require('./store.cjs');

function createLiveCalls(store,groupBusy=()=>false){
  const byAccount=new Map();
  const remove=call=>{
    byAccount.delete(call.caller);
    byAccount.delete(call.callee);
  };
  function active(account){
    const call=byAccount.get(account);
    if(!call)return;
    const chat=store.access(account,call.chat);
    if(Date.now()>Math.min(call.callerUntil,call.calleeUntil)||chat.friendRemoved||
       chat.membershipRevision!==call.revisions[account]){
      remove(call);
      return;
    }
    return call;
  }
  const sweep=setInterval(()=>{
    for(const call of byAccount.values())
      if(Date.now()>Math.min(call.callerUntil,call.calleeUntil))remove(call);
  },30000);
  sweep.unref();
  function handle(account,session,device,body,known){
    if(!/^[a-f0-9-]{36}$/u.test(device))fail(400,'call_device','通话窗口无效');
    const owner=session+'/'+device;
    let call=active(account);
    if(body?.action==='dial'){
      const chat=store.writableChat(account,body.chat);
      const peer=chat.first_user===account?chat.second_user:chat.first_user;
      if(chat.type!=='direct'||store.user(peer).kind!=='human'||!['audio','video'].includes(body.kind))
        fail(403,'call_unavailable','只能呼叫真人好友');
      if(call||active(peer)||groupBusy(account)||groupBusy(peer))fail(409,'call_busy','已有通话，请稍后重试');
      call={id:randomUUID(),chat:chat.id,kind:body.kind,caller:account,callee:peer,callerOwner:owner,
        revisions:{[account]:chat.membershipRevision,[peer]:store.access(peer,chat.id).membershipRevision},
        callerUntil:Date.now()+45000,calleeUntil:Date.now()+45000};
      byAccount.set(account,call);
      byAccount.set(peer,call);
    }else if(body&&(!call||body.id!==call.id))fail(409,'call_ended','通话已结束');
    if(!call)return {call:null};
    const outgoing=account===call.caller;
    const bound=outgoing?call.callerOwner:call.calleeOwner;
    if(bound&&bound!==owner){
      if(body)fail(409,'call_device','其他窗口正在通话');
      return {call:null};
    }
    if(body&&body.action!=='dial'){
      switch(body.action){
        case 'accept':
          if(outgoing)fail(403,'call_direction','仅接听方可操作');
          call.calleeOwner=owner;
          break;
        case 'end':
          remove(call);
          return {call:null};
        case 'signal': {
          const field=outgoing?'offer':'answer';
          if(!call.calleeOwner||(!outgoing&&!call.offer)||typeof body.sdp!=='string'||
              !body.sdp.startsWith('v=0')||body.sdp.length>60000||(call[field]&&call[field]!==body.sdp))
            fail(409,'call_signal','通话协商状态已改变');
          call[field]=body.sdp;
          break;
        }
        default: fail(400,'call_action','通话操作无效');
      }
    }
    if(call.calleeOwner)call[outgoing?'callerUntil':'calleeUntil']=Date.now()+45000;
    const peer=outgoing?call.callee:call.caller;
    const remote=outgoing?call.answer:call.offer;
    return {call:{id:call.id,chat:call.chat,kind:call.kind,outgoing,accepted:!!call.calleeOwner,
      peer,displayName:store.user(peer).displayName,...(remote&&known!==call.id&&{remote})}};
  }
  function disconnect(session){
    if(!session)return;
    for(const call of byAccount.values()){
      if([call.callerOwner,call.calleeOwner].some(owner=>owner?.startsWith(session+'/')))remove(call);
    }
  }
  return {handle,disconnect,isBusy:account=>!!active(account),close:()=>clearInterval(sweep)};
}
module.exports={createLiveCalls};
