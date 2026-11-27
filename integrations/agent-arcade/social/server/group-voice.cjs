'use strict';
const {randomUUID}=require('node:crypto');
const {fail}=require('./store.cjs');

const lease=45_000;
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const ended=()=>fail(409,'group_voice_ended','本次群语音已结束，请重新加入');
const busy=()=>fail(409,'call_busy','已有通话，请先离开当前通话');

function createGroupVoice(store,privateBusy,now=Date.now){
  const rooms=new Map(), seated=new Map(), retired=new Map();
  function remove(room,person){
    room.members.delete(person.number);
    seated.delete(person.number);
    retired.set(person.attempt,now()+lease);
    for(const other of room.members.values())other.inbox.delete(person.id);
    if(!room.members.size)rooms.delete(room.chat);
  }
  function roster(chat){
    return store.all("SELECT m.account,u.kind,COALESCE(r.revision,m.chat||'/'||m.account) AS revision "+
      'FROM members m JOIN users u ON u.number=m.account LEFT JOIN conversation_membership_revisions r '+
      'ON r.chat=m.chat AND r.account=m.account WHERE m.chat=? LIMIT 4',chat);
  }
  function eligible(rows){return rows.length<=3&&rows.every(row=>row.kind==='human');}
  function refresh(room,rows){
    for(const p of room.members.values()){
      if(!eligible(rows)||p.until<=now()||!rows.some(row=>row.account===p.number&&row.revision===p.revision)||
        !store.one('SELECT 1 FROM sessions WHERE digest=? AND account=? AND expires>?',p.session,p.number,now()))
        remove(room,p);
    }
  }
  function isBusy(number){
    const room=seated.get(number);
    if(room)refresh(room,roster(room.chat));
    return seated.has(number);
  }
  // Only called for conversations already selected for the authenticated viewer.
  function summary(conversation){
    const room=rooms.get(conversation.id);
    if(!room)return;
    refresh(room,roster(room.chat));
    if(room.members.size)return {id:room.id,numbers:[...room.members.keys()]};
  }
  function project(room,self){
    if(!room)return {room:null};
    return {room:{id:room.id,chat:room.chat,
      participants:Array.from(room.members.values(),p=>({number:p.number,id:p.id})),
      self:self?.id??null,...(self&&{signals:Array.from(self.inbox.values())})}};
  }
  function handle(account,session,chat,device,request){
    if(typeof device!=='string'||!uuid.test(device))fail(400,'call_device','通话窗口无效');
    const group=store.group(account,chat);
    if(request.revision!==group.membershipRevision)fail(409,'group_voice_revision','群成员身份已变更，请重新打开群聊');
    const rows=roster(chat);
    let room=rooms.get(chat);
    if(room){
      refresh(room,rows);
      room=rooms.get(chat);
    }
    if(!eligible(rows)||(!room&&rows.length!==3))fail(403,'group_voice_unavailable','此群暂不支持三人语音');
    const current=room?.members.get(account);
    const mine=current?.session===session&&current.device===device?current:null;
    if(request.action==='join'){
      if(typeof request.joinId!=='string'||!uuid.test(request.joinId))fail(400,'group_voice_join','入场标识无效');
      if(request.roomId!==undefined&&request.roomId!==room?.id)ended();
      const attempt=session+'/'+device+'/'+request.joinId;
      if(retired.has(attempt))ended();
      if(mine?.attempt===attempt){
        mine.until=now()+lease;
        return project(room,mine);
      }
      if(privateBusy(account)||isBusy(account))busy();
      if(!room)room={id:randomUUID(),chat,members:new Map()};
      const participant={number:account,id:randomUUID(),revision:group.membershipRevision,
        session,device,attempt,until:now()+lease,inbox:new Map()};
      room.members.set(account,participant);
      rooms.set(chat,room);
      seated.set(account,room);
      return project(room,participant);
    }
    if(request.action==='poll'&&!request.self&&!request.roomId)return project(room,null);
    if(!mine||request.roomId!==room.id||request.self!==mine.id)ended();
    switch(request.action){
      case 'poll':
        mine.until=now()+lease;
        return project(room,mine);
      case 'leave':
        remove(room,mine);
        return {ok:true};
      case 'ice':
        return {iceServers:[]};
      case 'signal':{
        const peer=Array.from(room.members.values()).find(p=>p.id===request.to);
        if(!peer||peer===mine)fail(409,'group_voice_peer','对方已离开本次群语音');
        const type=account<peer.number?'offer':'answer';
        const {sdp}=request;
        if(request.type!==type||typeof sdp!=='string'||sdp.length>60000||!/^v=0\r?\n/u.test(sdp)||
          !/^m=audio /mu.test(sdp)||/^m=(?!audio )/mu.test(sdp)||
          (type==='answer'&&!mine.inbox.has(peer.id)))
          fail(409,'group_voice_signal','语音协商状态已改变');
        const previous=peer.inbox.get(mine.id);
        if(previous&&previous.sdp!==sdp)fail(409,'group_voice_signal','请重新加入以协商连接');
        peer.inbox.set(mine.id,{from:mine.id,type,sdp});
        return {ok:true};
      }
      default: fail(400,'group_voice_action','群语音操作无效');
    }
  }
  function disconnect(session){
    for(const room of rooms.values())
      for(const p of room.members.values())if(p.session===session)remove(room,p);
  }
  const sweep=setInterval(()=>{
    for(const room of rooms.values())refresh(room,roster(room.chat));
    for(const [attempt,until] of retired)if(until<=now())retired.delete(attempt);
  },lease);
  sweep.unref();
  return {handle,disconnect,isBusy,summary,close:()=>clearInterval(sweep)};
}
module.exports={createGroupVoice};
