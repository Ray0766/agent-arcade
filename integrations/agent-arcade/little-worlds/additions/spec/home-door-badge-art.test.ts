import { expect, it } from 'vitest';
import * as T from 'three';
import { StyleLibrary } from '../src/assets/claude-geometry/style/materials.ts';
import { buildCameraBlueprintModel } from '../src/client/camera-blueprint-model.ts';
import { VILLAGE_PART_BOUNDS } from '../src/shared/physics/village-bounds.ts';
import { homeDoorBadgeMount, HOME_DOOR_BADGES } from '../src/shared/home-door-badge.ts';
import { HOME_DOOR_PART, HOME_VARIANTS, homeVariant } from '../src/shared/home-layout.ts';
import { rotDir } from '../src/shared/blueprint-model.ts';
import type { PartPlacement, Rot } from '../src/shared/blueprint-model.ts';

it('uses only an unambiguous fixture on the exterior wall beside the active door', () => {
  for (const variant of HOME_VARIANTS) expect(homeDoorBadgeMount(homeVariant(variant).parts, HOME_DOOR_PART)?.n).toBe(304);
  const stock = homeVariant('starter').parts;
  const sign = stock.find(part => part.n === 304)!;
  const door = stock.find(part => part.n === HOME_DOOR_PART)!;
  const widen = (part: PartPlacement): PartPlacement => part === door ? { ...part, part: 'wall.door-wide.open' } : part;
  expect(homeDoorBadgeMount(stock.map(widen), door.n)?.n).toBe(sign.n);
  expect(homeDoorBadgeMount(stock.filter(part => part !== sign), door.n)).toBeNull();
  expect(homeDoorBadgeMount(stock.filter(part => part.n !== 111), door.n)).toBeNull();
  const other = { ...sign, n: 901, x: 3 };
  const mountWall = { ...stock.find(part => part.n === 111)!, n: 902, x: 3 };
  expect(homeDoorBadgeMount([...stock, other, mountWall], door.n)).toBeNull();
  expect(homeDoorBadgeMount([...stock.filter(part => part !== sign), other, mountWall].map(widen), door.n)).toBeNull();
  const quarterTurn = (part: PartPlacement): PartPlacement => {
    const [x, z] = rotDir(1), [rx, rz] = rotDir(2);
    return { ...part, x: part.x * rx + part.z * x, z: part.x * rz + part.z * z, rot: ((part.rot + 1) % 4) as Rot };
  };
  expect(homeDoorBadgeMount(stock.map(quarterTurn), door.n)?.n).toBe(sign.n);
});

it('keeps the original fixture envelope and emits each mark on both visible faces', () => {
  const kit = new StyleLibrary('medium', { look: 'village', scans: false });
  const part: PartPlacement = { n: 304, part: 'sign.mail', x: 0, z: 0, rot: 0, level: 0 };
  const options = { pivot: { x: .5, z: 1 } };
  const original = buildCameraBlueprintModel([part], kit, 'medium', options);
  const models = HOME_DOOR_BADGES.map(badge => buildCameraBlueprintModel([part], kit, 'medium', { ...options, doorBadge: { partNumber: part.n, badge } }));
  try {
    const extent = VILLAGE_PART_BOUNDS[part.part];
    const originalBox = new T.Box3().setFromObject(original.object);
    const signatures: string[] = [];
    for (const model of models) {
      const mark = new Set<string>();
      model.object.traverse(node => {
        if (!(node instanceof T.Mesh)) return;
        const p = node.geometry.getAttribute('position');
        for (let i = 0; i < p.count; i++) if (Math.abs(p.getX(i)) > .0241)
          mark.add([p.getX(i), p.getY(i), p.getZ(i)].map(value => value.toFixed(5)).join(','));
      });
      const bounds = new T.Box3().setFromObject(model.object);
      expect(bounds.min.x).toBeGreaterThanOrEqual(extent.min[0] - 1e-5);
      expect(bounds.max.x).toBeLessThanOrEqual(extent.max[0] + 1e-5);
      expect(bounds.min.y).toBeCloseTo(originalBox.min.y, 6);
      expect(bounds.max.y).toBeCloseTo(originalBox.max.y, 6);
      expect(bounds.min.z).toBeCloseTo(originalBox.min.z, 6);
      expect(bounds.max.z).toBeCloseTo(originalBox.max.z, 6);
      expect([...mark].some(point => point.startsWith('-'))).toBe(true);
      expect([...mark].some(point => !point.startsWith('-'))).toBe(true);
      const socket = model.object.getObjectByName('part:304');
      expect(socket?.userData).toEqual({ n: 304, part: 'sign.mail' });
      signatures.push([...mark].sort().join(';'));
    }
    expect(signatures[0]).not.toBe(signatures[1]);
  } finally {
    original.dispose();
    models.forEach(model => model.dispose());
    kit.dispose();
  }
});
