import type { DatabaseSync } from 'node:sqlite';
import type { StampNextVisit } from '../shared/stamp-next-visit.ts';
import { RequestError } from './errors.ts';

export function stampNextVisitStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS stamp_next_visits (
    player_id TEXT PRIMARY KEY,
    planet_id TEXT NOT NULL,
    missing TEXT NOT NULL CHECK (missing IN ('plaque','water')),
    FOREIGN KEY (player_id,planet_id) REFERENCES courtyard_stamp_cards(player_id,planet_id) ON DELETE CASCADE
  );
  CREATE TRIGGER IF NOT EXISTS finish_stamp_next_visit AFTER UPDATE OF stamps ON courtyard_stamp_cards
  WHEN NEW.stamps=3 BEGIN
    DELETE FROM stamp_next_visits WHERE player_id=NEW.player_id AND planet_id=NEW.planet_id;
  END`);
  const choice = db.prepare(`SELECT v.planet_id AS planetId, v.missing, p.name AS planetName
    FROM stamp_next_visits v JOIN planets p ON p.id=v.planet_id WHERE v.player_id=?`);
  const pick = db.prepare(`INSERT INTO stamp_next_visits(player_id,planet_id,missing)
    SELECT player_id,planet_id,CASE stamps WHEN 1 THEN 'water' ELSE 'plaque' END
    FROM courtyard_stamp_cards WHERE player_id=? AND planet_id=? AND stamps IN (1,2)
    ON CONFLICT(player_id) DO UPDATE SET planet_id=excluded.planet_id,missing=excluded.missing`);
  const drop = db.prepare('DELETE FROM stamp_next_visits WHERE player_id=? AND planet_id=?');
  return {
    current(id: string): StampNextVisit | null {
      return choice.get(id) as unknown as StampNextVisit | undefined ?? null;
    },
    select(id: string, planetId: string) {
      if (!pick.run(id,planetId).changes) throw new RequestError(409,'Choose one of your unfinished cards.');
    },
    cancel(id: string, planetId: string) { drop.run(id,planetId); },
  };
}
