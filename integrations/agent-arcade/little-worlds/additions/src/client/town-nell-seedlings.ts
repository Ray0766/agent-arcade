import { NELL_FLOWERS, NELL_WATER_MS, type NellFlower } from '../shared/nell-seedlings.ts';
import type { NellStage } from './nell-seedling-art.ts';
import coralSample from '../assets/nell-seedling-coral.webp';
import goldSample from '../assets/nell-seedling-gold.webp';
import './town-nell-seedlings.css';

const text={
  zh:{ entry:'跟奈尔分株', title:'奈尔的温室苗台', coral:'珊瑚色', gold:'金色', move:'把花苗移进小盆',
    keep:'带一盆回家', discard:'放回苗台', choose:'选一株花苗。奈尔会给分出来的新盆浇水。', picked:'选好了。把这枝移进旁边的小盆。',
    busy:'正在把花苗移进小盆。', watering:'奈尔正在给新盆浇水。', ready:'奈尔：这盆浇好了。你可以带回书房，或放回苗台。',
    added:'奈尔：带回书房窗边吧，那里有光。', owned:'这颜色已经在你的书房托盘里了。', retry:'这盆暂时还不能带走。请靠近奈尔再试。' },
  en:{ entry:'Divide a plant with Nell', title:'Nell’s glasshouse bench', coral:'Coral', gold:'Gold', move:'Move the seedling into the pot',
    keep:'Take a pot home', discard:'Return it to the bench', choose:'Choose a seedling. Nell will water the new pot.', picked:'Move this stem into the little pot.',
    busy:'Moving the seedling into the little pot.', watering:'Nell is watering the new pot.', ready:'Nell: It’s watered. Take it to your study or leave it here.',
    added:'Nell: Leave it by your study window for some light.', owned:'This colour is already on your study tray.', retry:'This pot isn’t ready to take. Move closer to Nell and try again.' },
};
type Command = { action:'pot';color:NellFlower;visitEpoch:number } | { action:'keep';roundId:string;visitEpoch:number } | { action:'discard';roundId:string };
type Reply = { roundId?:string; added?:boolean };
const btn=(name:string)=>{
  const b=document.createElement('button');b.type='button';b.id='nell-seedling-'+name;return b;
};

export class TownNellSeedlings {
  private readonly entry=btn('entry');
  private readonly panel=document.createElement('section');
  private readonly status=document.createElement('p');
  private readonly heading=document.createElement('h2');
  private readonly choices={coral:btn('coral'),gold:btn('gold')};
  private readonly samples=document.createElement('div');
  private readonly labels={coral:document.createElement('span'),gold:document.createElement('span')};
  private readonly move=btn('move');
  private readonly keep=btn('keep');
  private readonly discard=btn('discard');
  private color:NellFlower|null=null;
  private roundId:string|null=null;
  private started=0;
  private saving=false;
  private generation=0;
  private returnFocus=false;
  private lastPaint='';
  get active(){return !this.panel.hidden;}
  private get copy(){return document.documentElement.lang.startsWith('zh')?text.zh:text.en;}

  constructor(host:HTMLElement, private readonly actions:{
    nearby():number|null; prepare():void; send(body:Command):Promise<Reply>;
    stage(state:NellStage|null):void; report(message:string):void; restoreFocus():void;
  }) {
    this.entry.hidden=this.panel.hidden=true;
    this.panel.id='nell-seedlings';
    this.entry.dataset.i18nVerbatim=this.panel.dataset.i18nVerbatim='';
    this.entry.className='primary';
    this.heading.id='nell-seedlings-heading';
    this.panel.setAttribute('aria-labelledby',this.heading.id);
    this.status.setAttribute('role','status');
    this.samples.className='nell-samples';
    for(const color of NELL_FLOWERS){
      const image=document.createElement('img');
      image.alt='';image.src=color==='coral'?coralSample:goldSample;
      image.width=256;image.height=170;
      this.choices[color].append(image,this.labels[color]);
      this.samples.append(this.choices[color]);
    }
    const actionsRow=document.createElement('div');
    actionsRow.className='nell-actions';
    actionsRow.append(this.move,this.keep,this.discard);
    this.panel.append(this.heading,this.status,this.samples,actionsRow);
    document.body.append(this.panel);host.append(this.entry);
    this.entry.onclick=()=>{
      if(this.entry.hidden||this.actions.nearby()===null)return;
      this.actions.prepare();
      this.entry.hidden=true;this.panel.hidden=false;
      this.frame(false);this.choices.coral.focus();
    };
    for(const color of NELL_FLOWERS)this.choices[color].onclick=()=>{
      if(!this.active||this.saving||this.roundId)return;
      this.color=color;this.frame(false);
    };
    this.move.onclick=()=>void this.transplant();
    this.keep.onclick=()=>void this.collect();
    this.discard.onclick=()=>{if(!this.saving||!this.roundId)this.close(true);};
    this.panel.addEventListener('keydown',event=>{
      if(event.key==='Escape'&&!this.saving){event.stopPropagation();this.close(true);}
    });
  }

