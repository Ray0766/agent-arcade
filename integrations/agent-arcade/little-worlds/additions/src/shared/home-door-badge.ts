import { rotDir } from './blueprint-model.ts';
import type { PartPlacement } from './blueprint-model.ts';
import { isOpenDoorPartId, PARTS } from './blueprint-parts.ts';
import { isWideDoor } from './wide-door.ts';

export const HOME_DOOR_BADGES = ['leaf-branch', 'open-book'] as const;
export type HomeDoorBadge = typeof HOME_DOOR_BADGES[number];
export const isHomeDoorBadge = (value: unknown): value is HomeDoorBadge =>
  HOME_DOOR_BADGES.some(badge => badge === value);

export const isHomeDoorBadgeFixture = (part: PartPlacement) =>
  part.part === 'sign.mail' || part.part === 'sign.blank';

/** Identify one existing exterior fixture, beside the active door's opening.
 * The fixture is on the outside cell of the same wall edge and faces inward;
 * the hanging panel projects back into that outside cell. */
export function homeDoorBadgeMount(parts: readonly PartPlacement[], doorPartNumber: number): PartPlacement | null {
  const door = parts.find(part => part.n === doorPartNumber && part.level === 0 && isOpenDoorPartId(part.part));
  if (!door) return null;
  const [dx, dz] = rotDir(door.rot), [rx, rz] = rotDir(door.rot + 1);
  const rightEdge = isWideDoor(door.part) ? 2 : 1;
  const fixtures = parts.filter(sign => {
    if (!isHomeDoorBadgeFixture(sign) || sign.level !== 0 || sign.rot !== (door.rot + 2) % 4) return false;
    const x = sign.x - door.x, z = sign.z - door.z;
    const beside = x * rx + z * rz;
    if (x * dx + z * dz !== 1 || (beside !== -1 && beside !== rightEdge)) return false;
    return parts.some(wall => wall.level === sign.level && wall.x === sign.x - dx && wall.z === sign.z - dz &&
      wall.rot === door.rot && PARTS[wall.part].role === 'wall' && PARTS[wall.part].plainFaces === true);
  });
  return fixtures.length === 1 ? fixtures[0] : null;
}
