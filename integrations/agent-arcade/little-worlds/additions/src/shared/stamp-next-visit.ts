export interface StampNextVisit {
  planetId: string;
  missing: 'plaque' | 'water';
  planetName: string;
  displayName?: string;
}
