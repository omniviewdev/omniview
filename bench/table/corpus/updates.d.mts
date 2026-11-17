export function rng(seed: number): () => number;

export type UpdateTouch = { kind: 'restart' | 'phase' | 'recreate'; key: string; previousKey: string };

export function createUpdates(spec?: { eventsPerSecond?: number; recordsPerEvent?: number; recreateEvery?: number; seed?: number }): {
  apply<Row extends object>(rows: readonly Row[]): { rows: Row[]; touched: UpdateTouch[]; removed: number; added: number };
};
