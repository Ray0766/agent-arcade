import type { HomeDoorBadge } from '../shared/home-door-badge.ts';
import type { DoorBadgeRubbingPreview, DoorBadgeRubbingVisit } from '../shared/door-badge-rubbing.ts';
import './door-badge-rubbing.css';

const chinese = () => document.documentElement.lang.startsWith('zh');
const label = (zh: boolean, cn: string, en: string) => zh ? cn : en;
const badgeName = (badge: HomeDoorBadge, zh: boolean) => badge === 'leaf-branch'
  ? label(zh, '叶枝', 'Leaf branch') : label(zh, '摊开的书', 'Open book');

/** Ink silhouettes of the same timber door badges used by the exterior scene. */
export function renderDoorBadgeRubbing(badge: HomeDoorBadge): HTMLElement {
  const figure = document.createElement('figure');
  figure.className = 'door-badge-impression';
  figure.dataset.badge = badge;
  const seal = document.createElement('span');
  seal.className = 'door-badge-impression-seal';
  seal.setAttribute('aria-hidden', 'true');
  const plate = document.createElement('canvas');
  plate.width = 144;
  plate.height = 112;
  const pen = plate.getContext('2d');
  if (pen) {
    pen.lineCap = 'round';
    pen.lineJoin = 'round';
    if (badge === 'leaf-branch') {
      pen.strokeStyle = '#355640';
      pen.lineWidth = 5;
      pen.beginPath();
      pen.moveTo(35, 91);
      pen.quadraticCurveTo(57, 74, 81, 43);
      pen.moveTo(56, 72);
      pen.quadraticCurveTo(73, 67, 101, 77);
      pen.moveTo(61, 65);
      pen.quadraticCurveTo(51, 56, 47, 44);
      pen.stroke();
      const leaf = (x: number, y: number, angle: number, color: string) => {
        pen.save();
        pen.translate(x, y);
        pen.rotate(angle);
        pen.beginPath();
        pen.moveTo(-15, 0);
        pen.quadraticCurveTo(0, -19, 22, 0);
        pen.quadraticCurveTo(2, 17, -15, 0);
        pen.fillStyle = color;
        pen.fill();
        pen.strokeStyle = '#e8e9d5';
        pen.lineWidth = 1.8;
        pen.beginPath();
        pen.moveTo(-11, 0);
        pen.lineTo(14, 0);
        pen.stroke();
        pen.restore();
      };
      leaf(89, 34, -.79, '#41735a');
      leaf(46, 45, -2.18, '#50846a');
      leaf(91, 74, .06, '#41735a');
    } else {
      pen.fillStyle = '#8e4937';
      pen.strokeStyle = '#8e4937';
      pen.lineWidth = 4;
      pen.beginPath();
      pen.moveTo(23, 39);
      pen.quadraticCurveTo(49, 26, 72, 42);
      pen.quadraticCurveTo(96, 26, 121, 39);
      pen.lineTo(121, 88);
      pen.quadraticCurveTo(95, 80, 72, 94);
      pen.quadraticCurveTo(49, 80, 23, 88);
      pen.closePath();
      pen.stroke();
      pen.fill();
      pen.fillStyle = '#fbefdb';
      for (const side of [-1, 1]) {
        pen.save();
        pen.translate(72, 0);
        pen.scale(side, 1);
        pen.beginPath();
        pen.moveTo(4, 43);
        pen.quadraticCurveTo(24, 32, 43, 40);
        pen.lineTo(43, 79);
        pen.quadraticCurveTo(24, 74, 4, 85);
        pen.closePath();
        pen.fill();
        pen.strokeStyle = '#ab6954';
        pen.lineWidth = 2;
        for (const y of [52, 62, 72]) {
          pen.beginPath();
          pen.moveTo(12, y + 2);
          pen.quadraticCurveTo(22, y - 4, 34, y - 2);
          pen.stroke();
        }
        pen.restore();
      }
      pen.fillStyle = '#8e4937';
      pen.beginPath();
      pen.moveTo(96, 38);
      pen.lineTo(104, 38);
      pen.lineTo(104, 63);
      pen.lineTo(100, 59);
      pen.lineTo(96, 65);
      pen.closePath();
      pen.fill();
    }
  }
  seal.append(plate);
  const caption = document.createElement('figcaption');
  caption.textContent = badgeName(badge, chinese());
  figure.append(seal, caption);
  return figure;
}

