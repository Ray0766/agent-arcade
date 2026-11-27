import * as T from 'three';
import type {GroundWorld} from '../shared/physics/world.ts';

export function frameGroupPhoto(world:GroundWorld,visitor:T.Vector3,resident:T.Vector3,bystanders:T.Vector3[],aspect:number,rankForeground=true) {
  const up=visitor.clone().add(resident).normalize();
  const across=resident.clone().sub(visitor).projectOnPlane(up).normalize();
  if(!across.lengthSq())return null;
  const forward=new T.Vector3().crossVectors(across,up).normalize();
  const heads=[visitor,resident].map(feet=>feet.clone().addScaledVector(feet.clone().normalize(),1.35));
  const target=visitor.clone().add(resident).multiplyScalar(.5).addScaledVector(up,1.12);
  const camera=new T.PerspectiveCamera(43,aspect,.08,200);
  const distance=Math.max(3.55,visitor.distanceTo(resident)/(.57*Math.min(aspect,1.5))+.75);
  const blockers=bystanders.map(feet=>{
    const up=feet.clone().normalize();
    return [feet.clone().addScaledVector(up,1),feet.clone().addScaledVector(up,1.55)];
  });
  camera.up.copy(up);
  let bestCamera:T.PerspectiveCamera|null=null,leastObstruction=Infinity;
  for(const framingScale of [1,.82])for(const yaw of [0,.36,-.36,.18,-.18,.55,-.55])for(const side of [1,-1]){
    const bearing=forward.clone().multiplyScalar(side).applyAxisAngle(up,yaw);
    camera.fov=43/framingScale; camera.updateProjectionMatrix();
    camera.position.copy(target).addScaledVector(bearing,distance*framingScale).addScaledVector(up,.37);
    camera.lookAt(target);camera.updateMatrixWorld(true);
    if(heads.some(head=>world.cameraDistance(head,camera.position,.08)+.04<head.distanceTo(camera.position)))continue;
    if(heads.some(head=>{
      const sightline=new T.Line3(camera.position,head);
      return blockers.some(body=>body.some(point=>sightline.closestPointToPoint(point,true,new T.Vector3()).distanceToSquared(point)<.6**2));
    }))continue;
    const screen=heads.map(head=>head.clone().project(camera));
    if(screen.some(p=>Math.abs(p.x)>.75||Math.abs(p.y)>.72||p.z>=1)||Math.abs(screen[0].x-screen[1].x)<.26)continue;
    if(!rankForeground)return {camera,target};
    // Face rays alone miss pillars that cover shoulders or fill the foreground beside a face.
    const foregroundBlocked=(x:number,y:number,z:number,reach:number)=>{
      const end=new T.Vector3(x,y,z).unproject(camera).lerp(camera.position,1-reach);
      return world.cameraDistance(camera.position,end,.06)+.05<camera.position.distanceTo(end);
    };
    let obstruction=0;
    const depth=target.clone().project(camera).z;
    const nearestSubjectDepth=Math.min(screen[0].z,screen[1].z);
    for(const [,head] of blockers){
      const p=head.clone().project(camera);
      if(p.z<nearestSubjectDepth&&p.z>-1&&Math.abs(p.x)<1.5&&Math.abs(p.y)<1.2)obstruction+=18;
    }
    for(const {x,y,z} of screen){
      for(const dx of [-.13,0,.13]){
        if(foregroundBlocked(x+dx,y-.26,z,.95))obstruction+=3;
        if(foregroundBlocked(x+dx,y,z,.85))obstruction+=2;
      }
    }
    for(const x of [-.96,-.79,-.62,-.33,0,.33,.62,.79,.96])for(const y of [-.45,.05,.55]){
      if(foregroundBlocked(x,y,depth,.94))obstruction++;
    }
    if(obstruction===0&&Math.abs(yaw)<=.36)return {camera,target};
    const score=obstruction+Math.abs(yaw)*7+Math.abs(1-framingScale);
    if(score<leastObstruction){bestCamera=camera.clone();leastObstruction=score;}
  }
  return bestCamera?{camera:bestCamera,target}:null;
}
