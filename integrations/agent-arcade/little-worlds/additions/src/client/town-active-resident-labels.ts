import * as T from 'three';
import { NPCS } from '../shared/world.ts';
import type { ResidentText } from '../shared/town-residents.ts';
import type { TownResidents } from './town-residents.ts';
import './town-active-resident-labels.css';

interface LabelSubject {
  id: string;
  name: ResidentText;
  role: ResidentText;
  head: T.Vector3;
  distance: number;
  hat?: readonly T.Object3D[];
}

export interface TownResidentLabelFrame {
  activeId: string | null;
  actionText?: string;
  camera: T.Camera;
  viewer: T.Vector3;
  radius: number;
  taskActors: readonly { id: string; anchor: T.Object3D; avatar?: { head: T.Object3D } }[];
  residents: TownResidents | null;
}

interface Rect { left: number; top: number; right: number; bottom: number }
interface Point { x: number; y: number }
interface LabelCard {
  root: HTMLElement;
  name: HTMLElement;
  detail: HTMLElement;
  leader: HTMLElement;
  size?: { width: number; height: number };
}

const taskRoles = {
  mica: { en: 'Sunshine parcel', zh: '阳光包裹' },
  sol: { en: 'Glasshouse delivery', zh: '温室收件' },
};
const legacyIds = ['mica', 'sol'] as const;
const intersects = (a: Rect, b: Rect) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
const hudSelector = [
  '.minimal-bar > *', '#nearby', '#interact', '#dock-guide', '#town-post-receipt-address',
  '#town-star-letter', '#notice', '#mouse-look', '#save-status', '#joystick',
].join(', ');

function nearTasks(input: TownResidentLabelFrame): LabelSubject[] {
  return input.taskActors.flatMap(actor => {
    if (actor.id !== 'mica' && actor.id !== 'sol') return [];
    const feet = actor.anchor.getWorldPosition(new T.Vector3());
    const distance = input.viewer.angleTo(feet) * input.radius;
    if (distance > 4.25) return [];
    const head = actor.avatar?.head.localToWorld(new T.Vector3(0, .15, 0)) ??
      feet.clone().addScaledVector(feet.clone().normalize(), 1.47);
    const name = NPCS[actor.id].name;
    return [{ id: actor.id, name: { en: name, zh: name }, role: taskRoles[actor.id], head, distance }];
  });
}

function project(point: T.Vector3, camera: T.Camera, width: number, height: number) {
  const clip = point.clone().project(camera);
  return { x: (clip.x + 1) * width / 2, y: (1 - clip.y) * height / 2, depth: clip.z };
}

function includeHat(face: Rect, hat: readonly T.Object3D[] | undefined, camera: T.Camera, width: number, height: number) {
  for (const part of hat ?? []) {
    // These instanced primitives use unit geometry. Project the transformed
    // bounds so the brim still clears the label when the resident turns.
    part.updateWorldMatrix(true, false);
    for (const x of [-.5, .5]) for (const y of [-.5, .5]) for (const z of [-.5, .5]) {
      const point = project(new T.Vector3(x, y, z).applyMatrix4(part.matrixWorld), camera, width, height);
      face.left = Math.min(face.left, point.x - 3);
      face.right = Math.max(face.right, point.x + 3);
      face.top = Math.min(face.top, point.y - 3);
      face.bottom = Math.max(face.bottom, point.y + 3);
    }
  }
}

function placeCard(head: Point, face: Rect, size: { width: number; height: number },
  width: number, height: number, avoid: readonly Rect[]): Rect | undefined {
  const w = size.width, h = size.height;
  const centered = head.x - w / 2;
  const top = face.top - h - 10;
  const right = face.right + 9, left = face.left - w - 9;
  const middle = head.y - h / 2;
  const candidates = [
    [centered, top], [right, top], [left, top],
    [right, middle], [left, middle],
    [centered, top - h - 8], [right, top - h - 8], [left, top - h - 8],
  ];
  const aroundHud = avoid.flatMap(block => [
    [block.right + 7, middle], [block.left - w - 7, middle],
    [centered, block.top - h - 7], [centered, block.bottom + 7],
  ]).sort((a, b) => Math.hypot(a[0] - centered, a[1] - top) - Math.hypot(b[0] - centered, b[1] - top));
  candidates.push(...aroundHud);
  for (const [x, y] of candidates) {
    const l = T.MathUtils.clamp(x, 8, width - w - 8);
    const t = T.MathUtils.clamp(y, 50, Math.max(50, height - h - 68));
    const box = { left: l, top: t, right: l + w, bottom: t + h };
    if (!avoid.some(block => intersects(box, block))) return box;
  }
}

/** Display-only consumer of the existing ground interaction target. */
export class TownActiveResidentLabels {
  private readonly root = document.createElement('div');
  private readonly cards = new Map<string, LabelCard>();
  private readonly legacy = legacyIds.map(id => ({ id, node: document.getElementById(`npc-${id}`) }));
  private viewportWidth = 0;

  constructor() {
    this.root.className = 'town-resident-labels';
    this.root.setAttribute('aria-hidden', 'true');
    this.root.hidden = true;
    document.body.append(this.root);
  }

