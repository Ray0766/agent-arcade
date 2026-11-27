import * as T from 'three';
import type { GroundPose, GroundWorld } from '../shared/physics/world.ts';
import type { Vec3 } from '../shared/world.ts';
import { legacyOutdoorCameraPose } from './legacy-ground-camera.ts';
import { SurfaceWalker } from './motion.ts';

export interface ResidentArrivalView {
  subject: NonNullable<ReturnType<typeof residentArrivalSubject>>;
  heading: T.Vector3;
  pitch: number;
  fov: number;
  aspect: number;
  portrait: boolean;
  ship?: T.Object3D;
}

/** Read the face, hands or visible ledger from the current resident pose. */
export function residentArrivalSubject(root: T.Object3D) {
  const head = root.getObjectByName('head');
  if (!head) return null;
  root.updateWorldMatrix(true, true);
  const face = head.localToWorld(new T.Vector3(0, -.035, .19));
  const forward = new T.Vector3(0, 0, 1).transformDirection(head.matrixWorld);
  const ledger = root.getObjectByName('work-ledger');
  const details = ledger?.visible
    ? [-.12, .12].map(x => ledger.localToWorld(new T.Vector3(x, .06, 0)))
    : ['elbow-1', 'elbow1'].flatMap(name => {
      const elbow = root.getObjectByName(name);
      return elbow ? [elbow.localToWorld(new T.Vector3(0, -.21, .012))] : [];
    });
  return { face, forward, details };
}

/** This is a prediction used to rank destinations. It never drives the camera. */
export function scoreResidentArrival(world: GroundWorld, viewer: Vec3, feet: GroundPose, view: ResidentArrivalView) {
  const walker = new SurfaceWalker(feet.position);
  const transport = new T.Quaternion().setFromUnitVectors(new T.Vector3(...viewer), walker.up);
  walker.north.copy(view.heading).applyQuaternion(transport).projectOnPlane(walker.up).normalize();
  const floor = walker.up.clone().multiplyScalar(feet.radius);
  const probe = (start: T.Vector3, end: T.Vector3) => world.cameraDistance(start, end, .06);
  const follow = legacyOutdoorCameraPose(walker, view.portrait, world.baseRadius, floor, walker.up, view.pitch, probe);
  const ray = new T.Raycaster();
  const shipHit = (from: T.Vector3, to: T.Vector3, near: number) => {
    if (!view.ship?.visible) return undefined;
    const segment = to.clone().sub(from), length = segment.length();
    if (length <= near) return undefined;
    ray.set(from, segment.divideScalar(length));
    ray.near = near;
    ray.far = length;
    return ray.intersectObject(view.ship, true).find(hit => hit.object instanceof T.Mesh && hit.object.visible);
  };
  const ship = shipHit(follow.head, follow.position, .35);
  if (ship) {
    const direction = follow.target.clone().sub(follow.position).normalize();
    follow.position.sub(follow.head).setLength(Math.max(0, ship.distance - .3)).add(follow.head);
    follow.target.copy(follow.position).addScaledVector(direction, 3);
  }
  const camera = new T.PerspectiveCamera(view.fov, view.aspect, .08, 100);
  camera.position.copy(follow.position);
  camera.up.copy(walker.up);
  camera.lookAt(follow.target);
  camera.updateMatrixWorld(true);
  const eye = camera.position;
  const torso = floor.clone().addScaledVector(walker.up, .92);
  const screenWeight = (point: T.Vector3) => {
    const projected = point.clone().project(camera);
    if (projected.z < -1 || projected.z > 1 || Math.abs(projected.x) > .94 || Math.abs(projected.y) > .88) return 0;
    if (probe(eye, point) + .06 < eye.distanceTo(point) || shipHit(eye, point, .06)) return 0;
    const sight = new T.Line3(eye, point);
    const behindAvatar = follow.playerVisible && (
      sight.closestPointToPoint(torso, true, new T.Vector3()).distanceTo(torso) < .32 ||
      sight.closestPointToPoint(follow.head, true, new T.Vector3()).distanceTo(follow.head) < .24
    );
    return (behindAvatar ? .2 : 1) * (1 - Math.abs(projected.x) * .38 - Math.abs(projected.y) * .22);
  };
  const { face, forward, details } = view.subject;
  const front = forward.dot(eye.clone().sub(face).normalize());
  const screenHeight = Math.abs(face.clone().addScaledVector(walker.up, .24).project(camera).y - face.clone().project(camera).y);
  const size = T.MathUtils.clamp(screenHeight / .095, .25, 1);
  const facial = screenWeight(face) * T.MathUtils.clamp((front + .05) / .85, 0, 1) * size;
  const detail = details.reduce((best, point) => Math.max(best, screenWeight(point)), 0);
  return 4 * Math.min(facial, detail) + 2 * facial + detail;
}
