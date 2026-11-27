import type { MinimapPoint, MinimapTerrain, PlanetMinimapFrame, PlanetMinimapOptions, PlanetMinimap } from './planet-minimap-contract.ts';
import './planet-minimap.css';

const WIDTH=320, HEIGHT=160, INSET=17;
const COLUMNS=100, ROWS=50;
const low=[112,154,117], high=[204,211,158];
type View={x:number;y:number;metresPerPixel:number};

function fit(points:readonly MinimapPoint[]):View {
  const xs=points.map(p=>p.x), ys=points.map(p=>p.y);
  const left=Math.min(...xs), right=Math.max(...xs), top=Math.min(...ys), bottom=Math.max(...ys);
  const metresPerPixel=Math.max(15/WIDTH,(right-left+5)/(WIDTH-2*INSET),(bottom-top+5)/(HEIGHT-2*INSET));
  return {x:(left+right)/2,y:(top+bottom)/2,metresPerPixel};
}

function pixels(p:MinimapPoint,v:View) {
  return {x:WIDTH/2+(p.x-v.x)/v.metresPerPixel,y:HEIGHT/2+(p.y-v.y)/v.metresPerPixel};
}

function drawTerrain(canvas:HTMLCanvasElement, terrain:MinimapTerrain, view:View) {
  const ctx=canvas.getContext('2d');
  if(!ctx)return;
  const sample=document.createElement('canvas');
  sample.width=COLUMNS;sample.height=ROWS;
  const raster=sample.getContext('2d');
  if(!raster)return;
  const values=new Float64Array(COLUMNS*ROWS).fill(NaN);
  const size=(WIDTH/COLUMNS)*view.metresPerPixel;
  let min=Infinity,max=-Infinity;
  for(let row=0;row<ROWS;row++)for(let col=0;col<COLUMNS;col++){
    const h=terrain.heightAt({x:view.x+(col+.5-COLUMNS/2)*size,y:view.y+(row+.5-ROWS/2)*size});
    if(h===null||!Number.isFinite(h))continue;
    values[row*COLUMNS+col]=h;min=Math.min(min,h);max=Math.max(max,h);
  }
  const span=Math.max(.65,max-min);
  const image=raster.createImageData(COLUMNS,ROWS);
  for(let row=0;row<ROWS;row++)for(let col=0;col<COLUMNS;col++){
    const i=row*COLUMNS+col,h=values[i];
    if(!Number.isFinite(h))continue;
    const east=values[i+(col<COLUMNS-1?1:0)], south=values[i+(row<ROWS-1?COLUMNS:0)];
    const dx=Number.isFinite(east)?east-h:0, dy=Number.isFinite(south)?south-h:0;
    const relief=Math.max(-16,Math.min(16,(dx+dy)*34/size));
    const elevation=(h-min)/span;
    // Draw contours at constant altitude in metres. Ignore differences across the projection edge.
    const level=Math.floor(h/.28);
    const contour=(Number.isFinite(east)&&Math.floor(east/.28)!==level)||(Number.isFinite(south)&&Math.floor(south/.28)!==level);
    for(let channel=0;channel<3;channel++){
      image.data[i*4+channel]=low[channel]+(high[channel]-low[channel])*elevation+relief-(contour?14:0);
    }
    image.data[i*4+3]=255;
  }
  raster.putImageData(image,0,0);
  ctx.clearRect(0,0,WIDTH,HEIGHT);ctx.drawImage(sample,0,0,WIDTH,HEIGHT);
}

const zh={open:'小地图',close:'关闭地图',north:'北',you:'你的位置',dock:'码头',courtyard:'公共院落',route:'前往公共院落'};
const en={open:'Local map',close:'Close map',north:'N',you:'You are here',dock:'Dock',courtyard:'Public courtyard',route:'Directions to courtyard'};

