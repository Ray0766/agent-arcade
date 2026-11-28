import type { Vec3 } from './world.ts';

export interface PublicFlightPeer { id: string; role: 'owner' | 'guest' }
export type PublicFlightStage = 'dock' | 'flying' | 'arrived';
export interface PublicFlightShip {
  tripId: string; journey: number; sequence: number;
  position: Vec3; yaw: number; pitch: number;
}
export interface PublicFlightRound {
  id: string; peer: PublicFlightPeer; incoming: boolean;
  phase: 'invited' | 'agreed'; mine: PublicFlightStage; theirs: PublicFlightStage;
  ship: PublicFlightShip | null;
  meetingPeerId?: string;
}
export interface PublicFlightView { peers: PublicFlightPeer[]; round: PublicFlightRound | null }
export type PublicFlightCommand =
  | { action: 'invite'; peerId: string; requestId: string }
  | { action: 'accept' | 'decline' | 'cancel'; id: string };
