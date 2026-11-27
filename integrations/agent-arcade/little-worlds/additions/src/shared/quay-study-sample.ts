export type QuaySampleTurn = -3 | -2 | -1 | 1 | 2 | 3;

export interface QuayStudyView {
  eligible: boolean;
  sample: { version: number; turn: QuaySampleTurn | null } | null;
}

export function isQuaySampleTurn(turn: unknown): turn is QuaySampleTurn {
  return typeof turn === 'number' && Number.isInteger(turn) && turn !== 0 && Math.abs(turn) <= 3;
}
