import * as T from 'three';
import { alignVisitorHandProp } from './visitor-prop-anchor.ts';
import { TOWN_POST_ADA, TOWN_POST_PAX, type TownPostCommand, type TownPostProgress } from '../shared/town-post.ts';
import './town-post-delivery.css';

const copy={
  zh:{offer:'接下星星信', deliver:'把星星信交给艾达', address:'商铺街东排 · 艾达收',
    route:'沿邮局巷回抵达广场，再转进商铺街。', wrong:'这封信写着商铺街东排，得交给艾达。',
    retry:'暂时没能交接。走近一些，再试一次。', done:'艾达：收到了，谢谢！是东排小店订的新招牌，明早就能挂上。'},
  en:{offer:'Take the star letter', deliver:'Give the star letter to Ada', address:'Ada · East row, Market Street',
    route:'Follow Post Lane back to Arrival Square, then turn onto Market Street.', wrong:'This letter belongs to Ada on the east row.',
    retry:'The letter could not be handed over. Step closer and try again.', done:'Ada: Thank you! It’s about the new sign for my shop. I can hang it tomorrow.'},
};
const words=()=>document.documentElement.lang.startsWith('zh')?copy.zh:copy.en;
type Site = { residentId:string; visitEpoch:number };

export function townResidentActionHost() {
  let host=document.getElementById('town-resident-actions');
  if(!host){
    host=document.createElement('div');
    host.id='town-resident-actions';
    host.dataset.i18nVerbatim='';
    document.getElementById('dialogue-text')!.after(host);
  }
  return host;
}

export class TownPostDelivery {
  readonly offer=document.createElement('button');
  private readonly handover=document.createElement('button');
  private readonly card=document.createElement('aside');
  private readonly address=document.createElement('strong');
  private readonly directions=document.createElement('span');
  private readonly hint=document.createElement('p');
  private progress?:TownPostProgress;
  private request?:AbortController;
  private inTown=false;
  private busy=false;
  private offered=false;
  private retryAt=0;

  constructor(host:HTMLElement, private readonly actions:{
    nearby(residentId:string):Site|null;
    flush():Promise<void>;
    receive(message:string):void;
    report(message:string):void;
  }){
    this.offer.id='pax-accept-star-letter';
    this.handover.id='ada-deliver-star-letter';
    this.offer.type=this.handover.type='button';
    this.offer.className=this.handover.className='primary';
    this.offer.dataset.i18nVerbatim='';
    this.offer.hidden=this.handover.hidden=this.hint.hidden=this.card.hidden=true;
    this.card.id='town-star-letter';
    this.card.dataset.i18nVerbatim='';
    const seal=document.createElement('span');
    seal.className='town-star-seal';
    seal.textContent='✦';
    seal.setAttribute('aria-hidden','true');
    this.card.append(seal,this.address,this.directions);
    this.hint.setAttribute('role','status');
    host.append(this.handover,this.hint);
    document.body.append(this.card);
    this.offer.onclick=()=>{if(this.offered&&!this.offer.hidden)void this.change('accept',TOWN_POST_PAX);};
    this.handover.onclick=()=>{if(!this.handover.hidden)void this.change('deliver',TOWN_POST_ADA);};
  }

  get carrying() { return this.inTown&&!!this.progress?.pending; }

  offerAfterSorting(visible:boolean){
    this.offered=visible;
    this.paintOffer();
  }

  frame(inTown:boolean, speakingId:string|undefined, showAddress:boolean){
    if (!inTown&&this.inTown){
      this.request?.abort();
      this.request=undefined;
      this.progress=undefined;
      this.retryAt=0;
    }
    this.inTown=inTown;
    if(inTown&&!this.progress&&!this.request&&performance.now()>=this.retryAt)void this.load();
    const labels=words();
    this.card.hidden=!this.carrying||!showAddress;
    this.handover.hidden=!this.carrying||speakingId!==TOWN_POST_ADA;
    this.handover.disabled=this.busy;
    this.hint.hidden=!this.carrying||!speakingId||speakingId===TOWN_POST_ADA;
    if(this.hint.textContent!==labels.wrong)this.hint.textContent=labels.wrong;
    if(this.handover.textContent!==labels.deliver)this.handover.textContent=labels.deliver;
    if(this.address.textContent!==labels.address)this.address.textContent=labels.address;
    if(this.directions.textContent!==labels.route)this.directions.textContent=labels.route;
    this.paintOffer();
  }

