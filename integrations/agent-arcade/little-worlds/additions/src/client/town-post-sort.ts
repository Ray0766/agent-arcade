import './town-post-sort.css';
import { createTownPostReceiptCard, markTownPostReceiptSlot } from './town-post-receipt-art.ts';

export const POST_COURIER = 'pax-courier';
type Mark = 'star' | 'moon';
const marks: Mark[] = ['star', 'moon'];
const stamps = { star: '✦', moon: '☾' };
const copy = {
  zh: { title:'邮局分信', open:'帮忙分信', star:'星星', moon:'月亮',
    take:(mark:string)=>'拿起'+mark+'信', slot:(mark:string)=>mark+'信格',
    back:(slot:string,mark:string)=>'从'+slot+'格取回'+mark+'信',
    start:'选一封信，再选图记相同的信格。',
    placing:'选一个信格放下手上的信。', wrong:'图记不一样，可以把信取回来。',
    sorted:'两封信都放对了。', submit:'交给帕克斯',
    thanks:'谢谢！这两封信都分对了。', close:'回到街上' },
  en: { title:'Sort the post', open:'Help sort the post', star:'Star', moon:'Moon',
    take:(mark:string)=>'Pick up '+mark+' letter', slot:(mark:string)=>mark+' slot',
    back:(slot:string,mark:string)=>'Take '+mark+' letter back from '+slot+' slot',
    start:'Choose a letter, then find its matching slot.',
    placing:'Choose a slot for the letter you’re holding.', wrong:'The marks differ. You can take the letter back.',
    sorted:'Both letters are in the right slots.', submit:'Hand letters to Pax',
    thanks:'Thank you! Both letters are sorted.', close:'Back to the street' },
};

export class TownPostSort {
  private readonly entry = document.createElement('button');
  private readonly receiptEntry = document.createElement('button');
  private readonly panel = document.createElement('section');
  private readonly title = document.createElement('h2');
  private readonly status = document.createElement('p');
  private readonly close = document.createElement('button');
  private readonly submit = document.createElement('button');
  private readonly letters = marks.map(mark=>this.markButton(mark,'letter'));
  private readonly slots = marks.map(mark=>this.markButton(mark,'slot'));
  private readonly placed = new Map<Mark, Mark>();
  private selected?: Mark;
  private completed = false;
  private returning = false;
  private filing = false;
  private attempt = 0;
  private failed = false;
  private receiptVersion: number | null = null;
  private receiptCard?: HTMLCanvasElement;
  private language = '';

  constructor(entryHost: HTMLElement, private readonly actions: {
    nearby(): boolean;
    prepare(): void;
    receive(): void;
    restoreFocus(): void;
    starOffer?: { button:HTMLButtonElement; show(visible:boolean):void };
    receipt?: { held():number|null; archive(version:number):Promise<boolean> };
  }) {
    this.entry.type = this.close.type = this.submit.type = 'button';
    this.entry.id = 'pax-sort-entry';
    this.entry.className = this.submit.className = 'primary';
    this.title.id = 'pax-post-sort-title';
    this.panel.id = 'pax-post-sort';
    this.panel.setAttribute('aria-labelledby', this.title.id);
    this.status.setAttribute('role','status');
    this.entry.dataset.i18nVerbatim = this.panel.dataset.i18nVerbatim = '';
    this.entry.hidden = this.panel.hidden = true;
    const tray = document.createElement('div'), footer = document.createElement('footer');
    tray.className = 'pax-post-tray';
    tray.append(...this.letters,...this.slots);
    footer.append(this.close,this.submit);
    this.panel.append(this.title,this.status,tray,footer);
    if (actions.starOffer) tray.after(actions.starOffer.button);
    entryHost.append(this.entry);
    this.receiptEntry.id = 'pax-return-receipt';
    this.receiptEntry.type = 'button';
    this.receiptEntry.className = 'primary';
    this.receiptEntry.dataset.i18nVerbatim = '';
    this.receiptEntry.hidden = true;
    if (actions.receipt) entryHost.append(this.receiptEntry);
    document.body.append(this.panel);

    this.entry.onclick = () => {
      if (!this.entry.hidden) this.open(false);
    };
    this.receiptEntry.onclick = () => { if (!this.receiptEntry.hidden) this.open(true); };
    this.close.onclick = () => this.exit(true);
    this.submit.onclick = () => {
      void this.handOver();
    };
  }

  get receiptOnTray() { return this.returning && !this.panel.hidden && (this.placed.size > 0 || this.completed); }
  get receiptPanelOpen() { return this.returning && !this.panel.hidden; }

  private open(returning:boolean) {
    const version = returning ? this.actions.receipt?.held() ?? null : null;
    if (!this.actions.nearby() || (returning && version === null)) return;
    this.actions.prepare();
    this.receiptVersion = version;
    this.returning = returning;
    this.entry.hidden = this.receiptEntry.hidden = true;
    this.panel.hidden = false;
    this.paint();
    this.letters[0].focus({preventScroll:true});
  }

  private async handOver() {
    if (this.panel.hidden || !this.actions.nearby() || this.completed || this.filing || !this.sorted()) return;
    if (this.returning) {
      this.failed = false;
      this.filing = true;
      this.paint();
      const attempt = ++this.attempt;
      const archived = await this.actions.receipt!.archive(this.receiptVersion!).catch(()=>false);
      if (this.attempt !== attempt) return;
      this.filing = false;
      if (!archived) { this.failed = true; this.paint(); return; }
    }
    this.completed = true;
    if (!this.returning) this.actions.receive();
    this.paint();
    this.close.focus({preventScroll:true});
  }

