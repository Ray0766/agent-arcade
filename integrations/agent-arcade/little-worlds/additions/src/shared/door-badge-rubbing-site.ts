import { Vector3 } from 'three';
import { localToPlanet } from '../assets/claude-geometry/core/anchor.ts';
import { SIGNBOARD } from '../assets/claude-geometry/blueprint/parts/home/fixtures.ts';
import { partTransform, pivotOf } from './blueprint-model.ts';
import { structureFit } from './blueprints.ts';
import { homeDoorBadgeMount } from './home-door-badge.ts';
import type { SavedDoorBadgeRubbing, DoorBadgeRubbingVisit } from './door-badge-rubbing.ts';
import type { GroundPose, GroundWorld } from './physics/world.ts';
import type { PlanetView } from './planets.ts';
import { fieldOf } from './terrain.ts';
import { distance } from './world.ts';
import type { Vec3 } from './world.ts';

export interface DoorBadgeRubbingKey extends DoorBadgeRubbingVisit {
  buildingId: string;
  buildingVersion: number;
  mountNumber: number;
  badge: SavedDoorBadgeRubbing['badge'];
}

const targetCache = new WeakMap<PlanetView, ReturnType<typeof targetOf>>();
function targetOf(planet: PlanetView) {
  const exterior = planet.homeExterior, door = planet.homeDoor;
  if (planet.mine || planet.kind !== 'garden' || !exterior?.doorBadge || door?.buildingId !== exterior.buildingId) return null;
  const house = planet.objects.find(object => object.kind === 'structure' && object.id === exterior.buildingId);
  const parts = house?.blueprintHash && planet.blueprints?.[house.blueprintHash];
  if (!house || !parts) return null;
  const mount = homeDoorBadgeMount(parts, door.partNumber);
  if (!mount) return null;
  const transform = partTransform(mount, pivotOf(parts));
  const fit = structureFit(parts, house.position, house.rotation, fieldOf(planet.environment, planet.radius));
  const y = (SIGNBOARD.y0 + SIGNBOARD.y1) / 2, z = (SIGNBOARD.z0 + SIGNBOARD.z1) / 2;
  const local: Vec3 = [transform.position[0] + Math.sin(transform.yaw) * z,
    transform.position[1] + y, transform.position[2] + Math.cos(transform.yaw) * z];
  const point = new Vector3(...localToPlanet({ dir: house.position, yaw: house.rotation }, fit.baseRadius, local));
  return { point, direction: point.clone().normalize().toArray() as Vec3, buildingId: house.id,
    buildingVersion: house.version, mountNumber: mount.n, badge: exterior.doorBadge };
}

export function doorBadgeRubbingSite(planet: PlanetView, world: GroundWorld, pose: GroundPose, visitEpoch: number) {
  if (!pose.grounded || world.planetId !== planet.id) return null;
  if (!targetCache.has(planet)) targetCache.set(planet, targetOf(planet));
  const target = targetCache.get(planet);
  if (!target || distance(pose.position, target.direction, pose.radius) > 2.1 || world.blocked(pose)) return null;
  const eye = new Vector3(...pose.position).multiplyScalar(pose.radius + 1.45);
  // The last centimetres can touch the actual badge's own collision proxy.
  if (world.cameraDistance(eye, target.point, 0) + .24 < eye.distanceTo(target.point)) return null;
  return { planetId: planet.id, planetName: planet.name, visitEpoch, buildingId: target.buildingId,
    buildingVersion: target.buildingVersion, mountNumber: target.mountNumber, badge: target.badge };
}
