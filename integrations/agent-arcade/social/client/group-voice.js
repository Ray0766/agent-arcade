// Small-room audio mesh. Only the authorized signaling transport sees descriptions.
const POLL_MS=900;
const ICE_TIMEOUT=8000;
const SIGNAL_TIMEOUT=20000;
const SPEAKING_SAMPLE_MS=100;
const SPEAKING_HOLD_MS=400;
const SPEAKING_RMS=0.018;

export function mountGroupVoice({api,account,onChange=()=>{}}){
  const device=globalThis.crypto?.randomUUID?.();
  let session,notice='';
  function getState(){
    const s=session;
    return {
      phase:s?(s.stream?'active':'joining'):'idle',
      notice,chatId:s?.chatId,roomId:s?.roomId,memberId:s?.memberId,muted:!!s?.muted,
      audioBlocked:!!s&&[...s.peers.values()].some(peer=>peer.audioBlocked),
      members:s?.members.map(({id,number})=>({id,number,speaking:s.speaking.has(id),connection:id===s.memberId?'local':
        s.peers.get(id)?.pc.connectionState??'new'}))??[],
    };
  }
  const notify=()=>onChange(getState());
  const path=chatId=>'/conversations/'+encodeURIComponent(chatId)+'/group-voice/'+device;
  function request(s,action,fields={}){
    const scope={revision:s.revision,...(s.roomId&&s.memberId&&{roomId:s.roomId,self:s.memberId})};
    const options={expectedAccount:s.account};
    if(action==='poll')return api(path(s.chatId)+'?'+new URLSearchParams(scope),undefined,options);
    return api(path(s.chatId),{...scope,action,...fields},options);
  }
  async function discover(chatId,revision){
    const who=account();
    if(!device||!chatId||!revision||!who)return null;
    const {room}=await request({chatId,revision,account:who},'poll');
    return account()===who?room:null;
  }
  const isCurrent=s=>session===s&&account()===s.account;
  const isPeer=(s,peer)=>isCurrent(s)&&!peer.closed&&s.peers.get(peer.id)===peer;

  function sampleSpeakers(s){
    if(!isCurrent(s))return;
    const now=performance.now();
    let changed=false;
    for(const [id,meter] of s.speakerMeters){
      const available=s.speakerContext.state==='running'&&meter.track.readyState==='live'&&
        meter.track.enabled&&!meter.track.muted&&(id===s.memberId?!s.muted:s.peers.get(id)?.pc.connectionState==='connected');
      if(!available)meter.lastHeard=-Infinity;
      else{
        meter.analyser.getFloatTimeDomainData(meter.samples);
        let energy=0;
        for(const value of meter.samples)energy+=value*value;
        if(energy>meter.samples.length*SPEAKING_RMS**2)meter.lastHeard=now;
      }
      const speaking=now-meter.lastHeard<SPEAKING_HOLD_MS;
      if(speaking===s.speaking.has(id))continue;
      if(speaking)s.speaking.add(id);
      else s.speaking.delete(id);
      changed=true;
    }
    if(changed)notify();
  }
  function removeSpeaker(s,id){
    const meter=s.speakerMeters.get(id);
    if(meter){
      meter.source.disconnect();
      meter.analyser.disconnect();
      s.speakerMeters.delete(id);
    }
    s.speaking.delete(id);
  }
  function watchSpeaker(s,id,track){
    if(!globalThis.AudioContext)return;
    removeSpeaker(s,id);
    try{
      const context=s.speakerContext??=new AudioContext();
      const source=context.createMediaStreamSource(new MediaStream([track]));
      const analyser=context.createAnalyser();
      analyser.fftSize=1024;
      source.connect(analyser);
      s.speakerMeters.set(id,{track,source,analyser,samples:new Float32Array(analyser.fftSize),lastHeard:-Infinity});
      s.speakerTimer??=setInterval(()=>sampleSpeakers(s),SPEAKING_SAMPLE_MS);
      void context.resume().catch(()=>{});
    }catch{
      // A meter can be unavailable without affecting media playback.
    }
  }

  function closePeer(s,peer){
    removeSpeaker(s,peer.id);
    peer.closed=true;
    peer.audioBlocked=false;
    peer.finishIce?.();
    peer.pc.close();
    if(peer.audio){
      peer.audio.srcObject=null;
      peer.audio.remove();
    }
  }
  function dispose(s,message='',sendLeave=false){
    if(session!==s)return;
    session=undefined;
    notice=message;
    clearTimeout(s.timer);
    clearInterval(s.speakerTimer);
    for(const peer of s.peers.values())closePeer(s,peer);
    removeSpeaker(s,s.memberId);
    if(s.speakerContext)void s.speakerContext.close().catch(()=>{});
    s.peers.clear();
    s.stream?.getTracks().forEach(track=>track.stop());
    const departed=sendLeave&&s.roomId?request(s,'leave').catch(()=>{}):undefined;
    notify();
    return departed;
  }
  function finishPeer(s,peer){
    if(!isPeer(s,peer))return;
    closePeer(s,peer);
    notify();
  }
  function play(s,peer){
    if(!isPeer(s,peer))return;
    const attempt=peer.audio?.play();
    if(!attempt)return;
    void attempt.then(()=>{
      if(!isPeer(s,peer)||!peer.audioBlocked)return;
      peer.audioBlocked=false;
      notify();
    },()=>{
      if(!isPeer(s,peer)||peer.audioBlocked)return;
      peer.audioBlocked=true;
      notify();
    });
  }
  async function sendDescription(s,peer){
    const description=peer.outgoing;
    if(!description||peer.sending||!isPeer(s,peer))return;
    peer.sending=true;
    try{
      await request(s,'signal',{to:peer.id,...description});
      if(peer.outgoing===description)peer.outgoing=undefined;
    }catch{
      // The next successful roster update retries this same description.
    }finally{
      peer.sending=false;
    }
  }
  async function prepareDescription(s,peer,type){
    const {pc}=peer;
    const description=await (type==='offer'?pc.createOffer():pc.createAnswer());
    if(!isPeer(s,peer))return;
    await pc.setLocalDescription(description);
    if(!isPeer(s,peer))return;
    if(pc.iceGatheringState!=='complete'){
      await new Promise(resolve=>{
        const finish=()=>{
          clearTimeout(timer);
          pc.removeEventListener('icegatheringstatechange',changed);
          peer.finishIce=undefined;
          resolve();
        };
        const changed=()=>{if(pc.iceGatheringState==='complete')finish();};
        const timer=setTimeout(finish,ICE_TIMEOUT);
        peer.finishIce=finish;
        pc.addEventListener('icegatheringstatechange',changed);
      });
    }
    if(isPeer(s,peer)&&pc.localDescription){
      peer.outgoing={type,sdp:pc.localDescription.sdp};
      void sendDescription(s,peer);
    }
  }
  function addPeer(s,member){
    const pc=new RTCPeerConnection({iceServers:s.iceServers});
    const peer={id:member.id,pc,initiator:s.account<member.number};
    s.peers.set(member.id,peer);
    pc.addTrack(s.stream.getAudioTracks()[0],s.stream);
    pc.ontrack=event=>{
      if(!isPeer(s,peer)||event.track.kind!=='audio')return;
      if(!peer.audio){
        peer.audio=document.createElement('audio');
        peer.audio.autoplay=true;
        peer.audio.hidden=true;
        document.body.append(peer.audio);
      }
      peer.audio.srcObject=new MediaStream([event.track]);
      watchSpeaker(s,peer.id,event.track);
      play(s,peer);
    };
    pc.onconnectionstatechange=()=>{if(isPeer(s,peer))notify();};
    if(peer.initiator)void prepareDescription(s,peer,'offer').catch(()=>finishPeer(s,peer));
  }
  async function receiveDescription(s,peer,{type,sdp}){
    if(!isPeer(s,peer)||peer.receiving||peer.pc.remoteDescription||typeof sdp!=='string'||
       type!==(peer.initiator?'answer':'offer'))return;
    peer.receiving=true;
    try{
      await peer.pc.setRemoteDescription({type,sdp});
      if(isPeer(s,peer)&&type==='offer')await prepareDescription(s,peer,'answer');
    }catch{
      finishPeer(s,peer);
    }finally{
      peer.receiving=false;
    }
  }
  function updateRoster(s,room){
    if(room?.id!==s.roomId||room.chat!==s.chatId||room.self!==s.memberId||!room.participants?.some(member=>member.id===s.memberId)){
      dispose(s,'你已离开群语音。');
      return;
    }
    s.room=room;
    s.members=room.participants;
    const peerIds=new Set(s.members.filter(member=>member.id!==s.memberId).map(member=>member.id));
    for(const [id,peer] of s.peers){
      if(peerIds.has(id))continue;
      s.peers.delete(id);
      closePeer(s,peer);
    }
    if(s.stream){
      for(const member of s.members){
        if(!peerIds.has(member.id)||s.peers.has(member.id))continue;
        addPeer(s,member);
      }
      for(const signal of room.signals??[]){
        const peer=s.peers.get(signal.from);
        if(peer)void receiveDescription(s,peer,signal);
      }
      for(const peer of s.peers.values())void sendDescription(s,peer);
    }
    notify();
  }
  async function poll(s){
    if(session!==s)return;
    if(!isCurrent(s)){dispose(s,'',true);return;}
    try{
      const {room}=await request(s,'poll');
      if(!isCurrent(s))return;
      s.lastSeen=Date.now();
      updateRoster(s,room);
    }catch(error){
      if(!isCurrent(s))return;
      if([401,403,404,409].includes(error.status))dispose(s,'群语音已结束或当前已无权加入。');
      else if(Date.now()-s.lastSeen>SIGNAL_TIMEOUT)dispose(s,'群语音连接已中断。',true);
    }finally{
      if(isCurrent(s))s.timer=setTimeout(()=>void poll(s),POLL_MS);
      else if(session===s)dispose(s,'',true);
    }
  }

  async function join(chatId,revision){
    const who=account();
    if(session||!who||!chatId||!revision)return false;
    if(!globalThis.RTCPeerConnection||!navigator.mediaDevices?.getUserMedia||!device){
      notice='当前环境无法使用群语音，请打开本机入口或 HTTPS。';
      notify();
      return false;
    }
    const s={account:who,chatId,revision,peers:new Map(),members:[],muted:false,speakerMeters:new Map(),speaking:new Set()};
    session=s;
    notice='';
    notify();
    try{
      const joinId=crypto.randomUUID();
      let result;
      try{result=await request(s,'join',{joinId});}
      catch(error){
        if(!isCurrent(s)||error.status>=400&&error.status<500)throw error;
        result=await request(s,'join',{joinId});
      }
      const {room}=result;
      s.roomId=room?.id;
      s.memberId=room?.self;
      if(!isCurrent(s)){
        if(session===s)dispose(s,'',true);
        else if(s.roomId&&s.memberId)void request(s,'leave').catch(()=>{});
        return false;
      }
      if(!s.roomId||!s.memberId||room.chat!==s.chatId||!room.participants?.some(member=>member.id===s.memberId)){
        dispose(s,'无法加入群语音。',true);
        return false;
      }
      s.room=room;
      s.members=room.participants;
      s.lastSeen=Date.now();
      notify();
      void poll(s);
      const {iceServers}=await request(s,'ice');
      if(!isCurrent(s))return false;
      s.iceServers=iceServers??[];
      const stream=await navigator.mediaDevices.getUserMedia({audio:true,video:false});
      if(!isCurrent(s)){
        stream.getTracks().forEach(track=>track.stop());
        if(session===s)dispose(s,'',true);
        return false;
      }
      s.stream=stream;
      const track=stream.getAudioTracks()[0];
      if(!track||track.readyState!=='live')throw Error('unavailable_microphone');
      track.enabled=!s.muted;
      watchSpeaker(s,s.memberId,track);
      track.addEventListener('ended',()=>{
        if(isCurrent(s))dispose(s,'麦克风已断开，请重新加入群语音。',true);
      },{once:true});
      updateRoster(s,s.room);
      return isCurrent(s);
    }catch(error){
      if(isCurrent(s)){
        dispose(s,error.name==='NotAllowedError'?'请允许使用麦克风后重新加入。':'无法加入群语音，请检查会话权限和麦克风。',true);
      }
      return false;
    }
  }
  async function leave(){
    if(!session)return;
    await dispose(session,'',true);
  }
  function reset(){
    if(session)void dispose(session,'',true);
    else if(notice){notice='';notify();}
  }
  function setMuted(muted){
    const s=session;
    if(!s?.stream||!isCurrent(s)||typeof muted!=='boolean'||s.muted===muted)return false;
    s.muted=muted;
    for(const track of s.stream.getAudioTracks())track.enabled=!muted;
    if(muted){
      const meter=s.speakerMeters.get(s.memberId);
      if(meter)meter.lastHeard=-Infinity;
      s.speaking.delete(s.memberId);
    }
    notify();
    return true;
  }
  function resumeAudio(){
    const s=session;
    if(!s||!isCurrent(s))return;
    if(s.speakerContext)void s.speakerContext.resume().catch(()=>{});
    for(const peer of s.peers.values())play(s,peer);
  }
  window.addEventListener('pagehide',reset);
  return {discover,join,leave,setMuted,getState,resumeAudio,reset};
}
