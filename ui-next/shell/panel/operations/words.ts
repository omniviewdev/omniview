import { isIconName, type IconName, type StatusRole } from '@omniviewdev/kit';
import type { OperationState } from './types';

// The words and glyphs of the Operations table (ch16 S122; the mock's `stateWords` and `STATE_FACE`, shell-panel.js:2258-2266). One glyph carries one meaning (X2): work under way is the loader, work that waits is the clock, a
// finished outcome is a check, a cross or a warning, and a task that was cancelled or paused is the neutral minus. The word is the platform's own and keeps its spelling; the role chooses the glyph.

/** What the State column draws: the kit's role for the glyph, and the word. Work that has not started is `progress` with `queued`: the clock, because waiting is not moving (design 13 SR1). */
export type StateFace =
  | { readonly role: 'progress'; readonly queued: boolean; readonly word: string }
  | { readonly role: Exclude<StatusRole, 'progress'>; readonly word: string };

export const STATE_FACES: Readonly<Record<OperationState, StateFace>> = {
  starting: { role: 'progress', queued: true, word: 'Starting' },
  running: { role: 'progress', queued: false, word: 'Running' },
  paused: { role: 'stopped', word: 'Paused' },
  succeeded: { role: 'healthy', word: 'Succeeded' },
  failed: { role: 'error', word: 'Failed' },
  cancelled: { role: 'stopped', word: 'Canceled' },
  unknown: { role: 'attention', word: 'Outcome unknown' },
};

/** S84: a request to stop is "Canceling…" until the producer acknowledges it, and never claims a rollback. A change is in motion, so the loader, whatever state the work was in. */
export const CANCELING = 'Canceling…';
export const CANCELING_FACE: StateFace = { role: 'progress', queued: false, word: CANCELING };

/** What a dash in a cell is named by what is missing (design 13 D7): its words are never drawn, they are the dash's accessible name. */
export const NO_TARGET = 'No target';
export const NO_PROGRESS = 'No progress reported';
export const NO_START = 'No start time';

/**
 * The glyph of Open: the mock's `LuExternalLink`. The kit's registry does not have it yet, so until it does the button draws the nearest glyph it has, an arrow; the day the registry knows the name this is the name, with
 * nothing else to change.
 */
const WANTED_OPEN_ICON = 'external-link';
export const OPEN_ICON: IconName = isIconName(WANTED_OPEN_ICON) ? WANTED_OPEN_ICON : 'arrow-right';
