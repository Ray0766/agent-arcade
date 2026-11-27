import * as T from 'three';
import { disposeObject3D } from '../assets/claude-geometry/core/dispose.ts';
import { COURTYARD_PLANTINGS } from '../shared/courtyard-plantings.ts';
import type { GroundPose, GroundWorld } from '../shared/physics/world.ts';
import type { PlacedObject } from '../shared/planets.ts';
import { courtyardFoliage } from './nature-art.ts';
import './visitor-flower-bouquet.css';

type Flower = 'coral' | 'gold';
type Arrangement = { main: Flower; accent: Flower };
type Bed = { object: PlacedObject; model: T.Object3D };
type Site = {
  world: GroundWorld;
  pose: GroundPose;
  objects: readonly PlacedObject[];
  getModel(id: string): T.Object3D | undefined;
};
const defaultFlowers: Arrangement = { main: 'coral', accent: 'gold' };
const flowers = {
  coral: ['珊瑚花', 'Coral flowers'],
  gold: ['金色花', 'Golden flowers'],
} satisfies Record<Flower, [string, string]>;

function nearbyBed({ world, pose, objects, getModel }: Site): Bed | null {
  if (!pose.grounded || world.blocked(pose)) return null;
  const up = new T.Vector3(...pose.position), eye = up.clone().multiplyScalar(pose.radius + .9);
  for (const object of objects) {
    if (object.kind !== 'structure' || object.blueprintHash !== COURTYARD_PLANTINGS.bed.hash ||
        up.angleTo(new T.Vector3(...object.position)) * world.baseRadius > 2.55) continue;
    const model = getModel(object.id);
    if (!model?.visible || !model.parent) continue;
    for (const part of COURTYARD_PLANTINGS.bed.parts) {
      if (part.part !== 'garden.bed') continue;
      const anchor = model.getObjectByName(`part:${part.n}`);
      if (anchor?.userData.part !== part.part) continue;
      const point = anchor.localToWorld(new T.Vector3(0, .58, 0));
      const metres = up.angleTo(point) * world.baseRadius;
      if (metres >= .65 && metres <= 1.75 && world.cameraDistance(eye, point, .04) + .06 >= eye.distanceTo(point))
        return { object, model };
    }
  }
  return null;
}

function makeBouquet({ main, accent }: Arrangement) {
  const root = new T.Group();
  const paper = new T.Mesh(new T.CylinderGeometry(.19, .034, .30, 8, 1, true),
    new T.MeshStandardMaterial({ color: '#f1d9a9', side: T.DoubleSide, roughness: .93 }));
  paper.position.y = -.045;
  root.add(paper);
  const tie = new T.Mesh(new T.CylinderGeometry(.087, .081, .027, 8),
    new T.MeshStandardMaterial({ color: '#718164', roughness: .8 }));
  tie.position.y = -.091;
  root.add(tie);
  const tuck = (flower: Flower, x: number, y: number, z: number, width: number, height: number, tilt: number) => {
    const spray = courtyardFoliage('flowers', flower === 'gold');
    spray.position.set(x, y, z);
    spray.scale.set(width, height, width);
    spray.rotation.set(.15, x < 0 ? .28 : -.24, tilt);
    root.add(spray);
  };
  tuck(main, 0, .042, .01, .34, .39, -.04);
  tuck(main, -.105, .065, -.028, .25, .31, .17);
  tuck(accent, .108, .043, .005, .29, .31, -.15);
  tuck(accent, -.106, .014, .09, .24, .26, .21);
  root.rotation.z = -.10;
  return root;
}

export class VisitorFlowerBouquet {
  private readonly button = document.createElement('button');
  private readonly inspect = document.createElement('button');
  private readonly dialog = document.createElement('dialog');
  private readonly main: HTMLSelectElement;
  private readonly accent: HTMLSelectElement;
  private readonly mount = new T.Group();
  private readonly rootRotation = new T.Quaternion();
  private scope: string | null = null;
  private offer: Bed | null = null;
  private source: Bed | null = null;
  private committed = false;
  private inspecting = false;
  private model: T.Group | null = null;
  private language = '';