type Transport = {
  preview(visit: DoorBadgeRubbingVisit): Promise<DoorBadgeRubbingPreview>;
  keep(visit: DoorBadgeRubbingVisit, version: string): Promise<DoorBadgeRubbingPreview>;
};

type Paper = {
  visit: DoorBadgeRubbingVisit;
  preview: DoorBadgeRubbingPreview | null;
  previous: HomeDoorBadge | null;
  pending: 'preview' | 'keep' | null;
  feedback: 'failed' | 'refresh' | 'kept' | null;
};

const sameVisit = (a: DoorBadgeRubbingVisit | null, b: DoorBadgeRubbingVisit | null) =>
  a?.planetId === b?.planetId && a?.visitEpoch === b?.visitEpoch;

export class DoorBadgeRubbing {
  private readonly entry = document.createElement('button');
  private readonly dialog = document.createElement('dialog');
  private readonly title = document.createElement('h2');
  private readonly closeButton = document.createElement('button');
  private readonly planet = document.createElement('p');
  private readonly samples = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly retry = document.createElement('button');
  private readonly keepButton = document.createElement('button');
  private site: DoorBadgeRubbingVisit | null = null;
  private paper: Paper | null = null;

  constructor(private readonly transport: Transport) {
    this.entry.id = 'door-badge-rubbing-open';
    this.entry.type = 'button';
    this.entry.hidden = true;
    this.entry.dataset.i18nVerbatim = '';
    this.entry.setAttribute('aria-haspopup', 'dialog');
    this.entry.setAttribute('aria-controls', 'door-badge-rubbing');
    this.dialog.id = 'door-badge-rubbing';
    this.dialog.dataset.i18nVerbatim = '';
    this.dialog.setAttribute('aria-labelledby', 'door-badge-rubbing-title');
    this.title.id = 'door-badge-rubbing-title';
    this.samples.className = 'door-badge-rubbing-samples';
    this.planet.className = 'door-badge-rubbing-planet';
    this.status.className = 'door-badge-rubbing-status';
    this.status.setAttribute('role', 'status');
    this.keepButton.id = 'door-badge-rubbing-keep';
    this.closeButton.id = 'door-badge-rubbing-close';
    this.retry.id = 'door-badge-rubbing-retry';
    this.keepButton.className = 'primary';
    for (const button of [this.closeButton, this.keepButton, this.retry]) button.type = 'button';
    const header = document.createElement('header');
    header.append(this.title, this.closeButton);
    const footer = document.createElement('footer');
    footer.append(this.status, this.retry, this.keepButton);
    this.dialog.append(header, this.planet, this.samples, footer);
    (document.getElementById('travel-guidance') ?? document.body).append(this.entry);
    document.body.append(this.dialog);
    this.entry.onclick = () => this.open();
    this.closeButton.onclick = () => this.dismiss(true);
    this.dialog.oncancel = event => { event.preventDefault(); this.dismiss(true); };
    // The world intercepts Escape in capture to release mouse look. Only take
    // precedence while this paper owns the active modal.
    window.addEventListener('keydown', event => {
      if (event.key !== 'Escape' || !this.dialog.open) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      this.dismiss(true);
    }, true);
    this.dialog.onclose = () => {
      if (!this.dialog.open) this.paper = null;
    };
    this.retry.onclick = () => {
      if (!this.paper) return;
      this.closeButton.focus({ preventScroll: true });
      void this.read(this.paper);
    };
    this.keepButton.onclick = () => { if (this.paper) void this.keep(this.paper); };
  }

  get opened() { return this.dialog.open; }

  frame(visit: DoorBadgeRubbingVisit | null) {
    const changed = !sameVisit(visit, this.site);
    if (changed) this.site = visit && { ...visit };
    this.entry.hidden = !this.site;
    const text = label(chinese(), '拓下门徽', 'Rub the door badge');
    if (this.entry.textContent !== text) this.entry.textContent = text;
    if (changed && this.paper) this.dismiss(false);
  }

