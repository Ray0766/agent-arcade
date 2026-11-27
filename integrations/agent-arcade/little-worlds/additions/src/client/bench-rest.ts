import { Quaternion, Vector3, type Object3D } from 'three';
import type { GroundPose, GroundWorld } from '../shared/physics/world.ts';

export interface SeatedBenchCompanion {
  residentId: string;
  name: string;
  benchId: string;
  model: Object3D;
  seat: BenchSeat;
}

export interface BenchSeat {
  position: Vector3;
  rotation: Quaternion;
  distance: number;
}

/** The Kenney quick-build bench has a .439 m seat and no back.
 * The render pose faces the side from which the player approached. */
export function benchSeat(model: Object3D, feet: GroundPose, world: Pick<GroundWorld, 'cameraDistance'>, hipHeight = .65): BenchSeat | null {
  const footing = new Vector3(...feet.position).multiplyScalar(feet.radius);
  const local = model.worldToLocal(footing.clone());
  const distance = Math.hypot(local.x, local.z);
  if (Math.abs(local.x) > .65 || Math.abs(local.z) < .48 || distance > 1.3 || Math.abs(local.y) > .24) return null;

  const side = Math.sign(local.z);
  const eye = footing.clone().addScaledVector(new Vector3(...feet.position), .95);
  const benchEye = model.localToWorld(new Vector3(0, 1, 0));
  if (world.cameraDistance(eye, benchEye, .06) + .05 < eye.distanceTo(benchEye)) return null;

  const position = model.localToWorld(new Vector3(0, .439 + .067 - hipHeight, .025 * side));
  const rotation = model.getWorldQuaternion(new Quaternion());
  if (side < 0) rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI));
  return { position, rotation, distance };
}

/** Seat centres are on separate meshes, with clearance between the seated bodies. */
export function adjacentBenchCompanion(benchId: string, seat: BenchSeat, companions: readonly SeatedBenchCompanion[],
  world: Pick<GroundWorld, 'cameraDistance'>): SeatedBenchCompanion | undefined {
  if (!companions.length) return;
  const from = seat.position.clone().addScaledVector(seat.position.clone().normalize(), .96);
  let nearest: SeatedBenchCompanion | undefined;
  let best = 3.05;
  for (const companion of companions) {
    const other = companion.seat.position;
    if (companion.benchId === benchId || Math.abs(seat.position.length() - other.length()) > .4) continue;
    const spacing = seat.position.distanceTo(other);
    if (spacing < 1.25 || spacing >= best) continue;
    const to = other.clone().addScaledVector(other.clone().normalize(), .96);
    if (world.cameraDistance(from, to, .06) + .05 < from.distanceTo(to)) continue;
    nearest = companion;
    best = spacing;
  }
  return nearest;
}
