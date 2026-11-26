import * as T from 'three';
import { arc, fromLocal, toLocal } from '../shared/planet-plan/sphere.ts';
import type { GroundWorld, GroundPose } from '../shared/physics/world.ts';
import type { TutorialTarget } from '../shared/tutorial-navigation.ts';
import type { Vec3 } from '../shared/world.ts';
import { BOARD_RADIUS, portPoint } from '../shared/ports.ts';

export interface ResidentGuideEntry {
  id: string;
  name: string;
  pose: Pick<GroundPose, 'position' | 'radius'> | null;
}

export const RESIDENT_GUIDE_REPLAN_METRES = .65;

/** Stand beside the resident where they can be seen. The route planner still
 * has to prove that the visitor can walk to the chosen point. */
export function residentGuideTargets(world: GroundWorld, viewer: Vec3, resident: ResidentGuideEntry, roster: readonly ResidentGuideEntry[]): TutorialTarget[] {
  if (!resident.pose) return [];
  const origin = resident.pose.position, radius = world.baseRadius, dock = portPoint(world.planetId);
  const [east, north] = toLocal(origin, viewer, radius);
  const bearing = Math.atan2(north, east);
  const figure = new T.Vector3(...origin).multiplyScalar(resident.pose.radius + 1.05);
  const candidates: TutorialTarget[] = [];
  for (const offset of [0, 1, -1, 2, -2, 3, -3, 4]) {
    const angle = bearing + offset * Math.PI / 4;
    const point = fromLocal(origin, [1.5 * Math.cos(angle), 1.5 * Math.sin(angle)], radius);
    // Keep the meeting point beyond the ship's boarding area.
    if (arc(point, dock, radius) < BOARD_RADIUS + .25) continue;
    // The visitor should arrive nearer to the chosen resident than to their neighbours.
    if (roster.some(other => other.id !== resident.id && other.pose && arc(point, other.pose.position, radius) < 1.68)) continue;
    const pose = world.pose(point);
    pose.radius = world.support(point, pose.radius + .45).radius;
    if (world.blocked(pose)) continue;
    const eye = new T.Vector3(...point).multiplyScalar(pose.radius + 1.1);
    if (world.cameraDistance(eye, figure, .06) + .05 < eye.distanceTo(figure)) continue;
    candidates.push({ kind: 'resident', planetId: world.planetId, position: point });
    if (candidates.length >= 4) break;
  }
  return candidates;
}