  private open() {
    if (!this.site || this.dialog.open) return;
    const paper: Paper = { visit: this.site, preview: null, previous: null, pending: null, feedback: null };
    this.paper = paper;
    if (document.pointerLockElement) document.exitPointerLock();
    void this.read(paper);
    this.dialog.showModal();
    this.closeButton.focus({ preventScroll: true });
  }

  private dismiss(restore: boolean) {
    this.paper = null;
    if (this.dialog.open) this.dialog.close();
    if (restore && !this.entry.hidden) this.entry.focus({ preventScroll: true });
  }

  private async read(paper: Paper) {
    if (paper.pending) return;
    paper.pending = 'preview';
    paper.preview = null;
    paper.feedback = null;
    this.paint(paper);
    try {
      const preview = await this.transport.preview(paper.visit);
      if (paper !== this.paper) return;
      if (preview.current.planetId !== paper.visit.planetId) throw new Error('Door badge visit changed.');
      paper.previous = preview.saved[0]?.badge ?? null;
      paper.preview = preview;
    } catch {
      paper.feedback = 'failed';
    } finally {
      paper.pending = null;
      if (paper === this.paper) this.paint(paper);
    }
  }

  private async keep(paper: Paper) {
    const preview = paper.preview;
    if (!preview || paper.pending || preview.saved.some(sample => sample.badge === preview.current.badge)) return;
    paper.pending = 'keep';
    paper.feedback = null;
    this.paint(paper);
    try {
      const stored = await this.transport.keep(paper.visit, preview.version);
      if (paper !== this.paper) return;
      if (stored.current.planetId !== paper.visit.planetId || stored.current.badge !== preview.current.badge
          || !stored.saved.some(sample => sample.badge === preview.current.badge)) throw new Error('Door badge preview changed.');
      paper.preview = stored;
      paper.feedback = 'kept';
    } catch {
      paper.preview = null;
      paper.feedback = 'refresh';
    } finally {
      paper.pending = null;
      if (paper === this.paper) {
        this.paint(paper);
        (paper.feedback === 'refresh' ? this.retry : this.closeButton).focus({ preventScroll: true });
      }
    }
  }

  private paint(paper: Paper) {
    const zh = chinese(), preview = paper.preview, previous = paper.previous;
    const collected = !!preview?.saved.some(sample => sample.badge === preview.current.badge);
    this.title.textContent = label(zh, '门徽拓样', 'Door badge rubbing');
    this.closeButton.textContent = label(zh, '合上', 'Close');
    this.keepButton.textContent = label(zh, '夹进我的寻景卡册', 'Keep in my stamp album');
    this.retry.textContent = label(zh, '重新查看', 'Look again');
    this.planet.textContent = preview?.current.planetName ?? '';
    this.planet.hidden = !this.planet.textContent;
    this.samples.replaceChildren();
    if (preview) {
      if (previous) this.samples.append(this.sample(previous, label(zh, '上次的拓样', 'Last rubbing')));
      this.samples.append(this.sample(preview.current.badge, label(zh, '眼前这枚', 'Current badge')));
    }
    this.keepButton.hidden = !preview || collected;
    this.keepButton.disabled = !!paper.pending;
    this.retry.hidden = paper.feedback !== 'failed' && paper.feedback !== 'refresh';
    this.status.textContent = paper.pending === 'preview' ? label(zh, '正在核对眼前的门徽…', 'Checking the badge on this door…')
      : paper.pending === 'keep' ? label(zh, '正在夹进寻景卡册…', 'Keeping in your stamp album…')
      : paper.feedback === 'failed' ? label(zh, '暂时看不到门徽拓样。', 'This badge rubbing is unavailable.')
      : paper.feedback === 'refresh' ? label(zh, '请重新查看眼前的门徽，再收存。', 'Look at the current badge before keeping it.')
      : paper.feedback === 'kept' ? label(zh, '已夹进你的寻景卡册。', 'Kept in your stamp album.')
      : collected ? label(zh, '这款已在你的寻景卡册。', 'This badge is already in your stamp album.') : '';
  }

  private sample(badge: HomeDoorBadge, name: string) {
    const section = document.createElement('section');
    const heading = document.createElement('h3');
    heading.textContent = name;
    section.append(heading, renderDoorBadgeRubbing(badge));
    return section;
  }
}
