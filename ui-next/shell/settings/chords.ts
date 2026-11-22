import type { KeyLike, Platform } from '../core/chords';

// The chord that opens Settings (the mock's keymap: `host.settings`, Command comma, and Control Option comma for a browser) as a function from a key event to what it asks. Framework-free: the DOM adapter is `useSettingsChords.ts`.
// The native chord is Command on a Mac and Control elsewhere; a browser keeps that one for its own preferences, so the shell also answers Control Option, as it does for the tab and panel chords (`core/chords.ts`). The comma is
// the physical key (`code`), as every other chord of the shell is: Option turns a character into another, a layout moves it, and the key stays where it is.

export type SettingsChord = { readonly action: 'open' };

/**
 * The chord a key event is, or `undefined`. Shift is another chord, a key something else already took is theirs, an input method that is composing owns the keys, and AltGr (Control and Alt on a Windows layout, typing a
 * character) is not the web alternate.
 */
export function settingsChordOf(event: KeyLike, platform: Platform): SettingsChord | undefined {
  if (event.defaultPrevented === true || event.isComposing === true || event.keyCode === 229 || event.shiftKey || event.code !== 'Comma') {
    return undefined;
  }

  const native = platform === 'mac' ? event.metaKey && !event.ctrlKey && !event.altKey : event.ctrlKey && !event.metaKey && !event.altKey;
  const web = event.ctrlKey && event.altKey && !event.metaKey && event.getModifierState?.('AltGraph') !== true;
  return native || web ? { action: 'open' } : undefined;
}

/** The chord as the app's own window shows it: Command comma on a Mac, Control comma elsewhere. */
export const settingsChordText = (platform: Platform): string => (platform === 'mac' ? '⌘,' : 'Ctrl+,');

/** What a browser tab shows instead, because it keeps the first for itself. */
export const WEB_SETTINGS_CHORD = { mac: '⌃⌥,', other: 'Ctrl+Alt+,' } as const;

/** The native chord as `aria-keyshortcuts` writes it. */
export const settingsChordKeys = (platform: Platform): string => (platform === 'mac' ? 'Meta+,' : 'Control+,');
