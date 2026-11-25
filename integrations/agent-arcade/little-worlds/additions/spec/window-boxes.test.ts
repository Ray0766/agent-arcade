import { expect, it } from 'vitest';
import { planWindowBoxes } from '../src/client/town-exterior.ts';
import type { PartPlacement, Rot } from '../src/shared/blueprint-model.ts';

it('uses exterior window bays and leaves doors, interior walls and walkable landings clear', () => {
  const p = (n: number, part: PartPlacement['part'], x: number, z: number, rot: Rot = 0, level = 0): PartPlacement =>
    ({ n, part, x, z, rot, level });
  const parts = [
    p(1, 'floor.deck', 1, 1), p(2, 'wall.window', 1, 1),
    p(3, 'floor.deck', 2, 1), p(4, 'wall.door.open', 2, 1),
    p(5, 'floor.deck', 1, 2), // The first window actually faces another room.
    p(6, 'wall.window', 1, 1, 3), p(7, 'step.entry', 0, 1),
    p(8, 'wall.window', 2, 1, 1), p(9, 'wall.window.box', 2, 2, 1),
    p(10, 'wall.window', 1, 1, 2), p(11, 'wall.window', 0, 0),
    p(12, 'floor.deck', 1, 1, 0, 1), p(13, 'wall.window', 1, 1, 0, 1),
    p(14, 'floor.deck', 2, 1, 0, 1), p(15, 'wall.window', 2, 1, 0, 1),
  ];
  const before=structuredClone(parts);
  expect(planWindowBoxes(parts).map(p=>p.n)).toEqual([13,10]);
  expect(parts).toEqual(before);
});
