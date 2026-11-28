import './quay-study-controls.css';
import type { QuaySampleTurn, QuayStudyView } from '../shared/quay-study-sample.ts';

type Command = {action: 'claim'} | {action: 'save'; version: number; turn: QuaySampleTurn};
type Preview = { element: HTMLElement; setTurn(turn: number): void; dispose(): void };

export class QuayStudyControls {
  readonly button = document.createElement('button');
  private readonly dialog = document.createElement('dialog');
  private readonly heading = document.createElement('h2');
  private readonly display = document.createElement('div');
  private readonly readout = document.createElement('output');
  private readonly status = document.createElement('p');
  private readonly left = document.createElement('button');
  private readonly right = document.createElement('button');
  private readonly save = document.createElement('button');
  private readonly cancel = document.createElement('button');
  private scope?: AbortController;
  private state?: QuayStudyView;
  private busy = false;
  private turn = -2;
  private available = false;
  private preview?: Preview;

  constructor(private readonly model: () => Preview, private readonly prepare: () => void) {
    this.button.id = 'home-quay-sample';
    this.button.type = 'button';
    this.button.hidden = true;
    this.dialog.id = 'home-quay-study';
    this.dialog.dataset.i18nVerbatim = '';
    this.heading.id = 'home-quay-study-title';
    this.dialog.setAttribute('aria-labelledby', this.heading.id);
    this.status.setAttribute('role','status');
    this.display.className = 'quay-study-model';
    this.readout.setAttribute('aria-live','polite');
    const actions = document.createElement('div');
    actions.className = 'quay-study-actions';
    for (const [button,id] of [[this.left,'left'],[this.right,'right'],[this.save,'save'],[this.cancel,'cancel']] as const) {
      button.id = 'home-quay-' + id;
      button.type = 'button';
      actions.append(button);
    }
    this.dialog.append(this.heading,this.display,this.readout,this.status,actions);
    document.body.append(this.dialog);
    this.button.onclick = () => this.open();
    this.left.onclick = () => this.rotate(-1);
    this.right.onclick = () => this.rotate(1);
    this.save.onclick = () => {
      const sample = this.state?.sample;
      if (sample && this.turn !== 0) void this.write({action:'save',version:sample.version,turn:this.turn as QuaySampleTurn});
    };
    this.cancel.onclick = () => this.dialog.close();
    this.dialog.onclose = () => {
      if (this.dialog.open) return;
      this.releasePreview();
      if (this.available && !this.button.hidden) this.button.focus({preventScroll:true});
    };
    this.dialog.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      event.stopPropagation();
      this.rotate(event.key === 'ArrowLeft' ? -1 : 1);
    });
  }

  load() {
    this.reset();
    const scope = this.scope = new AbortController();
    void this.read(scope).catch(() => {});
  }

  reset() {
    this.scope?.abort();
    this.scope = undefined;
    this.state = undefined;
    this.busy = false;
    this.button.hidden = true;
    this.releasePreview();
    if (this.dialog.open) this.dialog.close();
  }

  frame(available: boolean) {
    this.available = available;
    this.button.hidden = !available || !this.state?.eligible;
    this.button.disabled = this.busy;
    this.button.textContent = this.state?.sample
      ? this.text('调整伊沃的试件','Adjust Ivo’s sample')
      : this.text('领取伊沃的试件','Claim Ivo’s sample');
    if (!available && this.dialog.open) {
      this.releasePreview();
      this.dialog.close();
    }
  }

  private text(zh: string,en: string) { return document.documentElement.lang.startsWith('zh') ? zh : en; }

  private async read(scope: AbortController) {
    const response = await fetch('/api/home/quay-sample',{signal:scope.signal,cache:'no-store'});
    if (!response.ok) {
      if (this.scope === scope) { this.state = undefined; this.frame(this.available); }
      return;
    }
    const state: QuayStudyView = await response.json();
    if (this.scope !== scope) return;
    this.state = state;
    this.frame(this.available);
  }

  private async write(command: Command) {
    const scope = this.scope;
    if (!scope || this.busy || !this.available) return;
    this.busy = true;
    this.status.textContent = '';
    this.frame(this.available);
    if (this.dialog.open) this.paint();
    let saved = false;
    try {
      const response = await fetch('/api/home/quay-sample',{
        method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(command),signal:scope.signal,
      });
      if (response.status === 409) {
        await this.read(scope);
        if (scope === this.scope) {
          this.turn = this.state?.sample?.turn ?? -2;
          this.status.textContent = this.text('试件已更新，请从当前偏角重试。','The sample changed. Start again from its current angle.');
        }
        return;
      }
      if (!response.ok) throw new Error('Sample unavailable');
      const state: QuayStudyView = await response.json();
      if (this.scope !== scope) return;
      this.state = state;
      saved = true;
    } catch {
      if (this.scope === scope) {
        this.status.textContent = this.text('试件暂时无法保存，请重试。','The sample wasn’t saved. Try again.');
        if (command.action === 'claim') this.button.title = this.text('领取未确认，请重试。','Claim unconfirmed. Try again.');
      }
    } finally {
      if (this.scope === scope) {
        this.busy = false;
        this.frame(this.available);
        if (this.dialog.open) this.paint();
      }
    }
    if (!saved || !this.available) return;
    if (command.action === 'claim') this.open();
    else if (this.dialog.open) this.dialog.close();
  }

  private open() {
    if (this.button.hidden || this.busy || document.querySelector('dialog[open]')) return;
    const sample = this.state?.sample;
    if (!sample) { void this.write({action:'claim'}); return; }
    this.prepare();
    this.turn = sample.turn ?? -2;
    this.status.textContent = '';
    this.dialog.showModal();
    this.releasePreview();
    try { this.preview = this.model(); this.display.append(this.preview.element); } catch { /* Angle controls remain usable. */ }
    this.paint();
    this.left.focus({preventScroll:true});
  }

  private rotate(delta: number) {
    if (this.busy || !this.dialog.open) return;
    this.turn = Math.max(-3,Math.min(3,this.turn+delta));
    this.status.textContent = '';
    this.paint();
  }

  private releasePreview() {
    this.preview?.dispose();
    this.display.replaceChildren();
    this.preview = undefined;
  }

  private paint() {
    const zh = document.documentElement.lang.startsWith('zh');
    this.heading.textContent = this.text('伊沃的托臂试件','Ivo’s support sample');
    this.left.textContent = this.text('向左转一格','Turn left one notch');
    this.right.textContent = this.text('向右转一格','Turn right one notch');
    this.save.textContent = this.text('保存这个偏角','Save this offset');
    this.cancel.textContent = this.text('取消','Cancel');
    const count = Math.abs(this.turn);
    this.readout.textContent = this.turn === 0
      ? this.text('刻线已对齐，请留一格偏角给同伴。','Marks aligned. Leave an offset for your companion.')
      : zh ? (this.turn < 0 ? '左偏 ' : '右偏 ')+count+' 格'
        : (this.turn < 0 ? 'Left ' : 'Right ')+count+(count === 1 ? ' notch' : ' notches');
    this.readout.dataset.turn = String(this.turn);
    this.left.disabled = this.busy || this.turn <= -3;
    this.right.disabled = this.busy || this.turn >= 3;
    this.save.disabled = this.busy || this.turn === 0;
    this.cancel.disabled = this.busy;
    this.preview?.setTurn(this.turn);
  }
}
