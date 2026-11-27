import { Vector3 } from 'three';
import type { DatabaseSync } from 'node:sqlite';
import { TOWN_POST_ADA, TOWN_POST_PAX, type TownPostProgress } from '../shared/town-post.ts';
import { RESIDENT_INTERACT_DISTANCE, RESIDENT_INTERACT_HEIGHT, TOWN_RESIDENT_ANCHORS } from '../shared/town-residents.ts';
import { STEP_HEIGHT, type GroundWorld } from '../shared/physics/world.ts';
import type { PlayerState } from '../shared/world.ts';
import { RequestError } from './errors.ts';

export function townPostStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS town_post_progress (
    player_id TEXT PRIMARY KEY NOT NULL REFERENCES players(id) ON DELETE CASCADE,
    version INTEGER NOT NULL CHECK(version > 0),
    pending INTEGER NOT NULL CHECK(pending IN (0,1))
  )`);
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
    change(playerId: string, player: PlayerState, body: Record<string,unknown>, terrain:()=>GroundWorld) {
      const {action,residentId,version,visitEpoch}=body;
      if(Object.keys(body).length!==4 || (action!=='accept'&&action!=='deliver') ||
          typeof version!=='number' || !Number.isSafeInteger(version) || version<0 ||
          typeof visitEpoch!=='number' || !Number.isSafeInteger(visitEpoch) || visitEpoch<0)
        throw new RequestError(400,'Choose the current star letter action.');
      const resident=action==='accept'?TOWN_POST_PAX:TOWN_POST_ADA;
      if(residentId!==resident)throw new RequestError(409,'Take the star letter to Ada.');
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
        throw new RequestError(409,action==='accept'?'Move closer to Pax.':'Move closer to Ada.');
      const result=action==='deliver'?deliver.run(playerId,version):
        version===0?create.run(playerId):renew.run(playerId,version);
      return {...read(playerId),changed:!!result.changes};
    },
  };
}
