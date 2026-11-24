export type TakenOutput = { readonly chunks: readonly Uint8Array[]; readonly bytes: number };

export type HeldOutput = {
  readonly push: (bytes: Uint8Array) => void;
  readonly take: (max?: number) => TakenOutput;
  readonly bytes: () => number;
  readonly clear: () => void;
};

export function createHeldOutput(): HeldOutput {
  return { push: () => undefined, take: () => ({ chunks: [], bytes: 0 }), bytes: () => 0, clear: () => undefined };
}
