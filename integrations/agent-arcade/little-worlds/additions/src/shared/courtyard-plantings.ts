import type { PartPlacement } from './blueprint-model.ts';

// Immutable stock blueprints use the existing structure save and placement contract.
export const COURTYARD_PLANTINGS = {
  bed: {
    name: 'Flower drift', hash: '33b0d57e2a48436ba62db6f215d8a91ae54f0a777f81b51de25972aa8c9e9063',
    parts: [
      { n: 1, part: 'garden.bed', x: 2, z: 3, level: 0, rot: 0 },
      { n: 2, part: 'garden.bed', x: 3, z: 3, level: 0, rot: 0 },
      { n: 3, part: 'floor.deck', x: 2, z: 3, level: 0, rot: 0 },
      { n: 4, part: 'floor.deck', x: 3, z: 3, level: 0, rot: 0 },
    ],
  },
  edging: {
    name: 'Low stone edging', hash: '9ee1eb8aaa83270b24846c0bc6f6abb4c8f347b085b0757ec685c007a812e175',
    parts: [
      { n: 1, part: 'street.kerb', x: 2, z: 3, level: 0, rot: 0 },
      { n: 2, part: 'street.paving', x: 2, z: 3, level: 0, rot: 0 },
    ],
  },
  'golden-tree': {
    name: 'Golden-leaf tree', hash: '56591142319933161b15907e20f6bc1ea2fc758516e476c8dfd18a161179c614',
    parts: [
      { n: 1, part: 'garden.tree', x: 3, z: 3, level: 0, rot: 0 },
      { n: 2, part: 'floor.deck', x: 3, z: 3, level: 0, rot: 0 },
    ],
  },
} satisfies Record<string, { name: string; hash: string; parts: PartPlacement[] }>;

export type CourtyardPlanting = keyof typeof COURTYARD_PLANTINGS;
export const courtyardPlanting = (hash: unknown) => Object.entries(COURTYARD_PLANTINGS)
  .find(([, planting]) => planting.hash === hash)?.[0] as CourtyardPlanting | undefined;

export type CourtyardFlower = 'coral' | 'gold';
export type CourtyardBedPalette = 'original' | CourtyardFlower;
export const COURTYARD_BED_PALETTES = ['original', 'coral', 'gold'] as const;
export const isCourtyardBedPalette = (value: unknown): value is CourtyardBedPalette =>
  COURTYARD_BED_PALETTES.some(palette => palette === value);
export function courtyardBedFlowers(palette?: CourtyardBedPalette): { main: CourtyardFlower; accent: CourtyardFlower } {
  return palette === 'gold' ? { main: 'gold', accent: 'coral' } : { main: 'coral', accent: 'gold' };
}
