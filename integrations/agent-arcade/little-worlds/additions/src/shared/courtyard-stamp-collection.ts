export type CourtyardStamp = 'plaque' | 'water';

export const STAMP_BIT: Readonly<Record<CourtyardStamp, number>> = { plaque: 1, water: 2 };

export interface SavedCourtyardCard {
  planetId: string;
  planetName: string;
  stamps: number;
}

export interface CourtyardCardVisit {
  planetId: string;
  visitEpoch: number;
}

export type CourtyardCardAction = 'collect' | 'continue';

export function stampCount(stamps: number) {
  return Number(!!(stamps & STAMP_BIT.plaque)) + Number(!!(stamps & STAMP_BIT.water));
}
