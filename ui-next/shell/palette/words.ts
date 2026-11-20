import type { Platform } from '../core/chords';
import type { Chip, Note } from '../core/palette';

// The words and the ids of the palette: how a chord is written for the platform it is pressed on, what the input is called, what an empty list says, and the ids of the DOM. One place,
// so no component builds its own. The model's hints are platform-neutral (`Mod+Shift+Enter`: `Mod` is Command or Control, ch16 S64, S70); the view writes them with the platform's own keys.

const MAC: Readonly<Record<string, string>> = { Mod: '⌘', Alt: '⌥', Shift: '⇧', Enter: '↵', ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc' };
const OTHER: Readonly<Record<string, string>> = { Mod: 'Ctrl', Alt: 'Alt', Shift: 'Shift', Enter: 'Enter', ArrowRight: '→', ArrowLeft: '←', ArrowUp: '↑', ArrowDown: '↓', Escape: 'Esc' };
const MAC_NAMES: Readonly<Record<string, string>> = { Mod: 'Command', Alt: 'Option', Shift: 'Shift', ArrowRight: 'Right Arrow', ArrowLeft: 'Left Arrow', ArrowUp: 'Up Arrow', ArrowDown: 'Down Arrow' };
const OTHER_NAMES: Readonly<Record<string, string>> = { Mod: 'Control', Alt: 'Alt', Shift: 'Shift', ArrowRight: 'Right Arrow', ArrowLeft: 'Left Arrow', ArrowUp: 'Up Arrow', ArrowDown: 'Down Arrow' };

/** The order a Mac writes modifiers in: Command, Option, Shift (the mock's hints: `⌘⇧↵`, `⌥↵`). */
const MODIFIERS = ['Mod', 'Alt', 'Shift'];

const keysOf = (chord: string): string[] => {
  const parts = chord.split('+');
  const keys = parts.filter((part) => !MODIFIERS.includes(part));
  return [...MODIFIERS.filter((modifier) => parts.includes(modifier)), ...keys];
};

/** A chord as it is drawn in a hint: glyphs joined with nothing on a Mac (`⌘⇧↵`), words joined with a plus elsewhere (`Ctrl+Shift+Enter`). A letter is itself. */
export function chordGlyphs(chord: string, platform: Platform): string {
  const table = platform === 'mac' ? MAC : OTHER;
  return keysOf(chord)
    .map((key) => table[key] ?? key)
    .join(platform === 'mac' ? '' : '+');
}

/** The same chord as a screen reader says it: in words, never in glyphs (`Command Shift Enter`). */
export function chordName(chord: string, platform: Platform): string {
  const table = platform === 'mac' ? MAC_NAMES : OTHER_NAMES;
  return keysOf(chord)
    .map((key) => table[key] ?? key)
    .join(' ');
}

/** The chord of a control's tip and its key hint: `⌘K` on a Mac, `Ctrl+K` elsewhere. */
export const chordText = (chord: string, platform: Platform): string => chordGlyphs(chord, platform);

/** The chord as `aria-keyshortcuts` writes it: `Meta+K`, `Control+K`. */
export function chordKeys(chord: string, platform: Platform): string {
  return keysOf(chord)
    .map((key) => (key === 'Mod' ? (platform === 'mac' ? 'Meta' : 'Control') : key))
    .join('+');
}

/** What the input is called: `Search`, and where it searches while it is narrowed to a plugin and the places under it (S69). */
export function inputLabel(chips: ReadonlyArray<Pick<Chip, 'label'>>): string {
  return chips.length === 0 ? 'Search' : `Search in ${chips.map((chip) => chip.label).join(' › ')}`;
}

/** What an empty list says above its suggestions: the query that matched nothing in the mock's quotes, or that there is nothing yet. */
export function noteText(note: Note | undefined): string {
  if (note === undefined) {
    return '';
  }

  return note.type === 'no-results' ? `No results for “${note.query}”` : 'Nothing to show yet';
}

/**
 * An id the DOM and `aria-activedescendant` can hold, and one that two different row ids never share: anything outside letters, digits and hyphen becomes, for each of its UTF-16 units, an underscore and the
 * unit's code in exactly four hex digits (so the underscore is itself escaped, and the mapping can be read back; a character outside the first plane is two units, so two such characters never collide).
 */
export const domId = (prefix: string, id: string): string => `${prefix}-${id.replace(/[^A-Za-z0-9-]/g, (unit) => `_${unit.charCodeAt(0).toString(16).padStart(4, '0')}`)}`;
