import './paired-public-flight.css';

type Stage = 'dock' | 'flying' | 'landed';
type Peer = { id: string; name: string };

export type PairedFlightDockRound = {
  id: string;
  peerName: string;
  phase: 'sent' | 'received' | 'accepted';
  self: Stage;
  peer: Stage;
};

export type PairedFlightDockAction =
  | { action: 'invite'; peerId: string }
  | { action: 'accept' | 'decline' | 'cancel' | 'meet'; id: string };

type DockFrame = {
  peers: readonly Peer[];
  round: PairedFlightDockRound | null;
  canInvite: boolean;
  canBoard: boolean;
  canMeet: boolean;
  interactive: boolean;
};

const chinese = () => document.documentElement.lang.startsWith('zh');
const text = (cn: string, en: string) => chinese() ? cn : en;

export class PairedPublicFlightControls {
  private readonly root = document.createElement('section');
  private readonly heading = document.createElement('strong');
  private readonly status = document.createElement('p');
  private readonly chooser = document.createElement('select');
  private readonly actions = document.createElement('div');
  private readonly feedback = document.createElement('p');
  private snapshot: DockFrame | null = null;
  private key = '';
  private pick = false;
  private pending = false;

  constructor(host: HTMLElement, private readonly transport: {
    send: (action: PairedFlightDockAction) => Promise<void>;
    board: (roundId: string) => boolean;
    findShip: () => void;
  }) {
    this.root.id = 'paired-public-flight';
    this.root.dataset.i18nVerbatim = '';
    this.root.hidden = true;
    this.chooser.id = 'paired-public-flight-peer';
    this.actions.className = 'paired-public-flight-actions';
    this.status.setAttribute('aria-live', 'polite');
    this.feedback.setAttribute('role', 'status');
    this.feedback.hidden = true;
    this.root.append(this.heading, this.status, this.chooser, this.actions, this.feedback);
    host.append(this.root);
  }

  frame(snapshot: DockFrame | null) {
    if (snapshot?.round?.id !== this.snapshot?.round?.id) this.feedback.hidden = true;
    this.snapshot = snapshot;
    if (!snapshot?.canInvite || snapshot.round) this.pick = false;
    this.paint();
  }

  private paint() {
    const s = this.snapshot, round = s?.round;
    const show = !!s && (s.interactive && s.canInvite && s.peers.length > 0 || !!round);
    this.root.hidden = !show;
    if (!show) return;
    const key = JSON.stringify([s, this.pick, this.pending, chinese()]);
    if (key === this.key) return;
    this.key = key;
    const focused = this.actions.contains(document.activeElement) ? (document.activeElement as HTMLElement).id : '';
    const chosen = this.chooser.value;
    this.actions.replaceChildren();
    this.chooser.hidden = !this.pick;
    this.chooser.disabled = this.pending || !s.interactive;
    this.chooser.setAttribute('aria-label', text('选一位同场好友', 'Choose a friend here'));
    this.heading.textContent = text('约飞主星', 'Fly to the main planet together');
    this.status.textContent = '';
    if (round) this.paintRound(s, round);
    else if (!this.pick) {
      this.action('choose', text('约一位同场好友', 'Invite a friend here'), () => {
        this.pick = true;
        this.paint();
        this.chooser.focus();
      }, true);
    } else {
      this.chooser.replaceChildren();
      const empty = this.chooser.appendChild(new Option(text('选一位同场好友', 'Choose a friend here'), ''));
      empty.disabled = true;
      for (const peer of s.peers) this.chooser.append(new Option(peer.name, peer.id));
      this.chooser.value = s.peers.some(peer => peer.id === chosen) ? chosen : s.peers.length === 1 ? s.peers[0].id : '';
      const invite = this.action('invite', text('发出邀请', 'Send invitation'), () => {
        const peerId = this.chooser.value;
        if (this.snapshot?.canInvite && this.snapshot.peers.some(peer => peer.id === peerId)) {
          void this.submit({ action: 'invite', peerId });
        }
      }, true);
      invite.disabled ||= !this.chooser.value;
      this.chooser.onchange = () => { invite.disabled = !this.chooser.value || this.pending; };
      this.action('back', text('收起', 'Close'), () => {
        this.pick = false;
        this.paint();
        this.actions.querySelector('button')?.focus();
      });
    }
    if (focused) this.actions.querySelector<HTMLElement>('#' + focused)?.focus({ preventScroll: true });
  }