  private paintOffer(){
    this.offer.hidden=!this.offered||!this.inTown||!this.progress||this.progress.pending;
    this.offer.disabled=this.busy;
    const label=words().offer;
    if(this.offer.textContent!==label)this.offer.textContent=label;
  }

  private async load(){
    const request=this.request=new AbortController();
    try {
      const reply=await fetch('/api/town/post',{cache:'no-store',signal:request.signal});
      if(!reply.ok)throw Error('Star letter unavailable');
      const progress=await reply.json() as TownPostProgress;
      if(this.request===request)this.progress=progress;
    }catch{
      if(this.request===request)this.retryAt=performance.now()+2500;
    }finally{if(this.request===request)this.request=undefined;}
  }

  private async change(action:TownPostCommand['action'],residentId:string){
    const site=this.actions.nearby(residentId), progress=this.progress;
    if(this.busy||!site||!progress||(action==='deliver')!==progress.pending)return;
    this.busy=true;
    this.handover.disabled=true;
    this.offer.disabled=true;
    try{
      await this.actions.flush();
      if(this.actions.nearby(residentId)?.visitEpoch!==site.visitEpoch)return;
      const body:TownPostCommand={action,...site,version:progress.version};
      const reply=await fetch('/api/town/post',{method:'POST',signal:AbortSignal.timeout(5000),headers:{'Content-Type':'application/json'},body:JSON.stringify(body)});
      if(!reply.ok)throw Error('Star letter action failed');
      const result=await reply.json() as TownPostProgress&{changed:boolean};
      if(!this.inTown)return;
      this.progress=result;
      if(action==='deliver'&&result.changed&&this.actions.nearby(residentId)?.visitEpoch===site.visitEpoch)
        this.actions.receive(words().done);
    }catch{
      if(this.inTown)this.actions.report(words().retry);
    }finally{
      this.busy=false;
      this.paintOffer();
    }
  }
}

export class TownPostHeldLetter {
  private readonly mesh:T.Mesh<T.PlaneGeometry,T.MeshBasicMaterial>;
  private readonly inverse=new T.Quaternion();

  constructor(private readonly root:T.Group){
    const paper=document.createElement('canvas');
    paper.width=128;
    paper.height=84;
    const ctx=paper.getContext('2d')!;
    ctx.fillStyle='#fff2cd';ctx.fillRect(0,0,128,84);
    ctx.strokeStyle='#a8804a';ctx.lineWidth=4;ctx.strokeRect(2,2,124,80);
    ctx.beginPath();ctx.moveTo(2,3);ctx.lineTo(64,52);ctx.lineTo(126,3);ctx.stroke();
    ctx.fillStyle='#954b33';ctx.beginPath();ctx.arc(64,47,19,0,Math.PI*2);ctx.fill();
    ctx.fillStyle='#fff2cd';ctx.font='bold 28px serif';ctx.textAlign='center';ctx.fillText('✦',64,57);
    const atlas=new T.CanvasTexture(paper);atlas.colorSpace=T.SRGBColorSpace;
    this.mesh=new T.Mesh(new T.PlaneGeometry(.43,.28),new T.MeshBasicMaterial({map:atlas,side:T.DoubleSide}));
    this.mesh.name='town-star-letter';
    this.mesh.visible=false;
    root.add(this.mesh);
  }

  frame(parcel:T.Object3D, visible:boolean){
    this.mesh.visible=visible;
    if(visible){
      alignVisitorHandProp(this.mesh,this.root,parcel,this.inverse);
      this.mesh.translateX(.12);
      this.mesh.rotateY(.32);
    }
  }
}
