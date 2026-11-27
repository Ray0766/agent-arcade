// Group-call controls and the bridge from the media controller to Friends signaling.
export function mountGroupVoicePanel({api,account,scope,openChat,personAvatar,privateCallBusy}) {
  const panel=document.querySelector('#group-voice');
  const dock=panel.parentElement;
  const title=panel.querySelector('strong');
  const status=panel.querySelector('[role="status"]');
  const roster=panel.querySelector('ul');
  const join=panel.querySelector('[data-voice-join]');
  const mute=panel.querySelector('[data-voice-mute]');
  const leave=panel.querySelector('[data-voice-leave]');
  const resume=panel.querySelector('[data-voice-resume]');
  const back=panel.querySelector('[data-voice-back]');
  let controller,controllerFlight,active,discovery,discoveredFor,inFlight,joining=false,message='';
  let state={phase:'idle',members:[]};
  const key=current=>current&&JSON.stringify([account(),current.id,current.revision]);

  function paint(){
    const current=scope();
    const call=active&&state.phase!=='idle';
    const context=call?active:current;
    const detached=call&&current?.id!==active.id;
    if(detached&&panel.parentElement===dock)document.body.append(panel);
    if(!detached&&panel.parentElement!==dock)dock.append(panel);
    panel.classList.toggle('group-voice-detached',Boolean(detached));
    const participants=call?state.members:(key(current)===discoveredFor?discovery?.participants:null)??[];
    panel.hidden=!context||(!call&&!context.canStart&&!participants.length);
    if(panel.hidden)return;
    const confirmed=call&&state.phase==='active';
    const people=participants.flatMap(member=>{
      const person=context.members.find(item=>item.number===member.number);
      return person?[{...person,entryId:member.id}]:[];
    });
    title.textContent=detached?context.title+' · 群语音':'群语音';
    status.textContent=message||state.notice||(joining&&!confirmed?'正在加入…':
      people.length?people.length+' 人在通话':'');
    roster.hidden=!people.length;
    const identities=people.map(person=>[person.number,person.entryId,person.displayName,person.avatarRevision]);
    const rosterKey=JSON.stringify(identities);
    if(roster.dataset.people!==rosterKey){
      roster.dataset.people=rosterKey;
      roster.replaceChildren(...people.map(person=>{
        const item=document.createElement('li');
        item.dataset.groupVoiceAccount=person.number;
        item.dataset.groupVoiceEntry=person.entryId;
        const name=document.createElement('span');
        name.textContent=person.displayName+(person.number===account()?'（我）':'');
        const speaking=document.createElement('span');
        speaking.className='group-voice-speaking';
        speaking.textContent='正在讲话';
        speaking.hidden=true;
        item.append(personAvatar(person),name,speaking);
        return item;
      }));
    }
    const speaking=new Set(confirmed?state.members.filter(member=>member.speaking).map(member=>member.id):[]);
    for(const row of roster.children)row.lastElementChild.hidden=!speaking.has(row.dataset.groupVoiceEntry);
    join.hidden=Boolean(call);
    join.disabled=joining||key(current)!==discoveredFor;
    join.textContent=people.length?'加入语音':'发起语音';
    mute.hidden=!confirmed;
    mute.textContent=state.muted?'取消静音':'静音';
    mute.setAttribute('aria-pressed',String(Boolean(state.muted)));
    leave.hidden=!call;
    leave.textContent=confirmed?'离开':'取消加入';
    resume.hidden=!confirmed||!state.audioBlocked;
    back.hidden=!detached;
  }
  async function discover(){
    const current=scope(),identity=key(current);
    if(!identity||active?.id===current.id||inFlight?.identity===identity)return;
    const request={identity};
    inFlight=request;
    try{
      const client=await getController();
      if(inFlight!==request||key(scope())!==identity)return;
      const room=await client.discover(current.id,current.revision);
      if(inFlight!==request||key(scope())!==identity)return;
      discovery=room;
      discoveredFor=identity;
      message='';
    }catch{
      if(inFlight!==request||key(scope())!==identity)return;
      discovery=undefined;
      discoveredFor=undefined;
      message='群语音暂时不可用，稍后会重试。';
    }finally{
      if(inFlight===request)inFlight=undefined;
      paint();
    }
  }
  async function getController(){
    if(controller)return controller;
    controllerFlight??=import('./group-voice.js').then(({mountGroupVoice})=>{
      controller=mountGroupVoice({api,account,onChange:next=>{
        state=next;
        if(state.phase==='idle'&&!joining){
          active=undefined;
          discoveredFor=undefined;
        }
        paint();
      }});
      return controller;
    }).finally(()=>{controllerFlight=undefined;});
    return controllerFlight;
  }
  join.addEventListener('click',async()=>{
    const current=scope(),viewer=account();
    if(joining||active||!current||!viewer||key(current)!==discoveredFor)return;
    if(privateCallBusy()){message='请先结束好友通话，再加入群语音。';paint();return;}
    const pending={...current,viewer,identity:key(current)};
    joining=true;message='';paint();
    try{
      const client=await getController();
      if(viewer!==account()||pending.identity!==key(scope())||privateCallBusy())return;
      active=pending;
      if(!await client.join(current.id,current.revision)&&active===pending)active=undefined;
    }catch{
      if(viewer===account())message='暂时无法加入群语音，请重试。';
      if(active===pending)active=undefined;
    }finally{
      joining=false;paint();
    }
  });
  leave.addEventListener('click',async()=>{
    await controller?.leave();
    active=undefined;
    discoveredFor=undefined;
    paint();
    void discover();
  });
  mute.addEventListener('click',()=>controller?.setMuted(!state.muted));
  resume.addEventListener('click',()=>controller?.resumeAudio());
  back.addEventListener('click',()=>{if(active)void openChat(active.id);});
  function refresh(){
    if(active&&state.phase==='idle'&&!joining)active=undefined;
    paint();
    if(!document.hidden)void discover();
  }
  function reset(){
    controller?.reset();
    active=discovery=discoveredFor=inFlight=undefined;
    message='';
    paint();
  }
  setInterval(()=>{if(!document.hidden)void discover();},1500);
  return {refresh,reset,isBusy:()=>joining||state.phase!=='idle'};
}
