import { Vector3, type Object3D } from 'three';
import type { GroundPose, GroundWorld } from '../shared/physics/world.ts';
import { canWalkTutorialConnector } from '../shared/tutorial-navigation.ts';
import { distance, type Vec3 } from '../shared/world.ts';
import { benchSeat, type BenchSeat } from './bench-rest.ts';
import { residentHipHeight } from './bothouse-resident-model.ts';

export interface ResidentBenchPlan {
  id: string;
  model: Object3D;
  approach: Vec3;
  seat: BenchSeat;
}

/** Prove a short approach to either open side using ordinary ground physics. */
export function planResidentBench(world: GroundWorld, feet: GroundPose, benches: ReadonlyMap<string, Object3D>): ResidentBenchPlan | null {
  const start = new Vector3(...feet.position);
  const nearby = [...benches].map(([id, model]) => ({
    id, model, range: start.angleTo(model.getWorldPosition(new Vector3())) * world.baseRadius,
  })).filter(bench => bench.range <= 4).sort((a,b) => a.range - b.range).slice(0,3);
  for (const {id, model} of nearby) {
    const sides = [-.92,.92].map(offset => model.localToWorld(new Vector3(0,0,offset)).normalize().toArray());
    sides.sort((a,b) => distance(feet.position,a,world.baseRadius)-distance(feet.position,b,world.baseRadius));
    for (const approach of sides) {
      const pose = world.pose(approach);
      const seat = benchSeat(model, pose, world, residentHipHeight);
      if (seat && pose.grounded && !world.blocked(pose) && canWalkTutorialConnector(world, feet.position, approach)) {
        return { id, model, approach, seat };
      }
    }
  }
  return null;
}