  frame(talking:boolean) {
    const near=this.actions.nearby();
    this.entry.hidden=near===null||!talking||this.active;
    if(this.entry.textContent!==this.copy.entry)this.entry.textContent=this.copy.entry;
    if(!this.active){
      if(this.returnFocus){
        this.returnFocus=false;
        // The same HUD update makes the nearby talk button visible after frame().
        if(near!==null)queueMicrotask(()=>{
          if(!this.active&&(document.activeElement===document.body||this.panel.contains(document.activeElement)))
            this.actions.restoreFocus();
        });
      }
      return;
    }
    if(near===null){this.close(false);return;}
    const elapsed=this.roundId?performance.now()-this.started:0;
    const ready=!!this.roundId&&elapsed>=NELL_WATER_MS;
    const watering=elapsed>=520&&!ready;
    this.actions.stage({color:this.color,transplant:Math.min(elapsed/520,1),watering,wet:ready});
    const c=this.copy,key=[c.title,this.color,!!this.roundId,this.saving,watering,ready].join('|');
    if(this.lastPaint===key)return;
    this.lastPaint=key;
    this.heading.textContent=c.title;
    this.status.textContent=ready?c.ready:watering?c.watering:this.roundId||this.saving?c.busy:this.color?c.picked:c.choose;
    this.samples.hidden=!!this.roundId||this.saving;
    for(const color of NELL_FLOWERS){
      const button=this.choices[color];
      this.labels[color].textContent=c[color];
      button.setAttribute('aria-pressed',String(this.color===color));
    }
    this.move.textContent=c.move;this.move.hidden=!this.color||this.saving||!!this.roundId;
    this.keep.textContent=c.keep;this.keep.hidden=!ready;this.keep.disabled=this.saving;
    this.discard.textContent=c.discard;this.discard.disabled=this.saving&&!!this.roundId;
  }

  private async transplant() {
    const visitEpoch=this.actions.nearby(), color=this.color;
    if(!this.active||visitEpoch===null||!color||this.saving||this.roundId)return;
    const generation=this.generation;
    this.saving=true;this.frame(false);
    try{
      const reply=await this.actions.send({action:'pot',color,visitEpoch});
      if(!reply.roundId)throw Error('No active seedling');
      if(generation!==this.generation){this.sendDiscard(reply.roundId);return;}
      this.roundId=reply.roundId;this.started=performance.now();
      this.discard.focus();
    }catch{if(generation===this.generation)this.actions.report(this.copy.retry);}
    finally{if(generation===this.generation){this.saving=false;this.frame(false);}}
  }

  private async collect() {
    const visitEpoch=this.actions.nearby(), roundId=this.roundId;
    if(!this.active||visitEpoch===null||!roundId||this.keep.hidden||this.saving)return;
    const generation=this.generation;
    this.saving=true;this.frame(false);
    try{
      const reply=await this.actions.send({action:'keep',roundId,visitEpoch});
      if(generation!==this.generation)return;
      this.actions.report(reply.added?this.copy.added:this.copy.owned);
      this.close(true);
    }catch{
      if(generation===this.generation){this.saving=false;this.frame(false);this.actions.report(this.copy.retry);}
    }
  }

  private close(restoreFocus:boolean) {
    this.generation++;
    this.panel.hidden=true;this.actions.stage(null);this.lastPaint='';
    if(this.roundId)this.sendDiscard(this.roundId);
    this.color=this.roundId=null;this.saving=false;this.started=0;
    this.returnFocus=restoreFocus;
    if(restoreFocus)this.actions.restoreFocus();
  }

  private sendDiscard(roundId:string) { void this.actions.send({action:'discard',roundId}).catch(()=>{}); }
}
