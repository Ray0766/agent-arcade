import type { DatabaseSync } from 'node:sqlite';
import type { CourtyardCardAction, CourtyardCardVisit, SavedCourtyardCard } from '../shared/courtyard-stamp-collection.ts';
import type { PlayerState } from '../shared/world.ts';
import { RequestError } from './errors.ts';

const planetIdPattern = /^p-[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export function courtyardCardVisit(planetId: unknown, visitEpoch: unknown): CourtyardCardVisit {
  if (typeof planetId !== 'string' || !planetIdPattern.test(planetId) ||
      typeof visitEpoch !== 'number' || !Number.isSafeInteger(visitEpoch) || visitEpoch < 0)
    throw new RequestError(400, 'Choose the current courtyard visit.');
  return { planetId, visitEpoch };
}

export function requireCourtyardCardVisit(player: PlayerState, visit: CourtyardCardVisit) {
  const location = player.location;
  if (player.planetId !== visit.planetId || player.flight.mode !== 'ground' ||
      location?.kind !== 'exterior' || location.visitEpoch !== visit.visitEpoch || player.home?.canEdit)
    throw new RequestError(403, 'Return to the approved friend visit.');
}

export function requireOwnStampAlbum(player: PlayerState) {
  if (player.location?.kind !== 'interior' || !player.home?.canEdit)
    throw new RequestError(403, 'Open the card album in your own study.');
}

/** The two original courtyard interactions supply cosmetic stamps. This store
 * owns durable collection and identity; a repeat completion never makes a new card. */
export function courtyardStampCollection(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS courtyard_stamp_cards (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    planet_id TEXT NOT NULL REFERENCES planets(id) ON DELETE CASCADE,
    planet_name TEXT NOT NULL,
    stamps INTEGER NOT NULL CHECK(stamps BETWEEN 1 AND 3),
    PRIMARY KEY(player_id, planet_id)
  )`);
  const select = 'SELECT planet_id AS planetId, planet_name AS planetName, stamps FROM courtyard_stamp_cards';
  const read = db.prepare(select + ' WHERE player_id=? AND planet_id=?');
  const list = db.prepare(select + ' WHERE player_id=? ORDER BY planet_name, planet_id');
  const collect = db.prepare(`INSERT INTO courtyard_stamp_cards (player_id,planet_id,planet_name,stamps)
    SELECT ?,id,name,? FROM planets WHERE id=? AND kind='garden' AND owner_id IS NOT NULL AND owner_id<>?
    ON CONFLICT(player_id,planet_id) DO UPDATE SET stamps=courtyard_stamp_cards.stamps | excluded.stamps
    RETURNING planet_id AS planetId, planet_name AS planetName, stamps`);
  const continueCard = db.prepare(`UPDATE courtyard_stamp_cards SET stamps=stamps | ? WHERE player_id=? AND planet_id=?
    RETURNING planet_id AS planetId, planet_name AS planetName, stamps`);
  return {
    read(playerId: string, planetId: string) {
      return read.get(playerId, planetId) as unknown as SavedCourtyardCard | undefined ?? null;
    },
    list(playerId: string) {
      return list.all(playerId) as unknown as SavedCourtyardCard[];
    },
    save(playerId: string, planetId: string, action: CourtyardCardAction, stamps: number) {
      const row = action === 'collect' ? collect.get(playerId, stamps, planetId, playerId)
        : continueCard.get(stamps, playerId, planetId);
      if (!row) throw new RequestError(409, 'Collect this courtyard card first.');
      return row as unknown as SavedCourtyardCard;
    },
  };
}
