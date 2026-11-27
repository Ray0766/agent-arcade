import type { HomeDoorBadge } from './home-door-badge.ts';
import type { CourtyardCardVisit } from './courtyard-stamp-collection.ts';

export type DoorBadgeRubbingVisit = CourtyardCardVisit;
export interface SavedDoorBadgeRubbing {
  planetId: string;
  planetName: string;
  badge: HomeDoorBadge;
}
export interface DoorBadgeRubbingPreview {
  current: SavedDoorBadgeRubbing;
  version: string;
  saved: SavedDoorBadgeRubbing[];
}
