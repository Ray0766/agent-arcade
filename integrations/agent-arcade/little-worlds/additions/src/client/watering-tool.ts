import * as T from 'three';
import type { Vec3 } from '../shared/world.ts';
import { ART_PALETTE } from './art-profile.ts';

type ToolShape = 'box' | 'cylinder' | 'sphere';
export const WATER_COLOR = '#79aaa4';
export const WATER_WIDTH = .012;
const MOUTH: Vec3 = [.10, -.04, .33];

export function buildWateringCan(piece: (parent: T.Group, shape: ToolShape, color: string,
  position: Vec3, size: Vec3) => T.Object3D) {
  const can = new T.Group();
  piece(can, 'cylinder', ART_PALETTE.iron, [0, -.16, .035], [.17, .2, .17]);
  for (const x of [-.065, .065]) piece(can, 'box', ART_PALETTE.iron, [x, -.025, .035], [.023, .09, .027]);
  piece(can, 'box', ART_PALETTE.iron, [0, .02, .035], [.15, .025, .027]);
  const spout = piece(can, 'cylinder', ART_PALETTE.iron, [.05, -.085, .205], [.035, .25, .035]);
  spout.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), new T.Vector3(.10, .09, .23).normalize());
  piece(can, 'sphere', ART_PALETTE.iron, MOUTH, [.055, .045, .05]);
  return can;
}

export function wateringCanMouth(can: T.Group) {
  return can.localToWorld(new T.Vector3(...MOUTH));
}

export function aimWaterStream(stream: T.Object3D, mouth: T.Vector3, end: T.Vector3, width = WATER_WIDTH) {
  const delta = end.clone().sub(mouth);
  stream.position.copy(mouth).add(end).multiplyScalar(.5);
  stream.scale.set(width, delta.length(), width);
  stream.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), delta.normalize());
}
