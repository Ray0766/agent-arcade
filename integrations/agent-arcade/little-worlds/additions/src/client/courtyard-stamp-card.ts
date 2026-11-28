import { Vector3 } from 'three';
import { courtyardRoutes, courtyardVisit } from '../shared/courtyard-arrival.ts';
import type { GroundPose, GroundWorld } from '../shared/physics/world.ts';
import type { PlanetView } from '../shared/planets.ts';
import { canWalkTutorialConnector } from '../shared/tutorial-navigation.ts';
import { distance } from '../shared/world.ts';
import { STAMP_BIT, stampCount, type CourtyardCardAction, type CourtyardCardVisit, type CourtyardStamp } from '../shared/courtyard-stamp-collection.ts';
import { readVisitCard, writeVisitCard } from './courtyard-stamp-api.ts';
import './courtyard-stamp-card.css';

type Site = {
  planet: PlanetView;
  world: GroundWorld;
  pose: GroundPose;
  waterScope: string | null;
  waterHere: boolean;
};
type Collection = {
  visit: CourtyardCardVisit;
  abort: AbortController;
  saved: number | null;
  busy: boolean;
  error: boolean;
};
type Plaque = 'unavailable' | 'route' | 'near';

export class CourtyardStampCard {
  private readonly root = document.createElement('aside');
  private readonly entry = document.createElement('button');
  private readonly panel = document.createElement('section');
  private readonly title = document.createElement('h2');
  private readonly close = document.createElement('button');
  private readonly plaqueTitle = document.createElement('strong');
  private readonly waterTitle = document.createElement('strong');
  private readonly plaqueStory = document.createElement('small');
  private readonly waterStory = document.createElement('small');
  private readonly confirm = document.createElement('button');
  private readonly count = document.createElement('output');
  private readonly collect = document.createElement('button');
  private readonly collectionStatus = document.createElement('small');
  private earned = 0;
  private collection: Collection | null = null;
  private readonly routeProof = new WeakMap<GroundWorld, boolean>();
  private scope: string | null = null;
  private site: Site | null = null;
  private opened = false;
  private enrolled = false;
  private lastPaint = '';

  constructor(releaseView: () => void) {
    this.root.id = 'courtyard-stamps';
    this.root.dataset.i18nVerbatim = '';
    this.root.hidden = true;
    this.entry.id = 'courtyard-stamps-toggle';
    this.entry.setAttribute('aria-controls', 'courtyard-stamps-panel');
    this.panel.id = 'courtyard-stamps-panel';
    this.panel.setAttribute('aria-labelledby', 'courtyard-stamps-title');
    this.title.id = 'courtyard-stamps-title';
    this.close.id = 'courtyard-stamps-close';
    this.confirm.id = 'courtyard-stamps-confirm-plaque';
    this.count.setAttribute('aria-live', 'polite');
    this.collect.id = 'courtyard-stamps-collect';
    this.collectionStatus.id = 'courtyard-stamps-collection-status';
    this.collectionStatus.setAttribute('role', 'status');
    for (const button of [this.entry, this.close, this.confirm, this.collect]) button.type = 'button';
    const header = document.createElement('header');
    header.append(this.title, this.close);
    this.panel.append(header, this.plaqueTitle, this.plaqueStory, this.confirm,
      this.waterTitle, this.waterStory, this.count, this.collectionStatus, this.collect);
    this.root.append(this.entry, this.panel);
    document.body.append(this.root);
    this.entry.onclick = () => {
      if (!this.site) return;
      if (!this.opened) {
        releaseView();
        this.enrolled = true;
        this.loadCollection();
      }
      this.opened = !this.opened;
      this.paint();
      (this.opened ? this.close : this.entry).focus({ preventScroll: true });
    };
    this.close.onclick = () => {
      this.opened = false;
      this.paint();
      this.entry.focus({ preventScroll: true });
    };
    this.confirm.onclick = () => {
      if (!this.opened || !this.site || this.plaqueStatus(this.site) !== 'near') return;
      this.complete('plaque');
    };
    this.collect.onclick = () => {
      const entry = this.collection;
      if (!entry || entry.busy) return;
      if (entry.saved === null) void this.readCollection(entry);
      else void this.saveCollection(entry, entry.saved ? 'continue' : 'collect');
    };
  }

  frame(scope: string | null, site: Site | null) {
    if (scope !== this.scope) {
      this.scope = scope;
      this.collection?.abort.abort();
      this.collection = null;
      this.earned = 0;
      this.enrolled = this.opened = false;
    }
    this.site = site;
    this.paint();
  }

  watered(waterScope: string) {
    if (this.enrolled && this.site?.waterScope === waterScope) {
      this.complete('water');
    }
  }

  private complete(stamp: CourtyardStamp) {
    this.earned |= STAMP_BIT[stamp];
    const entry = this.collection;
    if (entry?.saved && !entry.busy && !entry.error) void this.saveCollection(entry, 'continue');
    this.paint();
  }

  private loadCollection() {
    if (this.collection || !this.site || !this.scope) return;
    const planetId = this.site.planet.id;
    const epoch = this.scope.startsWith(planetId + '/') ? this.scope.slice(planetId.length + 1) : '';
    if (!/^[0-9]+$/.test(epoch) || !Number.isSafeInteger(Number(epoch))) return;
    const entry: Collection = {
      visit: { planetId, visitEpoch: Number(epoch) }, abort: new AbortController(),
      saved: null, busy: false, error: false,
    };
    this.collection = entry;
    void this.readCollection(entry);
  }