  constructor(private readonly host: HTMLElement, root: T.Group, releaseView: () => void) {
    this.mount.name = 'visitor-flower-bouquet';
    this.mount.visible = false;
    root.add(this.mount);
    this.button.id = 'visitor-flower-bouquet';
    this.button.type = 'button';
    this.button.className = 'primary';
    this.button.dataset.i18nVerbatim = '';
    this.button.hidden = true;
    this.inspect.id = 'visitor-bouquet-inspect';
    this.inspect.type = 'button';
    this.inspect.className = 'primary';
    this.inspect.dataset.i18nVerbatim = '';
    this.inspect.hidden = true;
    this.inspect.onclick = () => {
      if (this.inspect.hidden || !this.committed) return;
      releaseView();
      this.inspecting = !this.inspecting;
    };
    host.append(this.inspect, this.button);
    this.dialog.id = 'visitor-bouquet-dialog';
    this.dialog.setAttribute('aria-labelledby', 'visitor-bouquet-title');
    this.dialog.dataset.i18nVerbatim = '';
    this.dialog.innerHTML = `
      <h2 id="visitor-bouquet-title"></h2>
      <label><span></span><select id="visitor-bouquet-main"></select></label>
      <label><span></span><select id="visitor-bouquet-accent"></select></label>
      <div class="visitor-bouquet-actions">
        <button id="visitor-bouquet-cancel" type="button"></button>
        <button id="visitor-bouquet-confirm" class="primary" type="button"></button>
      </div>`;
    document.body.append(this.dialog);
    const get = <E extends HTMLElement>(id: string) => this.dialog.querySelector<E>('#visitor-bouquet-' + id)!;
    this.main = get('main');
    this.accent = get('accent');
    this.main.onchange = this.accent.onchange = () => this.preview();
    get('cancel').onclick = () => this.clear();
    get('confirm').onclick = () => {
      if (!this.scope || !this.source || !this.model) return;
      this.committed = true;
      this.source = null;
      this.dialog.close();
    };
    this.dialog.addEventListener('cancel', event => { event.preventDefault(); this.clear(); });
    this.button.onclick = () => {
      if (this.button.hidden || !this.scope) return;
      if (this.committed) { this.clear(); return; }
      if (!this.offer) return;
      releaseView();
      this.source = this.offer;
      this.main.value = defaultFlowers.main;
      this.accent.value = defaultFlowers.accent;
      this.dialog.showModal();
      this.preview();
    };
  }

  get holding() { return this.model !== null; }
  get faceViewer() { return this.dialog.open || this.inspecting; }
  resumeWalking() { this.inspecting = false; }

  frame(scope: string | null, site: Site | null, available: boolean, mayCarry: boolean) {
    if (scope !== this.scope) {
      this.clear();
      this.scope = scope;
    }
    this.offer = scope && site && (available || this.dialog.open) ? nearbyBed(site) : null;
    if (this.source && (!this.offer || this.offer.model !== this.source.model ||
        this.offer.object.version !== this.source.object.version)) this.clear();
    this.copy();
    const hidden = !scope || !mayCarry || this.dialog.open || !(this.committed || this.offer);
    this.button.hidden = hidden;
    this.inspect.hidden = hidden || !this.committed;
    this.inspect.setAttribute('aria-pressed', String(this.inspecting));
    this.host.toggleAttribute('data-visitor-bouquet', !hidden);
    const text = this.committed ? (this.language === 'zh' ? '收起花束' : 'Put away bouquet')
      : this.language === 'zh' ? '搭一束花' : 'Arrange a bouquet';
    if (this.button.textContent !== text) this.button.textContent = text;
  }

  attach(parcel: T.Object3D, visible: boolean) {
    this.mount.visible = visible && this.holding;
    if (!this.mount.visible) return;
    const root = this.mount.parent!;
    parcel.localToWorld(this.mount.position.set(0, .025, .07));
    root.worldToLocal(this.mount.position);
    root.getWorldQuaternion(this.rootRotation).invert();
    parcel.getWorldQuaternion(this.mount.quaternion).premultiply(this.rootRotation);
  }

  snapshot() {
    return { mode: this.committed ? 'carrying' : this.dialog.open ? 'preview' : 'idle',
      main: this.holding ? this.main.value : null, accent: this.holding ? this.accent.value : null,
      centre: this.mount.visible ? this.mount.localToWorld(new T.Vector3(0, .27, 0)).toArray() : null,
      facing: this.mount.visible ? new T.Vector3(0, 0, 1).applyQuaternion(this.mount.getWorldQuaternion(new T.Quaternion())).toArray() : null };
  }

  private preview() {
    if (this.model) disposeObject3D(this.model);
    this.model = makeBouquet({ main: this.main.value as Flower, accent: this.accent.value as Flower });
    this.mount.add(this.model);
  }

  private clear() {
    if (this.model) disposeObject3D(this.model);
    this.model = null;
    this.mount.visible = false;
    this.source = null;
    this.committed = this.inspecting = false;
    if (this.dialog.open) this.dialog.close();
  }

  private copy() {
    const lang = document.documentElement.lang.startsWith('zh') ? 'zh' : 'en';
    if (this.language === lang) return;
    this.language = lang;
    const zh = lang === 'zh';
    this.inspect.textContent = zh ? '看看花束' : 'Look at bouquet';
    this.dialog.querySelector('h2')!.textContent = zh ? '搭一束花' : 'Arrange a bouquet';
    this.dialog.querySelector('#visitor-bouquet-cancel')!.textContent = zh ? '取消' : 'Cancel';
    this.dialog.querySelector('#visitor-bouquet-confirm')!.textContent = zh ? '确认花束' : 'Keep bouquet';
    for (const [select, label, initial] of [
      [this.main, zh ? '主花' : 'Main flowers', defaultFlowers.main],
      [this.accent, zh ? '配花' : 'Accent flowers', defaultFlowers.accent],
    ] as const) {
      const selected = select.value || initial;
      select.parentElement!.querySelector('span')!.textContent = label;
      select.replaceChildren(...Object.entries(flowers).map(([value, names]) => new Option(names[zh ? 0 : 1], value)));
      select.value = selected;
    }
  }
}
