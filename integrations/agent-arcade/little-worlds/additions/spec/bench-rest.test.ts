import { Group, Vector3 } from 'three';
import { expect, it } from 'vitest';
import { benchSeat } from '../src/client/bench-rest.ts';
import type { GroundPose } from '../src/shared/physics/world.ts';

it('seats visitors facing their approach side and refuses obstructed or end-on approaches', () => {
  const bench = new Group();
  bench.position.y = 21.6;
  const footing = (x: number, z: number): GroundPose => {
    const point = new Vector3(x, bench.position.y, z);
    return { position: point.clone().normalize().toArray(), radius: point.length(), grounded: true, verticalSpeed: 0 };
  };
  const clear = { cameraDistance: (from: Vector3, to: Vector3) => from.distanceTo(to) };
  for (const side of [-1, 1]) {
    const feet = footing(0, side * .8);
    const original = structuredClone(feet);
    const seat = benchSeat(bench, feet, clear)!;
    expect(seat.position.z).toBeCloseTo(side * .025);
    expect(new Vector3(0, 0, 1).applyQuaternion(seat.rotation).z).toBeCloseTo(side);
    expect(feet).toEqual(original);
  }
  expect(benchSeat(bench, footing(1, 0), clear)).toBeNull();
  expect(benchSeat(bench, footing(0, .8), { cameraDistance: () => .25 })).toBeNull();
});
