import { randomUUID } from 'node:crypto';
import { Vector3 } from 'three';
import { RESIDENT_INTERACT_DISTANCE, RESIDENT_INTERACT_HEIGHT, TOWN_RESIDENT_ANCHORS } from '../shared/town-residents.ts';
import { STEP_HEIGHT, type GroundWorld } from '../shared/physics/world.ts';
import type { PlayerState } from '../shared/world.ts';
import type { PairedQuayCommand, PairedQuayView, QuayPhase, QuayRole } from '../shared/paired-quay-repair.ts';
import type { QuaySampleAccess } from './quay-study-sample.ts';
import type { QuaySampleTurn } from '../shared/quay-study-sample.ts';
import { RequestError } from './errors.ts';

export function atQuayBench(player: PlayerState, world: GroundWorld): boolean {
  if (player.planetId !== 'hub' || player.flight.mode !== 'ground' || player.location?.kind !== 'exterior' || !player.ground?.grounded) return false;
  const target = TOWN_RESIDENT_ANCHORS['ivo-repair'].position;
  const from = new Vector3(...player.position), to = new Vector3(...target);
  if (from.angleTo(to) * world.baseRadius > RESIDENT_INTERACT_DISTANCE) return false;
  const support = world.support(target, world.radius(target) + STEP_HEIGHT);
  if (Math.abs(player.ground.radius - support.radius) > RESIDENT_INTERACT_HEIGHT || world.blocked({...world.pose(target),radius:support.radius})) return false;
  const eye = from.multiplyScalar(player.ground.radius + 1.35), chest = to.multiplyScalar(support.radius + 1.3);
  return world.cameraDistance(eye,chest) + .03 >= eye.distanceTo(chest);
}

export function isQuayCommand(value: Record<string,unknown>): boolean {
  return value.action === 'repair' && Object.keys(value).length === 4 &&
    Number.isSafeInteger(value.version) && Number(value.version) >= 1 &&
    typeof value.move === 'string' && ['offer','offerSample','acceptSample','accept','decline','ready','press','left','right','hold','tighten','retest','leave'].includes(value.move);
}

const changed = () => new RequestError(409,'Check the current support, your position and your role.');

export class QuayRepairRound {
  readonly id = randomUUID();
  private version = 1;
  private phase: QuayPhase = 'met';
  private holder?: string;
  private turn = -2;
  private requestedSample = false;
  private startingTurn: QuaySampleTurn = -2;
  private ready = new Set<string>();
  private left = new Set<string>();

  role(member: string): QuayRole | null { return !this.holder ? null : this.holder === member ? 'holder' : 'wrench'; }

  stillAtBench(member: string, near: boolean) {
    return this.phase === 'done' || !this.ready.has(member) || near;
  }

  view(member: string, other: string, near: boolean, samples: QuaySampleAccess): PairedQuayView | undefined {
    if (this.left.has(member)) return;
    return { id:this.id, version:this.version, phase:this.phase, role:this.role(member),
      myReady:this.ready.has(member), peerReady:this.ready.has(other), atBench:near, turn:this.turn,
      locked:this.phase === 'locked' || this.phase === 'done',
      ...(this.phase === 'offered' && this.requestedSample && { requestedSample: true as const,
        ...(this.role(member) === 'wrench' && samples.savedTurn(member) !== null && { canUseSample: true as const }) }) };
  }

  /** Returns false when this pair should release both windows. Only the caller's side can be confirmed. */
  apply(member: string, cmd: PairedQuayCommand, near: boolean, atSign: () => boolean, samples: QuaySampleAccess, peer: string): boolean {
    if (cmd.id !== this.id || this.left.has(member) || cmd.version !== this.version) throw changed();
    const role = this.role(member);
    switch (cmd.move) {
      case 'leave':
        if (this.phase !== 'done') return false;
        this.left.add(member);
        return this.left.size < 2;
      case 'offerSample':
      case 'offer':
        if (this.phase !== 'met' || !atSign()) throw changed();
        this.requestedSample = cmd.move === 'offerSample';
        this.holder = member; this.phase = 'offered'; break;
      case 'decline':
      case 'acceptSample':
      case 'accept':
        if (this.phase !== 'offered' || role !== 'wrench') throw changed();
        if (cmd.move === 'decline') return false;
        if (!atSign()) throw changed();
        if (cmd.move === 'acceptSample') {
          if (!this.requestedSample) throw changed();
          const turn = samples.savedTurn(member);
          if (turn === null) throw changed();
          this.startingTurn = turn;
        }
        this.phase = 'walking'; break;
      case 'ready':
        if (this.phase !== 'walking' || this.ready.has(member) || !near) throw changed();
        this.ready.add(member);
        if (this.ready.size === 2) {
          this.turn = this.startingTurn;
          this.phase = 'inspect';
        }
        break;
      case 'press':
        if (role !== 'holder' || this.phase !== 'inspect') throw changed();
        this.phase = 'adjust'; break;
      case 'left':
      case 'right': {
        if (role !== 'holder' || this.phase !== 'adjust') throw changed();
        const next = this.turn + (cmd.move === 'left' ? -1 : 1);
        if (next < -3 || next > 3) throw changed();
        this.turn = next; break;
      }
      case 'hold':
        if (role !== 'holder' || this.phase !== 'adjust' || this.turn !== 0) throw changed();
        this.phase = 'held'; break;
      case 'tighten':
        if (role !== 'wrench' || this.phase !== 'held') throw changed();
        this.phase = 'locked'; break;
      case 'retest':
        if (role !== 'holder' || this.phase !== 'locked') throw changed();
        samples.award(member, peer);
        this.phase = 'done'; break;
    }
    this.version++;
    return true;
  }
}
