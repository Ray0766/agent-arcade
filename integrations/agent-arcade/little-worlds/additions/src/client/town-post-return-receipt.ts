import { TOWN_POST_ADA, TOWN_POST_PAX, type TownPostReceiptCommand, type TownPostReceiptProgress } from '../shared/town-post.ts';
import './town-post-return-receipt.css';

const endpoint = '/api/town/post/receipt';
type Site = { residentId: string; visitEpoch: number };
const text = (zh:string,en:string) => document.documentElement.lang.startsWith('zh') ? zh : en;

export class TownPostReturnReceipt {
  private readonly collect = document.createElement('button');
  private readonly hint = document.createElement('p');
  private readonly card = document.createElement('aside');
  private readonly address = document.createElement('strong');
  private readonly route = document.createElement('span');
  private epoch: number | null = null;
  private scope?: AbortController;
  private progress?: TownPostReceiptProgress;
  private reading?: AbortController;
  private writing?: AbortController;
  private nextRead = 0;
  private talkingToAda = false;
  private needsRevisit = false;

  constructor(host:HTMLElement, private readonly actions:{
    nearby(id:string):Site|null;
    flush():Promise<void>;
    receive(message:string):void;
    file():void;
    report(message:string):void;
  }) {
    this.collect.type = 'button';
    this.collect.id = 'ada-collect-post-receipt';
    this.collect.className = 'primary';
    this.hint.setAttribute('role','status');
    this.card.id = 'town-post-receipt-address';
    this.collect.hidden = this.hint.hidden = this.card.hidden = true;
    this.card.dataset.i18nVerbatim = '';
    const seal = document.createElement('span');
    seal.className = 'town-star-seal';
    seal.textContent = '✦';
    seal.setAttribute('aria-hidden','true');
    this.card.append(seal,this.address,this.route);
    host.append(this.collect,this.hint);
    document.body.append(this.card);
    this.collect.onclick = () => {
      if (!this.collect.hidden) void this.change('collect').catch(()=>this.actions.report(
        text('暂时取不到签收联，请走近艾达再试。','Could not collect the receipt. Step closer to Ada and try again.')));
    };
  }

  get carrying() { return this.epoch !== null && this.progress?.heldVersion != null; }
  get heldVersion() { return this.epoch === null ? null : this.progress?.heldVersion ?? null; }

  setVisit(epoch:number|null) {
    if (this.epoch === epoch) return;
    this.scope?.abort();
    this.reading?.abort();
    this.writing?.abort();
    this.scope = epoch===null ? undefined : new AbortController();
    this.reading = this.writing = undefined;
    this.epoch = epoch;
    this.progress = undefined;
    this.nextRead = 0;
    this.talkingToAda = this.needsRevisit = false;
    this.collect.hidden = this.hint.hidden = this.card.hidden = true;
  }

  justDelivered() {
    this.needsRevisit = true;
    this.collect.hidden = this.hint.hidden = true;
    this.reading?.abort();
    this.reading = undefined;
    void this.load();
  }

  frame(speakingId:string|undefined, showAddress:boolean) {
    if (!this.scope) return;
    const ada = speakingId === TOWN_POST_ADA && !!this.actions.nearby(TOWN_POST_ADA);
    const refreshed = ada && !this.talkingToAda;
    if (!ada) this.needsRevisit = false;
    this.talkingToAda = ada;
    if (refreshed || (!this.progress && performance.now() >= this.nextRead)) void this.load();
    const visible = ada && !this.needsRevisit && !this.carrying && this.progress?.availableVersion != null;
    this.collect.hidden = this.hint.hidden = !visible;
    this.collect.disabled = !!this.writing;
    this.card.hidden = !this.carrying || !showAddress;
    const update = (element:HTMLElement, label:string) => { if (element.textContent !== label) element.textContent = label; };
    update(this.collect,text('取签收联','Collect receipt'));
    update(this.hint,text('艾达：这是你上次送来的星星信。','Ada: This is for the star letter you brought last time.'));
    update(this.address,text('星星信签收联 · 邮局巷 · 帕克斯收','Star-letter receipt · Post Lane · For Pax'));
    update(this.route,text('从商铺街回广场，再走邮局巷。','Return to the square, then follow Post Lane.'));
  }

  archive(version:number) { return this.heldVersion === version ? this.change('archive') : Promise.resolve(false); }

  private async load(whileWriting = false) {
    const scope = this.scope;
    if (!scope || this.reading || this.writing && !whileWriting) return;
    const read = this.reading = new AbortController();
    try {
      const response = await fetch(endpoint,{cache:'no-store',signal:AbortSignal.any([scope.signal,read.signal,AbortSignal.timeout(5000)])});
      if (!response.ok) throw new Error('Receipt progress unavailable');
      const data:TownPostReceiptProgress = await response.json();
      if (this.scope === scope && this.reading === read) this.progress = data;
    } catch { /* Retain the last confirmed state while retrying. */ }
    finally { if (this.reading===read) { this.reading=undefined; this.nextRead=performance.now()+2400; } }
  }

  private async change(action:TownPostReceiptCommand['action']) {
    const scope = this.scope;
    const residentId = action === 'collect' ? TOWN_POST_ADA : TOWN_POST_PAX;
    const site = this.actions.nearby(residentId);
    const version = action === 'collect' ? this.progress?.availableVersion : this.progress?.heldVersion;
    if (!scope || !site || site.visitEpoch !== this.epoch || version == null || this.writing ||
        (action === 'collect' && (this.carrying || !this.talkingToAda || this.needsRevisit))) return false;
    this.reading?.abort();
    this.reading = undefined;
    const write = this.writing = new AbortController();
    try {
      await this.actions.flush();
      if (this.scope !== scope || this.actions.nearby(residentId)?.visitEpoch !== site.visitEpoch) return false;
      const body:TownPostReceiptCommand={action,residentId,visitEpoch:site.visitEpoch,version};
      const response = await fetch(endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),
        signal:AbortSignal.any([scope.signal,write.signal,AbortSignal.timeout(5000)])});
      if (!response.ok) throw new Error('Receipt handover failed');
      const progress:TownPostReceiptProgress & {changed:boolean} = await response.json();
      if (this.scope !== scope) return false;
      this.progress = progress;
      if (progress.changed && this.actions.nearby(residentId)?.visitEpoch === site.visitEpoch) {
        if (action === 'archive') this.actions.file();
        else if (this.talkingToAda) this.actions.receive(text('艾达：签收联给你，劳烦带回邮局。','Ada: Here is the receipt. Please take it back to the post office.'));
      }
      return action === 'archive' ? progress.archivedVersion === version : progress.heldVersion === version;
    } catch (error) {
      if (this.scope !== scope) return false;
      await this.load(true);
      if (this.scope !== scope) return false;
      if (action === 'archive' && this.progress?.archivedVersion === version) return true;
      throw error;
    } finally { if (this.writing === write) this.writing = undefined; }
  }
}
