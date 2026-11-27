// The server exchanges the two complete ICE descriptions. Media travels between peers.
export function mountLiveCalls({api,account,goChat,chat}){
  const get=id=>document.getElementById(id);
  const panel=get('live-call'), remote=get('call-remote'), local=get('call-local');
  const device=crypto.randomUUID?.();
  let active, dismissed, revision=0, polling=false, dialing=false;
  const route='/calls/'+device;
  function controls(message,{incoming=false,terminal=false}={}){
    panel.hidden=false;
    get('call-status').textContent=message;
    get('call-accept').hidden=!incoming;
    get('call-end').textContent=terminal?'关闭':incoming?'拒绝':'挂断';
  }
  function reset(message){
    revision++;
    dialing=false;
    const old=active;
    if(old)dismissed=old.id;
    active=null;
    clearTimeout(old?.deadline);
    old?.pc?.close();
    old?.stream?.getTracks().forEach(track=>track.stop());
    for(const el of [remote,local]){
      el.srcObject=null;
      el.hidden=true;
    }
    get('call-play').hidden=true;
    panel.hidden=true;
    if(message)controls(message,{terminal:true});
  }
  function send(body,who=account()){
    return api(route,body,{expectedAccount:who});
  }
  function end(message){
    const c=active;
    reset(message);
    if(c)void send({action:'end',id:c.id},c.account).catch(()=>{});
  }
  function mediaError(error){
    if(error.name==='NotAllowedError')return '设备权限未获准，请允许麦克风或摄像头后重拨。';
    if(error.name==='NotFoundError')return '找不到通话设备，请连接后重拨。';
    return '未能建立媒体连接，请检查设备和网络后重拨。';
  }
  async function negotiate(c,offer){
    try{
      if(c.kind==='video'&&window.arcadeCallCamera&&
         !await window.arcadeCallCamera.prepare({account:c.account,device,id:c.id}))throw new DOMException('camera','NotAllowedError');
      if(active!==c)return;
      const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:c.kind==='video'});
      if(active!==c){stream.getTracks().forEach(track=>track.stop());return;}
      c.stream=stream;
      if(c.kind==='video'){local.srcObject=stream;local.hidden=false;}
      const pc=c.pc=new RTCPeerConnection({iceServers:[]});
      for(const track of stream.getTracks()){
        track.addEventListener('ended',()=>{if(active===c)end('通话设备已断开，请重新连接后重拨。');},{once:true});
        if(track.readyState==='ended')throw Error('device_ended');
        pc.addTrack(track,stream);
      }
      pc.ontrack=event=>{
        if(active!==c)return;
        if(remote.srcObject===event.streams[0])return;
        remote.srcObject=event.streams[0];
        remote.hidden=c.kind!=='video';
        remote.play().catch(()=>{if(active===c)get('call-play').hidden=false;});
      };
      pc.onconnectionstatechange=()=>{
        if(active!==c)return;
        if(pc.connectionState==='connected'){
          clearTimeout(c.deadline);
          controls(c.displayName+' · '+(c.kind==='video'?'视频':'语音')+'通话中');
        }
        if(pc.connectionState==='failed')end('媒体连接中断，通话已结束。');
      };
      if(!c.outgoing)await pc.setRemoteDescription({type:'offer',sdp:offer});
      await pc.setLocalDescription(c.outgoing?await pc.createOffer():await pc.createAnswer());
      if(pc.iceGatheringState!=='complete'){
        await new Promise(resolve=>{
          const finish=()=>{clearTimeout(timer);pc.removeEventListener('icegatheringstatechange',changed);resolve();};
          const changed=()=>{if(pc.iceGatheringState==='complete')finish();};
          const timer=setTimeout(finish,4000);
          pc.addEventListener('icegatheringstatechange',changed);
        });
      }
      if(active===c)await send({action:'signal',id:c.id,sdp:pc.localDescription.sdp},c.account);
    }catch(error){if(active===c)end(mediaError(error));}
  }
  function apply(data){
    if(!data){if(active)reset('通话已结束。');return;}
    if(data.id===dismissed)return;
    if(active?.id!==data.id){
      reset();
      active={...data,account:account(),lastSeen:Date.now()};
      const type=data.kind==='video'?'视频':'语音';
      controls(data.outgoing?'正在呼叫 '+data.displayName+' · '+type:data.displayName+' 邀请你'+type+'通话',{incoming:!data.outgoing});
      get('call-play').hidden=true;
    }
    const c=active;
    if(!data.accepted)return;
    if(!c.deadline&&!c.started){
      controls('正在与 '+c.displayName+' 建立连接…');
      c.deadline=setTimeout(()=>{if(active===c)end('连接超时，请重拨。');},30000);
    }
    if(!c.started&&(c.outgoing||data.remote)){
      c.started=true;
      void negotiate(c,data.remote);
    }else if(c.outgoing&&data.remote&&c.pc&&!c.applying&&!c.pc.remoteDescription){
      c.applying=true;
      c.pc.setRemoteDescription({type:'answer',sdp:data.remote}).catch(()=>{if(active===c)end('通话协商失败，请重拨。');});
    }
  }
  async function poll(){
    if(!device||!account()||polling||dialing)return;
    const rev=revision,who=account();
    polling=true;
    try{
      const known=active?.pc?.remoteDescription?('?known='+active.id):'';
      const {call}=await api(route+known,undefined,{expectedAccount:who});
      if(rev===revision&&who===account()){
        apply(call);
        if(active)active.lastSeen=Date.now();
      }
    }catch{
      if(rev===revision&&active&&Date.now()-(active.lastSeen??0)>45000)end('与通话服务的连接已中断。');
    }finally{polling=false;}
  }
  async function dial(kind){
    if(active||dialing)return;
    if(!device||!navigator.mediaDevices?.getUserMedia||!window.RTCPeerConnection){
      controls('请使用本机入口或 HTTPS，并允许访问通话设备。',{terminal:true});return;
    }
    get('call-menu').open=false;
    const rev=++revision,who=account();
    dialing=true;
    try{
      const {call}=await send({action:'dial',kind,chat:chat()},who);
      if(rev===revision)apply(call);
    }catch(error){if(rev===revision)reset(error.message==='call_busy'?'已有通话，请稍后重拨。':'无法呼叫，请确认好友关系和网络。');}
    finally{if(revision===rev)dialing=false;}
  }
  for(const kind of ['audio','video'])get('call-'+kind).onclick=()=>void dial(kind);
  get('call-accept').onclick=async()=>{
    const c=active;
    if(!c||c.accepting)return;
    c.accepting=true;
    controls('正在接听…');
    ++revision;
    try{
      await goChat(c.chat,false,c.account);
      if(active!==c)return;
      const {call}=await send({action:'accept',id:c.id},c.account);
      if(active===c)apply(call);
    }catch{if(active===c)end('来电已结束。');}
  };
  get('call-end').onclick=()=>end();
  get('call-play').onclick=()=>remote.play().then(()=>get('call-play').hidden=true).catch(()=>{});
  window.addEventListener('pagehide',()=>end());
  setInterval(()=>{if(active)void poll();},900);
  return {poll,reset};
}
