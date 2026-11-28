import type { PublicFlightCommand, PublicFlightView } from '../shared/paired-public-flight.ts';

const PULSE_MS = 650;
const VIEW_MS = 2200;
const SHIP_MS = 4500;
export type FlightResumeStatus = 'checking' | 'unconfirmed' | 'ended';

/** One authenticated pulse may be in flight at a time, including during takeoff. */
export class PairedPublicFlightSession {
  private client: string | null = null;
  private generation = 0;
  private response: PublicFlightView | null = null;
  private receivedAt = -Infinity;
  private shipAt = -Infinity;
  private nextAt = 0;
  private pending: Promise<PublicFlightView | undefined> | null = null;
  private queued = false;
  private suspended = false;
  private resumeClient: string | null = null;
  private knownClient: string | null = null;
  private review: FlightResumeStatus | null = null;
  private resumed = false;

  constructor(private readonly post: (client: string, command?: PublicFlightCommand) => Promise<PublicFlightView>) {}

  get view() { return performance.now() - this.receivedAt < VIEW_MS ? this.response : null; }
  get tracking() { return !!(this.response?.round); }
  get resumeStatus() { return this.review; }
  get ship() {
    return performance.now() - this.shipAt < SHIP_MS ? this.view?.round?.ship ?? null : null;
  }

  visibility(visible: boolean) {
    if (visible) {
      if (!this.suspended) return;
      this.suspended = false;
      if (this.resumeClient) this.review = 'checking';
      return;
    }
    if (this.suspended) return;
    this.suspended = true;
    if (this.knownClient) this.resumeClient = this.knownClient;
    this.invalidate();
  }

  retryResume() {
    if (this.review !== 'unconfirmed' || this.suspended || !this.resumeClient) return;
    this.review = 'checking';
    this.nextAt = 0;
  }

  dismissResume() {
    if (this.review === 'checking') return;
    this.review = null;
    this.resumeClient = null;
  }

  takeResumed() {
    const value = this.resumed;
    this.resumed = false;
    return value;
  }

  frame(client: string | null) {
    if (this.suspended) return;
    const previousClient = this.resumeClient ?? this.knownClient;
    if (client && previousClient && client !== previousClient) this.dismissContext();
    if (client !== this.client) {
      this.client = client;
      this.invalidate();
    }
    if (!client && this.review === 'checking') this.review = 'unconfirmed';
    if (client && this.review !== 'unconfirmed' && !this.pending && !this.queued && performance.now() >= this.nextAt) {
      void this.send(client).catch(() => { /* the last acknowledgement expires */ });
    }
  }

  async command(command: PublicFlightCommand) {
    const client = this.client, generation = this.generation;
    if (!client || this.queued || this.suspended || this.review === 'checking' || this.review === 'unconfirmed')
      throw new Error('Public flight is unavailable.');
    this.queued = true;
    try {
      await this.pending?.catch(() => {});
      if (generation !== this.generation) throw new Error('Public flight context changed.');
      return await this.send(client, command);
    } finally {
      this.queued = false;
    }
  }

  private invalidate() {
    this.generation++;
    this.response = null;
    this.receivedAt = -Infinity;
    this.shipAt = -Infinity;
    this.nextAt = 0;
    this.resumed = false;
  }

  private dismissContext() {
    this.review = null;
    this.resumeClient = null;
    this.knownClient = null;
    this.invalidate();
  }

  private send(client: string, command?: PublicFlightCommand) {
    const generation = this.generation;
    const sentAt = performance.now();
    const checking = !command && this.review === 'checking' && client === this.resumeClient;
    const task = this.post(client, command).then(response => {
      if (generation !== this.generation) return;
      if (checking) {
        if (performance.now() - sentAt >= VIEW_MS) {
          this.review = 'unconfirmed';
          return;
        }
        this.resumed = !!(response.round);
        this.review = this.resumed ? null : 'ended';
        this.resumeClient = null;
      } else if (this.review === 'ended' && (response.round)) {
        this.review = null;
      }
      const previous = this.response?.round?.ship, latest = response.round?.ship;
      if (!latest) this.shipAt = -Infinity;
      else if (!previous || previous.tripId !== latest.tripId || previous.journey !== latest.journey || previous.sequence !== latest.sequence) {
        this.shipAt = sentAt;
      }
      this.response = response;
      this.knownClient = response.round ? client : null;
      this.receivedAt = sentAt;
      return response;
    }, error => {
      if (checking && generation === this.generation) this.review = 'unconfirmed';
      throw error;
    }).finally(() => {
      this.pending = null;
      if (generation === this.generation) this.nextAt = performance.now() + PULSE_MS;
    });
    this.pending = task;
    return task;
  }
}
