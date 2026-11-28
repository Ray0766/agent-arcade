import { Box3, BoxGeometry, CylinderGeometry, Group, Mesh, MeshStandardMaterial, PerspectiveCamera, Vector3 } from 'three';
import { buildBlueprintModel } from '../shared/blueprint-model3d.ts';
import type { CameraShipCollision } from './camera-ship-collision.ts';
import type { GroundWorld } from '../shared/physics/world.ts';
import { worldMaterials } from './shared-assets.ts';
import type { QuayRepairPose } from './town-quay-repair.ts';
import type { PairedQuayView } from '../shared/paired-quay-repair.ts';

export type PairedQuayRepairScene = Pick<PairedQuayView, 'id' | 'phase' | 'turn' | 'locked'>;
export const isPairedQuayRepairScene = (view: PairedQuayRepairScene | null) =>
  !!view && (view.phase==='inspect'||view.phase==='adjust'||view.phase==='held'||view.phase==='locked'||view.phase==='done');

/** Shared shape for Ivo's hand tool and the player's tabletop wrench. */
export const QUAY_WRENCH_PARTS = [
  { at:[0,0,.105], size:[.035,.04,.23] },
  { at:[0,0,.23], size:[.095,.04,.07] },
] satisfies {at:[number,number,number];size:[number,number,number]}[];

/** The original steel support and witness lines, without the cabinet or tools. */
export function quayRepairMechanism() {
  const root=new Group(), turntable=new Group(), arm=new Group();
  root.name='ivo-repair-support';
  turntable.name='quay-repair-turntable';
  arm.name='quay-repair-arm';
  turntable.position.y=.075; arm.position.y=.035;
  root.add(turntable); turntable.add(arm);
  const iron=new MeshStandardMaterial({color:'#4c6b70',roughness:.82});
  const brass=new MeshStandardMaterial({color:'#bc8952',roughness:.65});
  const mark=new MeshStandardMaterial({color:'#f2d998',roughness:.78});
  const box=(parent:Group,mat:MeshStandardMaterial,size:[number,number,number],at:[number,number,number])=>{
    const mesh=new Mesh(new BoxGeometry(...size),mat);
    mesh.position.set(...at); mesh.castShadow=true; mesh.receiveShadow=true; parent.add(mesh);
    return mesh;
  };
  box(root,iron,[.36,.071,.55],[0,.035,.075]);
  box(root,brass,[.20,.023,.20],[0,.079,0]);
  box(root,mark,[.024,.007,.057],[0,.074,.291]);
  box(arm,iron,[.15,.075,.30],[0,.019,.133]);
  box(arm,mark,[.024,.008,.070],[0,.060,.246]);
  box(arm,brass,[.19,.038,.069],[0,.043,.275]);
  const nut=new Mesh(new CylinderGeometry(.063,.063,.051,6),brass); nut.position.y=.179; root.add(nut);
  return {
    root, arm, nut, iron, brass, mark, box,
    setTurn(turn:number) { turntable.rotation.y=turn*.28; },
    dispose() {
      root.traverse(o=>{if(o instanceof Mesh)o.geometry.dispose();});
      iron.dispose();brass.dispose();mark.dispose();
    },
  };
}