  private paintRound(s: DockFrame, round: PairedFlightDockRound) {
    const { id, peerName } = round;
    const step = (action: 'accept' | 'decline' | 'cancel' | 'meet') => {
      if (this.snapshot?.round?.id === id) {
        void this.submit({ action, id });
      }
    };
    if (round.phase === 'received') {
      this.heading.textContent = text(`${peerName} 约你去主星`, `${peerName} invited you to the main planet`);
      this.status.textContent = text('同意后，仍需各自确认启航。', 'You will each confirm your own departure.');
      if (s.interactive) {
        this.action('accept', text('同意', 'Accept'), () => step('accept'), true);
        this.action('decline', text('谢绝', 'Decline'), () => step('decline'));
      }
      return;
    }
    if (round.phase === 'sent') this.status.textContent = text(`已邀请 ${peerName}，等待答复。`, `Waiting for ${peerName} to reply.`);
    else if (round.self === 'dock') {
      this.status.textContent = round.peer === 'dock'
        ? text(`和 ${peerName} 各自确认后启航。`, `You and ${peerName} each confirm departure.`)
        : text(`你的航程还未启航。`, 'Your ship has not departed yet.');
      if (s.interactive && s.canBoard) {
        this.action('board', text('确认我的航程', 'Confirm my journey'), () => {
          if (this.snapshot?.round?.id === id && this.snapshot.canBoard && this.snapshot.interactive) this.transport.board(id);
        }, true);
      } else if (s.interactive) {
        this.action('find-ship', text('去码头登船', 'Find my ship'), () => this.transport.findShip(), true);
      }
    } else if (round.self === 'flying') {
      this.status.textContent = round.peer === 'dock' ? text(`${peerName} 还在出发码头。`, `${peerName} is still at the departure port.`)
        : round.peer === 'landed' ? text(`${peerName} 已到主星。`, `${peerName} has arrived.`)
        : text(`和 ${peerName} 正各自飞往主星。`, `You and ${peerName} are flying to the main planet.`);
    } else {
      this.status.textContent = round.peer === 'landed'
        ? text(`${peerName} 也已抵达。去码头镇街方向的双行木牌会合。`, `${peerName} has arrived too. Meet at the town sign beside the dock.`)
          : round.peer === 'flying'
          ? text(`${peerName} 还在飞行。可去码头双行木牌等候。`, `${peerName} is still flying. You can wait at the dock sign.`)
          : text(`${peerName} 还未登船。可去码头双行木牌等候。`, `${peerName} has not departed. You can wait at the dock sign.`);
      if (s.interactive && s.canMeet) {
        this.status.textContent = text(`${peerName} 就在木牌旁。`, `${peerName} is beside the sign.`);
        this.action('meet', text('在主星会合', 'Meet at the port'), () => step('meet'), true);
      }
    }
    if (s.interactive) this.action('cancel', text('取消约飞', 'Cancel plans'), () => step('cancel'));
  }

  private action(id: string, title: string, run: () => void, primary = false) {
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'paired-public-flight-' + id;
    button.textContent = title;
    button.disabled = this.pending;
    if (primary) button.classList.add('primary');
    button.onclick = run;
    this.actions.append(button);
    return button;
  }

  private async submit(action: PairedFlightDockAction) {
    if (this.pending || !this.snapshot?.interactive) return;
    this.pending = true;
    this.feedback.hidden = true;
    this.paint();
    try {
      await this.transport.send(action);
    } catch {
      this.feedback.textContent = text('暂时无法更新约飞，请重试。', 'Could not update the plan. Try again.');
      this.feedback.hidden = false;
    } finally {
      this.pending = false;
      this.paint();
    }
  }
}
