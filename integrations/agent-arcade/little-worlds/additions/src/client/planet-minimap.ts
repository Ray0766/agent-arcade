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

const zh={open:'小地图',close:'关闭地图',north:'北',you:'你的位置',dock:'码头',courtyard:'公共院落',route:'前往公共院落',dockRoute:'寻找返航飞船',residentRoute:'寻找居民'};
const en={open:'Local map',close:'Close map',north:'N',you:'You are here',dock:'Dock',courtyard:'Public courtyard',route:'Directions to courtyard',dockRoute:'Find the ship back',residentRoute:'Find resident'};

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
  const youPin=document.createElement('span');
  const dockPin=document.createElement('button');
  const courtyardPin=document.createElement('button');
  const residentPin=document.createElement('button');
  const markers={you:youPin,dock:dockPin,courtyard:courtyardPin,resident:residentPin};
  youPin.setAttribute('aria-hidden','true');
  for (const [kind,marker] of Object.entries(markers)) {
    marker.className='planet-minimap-pin';marker.dataset.kind=kind;
    marker.hidden=true;plot.append(marker);
    if(marker instanceof HTMLButtonElement){
      marker.id='planet-minimap-'+kind+'-pin';
      marker.type='button';
    }
  }
  const types=['you','dock','courtyard'] as const;
  const keys=types.map(kind=>{
    const li=document.createElement('li');li.dataset.kind=kind;legend.append(li);return li;
  });
  const residentKey=document.createElement('li');
  residentKey.dataset.kind='resident';residentKey.hidden=true;
  const residentName=document.createElement('span');
  const residentStatus=document.createElement('small');
  residentKey.append(residentName,residentStatus);legend.append(residentKey);
  let current:PlanetMinimapFrame|null=null, view:View|null=null, painted:MinimapTerrain|null=null;
  let textLanguage='';
  function copy(){
    const lang=document.documentElement.lang.startsWith('zh')?'zh':'en';
    if(textLanguage===lang)return;
    textLanguage=lang;
    const words=lang==='zh'?zh:en;
    launcher.textContent=words.open;exit.setAttribute('aria-label',words.close);north.textContent=words.north;
    types.forEach((kind,i)=>{keys[i].textContent=words[kind];});
    route.textContent=words.route;courtyardPin.setAttribute('aria-label',words.route);
    dockPin.setAttribute('aria-label',words.dockRoute);
  }
  function close(returnFocus:boolean){
    const focusWasInside=panel.contains(document.activeElement);
    panel.hidden=true;launcher.setAttribute('aria-expanded','false');
    if(returnFocus&&focusWasInside&&!launcher.hidden)launcher.focus();
  }
  function render(){
    if(!current||panel.hidden)return;
    const {terrain,player,dock,canRouteToDock,courtyard,resident}=current;
    const markerPoints={you:player,dock,courtyard,resident:resident?.point};
    const points=Object.values(markerPoints).filter(point=>point!==undefined);
    if(!view||painted!==terrain||points.some(point=>{
      const p=pixels(point,view!);return p.x<INSET||p.y<INSET||p.x>WIDTH-INSET||p.y>HEIGHT-INSET;
    })){
      view=fit(points);painted=terrain;drawTerrain(canvas,terrain,view);
    }
    if(title.textContent!==terrain.name)title.textContent=terrain.name;
    route.hidden=keys[2].hidden=!courtyard;
    if((!resident&&document.activeElement===residentPin)||(!canRouteToDock&&document.activeElement===dockPin)){
      exit.focus({preventScroll:true});
    }
    dockPin.disabled=!canRouteToDock;
    residentKey.hidden=!resident;
    const name=resident?.name??'',status=resident?.status??'';
    if(residentName.textContent!==name)residentName.textContent=name;
    if(residentStatus.textContent!==status)residentStatus.textContent=status;
    residentStatus.hidden=!status;
    if(resident){
      const words=textLanguage==='zh'?zh:en;
      const label=[words.residentRoute,name,status].filter(Boolean).join(' · ');
      if(residentPin.getAttribute('aria-label')!==label)residentPin.setAttribute('aria-label',label);
    }else residentPin.removeAttribute('aria-label');
    for(const kind of Object.keys(markers) as (keyof typeof markers)[]){
      const marker=markers[kind],point=markerPoints[kind];
      marker.hidden=!point;
      if(!point)continue;
      const p=pixels(point,view!);
      marker.style.left=p.x/WIDTH*100+'%';marker.style.top=p.y/HEIGHT*100+'%';
    }
  }
  launcher.onclick=()=>{
    if(!current)return;
    if(!panel.hidden){close(true);return;}
    panel.hidden=false;view=null;launcher.setAttribute('aria-expanded','true');
    render();exit.focus({preventScroll:true});panel.scrollIntoView({block:'nearest'});
  };
  exit.onclick=()=>close(true);
  const actions=new Map<HTMLButtonElement,()=>boolean>([
    [courtyardPin,()=>!!current?.courtyard&&options.onCourtyard()],
    [dockPin,()=>!!current?.canRouteToDock&&options.onDock()],
    [residentPin,()=>!!current?.resident&&options.onResident(current.resident.id)],
  ]);
  for(const button of actions.keys()){
    button.onclick=event=>{
      let pin=button;
      // Two touch targets can overlap. A pointer click belongs to the closest visible symbol.
      if(event.detail>0){
        let closest=Infinity;
        for(const hit of document.elementsFromPoint(event.clientX,event.clientY)){
          if(!(hit instanceof HTMLButtonElement)||!actions.has(hit)||hit.hidden||hit.disabled)continue;
          const box=hit.getBoundingClientRect();
          const distance=Math.hypot(event.clientX-box.x-box.width/2,event.clientY-box.y-box.height/2);
          if(distance<closest){pin=hit;closest=distance;}
        }
      }
      if(actions.get(pin)?.())close(true);
    };
  }
  route.onclick=()=>{if(actions.get(courtyardPin)?.())close(true);};

  return {
    frame(value){
      const previous=current;
      current=value;copy();
      launcher.hidden=!value;
      if(!value){
        if(!previous)return;
        close(false);painted=null;view=null;
        route.hidden=true;keys[2].hidden=true;residentKey.hidden=true;
        residentName.textContent='';residentStatus.textContent='';residentPin.removeAttribute('aria-label');
        Object.values(markers).forEach(marker=>marker.hidden=true);
        canvas.getContext('2d')?.clearRect(0,0,WIDTH,HEIGHT);
      }else render();
    },
    dispose(){launcher.remove();panel.remove();},
  };
}
