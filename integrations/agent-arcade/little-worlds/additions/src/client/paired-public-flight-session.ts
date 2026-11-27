import type { PublicFlightCommand, PublicFlightView } from '../shared/paired-public-flight.ts';

const PULSE_MS = 650;
const VIEW_MS = 2200;
const SHIP_MS = 4500;

/** One authenticated pulse may be in flight at a time, including during takeoff. */
export class PairedPublicFlightSession {
  private client: string | null = null;
  private generation = 0;
  private response: PublicFlightView | null = null;
  private receivedAt = -Infinity;
  private shipAt = -Infinity;
  private nextAt = 0;
  private pending: Promise<void> | null = null;
  private queued = false;

  constructor(private readonly post: (client: string, command?: PublicFlightCommand) => Promise<PublicFlightView>) {}

  get view() { return performance.now() - this.receivedAt < VIEW_MS ? this.response : null; }
  get tracking() { return !!this.response?.round; }
  get ship() {
    return performance.now() - this.shipAt < SHIP_MS ? this.view?.round?.ship ?? null : null;
  }

  frame(client: string | null) {
    if (client !== this.client) {
      this.client = client;
      this.generation++;
      this.response = null;
      this.receivedAt = -Infinity;
      this.shipAt = -Infinity;
      this.nextAt = 0;
    }
    if (client && !this.pending && !this.queued && performance.now() >= this.nextAt) {
      void this.send(client).catch(() => { /* the last acknowledgement expires */ });
    }
  }

  async command(command: PublicFlightCommand) {
    const client = this.client, generation = this.generation;
    if (!client || this.queued) throw new Error('Public flight is unavailable.');
    this.queued = true;
    try {
      await this.pending?.catch(() => {});
      if (generation !== this.generation) throw new Error('Public flight context changed.');
      await this.send(client, command);
    } finally {
      this.queued = false;
    }
  }

  private send(client: string, command?: PublicFlightCommand) {
    const generation = this.generation;
    const sentAt = performance.now();
    const task = this.post(client, command).then(response => {
      if (generation !== this.generation) return;
      const previous = this.response?.round?.ship, latest = response.round?.ship;
      if (!latest) this.shipAt = -Infinity;
      else if (!previous || previous.tripId !== latest.tripId || previous.journey !== latest.journey || previous.sequence !== latest.sequence) {
        this.shipAt = sentAt;
      }
      this.response = response;
      this.receivedAt = sentAt;
    }).finally(() => {
      this.pending = null;
      this.nextAt = performance.now() + PULSE_MS;
    });
    this.pending = task;
    return task;
  }
}
