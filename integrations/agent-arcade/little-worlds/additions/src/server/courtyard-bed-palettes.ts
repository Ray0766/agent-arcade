import type { DatabaseSync } from 'node:sqlite';
import { COURTYARD_PLANTINGS, isCourtyardBedPalette, type CourtyardBedPalette } from '../shared/courtyard-plantings.ts';
import { RequestError } from './errors.ts';

export function courtyardBedPaletteStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS courtyard_bed_palettes (
    object_id TEXT PRIMARY KEY REFERENCES planet_objects(id) ON DELETE CASCADE,
    palette TEXT NOT NULL CHECK(palette IN ('coral','gold'))
  )`);
  const read = db.prepare('SELECT palette FROM courtyard_bed_palettes WHERE object_id=?');
  const list = db.prepare(`SELECT o.id, p.palette FROM courtyard_bed_palettes p
    JOIN planet_objects o ON o.id=p.object_id
    WHERE o.planet_id=? AND o.kind='structure' AND o.blueprint_hash=? ORDER BY o.id`);
  const object = db.prepare(`SELECT o.version FROM planet_objects o JOIN planets p ON p.id=o.planet_id
    WHERE o.id=? AND p.id=? AND p.owner_id=? AND o.kind='structure' AND o.blueprint_hash=?`);
  const set = db.prepare(`INSERT INTO courtyard_bed_palettes (object_id,palette) VALUES (?,?)
    ON CONFLICT(object_id) DO UPDATE SET palette=excluded.palette`);
  const clear = db.prepare('DELETE FROM courtyard_bed_palettes WHERE object_id=?');
  const bump = db.prepare('UPDATE players SET revision=revision+1 WHERE planet_id=?');
  return {
    list(planetId: string): Record<string, CourtyardBedPalette> {
      return Object.fromEntries(list.all(planetId, COURTYARD_PLANTINGS.bed.hash)
        .flatMap(({ id, palette }) => isCourtyardBedPalette(palette) ? [[String(id), palette]] : []));
    },
    set(at: { playerId: string; planetId: string; objectId: string; expectedVersion: number; expectedPalette: CourtyardBedPalette; palette: CourtyardBedPalette }) {
      db.exec('BEGIN IMMEDIATE');
      try {
        if (object.get(at.objectId, at.planetId, at.playerId, COURTYARD_PLANTINGS.bed.hash)?.version !== at.expectedVersion ||
            (read.get(at.objectId)?.palette ?? 'original') !== at.expectedPalette) {
          throw new RequestError(409, 'This flower bed changed. Select it again.');
        }
        if (at.palette !== at.expectedPalette) {
          if (at.palette === 'original') clear.run(at.objectId);
          else set.run(at.objectId, at.palette);
          bump.run(at.planetId);
        }
        db.exec('COMMIT');
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
