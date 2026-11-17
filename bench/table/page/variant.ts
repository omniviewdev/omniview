import type { Probe, Row } from './harness';

/** What every variant is given, and what it gives back to the harness. */
export type VariantProps = {
  readonly rows: readonly Row[];
  /** `plain` text cells, or the `real` cells of the narrow Pods row. */
  readonly cells: 'plain' | 'real';
  /** Counts the cells' render calls into `window.__cellCalls`, and gives the table a selection it can change. */
  readonly count: boolean;
  /** The control's window constants; the table has its own. */
  readonly overscan: number;
  readonly rangeStep: number;
  /** A number the parent changes to render again with nothing else changed (the count runs' unrelated update). */
  readonly tick: number;
};

export type VariantModule = { readonly default: (props: VariantProps) => React.JSX.Element; readonly probe: Probe };
