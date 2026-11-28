import type { PreferencesSource } from './preferences';

// Whether Option is the Meta key (#697 step 2). The setting `macOptionIsMeta` is `on`, `off` or `auto`; the emulator wants a yes or no, and `auto` is the keyboard's: true for the US layout and US International (Ghostty's rule: a
// person on them loses nothing they could type with Option, and gains Alt B and Alt F in the shell), false for every layout that types letters and signs with Option (AZERTY's `@`, the Nordic `{`, QWERTZ's euro sign).
//
// The page can only ask the keyboard's own map of key codes to characters (`navigator.keyboard.getLayoutMap()`: Chromium, in a secure context). WebKit's WKWebView and Firefox have no such API, and a call may be refused: where the
// layout cannot be known, `auto` is OFF. Option types characters, the conservative answer: a person on AZERTY who cannot type `@` is worse off than a person on US who sets Meta on once.

/** What the keyboard map answers: the character a key code types (`KeyQ` types `q` on a US layout). */
export type LayoutMap = { readonly get: (code: string) => string | undefined };

/**
 * The keys on which layouts differ, and what each types on the US layout: every key lists what it may be. US International types the same on the base layer, except that `'` and `` ` `` are DEAD keys, and Chromium reports a
 * dead key as the combining character it makes (U+0301 for the acute, U+0300 for the grave) and not as the sign. A layout is US only when EVERY key is one of its.
 */
const US_KEYS: Readonly<Record<string, readonly string[]>> = {
  KeyQ: ['q'],
  KeyW: ['w'],
  KeyA: ['a'],
  KeyZ: ['z'],
  KeyM: ['m'],
  Semicolon: [';'],
  Quote: ['\'', '\u0301', '\u00b4'],
  Backquote: ['`', '\u0300'],
  BracketLeft: ['['],
  BracketRight: [']'],
  Backslash: ['\\'],
  Minus: ['-'],
  Equal: ['='],
  Comma: [','],
  Period: ['.'],
  Slash: ['/'],
};

/** Whether a keyboard map is the US layout's: false for a map that does not say what a key types. */
export function isUsLayout(map: LayoutMap): boolean {
  return Object.entries(US_KEYS).every(([code, characters]) => characters.includes(map.get(code) ?? ''));
}

/** What `navigator` offers of the keyboard, as far as this reads it. */
export type KeyboardHost = { readonly keyboard?: { readonly getLayoutMap?: () => Promise<LayoutMap | null | undefined> } | undefined };

/** Whether the keyboard is a US layout, or `undefined` where nobody can know (no API, a refused call, an answer that is not a map). */
export async function readLayout(host: KeyboardHost): Promise<boolean | undefined> {
  try {
    const map = await host.keyboard?.getLayoutMap?.();
    return map === null || map === undefined || typeof map.get !== 'function' ? undefined : isUsLayout(map);
  } catch {
    return undefined;
  }
}

/** The yes or no the emulator is given: the person's word for `on` and `off`, the layout's for `auto` (off where it is unknown). */
export function optionIsMeta(setting: ReturnType<PreferencesSource['getSnapshot']>['macOptionIsMeta'], usLayout: boolean | undefined): boolean {
  return setting === 'on' || (setting === 'auto' && usLayout === true);
}
