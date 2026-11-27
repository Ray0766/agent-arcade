import type { ConfirmedFlightVisitFrame } from './flight.ts';
import type {
  OrbitFriendHome, OrbitFriendHomeBinding, OrbitFriendHomeResponse,
} from '../shared/friend-home-orbit.ts';

const RECHECK_MS = 2000;
const MAX_AGE_MS = 4000;

export function orbitFriendHomeFrames(
  render: (frame: ConfirmedFlightVisitFrame | null, home: OrbitFriendHome | null) => void,
) {
  let key = '';
  let request: AbortController | undefined;
  let home: OrbitFriendHome | null = null;
  let expires = 0;
  let recheck = 0;

  function clear() {
    request?.abort();
    request = undefined;
    home = null;
    expires = recheck = 0;
    key = '';
    render(null, null);
  }

  async function read(binding: OrbitFriendHomeBinding, started: number) {
    const controller = request = new AbortController();
    recheck = started + RECHECK_MS;
    const timeout = setTimeout(() => controller.abort(), MAX_AGE_MS);
    const query = new URLSearchParams({
      tripId: binding.tripId, revision: String(binding.revision),
      journey: String(binding.journey), targetId: binding.targetId,
    });
    try {
      const response = await fetch('/api/trip/friend-home?' + query, { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw Error('Orbit home unavailable');
      const result: OrbitFriendHomeResponse = await response.json();
      if (request !== controller || controller.signal.aborted || document.hidden) return;
      if (result.tripId !== binding.tripId || result.revision !== binding.revision ||
          result.journey !== binding.journey || result.targetId !== binding.targetId) throw Error('Orbit home changed');
      home = result.home;
      expires = started + MAX_AGE_MS;
    } catch {
      if (request === controller) { home = null; expires = 0; }
    } finally {
      clearTimeout(timeout);
      if (request === controller) request = undefined;
    }
  }

  return (frame: ConfirmedFlightVisitFrame | null) => {
    if (!frame?.detailRoot || document.hidden) {
      if (key) clear();
      return;
    }
    const binding = { tripId: frame.tripId, revision: frame.tripRevision, journey: frame.journey, targetId: frame.target.id };
    const current = JSON.stringify(binding);
    if (current !== key) {
      if (key) clear();
      key = current;
    }
    const now = performance.now();
    if (now >= expires) home = null;
    if (!request && now >= recheck) void read(binding, now);
    render(frame, home);
  };
}
