import type { CourtyardCardAction, CourtyardCardVisit, SavedCourtyardCard } from '../shared/courtyard-stamp-collection.ts';

async function requestCard<T>(path: string, signal: AbortSignal, body?: unknown): Promise<T> {
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.any([signal, AbortSignal.timeout(7000)]),
    cache: 'no-store',
  });
  if (!response.ok) throw new Error('The courtyard card request did not complete.');
  return response.json() as Promise<T>;
}

export const readVisitCard = (visit: CourtyardCardVisit, signal: AbortSignal) =>
  requestCard<SavedCourtyardCard | null>(`courtyard/stamp-card?planetId=${encodeURIComponent(visit.planetId)}&visitEpoch=${visit.visitEpoch}`, signal);

export const writeVisitCard = (visit: CourtyardCardVisit, action: CourtyardCardAction, stamps: number, signal: AbortSignal) =>
  requestCard<SavedCourtyardCard>('courtyard/stamp-card', signal, { ...visit, action, stamps });

export const readStampAlbum = (signal: AbortSignal) =>
  requestCard<SavedCourtyardCard[]>('home/stamp-album', signal);
