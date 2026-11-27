import type { DatabaseSync } from 'node:sqlite';
import { isQuaySampleTurn, type QuayStudyView } from '../shared/quay-study-sample.ts';
import { RequestError } from './errors.ts';

export function quayStudySamples(db: DatabaseSync) {
  // No row before the first successful paired repair. Version zero is an unclaimed part.
  db.exec(`CREATE TABLE IF NOT EXISTS study_quay_samples (
    player TEXT PRIMARY KEY REFERENCES players(id) ON DELETE CASCADE,
    version INTEGER NOT NULL DEFAULT 0 CHECK(version >= 0),
    turn INTEGER CHECK(turn IN (-3,-2,-1,1,2,3)),
    CHECK(version > 0 OR turn IS NULL)
  )`);
  const award = db.prepare('INSERT INTO study_quay_samples(player) VALUES (?), (?) ON CONFLICT(player) DO NOTHING');
  const slot = db.prepare('SELECT version, turn FROM study_quay_samples WHERE player=?');
  const claim = db.prepare('UPDATE study_quay_samples SET version=1 WHERE player=? AND version=0');
  const save = db.prepare('UPDATE study_quay_samples SET version=version+1,turn=? WHERE player=? AND version=?');

  function read(player: string): QuayStudyView {
    const row = slot.get(player);
    return {
      eligible: !!row,
      sample: row && Number(row.version) > 0
        ? { version: Number(row.version), turn: isQuaySampleTurn(row.turn) ? row.turn : null } : null,
    };
  }
  return {
    read,
    award(first: string, second: string) { award.run(first, second); },
    savedTurn(player: string) { return read(player).sample?.turn ?? null; },
    change(player: string, body: Record<string, unknown>): QuayStudyView {
      if (body.action === 'claim' && Object.keys(body).length === 1) {
        claim.run(player);
        const result = read(player);
        if (!result.eligible) throw new RequestError(403, 'Complete a shared quay repair first.');
        return result;
      }
      if (body.action !== 'save' || Object.keys(body).length !== 3 || !isQuaySampleTurn(body.turn) ||
          typeof body.version !== 'number' || !Number.isSafeInteger(body.version) || body.version < 1)
        throw new RequestError(400, 'Choose one to three marks to either side.');
      const current = read(player).sample;
      if (!current) throw new RequestError(403, 'Claim your workpiece in your study first.');
      if (current.version !== body.version) throw new RequestError(409, 'Reopen your current workpiece.');
      if (current.turn !== body.turn && save.run(body.turn, player, body.version).changes !== 1)
        throw new RequestError(409, 'Reopen your current workpiece.');
      return read(player);
    },
  };
}

export type QuaySampleAccess = Pick<ReturnType<typeof quayStudySamples>, 'award' | 'savedTurn'>;
