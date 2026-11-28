import './paired-quay-repair-controls.css';
import type { PairedQuayView, QuayAction } from '../shared/paired-quay-repair.ts';

const words = {
  zh: {
    title: '一起帮伊沃', met: '见到同伴了。要一起去修码头托臂吗？',
    offered: '同伴请你一起修托臂。你来操作扳手。', waiting: '等同伴答复。',
    walk: '沿木牌指的方向，到码头仓库左侧找伊沃。',
    ready: '到台面了。确认你的分工后等同伴就位。', readyPeer: '同伴已就位，确认你的分工即可开工。',
    readyWait: '你已就位，等同伴确认分工。',
    holder: '你负责试压、对线和稳住托臂。', wrench: '你负责扳动扳手，锁紧螺帽。',
    inspect: '试压托臂，看看螺帽松动的程度。', watchPress: '等同伴试压托臂。',
    adjust: '转动托臂，让两段刻线相接。', watchAdjust: '同伴正在对线。刻线相接、托臂稳住后，你再拧紧。',
    aligned: '刻线已对齐', apart: '刻线还差 {count} 格', held: '托臂已稳住。由你拧紧螺帽。', watchWrench: '你已稳住托臂。等同伴拧紧螺帽。',
    tightened: '同伴拧紧了螺帽。请复压，确认托臂稳固。', youTightened: '你拧紧了螺帽。等同伴复压。',
    done: '已对线、已紧固、复压通过。伊沃：可以接下一艘船了。',
    stale: '进度已更新，请按当前提示继续。', failed: '这次操作没有确认，请稍后重试。',
    action: { offer: '一起去帮伊沃', accept: '同意', decline: '谢绝', ready: '确认我的分工', press: '试压托臂', left: '逆时针转', right: '顺时针转', hold: '稳住托臂', tighten: '扳动扳手', retest: '复压托臂', leave: '回到街上' },
    stroll: '先各自逛逛', cancel: '退出双人修理',
  },
  en: {
    title: 'Help Ivo together', met: 'You met your companion. Fix the dock support together?',
    offered: 'Your companion invited you to repair the support. You’ll work the wrench.', waiting: 'Waiting for your companion’s answer.',
    walk: 'Follow the dock sign to Ivo on the left side of the warehouse.',
    ready: 'You’re at the workbench. Confirm your role and wait for your companion.', readyPeer: 'Your companion is ready. Confirm your role to begin.',
    readyWait: 'You’re ready. Waiting for your companion.',
    holder: 'Your job is to test, align and hold the support.', wrench: 'Your job is to work the wrench and tighten the nut.',
    inspect: 'Press the support to check how loose the nut is.', watchPress: 'Your companion will press the support first.',
    adjust: 'Turn the support until the two marks meet.', watchAdjust: 'Your companion is lining up the marks. Wait for them to hold the support steady.',
    aligned: 'Marks aligned', apart: 'Marks {count} notches apart', held: 'The support is steady. Tighten the nut.', watchWrench: 'You’re holding the support. Your companion can tighten the nut now.',
    tightened: 'Your companion tightened the nut. Press the support to check that it holds.', youTightened: 'You tightened the nut. Your companion will test the support again.',
    done: 'Aligned, tightened and tested. Ivo: ready for the next ship.',
    stale: 'The repair has moved on. Follow the updated steps.', failed: 'That move wasn’t confirmed. Try again in a moment.',
    action: { offer: 'Help Ivo together', accept: 'Accept', decline: 'Decline', ready: 'Confirm my role', press: 'Press the arm', left: 'Turn anticlockwise', right: 'Turn clockwise', hold: 'Hold the arm', tighten: 'Work the wrench', retest: 'Press again', leave: 'Back to the street' },
    stroll: 'Explore separately', cancel: 'Leave the repair',
  },
};

export function atQuayWorkbench(view: PairedQuayView | undefined) {
  return !!view && view.phase !== 'met' && view.phase !== 'offered' && view.phase !== 'walking';
}

type Site = { interactive: boolean; nearby: boolean };
const moves: QuayAction[] = ['offer', 'accept', 'decline', 'ready', 'press', 'left', 'right', 'hold', 'tighten', 'retest', 'leave'];

export class PairedQuayRepairControls {
  private readonly panel = document.createElement('section');
  private readonly title = document.createElement('h2');
  private readonly role = document.createElement('p');
  private readonly status = document.createElement('p');
  private readonly marks = document.createElement('output');
  private readonly feedback = document.createElement('p');
  private readonly buttons = new Map<QuayAction, HTMLButtonElement>();
  private readonly controls = document.createElement('div');
  private view?: PairedQuayView;
  private site: Site = { interactive: false, nearby: false };
  private painted = '';
  private pending = false;
  private error?: 'stale' | 'failed';
  private get copy() { return document.documentElement.lang.startsWith('zh') ? words.zh : words.en; }

