import { Group, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { residentArrivalSubject, scoreResidentArrival } from '../src/client/resident-arrival-view.ts';
import type { GroundPose, GroundWorld } from '../src/shared/physics/world.ts';

it('ranks a frontal face with a visible hand or ledger above a rear view or a blocked detail', () => {
  const feet: GroundPose = { position:[0,1,0], radius:21.6, grounded:true, verticalSpeed:0 };
  const face=new Vector3(.7,23,-1.4), detail=new Vector3(.85,22.72,-1.4);
  const clear = {baseRadius:21.6, cameraDistance:(from:Vector3,to:Vector3)=>from.distanceTo(to)} as GroundWorld;
  const blocked = {baseRadius:21.6, cameraDistance:(from:Vector3,to:Vector3)=>to === detail ? .1 : from.distanceTo(to)} as GroundWorld;
  const view = {subject:{face,forward:new Vector3(0,0,1),details:[detail]}, heading:new Vector3(0,0,-1),
    pitch:-.12,fov:54,aspect:1.6,portrait:false};
  const score=scoreResidentArrival(clear,feet.position,feet,view);
  expect(score).toBeGreaterThan(1.5);
  expect(scoreResidentArrival(blocked,feet.position,feet,view)).toBeLessThan(score);
  const rear={...view,subject:{...view.subject,forward:new Vector3(0,0,-1)}};
  expect(scoreResidentArrival(clear,feet.position,feet,rear)).toBeLessThan(score);
  expect(view.heading.toArray()).toEqual([0,0,-1]);
});


it('samples the resident hand joints until the existing work ledger becomes visible', () => {
  const root=new Group();
  for(const name of ['head','elbow-1','elbow1','work-ledger']){
    const node=new Group();
    node.name=name;
    root.add(node);
  }
  const ledger=root.getObjectByName('work-ledger')!;
  ledger.position.set(0,.8,.4);
  ledger.visible=false;
  const idle=residentArrivalSubject(root)!;
  expect(idle.details[0].y).toBeCloseTo(-.21);
  ledger.visible=true;
  const working=residentArrivalSubject(root)!;
  expect(working.details[0].y).toBeCloseTo(.86);
  expect(working.details[0].z).toBeCloseTo(.4);
});
