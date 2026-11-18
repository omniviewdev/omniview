// The tab chords (ch16 S41, S47, S52) as a function from a key event to what it asks. Framework-free: the DOM adapter (../tabs/useTabChords.ts) reads the
// event and runs the answer. The native chord is Command on macOS and Control elsewhere (`mod`); a browser never receives it (it closes its own tab), so the mock binds
// a web alternate, Control and Option together, and the shell answers both: the one that is bound in the running mode is the one a user presses.
//
//   close  W        the tab on screen            (S41: Command W, web Control Option W)
//   jump   1 to 8   the Nth tab of the strip     (S47: Command 1 to 8, web Control Option 1 to 8)
//   last   9        the last tab, whatever N     (S47: Command 9)

export type Platform = 'mac' | 'other';

/** What a key event says. `code` is the physical key: Option turns a letter into another character on a Mac, and a layout moves the digits, but the key stays where it is. */
export type KeyLike = {
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
  readonly isComposing?: boolean | undefined;
  readonly keyCode?: number | undefined;
  readonly defaultPrevented?: boolean | undefined;
  /** What the platform says of a modifier: the one thing that tells AltGr (Control and Alt together, typing a character) from the Control and Option chord. */
  readonly getModifierState?: ((key: string) => boolean) | undefined;
};

export type TabChord = { readonly action: 'close' } | { readonly action: 'jump'; readonly n: number } | { readonly action: 'last' };

const DIGIT = /^Digit([1-9])$/;

/** The platform a user agent string names: the one place the shell tells a Mac from the rest. */
export function platformOf(scope: { readonly platform?: string | undefined; readonly userAgent?: string | undefined } | undefined): Platform {
  return /mac/i.test(scope?.platform ?? scope?.userAgent ?? '') ? 'mac' : 'other';
}

/** The chord a key event is, or `undefined`. Shift with a chord is another chord (next, previous, reopen), and a key something else already took is theirs. */
export function chordOf(event: KeyLike, platform: Platform): TabChord | undefined {
  // An input method that is composing owns the keys (ch16 S52), and so does whatever already took this one.
  if (event.defaultPrevented === true || event.isComposing === true || event.keyCode === 229 || event.shiftKey) {
    return undefined;
  }

  const native = platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  // On Windows layouts AltGr arrives as Control and Alt, and types a character: it is not the web alternate.
  const web = event.ctrlKey && event.altKey && !event.metaKey && event.getModifierState?.('AltGraph') !== true;
  if ((!native || event.altKey) && !web) {
    return undefined;
  }

  if (event.code === 'KeyW') {
    return { action: 'close' };
  }

  const digit = DIGIT.exec(event.code)?.[1];
  if (digit === undefined) {
    return undefined;
  }

  const n = Number(digit);
  return n === 9 ? { action: 'last' } : { action: 'jump', n };
}
