import type { CourtyardFlower } from './courtyard-plantings.ts';

export const NELL_GARDENER = 'nell-garden';
export const NELL_FLOWERS = ['coral', 'gold'] as const satisfies readonly CourtyardFlower[];
export const NELL_WATER_MS = 2700;
export type NellFlower = typeof NELL_FLOWERS[number];
export type NellSeedlings = NellFlower[];
export function isNellFlower(value: unknown): value is NellFlower {
  return value === 'coral' || value === 'gold';
}
