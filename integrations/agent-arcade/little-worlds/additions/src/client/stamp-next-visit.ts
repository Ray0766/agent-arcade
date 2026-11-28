import type { StampNextVisit } from '../shared/stamp-next-visit.ts';

class StampNextVisitClient extends EventTarget {
  current: StampNextVisit | null = null;
  private generation = 0;
  private pending: Promise<StampNextVisit | null> | null = null;

  private set(next: StampNextVisit | null) {
    if (JSON.stringify(this.current) !== JSON.stringify(next)) {
      this.current = next;
      this.dispatchEvent(new Event('change'));
    }
    return this.current;
  }

  private async request(body?: {action:'select'|'cancel'; planetId:string}) {
    const revision = ++this.generation;
    try {
      const response = await fetch('/api/stamp-next-visit', {
        method: body ? 'POST' : 'GET',
        headers: body ? {'Content-Type':'application/json'} : {},
        body: body && JSON.stringify(body),
        cache: 'no-store',
        signal: AbortSignal.timeout(7000),
      });
      if (!response.ok) throw new Error(String(response.status));
      const {next} = await response.json() as {next:StampNextVisit|null};
      return revision === this.generation ? this.set(next) : this.current;
    } catch (error) {
      if (revision === this.generation) this.set(null);
      if (body) throw error;
      return this.current;
    }
  }

  private track(request: Promise<StampNextVisit|null>) {
    this.pending = request;
    const clear = () => { if (this.pending === request) this.pending = null; };
    void request.then(clear,clear);
    return request;
  }

  refresh() { return this.pending ?? this.track(this.request()); }
  select(planetId:string) { return this.track(this.request({action:'select',planetId})); }
  cancel(planetId:string) { return this.track(this.request({action:'cancel',planetId})); }
}
export const stampNextVisit = new StampNextVisitClient();
