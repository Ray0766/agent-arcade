export const TOWN_POST_PAX = 'pax-courier';
export const TOWN_POST_ADA = 'ada-shop';
export interface TownPostProgress { version: number; pending: boolean }
export type TownPostCommand = {
  action: 'accept' | 'deliver';
  residentId: string;
  version: number;
  visitEpoch: number;
};
