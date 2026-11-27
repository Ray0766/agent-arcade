import * as T from 'three';
import { paintAdaFlowerBasket } from './ada-flower-basket-art.ts';
import { alignVisitorHandProp } from './visitor-prop-anchor.ts';
import './town-post-receipt-art.css';

/** The same cream paper, star and shop stamp are used in hand and in the tray. */
export function createTownPostReceiptCard(): HTMLCanvasElement {
  const paper=document.createElement('canvas');
  paper.className='town-post-receipt-card';
  paper.setAttribute('aria-hidden','true');
  paper.width=320;
  paper.height=184;
  const ctx=paper.getContext('2d');
  if(!ctx)return paper;
  const zh=document.documentElement.lang.startsWith('zh');
  ctx.fillStyle='#fff1d1';
  ctx.fillRect(0,0,320,184);
  ctx.strokeStyle='#9f7247';
  ctx.lineWidth=4;
  ctx.strokeRect(6,6,308,172);
  ctx.lineWidth=2;
  ctx.setLineDash([4,4]);
  ctx.beginPath();
  ctx.moveTo(14,134);ctx.lineTo(306,134);
  ctx.stroke();
  ctx.setLineDash([]);

  ctx.fillStyle='#744732';
  ctx.beginPath();ctx.arc(48,72,23,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#fff1d1';
  ctx.font='700 26px serif';
  ctx.textAlign='center';
  ctx.textBaseline='middle';
  ctx.fillText('✦',48,73);
  ctx.fillStyle='#2f3c31';
  ctx.textAlign='left';
  ctx.font=zh?'700 27px sans-serif':'700 23px sans-serif';
  ctx.fillText(zh?'签收联':'Receipt',82,61);
  ctx.font=zh?'600 18px sans-serif':'600 17px sans-serif';
  ctx.fillText(zh?'星星信':'Star letter',82,92);

  ctx.strokeStyle='#9f674d';
  ctx.lineWidth=3;
  ctx.beginPath();ctx.arc(250,72,43,0,Math.PI*2);ctx.stroke();
  ctx.save();
  ctx.translate(250,70);
  ctx.scale(.255,.255);
  ctx.translate(-256,-143);
  paintAdaFlowerBasket(ctx);
  ctx.restore();

  ctx.fillStyle='#2f3c31';
  ctx.textAlign='center';
  ctx.font=zh?'700 23px sans-serif':'700 18px sans-serif';
  ctx.fillText(zh?'邮局巷 · 帕克斯收':'Post Lane · To Pax',160,156);
  return paper;
}

export function markTownPostReceiptSlot(button:HTMLButtonElement,mark:'star'|'moon') {
  button.dataset.townPostReceiptSlot=mark;
}

export function createTownPostReceiptPaper() {
  const atlas=new T.CanvasTexture(createTownPostReceiptCard());
  atlas.colorSpace=T.SRGBColorSpace;
  const paper=new T.Group();
  const geometry=new T.PlaneGeometry(.46,.2645);
  const material=new T.MeshBasicMaterial({map:atlas});
  const face=new T.Mesh(geometry,material);
  const back=new T.Mesh(geometry,material);
  back.rotation.y=Math.PI;
  paper.add(face,back);
  return paper;
}

export class TownPostHeldReceipt {
  private readonly paper:T.Group;
  private readonly inverse=new T.Quaternion();

  constructor(private readonly root:T.Group) {
    this.paper=createTownPostReceiptPaper();
    this.paper.name='town-post-receipt';
    this.paper.visible=false;
    root.add(this.paper);
  }

  frame(parcel:T.Object3D,visible:boolean) {
    this.paper.visible=visible;
    if(!visible)return;
    alignVisitorHandProp(this.paper,this.root,parcel,this.inverse);
    this.paper.translateX(.19);
    this.paper.rotateY(.38);
  }
}
