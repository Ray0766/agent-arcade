import {residentBodyLooks} from '../shared/planet-residents.ts';
import './resident-body-settings.css';

type Choice = 'auto' | typeof residentBodyLooks[number];
type BodyResident = {id:string;displayName:string;body:Choice};
const names:Record<Choice,[string,string]>={
  auto:['自动（跟随默认造型）','Automatic (use default)'],
  orange:['橘娘','Orange'],dragon:['龙娘','Dragon'],whale:['鲸鱼娘','Whale'],
  rainbow:['彩虹','Rainbow'],grok:['Grok','Grok'],lanxi:['岚汐','Lanxi']
};
const text=(zh:string,en:string)=>document.documentElement.lang.startsWith('zh')?zh:en;
const endpoint='/api/app-residents';

export class ResidentBodySettings {
  private button=document.createElement('button');
  private dialog=document.createElement('dialog');
  private status=document.createElement('p');
  private rows=document.createElement('div');
  private preview=document.createElement('figure');
  private title=document.createElement('h2');
  private intro=document.createElement('p');
  private close=document.createElement('button');
  private readonly inApp=new URLSearchParams(location.search).get('appChat')==='bothouse';
  private planet:string|null=null;
  private opened?:AbortController;

  constructor(actions:Element){
    this.button.type=this.close.type='button';
    this.button.id='resident-bodies-open';this.button.className='quiet';this.button.hidden=true;
    this.button.setAttribute('aria-haspopup','dialog');
    this.dialog.id='resident-bodies';this.dialog.dataset.i18nVerbatim='';
    this.title.id='resident-bodies-title';this.dialog.setAttribute('aria-labelledby',this.title.id);
    this.status.setAttribute('role','status');
    this.preview.className='resident-body-preview';
    this.close.className='quiet';
    this.dialog.append(this.title,this.intro,this.status,this.rows,this.close);
    this.dialog.addEventListener('close',()=>{
      if(!this.dialog.open){this.opened?.abort();this.opened=undefined;}
    });
    this.close.onclick=()=>this.dialog.close();
    this.button.onclick=()=>void this.open();
    actions.append(this.button);
    document.body.append(this.dialog);
  }

  update(planet:string|null){
    const home=this.inApp?planet:null;
    if(home!==this.planet){
      this.planet=home;
      if(this.dialog.open)this.dialog.close();
      this.button.hidden=!home;
    }
    const label=text('居民三维造型','Resident 3D appearance');
    if(home&&this.button.textContent!==label)this.button.textContent=label;
  }

  private async open(){
    if(!this.planet||this.dialog.open)return;
    this.opened?.abort();
    const request=this.opened=new AbortController();
    this.title.textContent=this.button.textContent;
    this.intro.textContent=text('保存后只改变这位搭档在本星球的身体。更换头像时，固定造型会保留。',
      'A saved body applies to this companion on this planet. Replacing their avatar keeps the selected body.');
    this.close.textContent=text('关闭','Close');
    this.rows.replaceChildren();
    this.status.textContent=text('正在读取居民…','Loading residents…');
    this.dialog.showModal();
    try{
      const response=await fetch(endpoint,{cache:'no-store',signal:AbortSignal.any([request.signal,AbortSignal.timeout(5000)])});
      if(!response.ok)throw Error();
      const state=await response.json() as {owned:boolean;connected:boolean;sourceId:string;bodyResidents:BodyResident[]};
      if(!this.dialog.open||this.opened!==request)return;
      if(!state.owned)throw Error();
      if(!state.connected){
        this.status.textContent=text('先在 App 顶部连接我的 AI。','Connect my AI at the top of the app first.');return;
      }
      if(!state.bodyResidents.length){
        this.status.textContent=text('暂时没有可设置的居民。同步后重新打开此页。','No residents are ready. Open this again after syncing.');return;
      }
      this.status.textContent='';
      const counts=new Map<string,number>();
      for(const resident of state.bodyResidents)counts.set(resident.displayName,(counts.get(resident.displayName)??0)+1);
      for(const resident of state.bodyResidents){
        const label=counts.get(resident.displayName)===1?resident.displayName:`${resident.displayName} · ${resident.id.slice(-8)}`;
        this.rows.append(this.form(label,resident,state.sourceId,request));
      }
    }catch{
      if(this.dialog.open&&this.opened===request)
        this.status.textContent=text('暂时无法读取居民。请回到自己的星球后重试。','Could not load residents. Return to your own planet and try again.');
    }
  }

  private showPreview(form:HTMLFormElement,choice:Choice){
    if(this.preview.parentElement===form&&this.preview.dataset.choice===choice)return;
    this.preview.dataset.choice=choice;
    if(choice==='auto'){
      const note=document.createElement('p');
      note.textContent=text('自动沿用居民的默认造型。选择固定造型可查看正面和侧面。','Automatic uses the resident’s default appearance. Select a fixed appearance to preview its front and side.');
      this.preview.replaceChildren(note);
    }else{
      const image=document.createElement('img');
      image.src='/resident-body-previews/'+choice+'.webp';image.decoding='async';
      image.width=560;image.height=280;
      image.alt=text(names[choice][0]+'的正面和侧面',names[choice][1]+' from the front and side');
      const caption=document.createElement('figcaption');
      const front=document.createElement('span'),side=document.createElement('span');
      front.textContent=text('正面','Front');side.textContent=text('侧面','Side');
      caption.append(front,side);this.preview.replaceChildren(image,caption);
    }
    form.append(this.preview);
  }

  private form(name:string,resident:BodyResident,sourceId:string,request:AbortController){
    const form=document.createElement('form'),label=document.createElement('label');
    const select=document.createElement('select'),save=document.createElement('button'),status=document.createElement('span');
    select.id='resident-body-'+resident.id;label.htmlFor=select.id;label.textContent=name;
    const options:Choice[]=['auto',...residentBodyLooks];
    for(const option of options)select.add(new Option(text(...names[option]),option));
    select.value=resident.body;
    save.type='submit';save.className='primary';save.textContent=text('保存','Save');
    save.setAttribute('aria-label',text('保存 '+name+' 的造型','Save appearance for '+name));
    status.setAttribute('role','status');
    const preview=()=>this.showPreview(form,select.value as Choice);
    select.onfocus=preview;
    select.onchange=()=>{status.textContent='';preview();};
    form.append(label,select,save,status);
    if(!this.rows.childElementCount)preview();
    form.onsubmit=async event=>{
      event.preventDefault();
      if(save.disabled||request!==this.opened)return;
      select.disabled=save.disabled=true;
      status.textContent=text('正在保存…','Saving…');
      try{
        const response=await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},
          signal:AbortSignal.any([request.signal,AbortSignal.timeout(5000)]),
          body:JSON.stringify({action:'set-body',sourceId,residentId:resident.id,body:select.value})});
        if(!response.ok||!(await response.json()).ok)throw Error();
        status.textContent=text('已保存','Saved');
      }catch{
        status.textContent=text('未能确认保存。请重新打开居民设置查看。','Could not confirm the save. Reopen resident settings to check.');
      }finally{select.disabled=save.disabled=false;}
    };
    return form;
  }
}
