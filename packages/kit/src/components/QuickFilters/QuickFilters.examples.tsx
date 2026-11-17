import { QuickFilters, type QuickFilter } from '@omniviewdev/kit';
import { useState } from 'react';

// The states of a list and how many items are in each: they add up to the count of All, which is how a strip reads (design 13 QF1).
const STATES: readonly QuickFilter[] = [
  { id: 'running', label: 'Running', count: 80, tone: 'success' },
  { id: 'pending', label: 'Pending', count: 4, tone: 'warning' },
  { id: 'failed', label: 'Failed', count: 3, tone: 'error' },
  { id: 'completed', label: 'Completed', count: 2, tone: 'muted' },
];

// A strip written the way a consumer writes it: the caller owns the choice, and clicking the chosen state again goes back to All.
function Strip({ total, filters, initial = null }: { readonly total?: number; readonly filters: readonly QuickFilter[]; readonly initial?: string | null }) {
  const [selected, setSelected] = useState<string | null>(initial);
  return (
    <QuickFilters
      label="Item state"
      total={total}
      filters={filters}
      selected={selected}
      onSelect={(id) => {
        setSelected(id === selected ? null : id);
      }}
    />
  );
}

/** All and four states, their counts adding up to 89: choose one, and the strip is one tab stop that Left, Right, Home and End move along. */
export const Default = () => <Strip total={89} filters={STATES} />;

/** A state chosen: its chip is pressed, and the others stay as they were. */
export const FailedSelected = () => <Strip total={89} filters={STATES} initial="failed" />;

/** A state with nothing in it is muted, not highlighted: a zero is a count, and an empty state needs no colour. */
export const EmptyFilters = () => (
  <Strip
    total={85}
    filters={STATES.map((state) => (state.id === 'pending' ? { ...state, count: 0 } : state))}
  />
);

/** While the counts load there are none to show: the strip keeps its chips, with no numbers, and nothing is highlighted. */
export const CountsUnknown = () => <Strip filters={STATES.map(({ id, label, tone }) => ({ id, label, tone }))} />;
