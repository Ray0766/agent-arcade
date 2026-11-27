import { STAMP_BIT, stampCount, type SavedCourtyardCard } from '../shared/courtyard-stamp-collection.ts';
import { readStampAlbum } from './courtyard-stamp-api.ts';
import './home-stamp-album.css';

export class HomeStampAlbum {
  readonly root = document.createElement('section');
  private readonly cards = document.createElement('ul');
  private readonly status = document.createElement('p');
  private readonly retry = document.createElement('button');
  private reading: AbortController | null = null;

  constructor() {
    this.root.id = 'home-stamp-album';
    this.root.hidden = true;
    this.cards.className = 'stamp-album-cards';
    this.status.setAttribute('role', 'status');
    this.retry.type = 'button';
    this.root.append(this.status, this.retry, this.cards);
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
    void readStampAlbum(reading.signal).then(cards => {
      if (reading !== this.reading) return;
      this.cards.replaceChildren(...cards.map(card => this.card(card, zh)));
      this.status.hidden = cards.length > 0;
      this.status.textContent = zh ? '还没有收藏。访友时盖一枚印记，再点「收下寻景卡」。'
        : 'No cards yet. Earn a stamp while visiting a friend, then collect the card.';
    }).catch(() => {
      if (reading !== this.reading) return;
      this.status.textContent = zh ? '暂时打不开寻景卡册。' : 'The stamp album could not be opened.';
      this.retry.hidden = false;
    });
  }

  close() {
    this.reading?.abort();
    this.reading = null;
    this.root.hidden = true;
    this.cards.replaceChildren();
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
