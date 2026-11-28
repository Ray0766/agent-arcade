import type { DatabaseSync } from 'node:sqlite';
import type { SavedDoorBadgeRubbing } from '../shared/door-badge-rubbing.ts';

export function doorBadgeRubbings(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS door_badge_rubbings (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    planet_id TEXT NOT NULL REFERENCES planets(id) ON DELETE CASCADE,
    planet_name TEXT NOT NULL,
    badge TEXT NOT NULL CHECK(badge IN ('leaf-branch','open-book')),
    PRIMARY KEY(player_id, planet_id, badge)
  )`);
  const select = 'SELECT planet_id AS planetId, planet_name AS planetName, badge FROM door_badge_rubbings';
  const forPlanet = db.prepare(select + ' WHERE player_id=? AND planet_id=? ORDER BY rowid DESC');
  const album = db.prepare(select + ' WHERE player_id=? ORDER BY planet_id, rowid');
  const keep = db.prepare(`INSERT INTO door_badge_rubbings (player_id,planet_id,planet_name,badge)
    VALUES (?,?,?,?) ON CONFLICT(player_id,planet_id,badge) DO NOTHING`);
  return {
    forPlanet(playerId: string, planetId: string) {
      return forPlanet.all(playerId, planetId) as unknown as SavedDoorBadgeRubbing[];
    },
    album(playerId: string) {
      return album.all(playerId) as unknown as SavedDoorBadgeRubbing[];
    },
    keep(playerId: string, sample: SavedDoorBadgeRubbing) {
      keep.run(playerId, sample.planetId, sample.planetName, sample.badge);
    },
  };
}
