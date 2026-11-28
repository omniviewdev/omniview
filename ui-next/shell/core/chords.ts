// The tab chords (ch16 S41, S47, S52) as a function from a key event to what it asks. Framework-free: the DOM adapter (../tabs/useTabChords.ts) reads the
// event and runs the answer. The native chord is Command on macOS and Control elsewhere (`mod`); a browser never receives it (it closes its own tab), so the mock binds
// a web alternate, Control and Option together, and the shell answers both: the one that is bound in the running mode is the one a user presses.
//
//   close  W        the tab on screen            (S41: Command W, web Control Option W)
//   jump   1 to 8   the Nth tab of the strip     (S47: Command 1 to 8, web Control Option 1 to 8)
//   last   9        the last tab, whatever N     (S47: Command 9)
//   reopen T        the tab closed last          (S43: Command Shift T, web Control Option Shift T; in the app's own window on Windows and Linux its menu owns Control Shift T, so there only Control Option Shift T)
//   next   Tab      the tab to the right         (S48: Control Tab, Command Shift ], web Control Option Right; previous is the mirror: Control Shift Tab, Command Shift [, Control Option Left)

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

export type TabChord = { readonly action: 'close' | 'reopen' | 'next' | 'previous' | 'last' } | { readonly action: 'jump'; readonly n: number };

const DIGIT = /^Digit([1-9])$/;

/** The platform a user agent string names: the one place the shell tells a Mac from the rest. */
export function platformOf(scope: { readonly platform?: string | undefined; readonly userAgent?: string | undefined } | undefined): Platform {
  return /mac/i.test(scope?.platform ?? scope?.userAgent ?? '') ? 'mac' : 'other';
}

/**
 * The chord a key event is, or `undefined`. Shift with a chord is another chord (reopen, next, previous: close and the digits have none), and a key something else already took is theirs. `appWindow` is whether the page is in the app's own window and not
 * in a browser tab, which keeps every chord (the default).
 */
export function chordOf(event: KeyLike, platform: Platform, appWindow = false): TabChord | undefined {
  // An input method that is composing owns the keys (ch16 S52), and so does whatever already took this one.
  if (event.defaultPrevented === true || event.isComposing === true || event.keyCode === 229) {
    return undefined;
  }

  // Control Tab is the same key on every platform (Command Tab is the system's), so it is neither the native chord nor the web alternate.
  if (event.code === 'Tab' && event.ctrlKey && !event.metaKey && !event.altKey) {
    return { action: event.shiftKey ? 'previous' : 'next' };
  }

  const native = platform === 'mac' ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
  // On Windows layouts AltGr arrives as Control and Alt, and types a character: it is not the web alternate.
  const web = event.ctrlKey && event.altKey && !event.metaKey && event.getModifierState?.('AltGraph') !== true;
  if ((!native || event.altKey) && !web) {
    return undefined;
  }

  const mod = native && !event.altKey;
  if (event.shiftKey) {
    const mac = platform === 'mac';
    // The app's menu owns Control Shift T in its own window on Windows and Linux (New Terminal): there reopen is the alternate alone.
    if (event.code === 'KeyT') {
      return web || mac || !appWindow ? { action: 'reopen' } : undefined;
    }

    return mod && mac && event.code === 'BracketRight' ? { action: 'next' } : mod && mac && event.code === 'BracketLeft' ? { action: 'previous' } : undefined;
  }

  if (web && (event.code === 'ArrowRight' || event.code === 'ArrowLeft')) {
    return { action: event.code === 'ArrowRight' ? 'next' : 'previous' };
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

export type PanelChord = { readonly action: 'toggle' | 'maximize' } | { readonly action: 'close-session' };

/**
 * The panel's chords (ch16 S106, S118) as a function from a key event to what it asks. Toggle is Command J on a Mac and Control J elsewhere, and Control Option J where a browser keeps the
 * first for itself, from anywhere in the window. Close session is Command W on a Mac and Control Shift W elsewhere (Control W stays Close tab: the page's chord applies outside the panel),
 * and Control Option W for the web, and only while the focus is in the panel: `inPanel`. Shift with Command J maximizes or restores the panel. A key something else already took,
 * a composition and AltGr are not chords.
 */
export function panelChordOf(event: KeyLike, platform: Platform, inPanel: boolean): PanelChord | undefined {
  if (event.defaultPrevented === true || event.isComposing === true || event.keyCode === 229) {
    return undefined;
  }

  const web = event.ctrlKey && event.altKey && !event.metaKey && !event.shiftKey && event.getModifierState?.('AltGraph') !== true;
  const native = platform === 'mac' ? event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey : event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
  if (event.code === 'KeyJ') {
    if (event.shiftKey && ((platform === 'mac' && event.metaKey && !event.ctrlKey && !event.altKey) ||
      (event.ctrlKey && event.altKey && !event.metaKey && event.getModifierState?.('AltGraph') !== true))) {
      return { action: 'maximize' };
    }

    return native || web ? { action: 'toggle' } : undefined;
  }

  if (event.code !== 'KeyW' || !inPanel) {
    return undefined;
  }

  const close = platform === 'mac' ? native : event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey;
  return close || web ? { action: 'close-session' } : undefined;
}

/** What a pane chord asks: to move the keyboard to the next or previous pane of the tool on screen (wrapping), or to the pane to the left, right, above or below. */
export type PaneChord = { readonly action: 'next' | 'previous' | 'left' | 'right' | 'up' | 'down' };

export function paneChordOf(_event: KeyLike, _platform: Platform, _inPanel: boolean): PaneChord | undefined {
  return undefined;
}
