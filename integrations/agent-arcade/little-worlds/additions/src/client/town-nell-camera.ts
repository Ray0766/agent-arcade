import { PerspectiveCamera, Vector3 } from 'three';
import type { GroundWorld } from '../shared/physics/world.ts';
import type { CameraShipCollision } from './camera-ship-collision.ts';
import type { TownResidents } from './town-residents.ts';
import { drawWithActivityCamera } from './town-quay-repair-prop.ts';

type Focus = NonNullable<ReturnType<TownResidents['nellSeedlingFocus']>>;
const sides=[1.02,-1.14,1.63,-1.65,0,2.07,-2.07];
const reaches=[2.13,2.68,1.8];
const above=[1.12,1.43];

export class TownNellCamera {
  private readonly shot=new PerspectiveCamera();
  private eye?:Vector3;
  private lastFeet?:Vector3;
  private lastAnchor?:Vector3;
  private viewport='';
  view:PerspectiveCamera|null=null;

  reset(){
    this.view=null;this.eye=undefined;this.lastFeet=undefined;this.lastAnchor=undefined;this.viewport='';
  }

  draw(camera:PerspectiveCamera,world:GroundWorld,ship:CameraShipCollision,focus:Focus,feet:Vector3,sol:Vector3|undefined,
    width:number,height:number,draw:()=>void) {
    const anchor=focus.anchor.getWorldPosition(new Vector3()), viewport=width+'x'+height;
    const shot=this.shot;
    shot.up.copy(anchor).normalize();
    shot.fov=51;shot.near=camera.near;shot.far=camera.far;
    const narrow=width<=650;
    shot.setViewOffset(width,height,narrow?0:-width*.08,narrow?-height*.16:0,width,height);
    const center=focus.face.clone().addScaledVector(shot.up,-.20).lerp(focus.pot,.49);
    if(!this.lastFeet||this.lastFeet.distanceTo(feet)>.18||!this.lastAnchor||
       this.lastAnchor.distanceTo(anchor)>.12||this.viewport!==viewport){
      this.lastFeet=feet.clone();this.lastAnchor=anchor;this.viewport=viewport;
      const subjects=[focus.face, ...focus.mothers, focus.pot];
      this.eye=this.findEye(world,ship,focus,center,subjects,feet,sol);
    }
    if(!this.eye){this.view=null;draw();return;}
    shot.position.copy(this.eye);shot.lookAt(center);shot.updateMatrixWorld(true);
    this.view=shot;
    drawWithActivityCamera(camera,shot,draw);
  }

  private findEye(world:GroundWorld,ship:CameraShipCollision,focus:Focus,center:Vector3,subjects:Vector3[],
    feet:Vector3,sol:Vector3|undefined) {
    const blockers=[feet,...(sol?[sol]:[])].flatMap(base=>{
      const up=base.clone().normalize();
      return [.55,1.10,1.49].map(height=>base.clone().addScaledVector(up,height));
    });
    let best:Vector3|undefined, bestClearance=-Infinity;
    for(const z of reaches)for(const x of sides)for(const y of above){
      const eye=focus.anchor.localToWorld(new Vector3(x,y,z));
      if(blockers.some(p=>p.distanceTo(eye)<.48))continue;
      if(subjects.some(p=>{
        const reach=p.distanceTo(eye);
        return world.cameraDistance(p,eye,.07)+.045<reach||ship.distance(p,eye,.10)+.035<reach;
      }))continue;
      this.shot.position.copy(eye);this.shot.lookAt(center);this.shot.updateMatrixWorld(true);
      const top=focus.face.clone().addScaledVector(this.shot.up,.25);
      const soilBase=focus.pot.clone().addScaledVector(this.shot.up,-.20);
      const onScreen=[...subjects,top,soilBase].map(p=>p.clone().project(this.shot));
      if(onScreen.some(p=>Math.abs(p.x)>.89||Math.abs(p.y)>.86||p.z>1))continue;
      let clearance=1;
      for(const subject of subjects){
        const ray=subject.clone().sub(eye),length=ray.lengthSq();
        for(const blocker of blockers){
          const along=blocker.clone().sub(eye).dot(ray)/length;
          if(along<=0||along>=1)continue;
          clearance=Math.min(clearance,blocker.distanceTo(eye.clone().addScaledVector(ray,along)));
        }
      }
      if(clearance>.48)return eye;
      if(clearance>bestClearance){best=eye;bestClearance=clearance;}
    }
    return bestClearance>.25?best:undefined;
  }
}