  constructor(host: HTMLElement, private readonly actions: {
    send: (round: PairedQuayView, move: QuayAction) => Promise<void>;
    restoreFocus: () => void;
  }) {
    this.panel.id = 'paired-quay-repair';
    this.panel.dataset.i18nVerbatim = '';
    this.panel.hidden = true;
    this.title.id = 'paired-quay-repair-heading';
    this.panel.setAttribute('aria-labelledby', this.title.id);
    this.role.className = 'paired-quay-role';
    this.status.setAttribute('role', 'status');
    this.feedback.setAttribute('role', 'status');
    this.feedback.className = 'paired-quay-feedback';
    this.controls.className = 'paired-quay-actions';
    for (const move of moves) {
      const button = document.createElement('button');
      button.type = 'button';
      button.id = `paired-quay-${move}`;
      button.onclick = () => void this.act(move);
      this.buttons.set(move, button);
      this.controls.append(button);
    }
    this.panel.addEventListener('keydown', event => {
      if (event.key === ' ' || event.key === 'Enter' || event.key === 'Tab') event.stopPropagation();
    });
    this.panel.append(this.title, this.role, this.status, this.marks, this.feedback, this.controls);
    host.append(this.panel);
  }

  frame(view: PairedQuayView | undefined, site: Site) {
    if (view?.id !== this.view?.id || view?.version !== this.view?.version) this.error = undefined;
    this.view = view;
    this.site = site;
    this.paint();
  }

  private async act(move: QuayAction) {
    const view = this.view, button = this.buttons.get(move);
    if (!view || !button || button.hidden || button.getAttribute('aria-disabled') === 'true') return;
    this.pending = true;
    this.error = undefined;
    this.paint();
    try {
      await this.actions.send(view, move);
    } catch (error) {
      if (this.view?.id === view.id) {
        this.error = error instanceof Error && 'status' in error && error.status === 409 ? 'stale' : 'failed';
      }
    } finally {
      this.pending = false;
      this.paint();
    }
  }

  private paint() {
    const v = this.view;
    if (!v) {
      if (this.panel.contains(document.activeElement)) this.actions.restoreFocus();
      this.panel.hidden = true;
      this.painted = '';
      return;
    }
    const c = this.copy, s = this.site;
    const key = [c.title,v.id,v.version,v.phase,v.role,v.myReady,v.peerReady,v.atBench,s.nearby,s.interactive,this.pending,this.error].join('/');
    if (key === this.painted) return;
    this.painted = key;
    const focused = this.panel.contains(document.activeElement) ? document.activeElement as HTMLElement : null;
    const holder = v.role === 'holder';
    const withinReach = v.atBench && s.nearby;
    const working = atQuayWorkbench(v);
    const allowed = new Map<QuayAction, boolean>([['leave', true]]);
    let status: string;
    switch (v.phase) {
      case 'met': allowed.set('offer', true); status = c.met; break;
      case 'offered':
        if (!holder) { allowed.set('accept', true); allowed.set('decline', true); allowed.delete('leave'); }
        status = holder ? c.waiting : c.offered;
        break;
      case 'walking':
        if (!v.myReady && withinReach) allowed.set('ready', true);
        status = v.myReady ? c.readyWait : withinReach ? v.peerReady ? c.readyPeer : c.ready : c.walk;
        break;
      case 'inspect':
        if (holder) allowed.set('press', withinReach);
        status = holder ? c.inspect : c.watchPress;
        break;
      case 'adjust':
        if (holder) {
          allowed.set('left', withinReach && v.turn > -3);
          allowed.set('right', withinReach && v.turn < 3);
          allowed.set('hold', withinReach && v.turn === 0);
        } else allowed.set('tighten', false);
        status = holder ? c.adjust : c.watchAdjust;
        break;
      case 'held':
        if (!holder) allowed.set('tighten', withinReach);
        status = holder ? c.watchWrench : c.held;
        break;
      case 'locked':
        if (holder) allowed.set('retest', withinReach);
        status = holder ? c.tightened : c.youTightened;
        break;
      case 'done': status = c.done; break;
    }
    this.panel.hidden = false;
    this.panel.dataset.phase = v.phase;
    this.panel.classList.toggle('at-workbench', working);
    this.title.textContent = c.title;
    this.role.hidden = !v.role || v.phase === 'offered' || v.phase === 'done';
    this.role.textContent = holder ? c.holder : c.wrench;
    this.status.textContent = status;
    this.marks.hidden = v.phase !== 'adjust';
    this.marks.textContent = v.turn === 0 ? c.aligned : c.apart.replace('{count}', String(Math.abs(v.turn)));
    this.marks.dataset.aligned = String(v.turn === 0);
    this.feedback.hidden = !this.error;
    this.feedback.textContent = this.error ? c[this.error] : '';
    const preferred = [...allowed].find(([move, enabled]) => move !== 'leave' && enabled)?.[0];
    for (const [move, button] of this.buttons) {
      button.hidden = !allowed.has(move) || !s.interactive;
      button.setAttribute('aria-disabled', String(this.pending || !allowed.get(move) || !s.interactive));
      button.classList.toggle('primary', move === (preferred ?? (v.phase === 'done' ? 'leave' : undefined)));
      button.textContent = move === 'leave' && !working ? (v.phase === 'met' ? c.stroll : c.cancel) : c.action[move];
    }
    if (focused?.hidden) {
      const next = this.buttons.get(preferred ?? 'leave');
      if (next && !next.hidden) next.focus({ preventScroll: true });
      else this.actions.restoreFocus();
    }
  }
}
