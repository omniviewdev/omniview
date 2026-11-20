import { chordOf, panelChordOf, type KeyLike, type Platform } from '../core/chords';

// The palette's chords as a function from a key event to what it asks (ch16 S66: Command K on a Mac and Control K elsewhere, a toggle, from anywhere), and the chords a modal palette keeps from
// the window behind it (the mock's chord router: a binding is ignored while a modal is open unless it says it is meant for one). Framework-free: the DOM adapter is `usePaletteChords.ts`.
// The tab chords' own rules are `../core/chords.ts`; this does not repeat them, it asks them.

export type PaletteChord = { readonly action: 'toggle' };

/** A key event as the palette reads it: the physical key and the character it made, which only a layout tells apart. */
export type PaletteKeyLike = KeyLike & { readonly key?: string | undefined };

/**
 * The key a user means by K. The character the key made decides when it is a Latin letter (a Dvorak layout moves the letter, and the user presses the key that says K); on a layout with
 * no Latin letter (a Cyrillic one) the physical key does.
 */
function isK(event: PaletteKeyLike): boolean {
  const letter = event.key !== undefined && /^[a-z]$/iu.test(event.key) ? event.key.toLowerCase() : undefined;
  return letter === undefined ? event.code === 'KeyK' : letter === 'k';
}

/**
 * Command K on a Mac and Control K elsewhere, and nothing with Shift or Option (those are other chords), nothing while an input method composes, and nothing a key handler before this one
 * already took.
 */
export function paletteChordOf(event: PaletteKeyLike, platform: Platform): PaletteChord | undefined {
  if (event.defaultPrevented === true || event.isComposing === true || event.keyCode === 229 || event.shiftKey || event.altKey) {
    return undefined;
  }

  const command = platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  return command && isK(event) ? { action: 'toggle' } : undefined;
}

/**
 * The window's own chords that a palette that is open keeps from the page behind it: closing or jumping to a tab, and toggling the panel. Typing, editing, the arrows, Enter, Escape and
 * the palette's own chord are the palette's. (The panel's Close session needs the focus to be in the panel, which it cannot be while the palette has the keyboard.)
 */
export function blocksUnderModal(event: PaletteKeyLike, platform: Platform): boolean {
  return chordOf(event, platform) !== undefined || panelChordOf(event, platform, false) !== undefined;
}
