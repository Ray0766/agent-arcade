import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { Vector3 } from 'three';
import { NELL_GARDENER, NELL_WATER_MS, isNellFlower, type NellFlower, type NellSeedlings } from '../shared/nell-seedlings.ts';
import { RESIDENT_INTERACT_DISTANCE, RESIDENT_INTERACT_HEIGHT, TOWN_RESIDENT_ANCHORS } from '../shared/town-residents.ts';
import { STEP_HEIGHT, type GroundWorld } from '../shared/physics/world.ts';
import type { PlayerState } from '../shared/world.ts';
import { RequestError } from './errors.ts';

const ROUND_MS = 120_000;
type Round = { id: string; color: NellFlower; visitEpoch: number; readyAt: number; expires: number };

function requireNell(player: PlayerState, visitEpoch: number, terrain: () => GroundWorld) {
  if (player.planetId !== 'hub' || player.flight.mode !== 'ground' || player.location?.kind === 'interior' ||
      (player.location?.visitEpoch ?? 0) !== visitEpoch || !player.ground?.grounded)
    throw new RequestError(403, 'Land on the main planet and approach Nell.');
  const world = terrain(), target = TOWN_RESIDENT_ANCHORS[NELL_GARDENER]?.position;
  if (!target) throw new RequestError(409, 'Nell is unavailable.');
  const from = new Vector3(...player.position), to = new Vector3(...target);
  const support = world.support(target, world.radius(target) + STEP_HEIGHT);
  const eye = from.clone().multiplyScalar(player.ground.radius + 1.35);
  const chest = to.clone().multiplyScalar(support.radius + 1.3);
  if (world.blocked({...world.pose(target),radius:support.radius}) ||
      from.angleTo(to) * world.baseRadius > RESIDENT_INTERACT_DISTANCE ||
      Math.abs(player.ground.radius - support.radius) > RESIDENT_INTERACT_HEIGHT ||
      world.cameraDistance(eye, chest) + .03 < eye.distanceTo(chest))
    throw new RequestError(409, 'Move closer to Nell at the glasshouse.');
}

export function nellSeedlingsStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS nell_seedlings (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    color TEXT NOT NULL CHECK(color IN ('coral','gold')),
    PRIMARY KEY(player_id,color)
  )`);
  const plants = db.prepare('SELECT color FROM nell_seedlings WHERE player_id=? ORDER BY color');
  const keep = db.prepare('INSERT INTO nell_seedlings(player_id,color) VALUES(?,?) ON CONFLICT DO NOTHING');
  const pending = new Map<string, Round>();
  const read = (id: string): NellSeedlings => plants.all(id).map(row => row.color).filter(isNellFlower);
  return {
    read,
    change(id: string, player: PlayerState, body: Record<string, unknown>, terrain: () => GroundWorld, now = Date.now()) {
      const { action, color, roundId, visitEpoch } = body;
      const round = pending.get(id);
      if (action === 'discard' && Object.keys(body).length === 2 && typeof roundId === 'string') {
        if (round?.id === roundId) pending.delete(id);
        return { discarded: true };
      }
      if (typeof visitEpoch !== 'number' || !Number.isSafeInteger(visitEpoch) || visitEpoch < 0)
        throw new RequestError(400, 'Choose the current glasshouse visit.');
      requireNell(player, visitEpoch, terrain);
      if (action === 'pot' && Object.keys(body).length === 3 && isNellFlower(color)) {
        for (const [playerId, older] of pending) if (older.expires <= now) pending.delete(playerId);
        const next = { id: randomUUID(), color, visitEpoch, readyAt: now + NELL_WATER_MS, expires: now + ROUND_MS };
        pending.set(id, next);
        return { roundId: next.id };
      }
      if (action !== 'keep' || Object.keys(body).length !== 3 || typeof roundId !== 'string')
        throw new RequestError(400, 'Choose the current seedling.');
      if (!round || round.id !== roundId || round.visitEpoch !== visitEpoch || round.expires <= now || now < round.readyAt)
        throw new RequestError(409, 'Finish potting and watering this seedling with Nell first.');
      return { added: !!keep.run(id, round.color).changes, colors: read(id) };
    },
  };
}
