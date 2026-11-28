import type { HomeRoofFinish } from './home.ts';
import type { HomeDoorBadge } from './home-door-badge.ts';
import type { PartPlacement } from './blueprint-model.ts';
import { rotDir } from './blueprint-model.ts';
import { cell, exteriorCells } from './structure-exterior.ts';

export const HOME_WALL_FINISHES = ['sage', 'ochre'] as const;
export type HomeWallFinish = typeof HOME_WALL_FINISHES[number];
export const isHomeWallFinish = (value: unknown): value is HomeWallFinish => HOME_WALL_FINISHES.some(finish => finish === value);

export interface HomeExterior {
  buildingId: string;
  wallFinish?: HomeWallFinish;
  doorBadge?: HomeDoorBadge;
}

export type HomeFinishPreview =
  | { roofFinish: HomeRoofFinish | null }
  | { wallFinish: HomeWallFinish | null }
  | { doorBadge: HomeDoorBadge | null };

const floors = new Set(['floor.deck', 'floor.grate', 'roof.deck']);
const plasterWalls = new Set(['wall.solid', 'wall.window', 'wall.louvre']);

/** Plaster on a supported wall whose outward face borders open air. */
export function paintableHomeWalls(parts: readonly PartPlacement[]): Set<number> {
  const occupied = new Set(parts
    .filter(part => floors.has(part.part))
    .map(part => cell(part.x, part.z, part.level)));
  const walls = parts.filter(part => plasterWalls.has(part.part) && occupied.has(cell(part.x, part.z, part.level)));
  const outside = new Map([...new Set(walls.map(part => part.level))].map(level => [level, exteriorCells(parts, occupied, level)]));
  return new Set(walls.filter(part => {
    const [dx, dz] = rotDir(part.rot);
    return outside.get(part.level)!.has(cell(part.x + dx, part.z + dz, part.level));
  }).map(part => part.n));
}