  private async readCollection(entry: Collection) {
    entry.busy = true;
    entry.error = false;
    this.paint();
    try {
      const card = await readVisitCard(entry.visit, entry.abort.signal);
      if (entry === this.collection) entry.saved = card?.stamps ?? 0;
    } catch {
      entry.error = true;
    } finally {
      entry.busy = false;
      if (entry === this.collection) {
        if (entry.saved && !entry.error) void this.saveCollection(entry, 'continue');
        this.paint();
      }
    }
  }

  private async saveCollection(entry: Collection, action: CourtyardCardAction) {
    if (entry.busy || entry.saved === null) return;
    const updates = this.earned & ~entry.saved;
    if (!updates) return;
    entry.busy = true;
    entry.error = false;
    this.paint();
    try {
      const card = await writeVisitCard(entry.visit, action, updates, entry.abort.signal);
      if (entry === this.collection) entry.saved = card.stamps;
    } catch {
      entry.error = true;
    } finally {
      entry.busy = false;
      if (entry === this.collection) {
        // A second stamp may arrive while the first write is still in flight.
        if (entry.saved && !entry.error && (this.earned & ~entry.saved)) void this.saveCollection(entry, 'continue');
        this.paint();
      }
    }
  }

  private plaqueStatus({ planet, world, pose }: Site): Plaque {
    const court = courtyardVisit(planet, world);
    if (!planet.name?.trim() || !court?.landmark) return 'unavailable';
    const { position } = court.landmark, radius = world.baseRadius;
    if (pose.grounded && !world.blocked(pose) &&
        distance(pose.position, position, radius) <= 3.2 &&
        distance(pose.position, court.target.position, radius) <= 1.1) {
      const eye = new Vector3(...pose.position).multiplyScalar(pose.radius + 1.35);
      const sign = new Vector3(...position).multiplyScalar(world.pose(position).radius + 1.12);
      if (world.cameraDistance(eye, sign, .08) + .10 >= eye.distanceTo(sign)) return 'near';
    }
    let valid = this.routeProof.get(world);
    if (valid === undefined) {
      const lane = courtyardRoutes(planet).find(route => route.id === court.target.routeId);
      valid = !!lane && lane.points.every((point, index) =>
        index === 0 || canWalkTutorialConnector(world, lane.points[index - 1], point));
      this.routeProof.set(world, valid);
    }
    return valid ? 'route' : 'unavailable';
  }

  private paint() {
    const hasSite = !!this.site;
    const opened = hasSite && this.opened;
    const plaque = opened && this.site ? this.plaqueStatus(this.site) : 'unavailable';
    const water = !!this.site?.waterHere;
    const zh = document.documentElement.lang.startsWith('zh');
    const named = this.site?.planet.name ?? '';
    const entry = this.collection;
    const saved = entry?.saved ?? 0;
    const stamps = this.earned | saved;
    const markedPlaque = !!(stamps & STAMP_BIT.plaque), markedWater = !!(stamps & STAMP_BIT.water);
    const key = JSON.stringify([hasSite, opened, zh, plaque, water, named, stamps, this.earned, entry?.saved, entry?.busy, entry?.error]);
    if (key === this.lastPaint) return;
    this.lastPaint = key;
    this.root.hidden = !hasSite;
    this.entry.setAttribute('aria-expanded', String(opened));
    this.panel.hidden = !opened;
    this.entry.hidden = opened;

    this.entry.textContent = this.title.textContent = zh ? '院落寻景卡' : 'Courtyard stamp card';
    this.close.textContent = zh ? '收起' : 'Close';
    this.plaqueTitle.textContent = zh ? '认院落牌' : 'Find the courtyard sign';
    this.waterTitle.textContent = zh ? '亲手浇一盆花' : 'Water a flowerpot';
    this.plaqueStory.textContent = markedPlaque ? (zh ? '已盖章 · 院落牌' : 'Stamped · Courtyard sign') :
      plaque === 'near' ? named :
      plaque === 'route' ? (zh ? '用向导找公共院落，走到牌旁确认。' : 'Follow the guide to the sign and confirm there.') :
      (zh ? '当前没有可确认的院落牌。' : 'No courtyard sign is available to confirm.');
    this.waterStory.textContent = markedWater ? (zh ? '已盖章 · 浇花' : 'Stamped · Watered flowers') :
      water ? (zh ? '点「选花浇水」，浇完这盆花。' : 'Choose a pot and finish watering it.') :
      (zh ? '附近暂无可浇的花盆。' : 'No flowerpot can be watered from here.');
    this.confirm.textContent = zh ? '确认院落牌' : 'Confirm the sign';
    this.confirm.hidden = !opened || markedPlaque || plaque !== 'near';
    this.plaqueTitle.dataset.stamped = String(markedPlaque);
    this.waterTitle.dataset.stamped = String(markedWater);
    this.count.textContent = stampCount(stamps) + (zh ? ' / 2 枚印记' : ' / 2 stamps');
    const newStamp = !!(this.earned & ~saved);
    this.collect.hidden = !entry || entry.busy || (entry.saved === null ? !entry.error : !newStamp);
    this.collect.textContent = entry?.error ? (zh ? '重试' : 'Retry') :
      saved ? (zh ? '补上印记' : 'Save stamp') : (zh ? '收下寻景卡' : 'Collect stamp card');
    this.collectionStatus.hidden = !entry || (!saved && !entry.busy && !entry.error);
    this.collectionStatus.textContent = entry?.busy ? (zh ? '正在同步寻景卡…' : 'Syncing your stamp card…') :
      entry?.error ? (zh ? '同步失败，请在本次来访中重试。' : 'Sync failed. Try again during this visit.') :
      (zh ? '已收入书房 · ' : 'In your study · ') + stampCount(saved) + ' / 2';
  }
}
