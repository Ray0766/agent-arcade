import { randomUUID } from 'node:crypto';
import type { PlayerState } from '../shared/world.ts';
import type { PublicFlightCommand, PublicFlightPeer, PublicFlightStage, PublicFlightView } from '../shared/paired-public-flight.ts';
import { mainTownDockBoard } from '../shared/main-town-dock-board.ts';
import { distance } from '../shared/world.ts';
import { canBoard } from '../shared/ports.ts';
import { RequestError } from './errors.ts';

import type { QuaySampleAccess } from './quay-study-sample.ts';
import { isQuayCommand, QuayRepairRound } from './paired-quay-repair.ts';

interface WindowMember {
  player: string; session: string; client: string; peer: PublicFlightPeer;
  origin: string; epoch: number; access: string; pulse: number;
  invitations: Set<string>; round?: Round;
}
interface Round {
  id: string; from: WindowMember; to: WindowMember; agreed: boolean; until: number;
  repair?: QuayRepairRound;
  trips: Map<WindowMember, { id: string; journey: number; request: string }>;
}
interface Access {
  samples: QuaySampleAccess;
  state(id: string): PlayerState;
  session(digest: string): string;
  owner(player: string): string | null | undefined;
  visit(player: string, session: string, planet: string): string | undefined;
  atQuay(player: string): boolean;
  hubPresence(player: string, epoch: number): string | undefined;
  allowed(access: string, planet: string): Promise<boolean>;
}
const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(value);
const windowId = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{32}$/.test(value);
const changed = () => new RequestError(409, 'This shared departure is no longer available.');
function parseCommand(value: unknown): PublicFlightCommand | undefined {
  if (value === undefined) return;
  if (value && typeof value === 'object' && 'id' in value && uuid(value.id) && isQuayCommand(value as Record<string,unknown>))
    return value as PublicFlightCommand;
  if (value && typeof value === 'object' && Object.keys(value).length === 2 && 'action' in value &&
      ['accept','decline','cancel','meet'].includes(String(value.action)) && 'id' in value && uuid(value.id)) return value as PublicFlightCommand;
  if (value && typeof value === 'object' && Object.keys(value).length === 3 && 'action' in value && value.action === 'invite' &&
      'peerId' in value && uuid(value.peerId) && 'requestId' in value && uuid(value.requestId)) return value as PublicFlightCommand;
  throw new RequestError(400, 'Invalid shared departure action.');
}
export function pairedPublicFlights(access: Access, now = Date.now) {
  const members = new Map<string, WindowMember>();
  const sign = mainTownDockBoard();
  function bySign(m: WindowMember) {
    const p = access.state(m.player);
    if (!p.ground?.grounded || p.planetId !== 'hub' || distance(sign,p.position,p.worldRadius)>2.0) return;
    return access.hubPresence(m.player,m.epoch+2);
  }
  const empty = (): PublicFlightView => ({peers: [], round: null});
  function end(round?: Round) {
    if (!round) return;
    if (round.from.round === round) delete round.from.round;
    if (round.to.round === round) delete round.to.round;
  }
  function sweep() {
    for (const [key, m] of members) {
      if (m.pulse + 15000 <= now()) { end(m.round); members.delete(key); }
      else if (m.round && m.round.until <= now()) end(m.round);
    }
  }
  function identity(m: WindowMember) {
    if (members.get(m.session+'/'+m.client) !== m || access.session(m.session) !== m.player) return false;
    if (m.peer.role === 'owner') return access.owner(m.player) === m.origin;
    return !!m.access && access.visit(m.player,m.session,m.origin) === m.access;
  }
  function dock(player: PlayerState) {
    return player.planetId !== 'hub' && player.flight.mode === 'ground' && player.location?.kind === 'exterior' &&
      player.ground?.grounded && canBoard(player.planetId,player.position,player.worldRadius);
  }
  function stage(m: WindowMember, r?: Round): PublicFlightStage | null {
    if (!identity(m) || m.pulse + 15000 <= now()) return null;
    const p = access.state(m.player), t = p.trip, bound = r?.trips.get(m);
    if (!bound) return p.planetId === m.origin && p.location?.visitEpoch === m.epoch && dock(p) ? 'dock' : null;
    if (!t || t.id !== bound.id || t.journey !== bound.journey || p.flight.journey !== bound.journey ||
        t.originId !== m.origin || t.targetId !== 'hub' || t.revision !== 1 || t.requestId !== bound.request) return null;
    if (t.status === 'active' && p.flight.mode === 'space' && p.location?.visitEpoch === m.epoch + 1) return 'flying';
    if (t.status === 'arrived' && p.flight.mode === 'ground' && p.planetId === 'hub' &&
        p.location?.kind === 'exterior' && p.location.visitEpoch === m.epoch + 2) return 'arrived';
    return null;
  }
  const valid = (r: Round) => r.from.round === r && r.to.round === r && r.until > now() && !!stage(r.from,r) && !!stage(r.to,r);
  async function authorized(m: WindowMember) {
    return identity(m) && (m.peer.role === 'owner' || await access.allowed(m.access,m.origin)) && identity(m);
  }
  const exclusive = (m: WindowMember) => ![...members.values()].some(other => other.player === m.player && other !== m && other.round);
  function available(a: WindowMember, b: WindowMember) {
    return a.player !== b.player && a.origin === b.origin && a.peer.role !== b.peer.role &&
      !a.round && !b.round && exclusive(a) && exclusive(b) && !!stage(a) && !!stage(b);
  }
  async function check(r: Round) {
    const guest = r.from.peer.role === 'guest' ? r.from : r.to;
    if (!valid(r) || !await authorized(guest) || !valid(r)) { end(r); return false; }
    return true;
  }
  function locate(player: string, session: string, client: string) {
    const key = session + '/' + client;
    let m = members.get(key);
    if (m && m.player === player && (stage(m,m.round) || m.round)) return m;
    if (m) { end(m.round); members.delete(key); }
    const s = access.state(player);
    if (!dock(s) || access.session(session) !== player) return;
    const role = access.owner(player) === s.planetId ? 'owner' : 'guest';
    const token = role === 'guest' ? access.visit(player,session,s.planetId) : '';
    if (role === 'guest' && !token) return;
    if (members.size >= 256) throw new RequestError(429,'Shared departure is busy.');
    m = {player,session,client,origin:s.planetId,epoch:s.location!.visitEpoch,access:token ?? '',
      peer:{id:randomUUID(),role},pulse:now(),invitations:new Set()};
    members.set(key,m);
    return m;
  }
  return {
    async pulse(player: string, session: string, body: Record<string,unknown>): Promise<PublicFlightView> {
      if (!windowId(body.client) || Object.keys(body).some(k => k !== 'client' && k !== 'command')) throw new RequestError(400,'Invalid departure window.');
      const command = parseCommand(body.command);
      sweep();
      const m = locate(player,session,body.client);
      if (!m) { if (command) throw changed(); return empty(); }
      if (command?.action === 'cancel' || command?.action === 'decline') {
        if (m.round?.repair) throw changed();
        if (m.round?.id === command.id && (command.action === 'cancel' || (!m.round.agreed && m.round.to === m))) end(m.round);
        return empty();
      }
      // An unknown Friends decision must not close a live round or renew its lease.
      if (!m.round) {
        if (!await authorized(m) || !stage(m,m.round)) {
          end(m.round);
          if (members.get(session+'/'+m.client) === m) members.delete(session+'/'+m.client);
          return empty();
        }
        m.pulse = now();
      }
      if (command?.action === 'invite' && !m.invitations.has(command.requestId)) {
        const other = [...members.values()].find(b => b.peer.id === command.peerId);
        if (!other || !available(m,other) || !await authorized(other) || !available(m,other)) throw changed();
        if (m.invitations.size >= 128) throw new RequestError(429,'Reopen the departure window.');
        m.invitations.add(command.requestId);
        const r: Round = {id:randomUUID(),from:m,to:other,agreed:false,until:now()+45000,trips:new Map()};
        m.round = other.round = r;
      }
      const r = m.round;
      if (r) {
        if (!await check(r)) return empty();
        m.pulse = now();
        if (command?.action === 'meet') {
          if (command.id !== r.id || !r.agreed) throw changed();
          if (!r.repair) {
            if (stage(r.from,r) !== 'arrived' || stage(r.to,r) !== 'arrived' || !bySign(r.from) || !bySign(r.to)) throw changed();
            r.repair = new QuayRepairRound();
            r.until = now()+10*60000;
          }
        }
        if (r.repair) {
          const q = r.repair, other = m === r.from ? r.to : r.from;
          const near = access.atQuay(m.player), otherNear = access.atQuay(other.player);
          if (!q.stillAtBench(m.player,near) || !q.stillAtBench(other.player,otherNear)) { end(r); return empty(); }
          if (command?.action === 'repair') {
            if (!q.apply(m.player,command,near,()=>!!bySign(m) && !!bySign(other),access.samples,other.player)) { end(r); return empty(); }
          } else if (command && command.action !== 'meet') throw changed();
          const repair = q.view(m.player,other.player,near,access.samples);
          return repair ? {peers:[],round:null,repair} : empty();
        }
        if (command?.action === 'repair') throw changed();
        if (command?.action === 'accept') {
          if (command.id !== r.id || r.to !== m) throw changed();
          if (!r.agreed) { r.agreed = true; r.until = now()+10*60000; }
        }
        const other = r.from === m ? r.to : r.from, mine = stage(m,r)!, theirs = stage(other,r)!;
        const state = mine === 'flying' && theirs === 'flying' ? access.state(other.player) : null;
        const f = state?.flight;
        const meetingPeerId = mine === 'arrived' && theirs === 'arrived' && bySign(m) ? bySign(other) : undefined;
        return {peers:[],round:{id:r.id,peer:other.peer,incoming:r.to===m,phase:r.agreed?'agreed':'invited',mine,theirs,
          ...(meetingPeerId ? {meetingPeerId} : {}),
          ship:f && state?.trip ? {tripId:state.trip.id,journey:f.journey,sequence:f.sequence,position:f.position,yaw:f.yaw,pitch:f.pitch} : null}};
      }
      if (command && command.action !== 'invite') throw changed();
      if (!stage(m)) return empty();
      const peers = [...members.values()].filter(other => available(m,other));
      const checked = await Promise.all(peers.map(async other => await authorized(other) && available(m,other) ? other.peer : null));
      return {peers:checked.filter((p): p is PublicFlightPeer => p !== null),round:null};
    },
    async launch<T extends {player: PlayerState}>(player: string, session: string, binding: unknown, trip: Record<string,unknown>, start: () => T): Promise<T> {
      if (!binding || typeof binding !== 'object' || Object.keys(binding).length !== 2 || !('client' in binding) ||
          !windowId(binding.client) || !('id' in binding) || !uuid(binding.id) || trip.targetId !== 'hub') throw new RequestError(400,'Invalid shared trip confirmation.');
      sweep();
      const m = members.get(session+'/'+binding.client), r = m?.round;
      if (!m || m.player !== player || !r || r.id !== binding.id || !r.agreed || !await check(r)) throw changed();
      const bound = r.trips.get(m);
      if (!bound && access.state(player).trip?.requestId === trip.requestId) throw changed();
      if (bound && bound.request !== trip.requestId || trip.visitEpoch !== m.epoch) throw changed();
      const result = start();
      const t = result.player.trip!;
      r.trips.set(m,{id:t.id,journey:t.journey,request:t.requestId});
      return result;
    }
  };
}
