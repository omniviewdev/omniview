import type { SessionItem, SessionState } from '../core/panel';
import type { Platform } from '../core/chords';

// The words and the DOM ids of the panel: what a session's state is called to a person, how a tab is named, and the chord's text. One place, so no component builds its own.

/** What a state is called in a tab's accessible name; a session that runs says nothing (a steady state has no word). */
const STATE_WORDS: Readonly<Record<SessionState, string>> = { starting: 'starting', running: '', ended: 'ended', failed: 'failed' };

export const stateWord = (state: SessionState): string => STATE_WORDS[state];

/** The accessible name of a session tab: the whole name and, when it is not steady, its state (ch16 SCT1: no plain-text tooltip repeats it). */
export function sessionName(item: SessionItem): string {
  const word = stateWord(item.state);
  return word === '' ? item.name : `${item.name}, ${word}`;
}

/**
 * An id the DOM and `aria-labelledby` can hold, and one that two different ids never share: anything outside letters, digits and hyphen becomes an underscore and the character's UTF-16 code
 * in exactly four hex digits. The underscore is itself escaped (`_005f`), so every underscore in the result starts an escape of a fixed width and the mapping can be read back; a code of
 * variable width made `:b` and `Ϋ` the same `_3ab`. Letters, digits, hyphens and a generated id (a UUID) are left as they are.
 */
const safe = (id: string): string => id.replace(/[^A-Za-z0-9-]/g, (character) => `_${character.charCodeAt(0).toString(16).padStart(4, '0')}`);

export const toolTabId = (prefix: string, tool: string): string => `${prefix}-tool-${safe(tool)}`;
export const sessionTabId = (prefix: string, session: string): string => `${prefix}-session-${safe(session)}`;
export const bodyId = (prefix: string, session: string): string => `${prefix}-body-${safe(session)}`;

/** The text of the toggle chord: Command J on a Mac, Control J elsewhere. */
export const toggleChordText = (platform: Platform): string => (platform === 'mac' ? '⌘J' : 'Ctrl+J');

/** The chord as `aria-keyshortcuts` writes it. */
export const toggleChordKeys = (platform: Platform): string => (platform === 'mac' ? 'Meta+J' : 'Control+J');
