export const TOWN_POST_PAX = 'pax-courier';
export const TOWN_POST_ADA = 'ada-shop';
export interface TownPostProgress { version: number; pending: boolean }
export type TownPostCommand = {
  action: 'accept' | 'deliver';
  residentId: string;
  version: number;
  visitEpoch: number;
};

export interface TownPostReceiptProgress {
  availableVersion: number | null;
  heldVersion: number | null;
  archivedVersion: number | null;
}

export interface TownPostReceiptCommand {
  action: 'collect' | 'archive';
  residentId: typeof TOWN_POST_ADA | typeof TOWN_POST_PAX;
  version: number;
  visitEpoch: number;
}
