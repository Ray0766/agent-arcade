import * as T from 'three';
import { handleFor } from '../assets/claude-geometry/core/dispose.ts';
import type { NellFlower, NellSeedlings } from '../shared/nell-seedlings.ts';
import { homeItemBounds, type HomeInterior } from '../shared/home.ts';
import { makeBouquet } from './bouquet-model.ts';
import { plantedPotMesh } from './nature-art.ts';

export type NellStage = { color: NellFlower | null; transplant: number; watering: boolean; wet: boolean };
const soil = '#4e382a';
const dampSoil = '#34271f';
const potHeight = .24;
const potPosition = new T.Vector3(-.28, .12, .72);

function shoot(color: NellFlower, scale = 1) {
  const plant = makeBouquet({ main: color, accent: color });
  plant.scale.setScalar(scale);
  return plant;
}

function seedlingPot() {
  const root = new T.Group();
  const pot = plantedPotMesh(.20, potHeight);
  const soilMaterial = new T.MeshStandardMaterial({color:soil,roughness:.96});
  const surface = new T.Mesh(new T.CircleGeometry(.142,16),soilMaterial);
  surface.rotation.x=-Math.PI/2;surface.position.y=potHeight*.915;
  root.add(pot,surface);
  return { root, soilMaterial };
}

function nurseryTray(width: number, depth: number) {
  const root = new T.Group();
  const wood = new T.MeshStandardMaterial({color:'#816446',roughness:.90});
  const tray = new T.Mesh(new T.BoxGeometry(width,.075,depth),wood);
  tray.position.y=-.0375;
  tray.castShadow=tray.receiveShadow=true;
  root.add(tray);
  return root;
}

export function nellSeedlingStage() {
  const root = new T.Group();
  root.name='nell-seedling-stage';
  const tray = nurseryTray(.78,.35);
  tray.position.set(.39,.13,.70);
  root.add(tray);
  const mothers = {coral:shoot('coral',.94),gold:shoot('gold',.94)};
  const offsets = {coral:.19,gold:.57};
  for (const color of ['coral','gold'] as const) {
    mothers[color].position.set(offsets[color],.13,.70);
    root.add(mothers[color]);
  }
  const moves = {coral:shoot('coral',.52),gold:shoot('gold',.52)};
  root.add(moves.coral,moves.gold);
  const {root:pot,soilMaterial}=seedlingPot();
  pot.position.copy(potPosition);
  root.add(pot);
  const bed = potPosition.clone().add(new T.Vector3(0,potHeight*.92,0));
  const start=new T.Vector3();
  root.visible=false;
  return {
    root, bed, motherPositions:Object.values(mothers).map(plant=>plant.position), art:handleFor(root),
    frame(stage:NellStage|null, reduced:boolean) {
      root.visible=!!stage;
      if(!stage)return;
      for (const color of ['coral','gold'] as const) {
        const plant=moves[color];
        plant.visible=color===stage.color;
        if(!plant.visible)continue;
        const moved=reduced&&stage.transplant>0?1:stage.transplant;
        start.set(offsets[color],.19,.64);
        plant.position.lerpVectors(start,bed,moved);
        plant.position.y+=Math.sin(moved*Math.PI)*.43;
      }
      soilMaterial.color.set(stage.wet?dampSoil:soil);
    },
  };
}

function sourcePlaque(zh:boolean) {
  const canvas=document.createElement('canvas');
  canvas.width=640;canvas.height=160;
  const context=canvas.getContext('2d')!;
  context.fillStyle='#344c3b';context.fillRect(0,0,640,160);
  context.fillStyle='#fff7df';context.textAlign='center';context.textBaseline='middle';
  context.font=zh?'54px sans-serif':'bold 49px sans-serif';
  context.fillText(zh?'主星温室 · 奈尔':'Nell · Glasshouse',320,80);
  const map=new T.CanvasTexture(canvas);
  map.colorSpace=T.SRGBColorSpace;
  const sign=new T.Mesh(new T.PlaneGeometry(.72,.18),new T.MeshBasicMaterial({map}));
  sign.position.set(0,.055,.18);
  return sign;
}

export function createHomeNellTray(colors: NellSeedlings, {room,items}:Pick<HomeInterior,'room'|'items'>, zh:boolean) {
  if(!colors.length)return null;
  const rear=-room.depth/2;
  // Leave the centre sill to the shared bouquet. Reuse free wall space beside the window.
  const shelves=items.filter(item=>item.kind==='shelf').map(homeItemBounds).filter(bounds=>bounds.minZ<rear+.55);
  const x=[-1.1,-2.2,2.45,-room.width/2+.57].find(x=>!shelves.some(b=>b.minX<x+.55&&b.maxX>x-.55));
  const root=nurseryTray(.94,.38);
  root.name='home-nell-seedlings';
  if(x!==undefined){
    root.position.set(x,1.01,rear+.245);
    const wood=new T.MeshStandardMaterial({color:'#816446',roughness:.90});
    const shape=new T.BoxGeometry(.06,.21,.10);
    for(const side of [-.30,.30]){
      const bracket=new T.Mesh(shape,wood);
      bracket.position.set(side,-.12,-.17);
      bracket.rotation.x=-.35;
      root.add(bracket);
    }
  }
  else {
    const [shelf]=items.filter(item=>item.kind==='shelf').sort((a,b)=>a.position[2]-b.position[2]);
    if(!shelf)return null;
    root.position.set(shelf.position[0],1.82,shelf.position[2]);
  }
  for(const color of ['coral','gold'] as const){
    if(!colors.includes(color))continue;
    const {root:pot,soilMaterial}=seedlingPot();
    soilMaterial.color.set(dampSoil);
    pot.position.x=color==='coral'?-.235:.235;
    const plant=shoot(color,.70);plant.position.y=potHeight*.92;pot.add(plant);
    root.add(pot);
  }
  root.add(sourcePlaque(zh));
  return handleFor(root);
}
