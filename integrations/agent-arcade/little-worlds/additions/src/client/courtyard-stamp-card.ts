import { Vector3 } from 'three';
import { courtyardRoutes, courtyardVisit } from '../shared/courtyard-arrival.ts';
import type { GroundPose, GroundWorld } from '../shared/physics/world.ts';
import type { PlanetView } from '../shared/planets.ts';
import { canWalkTutorialConnector } from '../shared/tutorial-navigation.ts';
import { distance } from '../shared/world.ts';
import './courtyard-stamp-card.css';

type Site = {
  planet: PlanetView;
  world: GroundWorld;
  pose: GroundPose;
  waterScope: string | null;
  waterHere: boolean;
};
type Stamp = 'plaque' | 'water';
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
  private readonly stamps = new Set<Stamp>();
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
    for (const button of [this.entry, this.close, this.confirm]) button.type = 'button';
    const header = document.createElement('header');
    header.append(this.title, this.close);
    this.panel.append(header, this.plaqueTitle, this.plaqueStory, this.confirm,
      this.waterTitle, this.waterStory, this.count);
    this.root.append(this.entry, this.panel);
    document.body.append(this.root);
    this.entry.onclick = () => {
      if (!this.site) return;
      if (!this.opened) {
        releaseView();
        this.enrolled = true;
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
      this.stamps.add('plaque');
      this.paint();
    };
  }

  frame(scope: string | null, site: Site | null) {
    if (scope !== this.scope) {
      this.scope = scope;
      this.stamps.clear();
      this.enrolled = this.opened = false;
    }
    this.site = site;
    this.paint();
  }

  watered(waterScope: string) {
    if (this.enrolled && this.site?.waterScope === waterScope) {
      this.stamps.add('water');
      this.paint();
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
    const markedPlaque = this.stamps.has('plaque'), markedWater = this.stamps.has('water');
    const key = JSON.stringify([hasSite, opened, zh, plaque, water, named, markedPlaque, markedWater]);
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
    this.count.textContent = zh ? `${this.stamps.size} / 2 枚印记` : `${this.stamps.size} / 2 stamps`;
  }
}