/** A tabletop support in Ivo’s local work frame. */
export function quayRepairProp() {
  const mechanism=quayRepairMechanism();
  const {root,arm,nut,iron,brass,mark,box}=mechanism;
  const table=buildBlueprintModel([{part:'furniture.sideboard',x:0,z:0,level:0,n:1,rot:0}],worldMaterials(),'medium',{sockets:false});
  root.add(table.object);
  const boxBounds=new Box3().setFromObject(table.object);
  const tableCenter=boxBounds.getCenter(new Vector3());
  table.object.position.set(-tableCenter.x,-boxBounds.max.y+.015,-tableCenter.z+.06);
  const lockStripe=box(root,mark,[.031,.008,.065],[0,.208,.014]);
  lockStripe.name='quay-repair-lock-stripe';
  const wrenchPivot=new Group(), wrench=new Group();
  wrenchPivot.name='paired-quay-wrench';
  wrenchPivot.position.y=.181;
  wrench.position.z=-.23;
  wrenchPivot.add(wrench);
  for(const part of QUAY_WRENCH_PARTS)box(wrench,iron,part.size,part.at);
  root.add(wrenchPivot);
  const brace=box(root,brass,[.32,.015,.047],[0,.124,.255]);
  brace.name='paired-quay-aligned-brace';
  let lastRound='',lastPhase:PairedQuayRepairScene['phase']|undefined,startedAt=0;
  const animate=(pose:QuayRepairPose,reduced:boolean)=>{
    mechanism.setTurn(pose.turn);
    const bounce=reduced?pose.press:Math.sin(pose.press*Math.PI*4)*pose.press;
    arm.rotation.x=pose.loose?.16+Math.abs(bounce)*.45:pose.locked?pose.press*.018:0;
    nut.rotation.y=pose.locked?1.2:pose.tightening*1.2;
    lockStripe.visible=pose.locked;
  };
  lockStripe.visible=false;
  root.visible=false;
  return {
    root,
    show(pose:QuayRepairPose|null,reduced:boolean) {
      lastRound='';lastPhase=undefined;
      wrenchPivot.visible=brace.visible=false;
      root.visible=!!pose;
      if(!pose)return;
      animate(pose,reduced);
    },
    showPaired(view:PairedQuayRepairScene,reduced:boolean,now:number) {
      root.visible=true;
      if(view.id!==lastRound||view.phase!==lastPhase){
        startedAt=view.id===lastRound?now:-Infinity;
        lastRound=view.id;lastPhase=view.phase;
      }
      const since=now-startedAt;
      const tightening=view.phase==='locked'?(reduced?1:Math.min(since/.68,1)):0;
      const pressing=view.phase==='adjust'||view.phase==='done';
      const press=pressing&&!reduced?Math.max(0,1-since/.5):0;
      // At zero the arm lays flat so the moving and fixed witness lines meet.
      animate({turn:view.turn,loose:view.phase==='adjust'&&view.turn!==0,
        press,tightening,locked:view.locked},reduced);
      if(view.phase==='locked'){
        nut.rotation.y=tightening*1.2;
        lockStripe.visible=view.locked&&tightening>=.85;
      }
      brace.visible=view.phase==='held';
      wrenchPivot.visible=view.phase==='held'||view.phase==='locked';
      wrenchPivot.rotation.y=-1.52+tightening*1.2;
    },
    dispose(){
      root.remove(table.object); table.dispose();
      mechanism.dispose();
    },
  };
}

// This uses the same exploration camera and placement safety in a short shot of
// the actual work. The original transform is restored immediately after drawing.
export function drawQuayRepair(camera: PerspectiveCamera, work: Group, world: GroundWorld, ship: CameraShipCollision,
  width: number,height: number, draw: () => void) {
  const target=work.localToWorld(new Vector3(-.17,.23,-.25));
  for(const side of [1,-1]){
    const eye=work.localToWorld(new Vector3(side*1.35,1.15,1.95));
    const reach=target.distanceTo(eye);
    if(world.cameraDistance(target,eye,.08)+.04<reach || ship.distance(target,eye,.10)+.04<reach)continue;
    const shot=camera.clone();
    shot.position.copy(eye);
    shot.up.copy(work.getWorldPosition(new Vector3()).normalize());
    shot.fov=45;
    const narrow=width<=650;
    shot.setViewOffset(width,height,narrow?0:width*.14,narrow?height*.14:0,width,height);
    shot.lookAt(target);
    const position=camera.position.clone(), quaternion=camera.quaternion.clone();
    const projection=camera.projectionMatrix.clone(), inverse=camera.projectionMatrixInverse.clone();
    try{
      camera.position.copy(shot.position); camera.quaternion.copy(shot.quaternion);
      camera.projectionMatrix.copy(shot.projectionMatrix); camera.projectionMatrixInverse.copy(shot.projectionMatrixInverse);
      camera.updateMatrixWorld(true);
      draw();
    } finally{
      camera.position.copy(position); camera.quaternion.copy(quaternion);
      camera.projectionMatrix.copy(projection); camera.projectionMatrixInverse.copy(inverse);
      camera.updateMatrixWorld(true);
    }
    return;
  }
  draw();
}
