import type { HomeDescriptor, HomeRoofFinish } from './home.ts';
import type { ShipTrip } from './ship-trip.ts';
import type { Vec3 } from './world.ts';

export interface OrbitFriendHome {
  variant: HomeDescriptor['variant'];
  kit: 'classic' | 'district';
  mirrored: boolean;
  position: Vec3;
  rotation: number;
  baseRadius: number;
  roofFinish: HomeRoofFinish | null;
}

export interface OrbitFriendHomeBinding extends Pick<ShipTrip, 'revision' | 'journey' | 'targetId'> {
  tripId: ShipTrip['id'];
}

export interface OrbitFriendHomeResponse extends OrbitFriendHomeBinding {
  home: OrbitFriendHome | null;
}