  private sorted() { return this.returning ? this.placed.get('star') === 'star' : marks.every(mark=>this.placed.get(mark)===mark); }

  frame(talkingToPax: boolean) {
    const nearby = this.actions.nearby();
    this.entry.hidden = !nearby || !talkingToPax || !this.panel.hidden;
    const held = this.actions.receipt?.held() ?? null;
    this.receiptEntry.hidden = this.entry.hidden || held === null;
    if (!this.panel.hidden && (!nearby || this.returning && held !== this.receiptVersion && !this.filing && !this.completed)) this.exit(false);
    const language = document.documentElement.lang.startsWith('zh')?'zh':'en';
    if (language!==this.language) {
      this.language=language;
      this.paint();
    }
  }

  private exit(focus: boolean) {
    this.panel.hidden = true;
    this.actions.starOffer?.show(false);
    this.placed.clear();
    this.attempt++;
    this.returning = this.filing = this.failed = false;
    this.receiptVersion = null;
    this.panel.removeAttribute('data-receipt');
    this.completed = false;
    this.selected = undefined;
    if (focus) this.actions.restoreFocus();
  }

  private markButton(mark: Mark, kind: 'letter' | 'slot') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pax-post-' + kind;
    button.onclick = () => {
      if (this.panel.hidden || this.completed || this.filing || !this.actions.nearby()) return;
      this.failed = false;
      if (kind==='letter') {
        if ([...this.placed.values()].includes(mark)) return;
        this.selected = this.selected===mark?undefined:mark;
      } else if (this.placed.has(mark)) {
        this.selected = this.placed.get(mark);
        this.placed.delete(mark);
      } else if (this.selected) {
        this.placed.set(mark,this.selected);
        this.selected = undefined;
      }
      this.paint();
      if (button.hidden) this.slots[0].focus({preventScroll:true});
    };
    return button;
  }

  private paint() {
    const labels = this.language==='zh'?copy.zh:copy.en;
    this.entry.textContent = labels.open;
    const zh = this.language==='zh';
    this.panel.toggleAttribute('data-receipt',this.returning);
    this.receiptEntry.textContent = zh?'归还星星信签收联':'Return the star-letter receipt';
    this.title.textContent = this.returning ? (zh?'星星信回执':'Star-letter receipt') : labels.title;
    this.close.textContent = labels.close;
    this.submit.textContent = this.returning ? (zh?'交给帕克斯归档':'File with Pax') : labels.submit;
    const ready = this.sorted();
    this.submit.hidden = !ready || this.completed;
    this.submit.disabled = this.filing;
    this.actions.starOffer?.show(!this.returning && this.completed && !this.panel.hidden);
    const wrong = [...this.placed].some(([slot,mark])=>slot!==mark);
    this.status.textContent = this.returning
      ? this.completed ? (zh?'帕克斯：这封星星信已签收归档。':'Pax: The star-letter receipt is filed.')
        : this.filing ? (zh?'正在归档…':'Filing…')
        : this.failed ? (zh?'暂时未能归档，请再试一次。':'Could not file the receipt. Try again.')
        : ready ? (zh?'签收联已放进星记格，可以交给帕克斯。':'The receipt is in the star slot. Hand it to Pax.')
        : wrong ? (zh?'这里是月记格，点它取回签收联。':'This is the moon slot. Select it to take the receipt back.')
        : this.selected ? (zh?'把手里的签收联放进一个格子。':'Place the receipt into a slot.')
        : (zh?'拿起艾达的签收联，对准星记格。':'Pick up Ada’s receipt and find the star slot.')
      : this.completed ? labels.thanks : ready ? labels.sorted :
      [...this.placed].some(([slot,mark])=>slot!==mark) ? labels.wrong : this.selected ? labels.placing : labels.start;
    for (const [i,mark] of marks.entries()) {
      const letter = this.letters[i], slot = this.slots[i], placed = this.placed.get(mark);
      letter.hidden = this.completed || (this.returning && mark==='moon') || [...this.placed.values()].includes(mark);
      letter.disabled = slot.disabled = this.filing;
      letter.textContent = this.returning ? '✦' : stamps[mark];
      letter.setAttribute('aria-label',this.returning ? (zh?'拿起艾达的签收联':'Pick up Ada’s receipt') : labels.take(labels[mark]));
      letter.setAttribute('aria-pressed',String(this.selected===mark));
      slot.hidden = this.completed && !(this.returning && mark==='star');
      slot.disabled = this.filing || this.completed;
      const name = labels[mark];
      slot.textContent = this.returning && this.completed ? (zh?'✦ 已归档':'✦ Filed') : placed ? stamps[mark]+'  ←  '+stamps[placed] : stamps[mark];
      slot.setAttribute('aria-label',this.returning ? (this.completed ? (zh?'星记格，已归档':'Star slot, filed') : placed ?
        (zh?'从'+name+'格取回签收联':'Take the receipt back from the '+name.toLowerCase()+' slot') :
        (zh?(mark==='star'?'星记格':'月记格'):name+' receipt slot')) : placed?labels.back(name,labels[placed]):labels.slot(name));
      slot.dataset.match = placed ? (placed===mark?'yes':'no') : '';
      if (this.returning) {
        markTownPostReceiptSlot(slot,mark);
        if (!this.completed && (placed || mark==='star' && this.placed.size===0)) {
          this.receiptCard ??= createTownPostReceiptCard();
          if (placed) slot.append(this.receiptCard);
          else letter.replaceChildren(this.receiptCard);
        }
      } else delete slot.dataset.townPostReceiptSlot;
    }
  }
}
