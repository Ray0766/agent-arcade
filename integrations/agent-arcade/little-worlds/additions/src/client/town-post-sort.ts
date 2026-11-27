import './town-post-sort.css';

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
  private language = '';

  constructor(entryHost: HTMLElement, private readonly actions: {
    nearby(): boolean;
    prepare(): void;
    receive(): void;
    restoreFocus(): void;
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
    entryHost.append(this.entry);
    document.body.append(this.panel);

    this.entry.onclick = () => {
      if (this.entry.hidden || !this.actions.nearby()) return;
      this.actions.prepare();
      this.entry.hidden = true;
      this.panel.hidden = false;
      this.paint();
      this.letters[0].focus({preventScroll:true});
    };
    this.close.onclick = () => this.exit(true);
    this.submit.onclick = () => {
      if (!this.actions.nearby() || this.completed || !marks.every(mark=>this.placed.get(mark)===mark)) return;
      this.completed = true;
      this.actions.receive();
      this.paint();
      this.close.focus({preventScroll:true});
    };
  }

  frame(talkingToPax: boolean) {
    const nearby = this.actions.nearby();
    this.entry.hidden = !nearby || !talkingToPax || !this.panel.hidden;
    if (!nearby && !this.panel.hidden) this.exit(false);
    const language = document.documentElement.lang.startsWith('zh')?'zh':'en';
    if (language!==this.language) {
      this.language=language;
      this.paint();
    }
  }

  private exit(focus: boolean) {
    this.panel.hidden = true;
    this.placed.clear();
    this.completed = false;
    this.selected = undefined;
    if (focus) this.actions.restoreFocus();
  }

  private markButton(mark: Mark, kind: 'letter' | 'slot') {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'pax-post-' + kind;
    button.onclick = () => {
      if (this.panel.hidden || this.completed || !this.actions.nearby()) return;
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
    this.title.textContent = labels.title;
    this.close.textContent = labels.close;
    this.submit.textContent = labels.submit;
    const ready = marks.every(mark=>this.placed.get(mark)===mark);
    this.submit.hidden = !ready || this.completed;
    this.status.textContent = this.completed ? labels.thanks : ready ? labels.sorted :
      [...this.placed].some(([slot,mark])=>slot!==mark) ? labels.wrong : this.selected ? labels.placing : labels.start;
    for (const [i,mark] of marks.entries()) {
      const letter = this.letters[i], slot = this.slots[i], placed = this.placed.get(mark);
      letter.hidden = this.completed || [...this.placed.values()].includes(mark);
      letter.textContent = stamps[mark];
      letter.setAttribute('aria-label',labels.take(labels[mark]));
      letter.setAttribute('aria-pressed',String(this.selected===mark));
      slot.hidden = this.completed;
      slot.textContent = placed ? stamps[mark]+'  ←  '+stamps[placed] : stamps[mark];
      slot.setAttribute('aria-label',placed?labels.back(labels[mark],labels[placed]):labels.slot(labels[mark]));
      slot.dataset.match = placed ? (placed===mark?'yes':'no') : '';
    }
  }
}
