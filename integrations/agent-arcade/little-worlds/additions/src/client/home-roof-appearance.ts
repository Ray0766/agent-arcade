import type { StyleLibrary } from '../assets/claude-geometry/style/materials.ts';
import { villageMaterial } from '../assets/claude-geometry/style/village.ts';
import type { HomeRoofFinish } from '../shared/home.ts';

const roofPalette: Record<HomeRoofFinish, string> = {
  slate: 'village:tile-dark',
  terracotta: 'village:pot',
};

const tiledRoofParts = new Set([
  'roof.slope', 'roof.slope.long', 'roof.slope.hip', 'roof.slope.valley',
  'roof.verge.left', 'roof.verge.right', 'roof.verge.long.left', 'roof.verge.long.right',
]);

export const isTiledRoofPart = (id: string) => tiledRoofParts.has(id);

/** Reuse the village palette and lighting. The style library owns these shared materials. */
export function homeRoofMaterial(lib: StyleLibrary, finish?: HomeRoofFinish) {
  if (lib.look !== 'village' || !finish || !Object.hasOwn(roofPalette, finish)) return;
  return villageMaterial(lib, roofPalette[finish]);
}
