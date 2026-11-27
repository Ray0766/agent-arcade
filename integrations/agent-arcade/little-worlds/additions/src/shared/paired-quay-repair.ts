export type QuayRole = 'holder' | 'wrench';
export type QuayPhase = 'met' | 'offered' | 'walking' | 'inspect' | 'adjust' | 'held' | 'locked' | 'done';
export type QuayAction = 'offer' | 'offerSample' | 'acceptSample' | 'accept' | 'decline' | 'ready' | 'press' | 'left' | 'right' | 'hold' | 'tighten' | 'retest' | 'leave';
export interface PairedQuayView {
  id: string; version: number; phase: QuayPhase;
  role: QuayRole | null; myReady: boolean; peerReady: boolean; atBench: boolean;
  turn: number; locked: boolean;
  requestedSample?: true; canUseSample?: true;
}
export interface PairedQuayCommand { action: 'repair'; id: string; version: number; move: QuayAction }
