import { rotDir } from './blueprint-model.ts';
import type { PartPlacement } from './blueprint-model.ts';

export const cell = (x: number, z: number, level: number) => `${x},${z},${level}`;

/** Flood only empty cells connected to the outside; enclosed holes get no finish. */
export function exteriorCells(parts: readonly PartPlacement[], occupied: ReadonlySet<string>, level: number) {
  const atLevel = parts.filter(p => p.level === level);
  const minX = Math.min(...atLevel.map(p => p.x)) - 1, maxX = Math.max(...atLevel.map(p => p.x)) + 1;
  const minZ = Math.min(...atLevel.map(p => p.z)) - 1, maxZ = Math.max(...atLevel.map(p => p.z)) + 1;
  const result = new Set<string>(), queue: [number, number][] = [[minX, minZ]];
  for (let i = 0; i < queue.length; i++) {
    const [x, z] = queue[i], key = cell(x, z, level);
    if (x < minX || x > maxX || z < minZ || z > maxZ || occupied.has(key) || result.has(key)) continue;
    result.add(key);
    for (let side = 0; side < 4; side++) { const [dx, dz] = rotDir(side); queue.push([x + dx, z + dz]); }
  }
  return result;
}