  private card(id: string): LabelCard {
    const existing = this.cards.get(id);
    if (existing) return existing;
    const root = document.createElement('div');
    const name = document.createElement('strong');
    const detail = document.createElement('small');
    const leader = document.createElement('span');
    root.className = 'town-resident-label';
    root.dataset.townResidentId = id;
    leader.className = 'town-resident-label-leader';
    root.append(name, detail, leader);
    this.root.append(root);
    const card = { root, name, detail, leader };
    this.cards.set(id, card);
    return card;
  }

  frame(input: TownResidentLabelFrame | null) {
    this.root.hidden = !input;
    if (!input) {
      for (const { node } of this.legacy) node?.removeAttribute('data-town-label-replaced');
      for (const { root } of this.cards.values()) root.hidden = true;
      return;
    }

    const width = innerWidth, height = innerHeight;
    const widthChanged = this.viewportWidth !== width;
    this.viewportWidth = width;
    if (widthChanged) for (const card of this.cards.values()) card.size = undefined;
    const camera = input.camera;
    const right = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new T.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const tasks = nearTasks(input);
    const subjects = [...tasks, ...(input.residents?.labelSubjects(input.viewer, input.radius, input.activeId) ?? [])];
    const heads = subjects.flatMap(subject => {
      const peak = project(subject.head, camera, width, height);
      if (peak.depth <= -1 || peak.depth >= 1 || peak.x < 0 || peak.x > width || peak.y < 0 || peak.y > height) return [];
      const edge = project(subject.head.clone().addScaledVector(right, .29).addScaledVector(up, .33), camera, width, height);
      const rx = Math.max(10, Math.abs(edge.x - peak.x)), ry = Math.max(12, Math.abs(edge.y - peak.y));
      const face = { left: peak.x - rx, right: peak.x + rx, top: peak.y - ry, bottom: peak.y + ry };
      includeHat(face, subject.hat, camera, width, height);
      return [{ ...subject, point: peak, face, active: subject.id === input.activeId }];
    }).sort((a, b) => Number(b.active) - Number(a.active) || a.distance - b.distance);

    // Keep the original delivery direction cue at range. Nearby cards
    // replace their legacy equivalents as soon as the new layer can take over.
    for (const { id, node } of this.legacy) {
      node?.toggleAttribute('data-town-label-replaced', !!input.activeId || heads.some(head => head.id === id));
    }
    const shown = new Set<string>();
    if (heads.length) {
      const avoid: Rect[] = heads.map(head => head.face);
      for (const item of document.querySelectorAll<HTMLElement>(hudSelector)) {
        const box = item.getBoundingClientRect();
        if (box.width && box.height) avoid.push({ left: box.left - 3, right: box.right + 3, top: box.top - 3, bottom: box.bottom + 3 });
      }
      const language = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
      for (const head of heads.slice(0, 3)) {
        const card = this.card(head.id);
        const active = String(head.active);
        const name = head.name[language];
        const detail = head.active && input.actionText?.trim() || head.role[language];
        card.root.hidden = false;
        if (!card.size || card.root.dataset.active !== active || card.name.textContent !== name || card.detail.textContent !== detail) {
          card.root.dataset.active = active;
          card.name.textContent = name;
          card.detail.textContent = detail;
          card.size = { width: card.root.offsetWidth, height: card.root.offsetHeight };
        }
        const box = placeCard(head.point, head.face, card.size, width, height, avoid);
        if (!box) continue;
        shown.add(head.id);
        avoid.push({ left: box.left - 5, right: box.right + 5, top: box.top - 5, bottom: box.bottom + 5 });
        this.paint(card, box, head.point, head.face);
      }
    }
    for (const [id, { root }] of this.cards) root.hidden = !shown.has(id);
  }

  private paint(card: LabelCard, box: Rect, head: Point, face: Rect) {
    const { root, leader } = card;
    root.style.transform = `translate(${Math.round(box.left)}px, ${Math.round(box.top)}px)`;
    root.dataset.headX = String(Math.round(head.x));
    root.dataset.headY = String(Math.round(head.y));
    root.dataset.headClearance = [face.left, face.top, face.right, face.bottom].map(n => n.toFixed(1)).join(',');
    const start = { x: T.MathUtils.clamp(head.x, box.left + 3, box.right - 3), y: T.MathUtils.clamp(head.y, box.top + 3, box.bottom - 3) };
    const towardCard = { x: start.x - head.x, y: start.y - head.y };
    const faceX = towardCard.x < 0 ? face.left : face.right;
    const faceY = towardCard.y < 0 ? face.top : face.bottom;
    const edge = Math.min((faceX - head.x) / (towardCard.x || Number.EPSILON), (faceY - head.y) / (towardCard.y || Number.EPSILON));
    const end = { x: head.x + edge * towardCard.x, y: head.y + edge * towardCard.y };
    const dx = end.x - start.x, dy = end.y - start.y;
    leader.style.transform = `translate(${start.x - box.left}px, ${start.y - box.top}px) rotate(${Math.atan2(dy, dx)}rad)`;
    leader.style.width = `${Math.hypot(dx, dy)}px`;
  }
}
