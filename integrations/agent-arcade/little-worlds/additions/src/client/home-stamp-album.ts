import { STAMP_BIT, stampCount, type SavedCourtyardCard } from '../shared/courtyard-stamp-collection.ts';
import { readDoorBadgeRubbingAlbum, readStampAlbum } from './courtyard-stamp-api.ts';
import { renderDoorBadgeRubbing } from './door-badge-rubbing.ts';
import type { SavedDoorBadgeRubbing } from '../shared/door-badge-rubbing.ts';
import './home-stamp-album.css';

export class HomeStampAlbum {
  readonly root = document.createElement('section');
  private readonly cards = document.createElement('ul');
  private readonly status = document.createElement('p');
  private readonly retry = document.createElement('button');
  private readonly rubbingPage = document.createElement('details');
  private readonly rubbingTitle = document.createElement('summary');
  private readonly rubbings = document.createElement('div');
  private reading: AbortController | null = null;

  constructor() {
    this.root.id = 'home-stamp-album';
    this.root.hidden = true;
    this.cards.className = 'stamp-album-cards';
    this.status.setAttribute('role', 'status');
    this.retry.type = 'button';
    this.rubbingPage.className = 'stamp-album-rubbings';
    this.rubbingPage.append(this.rubbingTitle, this.rubbings);
    this.root.append(this.rubbingPage, this.status, this.retry, this.cards);
  }

  open(zh: boolean) {
    this.close();
    const reading = new AbortController();
    this.reading = reading;
    this.root.hidden = false;
    this.cards.replaceChildren();
    this.retry.hidden = true;
    this.status.hidden = false;
    this.status.textContent = zh ? '正在打开寻景卡册…' : 'Opening your stamp album…';
    this.retry.textContent = zh ? '重试' : 'Retry';
    this.retry.onclick = () => this.open(zh);
    this.rubbingTitle.textContent = zh ? '门徽拓样夹页' : 'Door-badge rubbings';
    this.rubbings.textContent = zh ? '正在翻开夹页…' : 'Opening your rubbings…';
    void Promise.allSettled([readStampAlbum(reading.signal), readDoorBadgeRubbingAlbum(reading.signal)]).then(([cards, prints]) => {
      if (reading !== this.reading) return;
      if (cards.status === 'fulfilled') {
        this.cards.replaceChildren(...cards.value.map(card => this.card(card, zh)));
        this.status.hidden = cards.value.length > 0 || prints.status === 'fulfilled' && prints.value.length > 0;
        this.status.textContent = zh ? '还没有寻景卡。访友时盖一枚印记，再点「收下寻景卡」。'
          : 'No cards yet. Earn a stamp while visiting a friend, then collect the card.';
      } else {
        this.status.textContent = zh ? '暂时打不开寻景卡册。' : 'The stamp album could not be opened.';
      }
      if (prints.status === 'fulfilled') this.renderRubbings(prints.value, zh);
      else this.rubbings.textContent = zh ? '暂时打不开门徽拓样。' : 'The rubbings could not be opened.';
      this.retry.hidden = cards.status === 'fulfilled' && prints.status === 'fulfilled';
    });
  }

  close() {
    this.reading?.abort();
    this.reading = null;
    this.root.hidden = true;
    this.cards.replaceChildren();
    this.rubbings.replaceChildren();
    this.rubbingPage.open = false;
  }

  private renderRubbings(prints: SavedDoorBadgeRubbing[], zh: boolean) {
    if (!prints.length) {
      this.rubbings.textContent = zh ? '访友时走到门徽旁，可以留一枚拓样。' : 'Visit a friend and look beside their door to keep a rubbing.';
      return;
    }
    this.rubbings.replaceChildren();
    const groups = new Map<string, SavedDoorBadgeRubbing[]>();
    for (const print of prints) {
      const group = groups.get(print.planetId) ?? [];
      group.push(print);
      groups.set(print.planetId, group);
    }
    for (const [planetId, group] of groups) {
      const page = document.createElement('section'), title = document.createElement('h3'), specimens = document.createElement('div');
      page.dataset.rubbingPlanet = planetId;
      title.textContent = group.at(-1)!.planetName;
      specimens.className = 'stamp-album-rubbing-samples';
      for (const print of group) {
        const sample = renderDoorBadgeRubbing(print.badge);
        sample.dataset.rubbingBadge = print.badge;
        specimens.append(sample);
      }
      page.append(title, specimens);
      this.rubbings.append(page);
    }
    this.rubbingPage.open = true;
  }

  private card(card: SavedCourtyardCard, zh: boolean) {
    const item = document.createElement('li');
    item.dataset.stampPlanet = card.planetId;
    const title = document.createElement('h3');
    title.textContent = card.planetName;
    const count = document.createElement('output');
    count.textContent = stampCount(card.stamps) + (zh ? ' / 2 枚印记' : ' / 2 stamps');
    const stamps = document.createElement('ul');
    stamps.className = 'stamp-album-stamps';
    for (const [bit, motif, name] of [
      [STAMP_BIT.plaque, 'plaque', zh ? '认院落牌' : 'Find the courtyard sign'],
      [STAMP_BIT.water, 'water', zh ? '亲手浇花' : 'Water a flowerpot'],
    ] as const) {
      const stamp = document.createElement('li');
      const marked = !!(card.stamps & bit);
      stamp.dataset.stamped = String(marked);
      stamp.dataset.motif = motif;
      const seal = document.createElement('span');
      seal.className = 'stamp-album-seal';
      seal.setAttribute('aria-hidden', 'true');
      const symbol = document.createElement('span');
      symbol.className = 'stamp-album-symbol';
      seal.append(symbol);
      const label = document.createElement('strong');
      label.textContent = name;
      const mark = document.createElement('span');
      mark.textContent = marked ? (zh ? '已盖章' : 'Stamped') : (zh ? '待补章' : 'To do');
      mark.className = 'stamp-album-state';
      stamp.append(seal, label, mark);
      stamps.append(stamp);
    }
    item.append(title, count, stamps);
    return item;
  }
}