export function createPlanetMinimap(options:PlanetMinimapOptions):PlanetMinimap {
  const launcher=document.createElement('button');
  launcher.id='planet-minimap-open';launcher.type='button';launcher.hidden=true;
  launcher.setAttribute('aria-expanded','false');launcher.setAttribute('aria-controls','planet-minimap-panel');
  launcher.setAttribute('aria-haspopup','dialog');
  const mount=document.querySelector('#world-guide-minimap-slot');
  const panel=document.createElement('section');
  panel.id='planet-minimap-panel';panel.hidden=true;panel.setAttribute('role','dialog');
  panel.setAttribute('aria-labelledby','planet-minimap-title');
  panel.innerHTML='<header><h2 id="planet-minimap-title"></h2><button type="button" id="planet-minimap-close">×</button></header>'
    +'<div class="planet-minimap-plot"><canvas width="320" height="160" aria-hidden="true"></canvas><span class="planet-minimap-north"></span></div>'
    +'<ul class="planet-minimap-key"></ul><button type="button" id="planet-minimap-courtyard"></button>';
  mount?.append(launcher,panel);
  const title=panel.querySelector<HTMLHeadingElement>('h2')!;
  const canvas=panel.querySelector<HTMLCanvasElement>('canvas')!;
  const plot=canvas.parentElement!;
  const north=panel.querySelector<HTMLElement>('.planet-minimap-north')!;
  const legend=panel.querySelector<HTMLUListElement>('ul')!;
  const exit=panel.querySelector<HTMLButtonElement>('#planet-minimap-close')!;
  const route=panel.querySelector<HTMLButtonElement>('#planet-minimap-courtyard')!;
  const types=['you','dock','courtyard'] as const;
  const dockPin=document.createElement('button');dockPin.type='button';dockPin.id='planet-minimap-dock-pin';
  const courtyardPin=document.createElement('button');
  courtyardPin.id='planet-minimap-courtyard-pin';courtyardPin.type='button';courtyardPin.hidden=true;
  const markers=types.map(kind=>{
    const marker=kind==='courtyard'?courtyardPin:kind==='dock'?dockPin:document.createElement('span');
    marker.className='planet-minimap-pin';marker.dataset.kind=kind;
    if(kind==='you')marker.setAttribute('aria-hidden','true');
    plot.append(marker);return marker;
  });
  const keys=types.map(kind=>{
    const li=document.createElement('li');li.dataset.kind=kind;legend.append(li);return li;
  });
  let current:PlanetMinimapFrame|null=null, view:View|null=null, painted:MinimapTerrain|null=null;
  let textLanguage='';
  function copy(){
    const lang=document.documentElement.lang.startsWith('zh')?'zh':'en';
    if(textLanguage===lang)return;
    textLanguage=lang;
    const words=lang==='zh'?zh:en;
    launcher.textContent=words.open;exit.setAttribute('aria-label',words.close);north.textContent=words.north;
    types.forEach((kind,i)=>{keys[i].textContent=words[kind];});
    dockPin.setAttribute('aria-label',lang==='zh'?'寻找返航飞船':'Find the ship back');
    route.textContent=words.route;courtyardPin.setAttribute('aria-label',words.route);
  }
  function close(returnFocus:boolean){
    const focusWasInside=panel.contains(document.activeElement);
    panel.hidden=true;launcher.setAttribute('aria-expanded','false');
    if(returnFocus&&focusWasInside&&!launcher.hidden)launcher.focus();
  }
  function render(){
    if(!current||panel.hidden)return;
    const {terrain,player,dock,courtyard}=current;
    if(!current.canRouteToDock && document.activeElement===dockPin)exit.focus({preventScroll:true});
    dockPin.disabled=!current.canRouteToDock;
    const points=courtyard?[player,dock,courtyard]:[player,dock];
    if(!view||painted!==terrain||points.some(point=>{
      const p=pixels(point,view!);return p.x<INSET||p.y<INSET||p.x>WIDTH-INSET||p.y>HEIGHT-INSET;
    })){
      view=fit(points);painted=terrain;drawTerrain(canvas,terrain,view);
    }
    if(title.textContent!==terrain.name)title.textContent=terrain.name;
    route.hidden=keys[2].hidden=!courtyard;
    markers.forEach((marker,i)=>{
      const point=points[i];marker.hidden=!point;
      if(!point)return;
      const p=pixels(point,view!);
      marker.style.left=p.x/WIDTH*100+'%';marker.style.top=p.y/HEIGHT*100+'%';
    });
  }
  launcher.onclick=()=>{
    if(!current)return;
    if(!panel.hidden){close(true);return;}
    panel.hidden=false;view=null;launcher.setAttribute('aria-expanded','true');
    render();exit.focus({preventScroll:true});panel.scrollIntoView({block:'nearest'});
  };
  exit.onclick=()=>close(true);
  dockPin.onclick=()=>{if(current?.canRouteToDock&&options.onDock())close(true);};
  courtyardPin.onclick=route.onclick=()=>{if(current?.courtyard&&options.onCourtyard())close(true);};

  return {
    frame(value){
      const previous=current;
      current=value;copy();
      launcher.hidden=!value;
      if(!value){
        if(!previous)return;
        close(false);painted=null;view=null;
        route.hidden=true;keys[2].hidden=true;markers.forEach(marker=>marker.hidden=true);
        canvas.getContext('2d')?.clearRect(0,0,WIDTH,HEIGHT);
      }else render();
    },
    dispose(){launcher.remove();panel.remove();},
  };
}
