import type { Probe, Row } from './harness';

/** What every variant is given, and what it gives back to the harness. */
export type VariantProps = {
  readonly rows: readonly Row[];
  /** `plain` text cells, or the `real` cells of the narrow Pods row. */
  readonly cells: 'plain' | 'real';
  /** Counts the cells' render calls into `window.__cellCalls`. */
  readonly count: boolean;
  readonly layout: 'spacer' | 'absolute';
  readonly overscan: number;
  readonly rangeStep: number;
};

export type VariantModule = { readonly default: (props: VariantProps) => React.JSX.Element; readonly probe: Probe };
