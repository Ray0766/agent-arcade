import { Vector3 } from 'three';
import type { DatabaseSync } from 'node:sqlite';
import { TOWN_POST_ADA, TOWN_POST_PAX, type TownPostProgress, type TownPostReceiptProgress } from '../shared/town-post.ts';
import { RESIDENT_INTERACT_DISTANCE, RESIDENT_INTERACT_HEIGHT, TOWN_RESIDENT_ANCHORS } from '../shared/town-residents.ts';
import { STEP_HEIGHT, type GroundWorld } from '../shared/physics/world.ts';
import type { PlayerState } from '../shared/world.ts';
import { RequestError } from './errors.ts';

function requireContact(player: PlayerState, resident: typeof TOWN_POST_ADA | typeof TOWN_POST_PAX,
                        visitEpoch: number, terrain: () => GroundWorld) {
  if(player.planetId!=='hub'||player.flight.mode!=='ground'||player.location?.kind==='interior'||
      (player.location?.visitEpoch??0)!==visitEpoch||player.ground?.grounded!==true)
    throw new RequestError(403,'Land in town and approach the resident.');
  const world=terrain(), target=TOWN_RESIDENT_ANCHORS[resident]?.position;
  if (!target) throw new RequestError(409,'The post route is unavailable.');
  const from=new Vector3(...player.position), to=new Vector3(...target);
  const support=world.support(target,world.radius(target)+STEP_HEIGHT);
  const eye=from.clone().multiplyScalar(player.ground.radius+1.35);
  const chest=to.clone().multiplyScalar(support.radius+1.3);
  if(world.blocked({...world.pose(target),radius:support.radius}) ||
      from.angleTo(to)*world.baseRadius>RESIDENT_INTERACT_DISTANCE ||
      Math.abs(player.ground.radius-support.radius)>RESIDENT_INTERACT_HEIGHT ||
      world.cameraDistance(eye,chest)+.03<eye.distanceTo(chest))
    throw new RequestError(409,resident===TOWN_POST_PAX?'Move closer to Pax.':'Move closer to Ada.');
}

export function townPostStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS town_post_progress (
    player_id TEXT PRIMARY KEY NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK(version > 0),
    pending INTEGER NOT NULL CHECK(pending IN (0,1))
  )`);
  // The delivered letter is the only source of a receipt. Record it within the original delivery write.
  db.exec(`CREATE TABLE IF NOT EXISTS town_post_receipts (
    player_id TEXT NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK(version > 0),
    stage TEXT NOT NULL CHECK(stage IN ('available','held','archived')),
    PRIMARY KEY(player_id,version)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS one_held_town_post_receipt
    ON town_post_receipts(player_id) WHERE stage='held';
  CREATE TRIGGER IF NOT EXISTS town_post_record_delivery AFTER UPDATE OF pending ON town_post_progress
    WHEN OLD.pending=1 AND NEW.pending=0 AND OLD.version=NEW.version
    BEGIN
      INSERT OR IGNORE INTO town_post_receipts VALUES(NEW.player_id,NEW.version,'available');
    END;
  INSERT OR IGNORE INTO town_post_receipts(player_id,version,stage)
    SELECT player_id,version,'available' FROM town_post_progress WHERE version>0 AND pending=0;`);
  const receiptState = db.prepare(`SELECT
    MAX(CASE WHEN stage='available' THEN version END) AS availableVersion,
    MAX(CASE WHEN stage='held' THEN version END) AS heldVersion,
    MAX(CASE WHEN stage='archived' THEN version END) AS archivedVersion
    FROM town_post_receipts WHERE player_id=?`);
  const receiptStage = db.prepare('SELECT stage FROM town_post_receipts WHERE player_id=? AND version=?');
  const advance = db.prepare('UPDATE town_post_receipts SET stage=? WHERE player_id=? AND version=? AND stage=?');
  const readReceipt = (id: string) => receiptState.get(id) as unknown as TownPostReceiptProgress;
  const get = db.prepare('SELECT version,pending FROM town_post_progress WHERE player_id=?');
  const create = db.prepare('INSERT INTO town_post_progress(player_id,version,pending) VALUES(?,1,1) ON CONFLICT DO NOTHING');
  const renew = db.prepare('UPDATE town_post_progress SET version=version+1,pending=1 WHERE player_id=? AND version=? AND pending=0');
  const deliver = db.prepare('UPDATE town_post_progress SET pending=0 WHERE player_id=? AND version=? AND pending=1');
  const read = (playerId: string): TownPostProgress => {
    const row=get.get(playerId);
    return {version:Number(row?.version??0),pending:row?.pending===1};
  };
  return {
    read,
    readReceipt,
    changeReceipt(id: string, currentPlayer: () => PlayerState, body: Record<string,unknown>, terrain: () => GroundWorld) {
      const {action,residentId,version,visitEpoch} = body;
      if (Object.keys(body).length!==4 || (action!=='collect' && action!=='archive') ||
          typeof version!=='number' || !Number.isSafeInteger(version) || version<1 ||
          typeof visitEpoch!=='number' || !Number.isSafeInteger(visitEpoch) || visitEpoch<0)
        throw new RequestError(400,'Choose a delivered letter and its receipt.');
      const resident = action==='collect' ? TOWN_POST_ADA : TOWN_POST_PAX;
      if (residentId!==resident) throw new RequestError(409,'Choose the resident for this receipt.');
      db.exec('BEGIN IMMEDIATE');
      try {
        requireContact(currentPlayer(),resident,visitEpoch,terrain);
        const stage = receiptStage.get(id,version)?.stage;
        if (!stage) throw new RequestError(409,'This letter has no delivered receipt.');
        let changed = false;
        if (action==='collect' && stage==='available') {
          const {heldVersion,availableVersion} = readReceipt(id);
          if (heldVersion!==null || availableVersion!==version)
            throw new RequestError(409,'Check your current receipt before collecting.');
          changed = !!advance.run('held',id,version,'available').changes;
        } else if (action==='archive' && stage!=='archived') {
          if (stage!=='held') throw new RequestError(409,'Collect this receipt from Ada first.');
          changed = !!advance.run('archived',id,version,'held').changes;
        }
        const result = {...readReceipt(id),changed};
        db.exec('COMMIT');
        return result;
      } catch (error) {
        if (db.isTransaction) db.exec('ROLLBACK');
        throw error;
      }
    },
    change(playerId: string, player: PlayerState, body: Record<string,unknown>, terrain:()=>GroundWorld) {
      const {action,residentId,version,visitEpoch}=body;
      if(Object.keys(body).length!==4 || (action!=='accept'&&action!=='deliver') ||
          typeof version!=='number' || !Number.isSafeInteger(version) || version<0 ||
          typeof visitEpoch!=='number' || !Number.isSafeInteger(visitEpoch) || visitEpoch<0)
        throw new RequestError(400,'Choose the current star letter action.');
      const resident=action==='accept'?TOWN_POST_PAX:TOWN_POST_ADA;
      if(residentId!==resident)throw new RequestError(409,'Take the star letter to Ada.');
      requireContact(player,resident,visitEpoch,terrain);
      const result=action==='deliver'?deliver.run(playerId,version):
        version===0?create.run(playerId):renew.run(playerId,version);
      return {...read(playerId),changed:!!result.changes};
    },
  };
}
