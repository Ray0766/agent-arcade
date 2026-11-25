import { Quaternion, Vector3, type Object3D } from 'three';
import type { GroundPose, GroundWorld } from '../shared/physics/world.ts';

export interface BenchSeat {
  position: Vector3;
  rotation: Quaternion;
  distance: number;
}

/** The Kenney quick-build bench has a .439 m seat and no back.
 * The render pose faces the side from which the visitor approached. */
export function benchSeat(model: Object3D, feet: GroundPose, world: Pick<GroundWorld, 'cameraDistance'>): BenchSeat | null {
  const footing = new Vector3(...feet.position).multiplyScalar(feet.radius);
  const local = model.worldToLocal(footing.clone());
  const distance = Math.hypot(local.x, local.z);
  if (Math.abs(local.x) > .65 || Math.abs(local.z) < .48 || distance > 1.3 || Math.abs(local.y) > .24) return null;

  const side = Math.sign(local.z);
  const eye = footing.clone().addScaledVector(new Vector3(...feet.position), .95);
  const benchEye = model.localToWorld(new Vector3(0, 1, 0));
  if (world.cameraDistance(eye, benchEye, .06) + .05 < eye.distanceTo(benchEye)) return null;

  const position = model.localToWorld(new Vector3(0, .439 + .067 - .65, .025 * side));
  const rotation = model.getWorldQuaternion(new Quaternion());
  if (side < 0) rotation.multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), Math.PI));
  return { position, rotation, distance };
}
