import { Status, type StatusRole } from '@omniviewdev/kit';
import type { State } from './core/types';

// A plugin's state as a chip (ch16 S135: the state word of a row and of the header, never colour alone): the glyph of the kit's role for the state and the host's word for it. A healthy plugin has no word, so it has no chip.

/** The kit's role for each state: work under way is progress (a plugin that is starting again too: nothing failed), a fault is an error, a plugin that is off or stopped is stopped, and one that runs with errors or whose state the host did not say needs a look. */
export function roleOf(state: State): StatusRole {
  switch (state.kind) {
    case 'running':
      return 'healthy';
    case 'starting':
    case 'stopping':
    case 'removing':
      return 'progress';
    case 'degraded':
    case 'unknown':
      return 'attention';
    case 'disabled':
    case 'stopped':
      return 'stopped';
    case 'failed':
      return 'error';
  }
}

export function StateChip({ state }: { readonly state: State }) {
  return state.word === '' ? null : <Status role={roleOf(state)} data-pl-part="state-chip">{state.word}</Status>;
}
