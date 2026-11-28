import './town-quay-repair.css';

export const IVO_REPAIR = 'ivo-repair';
export type QuayRepairPose = { turn: number; loose: boolean; press: number; tightening: number; locked: boolean };
type Step = 'inspect' | 'adjust' | 'tightening' | 'verify' | 'done';

const words = {
  zh: { entry:'帮伊沃修托臂', title:'伊沃的码头修理点', leave:'回到街上', press:'试压托臂', verify:'再试一次', left:'逆时针转', right:'顺时针转',
    tighten:'请伊沃紧固', inspect:'先压一下托臂，看看这颗螺帽松到了什么程度。', loose:'托臂压下去会晃。转动托臂，让活动刻线和底座刻线相接。',
    aligned:'两段刻线已对齐。请伊沃用扳手紧固。', tightening:'伊沃正用扳手紧固螺帽。', check:'紧固好了。再压一下，确认托臂会不会晃。',
    done:'这次压下去稳住了。伊沃：可以接下一艘船了。', offset:'刻线尚未对齐', match:'刻线已对齐' },
  en: { entry:'Help Ivo repair the support', title:'Ivo’s dock repair', leave:'Back to the street', press:'Press the arm', verify:'Test it again', left:'Turn anticlockwise', right:'Turn clockwise',
    tighten:'Ask Ivo to tighten it', inspect:'Press the arm to check how loose the nut has become.', loose:'The arm wobbles. Turn it until the marks on the arm and base meet.',
    aligned:'The marks line up. Ask Ivo to tighten the nut.', tightening:'Ivo is tightening the nut with his wrench.', check:'The nut is tight. Press the arm again to check it.',
    done:'It holds under pressure. Ivo: ready for the next ship.', offset:'Marks apart', match:'Marks aligned' },
};

export class TownQuayRepair {
  private readonly open = document.createElement('button');
  private readonly panel = document.createElement('section');
  private readonly heading = document.createElement('h2');
  private readonly leave = document.createElement('button');
  private readonly status = document.createElement('p');
  private readonly marks = document.createElement('output');
  private readonly press = document.createElement('button');
  private readonly left = document.createElement('button');
  private readonly right = document.createElement('button');
  private readonly tighten = document.createElement('button');
  private step: Step = 'inspect';
  private turn = -2;
  private time = 0;
  private pressedAt = -Infinity;
  private tighteningAt = -Infinity;
  private painted = '';
  get active() { return !this.panel.hidden; }
  private get copy() { return document.documentElement.lang.startsWith('zh') ? words.zh : words.en; }

  constructor(host: HTMLElement, private readonly actions: {
    nearby(): boolean; prepare(): void; stage(pose: QuayRepairPose | null): void; restoreFocus(): void;
  }) {
    this.panel.id = 'ivo-quay-repair';
    this.heading.id = 'ivo-quay-repair-heading';
    this.panel.setAttribute('aria-labelledby',this.heading.id);
    this.status.setAttribute('role','status');
    this.open.dataset.i18nVerbatim = this.panel.dataset.i18nVerbatim = '';
    this.open.className='primary';
    this.open.hidden = this.panel.hidden = true;
    for (const [button,id] of [[this.open,'entry'],[this.leave,'leave'],[this.press,'press'],
      [this.left,'left'],[this.right,'right'],[this.tighten,'tighten']] as const) {
      button.type='button'; button.id='ivo-repair-'+id;
    }
    const header=document.createElement('header'), controls=document.createElement('div');
    header.append(this.heading,this.leave);
    controls.className='ivo-repair-controls';
    controls.append(this.press,this.left,this.right,this.tighten);
    this.panel.append(header,this.status,this.marks,controls);
    host.append(this.open); document.body.append(this.panel);
    this.open.onclick=()=>{
      if(this.open.hidden || !this.actions.nearby())return;
      this.actions.prepare();
      this.open.hidden=true; this.panel.hidden=false;
      this.step='inspect'; this.turn=-2; this.pressedAt=this.tighteningAt=-Infinity;
      this.publish(); this.paint(); this.press.focus({preventScroll:true});
    };
    this.leave.onclick=()=>this.exit(true);
    this.press.onclick=()=>{
      if(!this.valid() || (this.step!=='inspect' && this.step!=='verify' && this.step!=='done'))return;
      this.pressedAt=this.time;
      if(this.step==='inspect') { this.step='adjust'; this.paint(); this.right.focus({preventScroll:true}); }
      else { this.step='done'; this.paint(); }
      this.publish();
    };
    this.left.onclick=()=>this.rotate(-1);
    this.right.onclick=()=>this.rotate(1);
    this.tighten.onclick=()=>{
      if(!this.valid() || this.step!=='adjust' || this.turn!==0)return;
      this.step='tightening'; this.tighteningAt=this.time;
      this.paint(); this.leave.focus({preventScroll:true});
    };
  }

  frame(talking: boolean, elapsed: number) {
    this.time=elapsed;
    const nearby=this.actions.nearby();
    this.open.hidden=!nearby || !talking || !this.panel.hidden;
    if(!this.panel.hidden && !nearby)this.exit(false);
    if(!this.panel.hidden){
      if(this.step==='tightening' && elapsed-this.tighteningAt>=1.1){
        this.step='verify'; this.paint();
        this.press.focus({preventScroll:true});
      }
      this.publish();
    }
    this.paint();
  }

  private valid() { return !this.panel.hidden && this.actions.nearby(); }

  private rotate(delta: number) {
    if(!this.valid() || this.step!=='adjust')return;
    this.turn=Math.max(-3,Math.min(3,this.turn+delta));
    this.paint(); this.publish();
  }

  private publish() {
    this.actions.stage({ turn:this.turn, loose:this.step==='adjust',
      press:Math.max(0,1-(this.time-this.pressedAt)/.43),
      tightening:this.step==='tightening' ? Math.min(1,(this.time-this.tighteningAt)/1.1) : 0,
      locked:this.step==='verify'||this.step==='done' });
  }

  private exit(focus: boolean) {
    const returnFocus=focus||this.panel.contains(document.activeElement);
    this.panel.hidden=true;
    this.actions.stage(null);
    if(returnFocus)this.actions.restoreFocus();
  }

  private paint() {
    const c=this.copy, id=[c.title,this.step,this.turn].join('/');
    if(id===this.painted)return;
    this.painted=id;
    this.open.textContent=c.entry; this.heading.textContent=c.title; this.leave.textContent=c.leave;
    this.press.textContent=this.step==='inspect'?c.press:c.verify;
    this.left.textContent=c.left; this.right.textContent=c.right; this.tighten.textContent=c.tighten;
    this.left.hidden=this.right.hidden=this.tighten.hidden=this.marks.hidden=this.step!=='adjust';
    this.press.hidden=this.step==='adjust'||this.step==='tightening';
    this.left.disabled=this.turn===-3; this.right.disabled=this.turn===3;
    this.tighten.disabled=this.turn!==0;
    this.marks.textContent=this.turn===0?c.match:c.offset;
    this.marks.dataset.aligned=String(this.turn===0);
    this.status.textContent=this.step==='adjust'?(this.turn===0?c.aligned:c.loose):this.step==='verify'?c.check:c[this.step];
    this.panel.dataset.stage=this.step;
  }
}
