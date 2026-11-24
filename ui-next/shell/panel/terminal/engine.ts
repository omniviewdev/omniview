import type { TerminalModes } from './feed';

// What the Terminal tool needs of a terminal emulator, in the host's own words. The emulator itself (xterm.js, with its GPU renderer) is the one thing the tool loads lazily, when the first terminal is shown
// (`xtermEngine.ts`, the only file that imports it); everything else (`screen.ts`, the body) is written against this and tested against a fake. The emulator holds the SCREEN and the scrollback; the bytes
// come from a feed, and the user's input goes back to it.

/** The colours of the screen, as CSS colour strings, resolved from the theme's tokens (the body reads them; the emulator never names a token). */
export type EngineTheme = {
  readonly background: string;
  readonly foreground: string;
  readonly cursor: string;
  readonly cursorAccent: string;
  readonly selectionBackground: string;
  readonly selectionInactiveBackground: string;
  /** The sixteen colours of the palette: black, red, green, yellow, blue, magenta, cyan, white, then the same bright. */
  readonly palette: readonly string[];
};

export type EngineAppearance = {
  readonly theme: EngineTheme;
  readonly fontFamily: string;
  /** In pixels. */
  readonly fontSize: number;
  /** A multiple of the font's own line height. */
  readonly lineHeight: number;
};

export type EngineOptions = {
  readonly cols: number;
  readonly rows: number;
  /** Lines kept above the screen. */
  readonly scrollback: number;
  readonly appearance: EngineAppearance;
  /**
   * Whether the printed output is in the accessibility tree, for a person whose screen reader reads it: the emulator's `screenReaderMode`. It is off unless the person chose it: it costs work for each line the emulator
   * parses, and it puts a second copy of the visible rows in the document.
   */
  readonly screenReaderMode: boolean;
};

/** The renderer: the DOM's own (`dom`) or the GPU's (`gpu`), which falls back to the first by itself when its context is lost. */
export type EngineRenderer = 'dom' | 'gpu';

export type Engine = {
  /** Draws the screen inside `host`, which is laid out and visible when this is called. */
  readonly open: (host: HTMLElement) => void;
  /** The cells that fit in the host now, or `undefined` when it has no size (a host that is hidden or 0 px). */
  readonly measure: () => { readonly cols: number; readonly rows: number } | undefined;
  readonly resize: (cols: number, rows: number) => void;
  readonly size: () => { readonly cols: number; readonly rows: number };
  /** Parses bytes (or text) into the screen. `done` is called once they are parsed: what the screen's flow control counts. */
  readonly write: (data: Uint8Array | string, done?: () => void) => void;
  /**
   * What the emulator sends toward the shell: what the person typed, pasted or composed (`user` is true), and what the emulator says by itself (`user` is false): the answer to a query it parsed, a report of its focus. The
   * two must be told apart because the second is the answer of a program that may be long past (while a replay is applied it is dropped), and the first is the person's, which is never lost. Returns what stops it.
   */
  readonly onData: (listener: (data: string, user: boolean) => void) => () => void;
  /** The selection changed. Returns what stops it. */
  readonly onSelection: (listener: () => void) => () => void;
  /**
   * Called for every key before the emulator processes it: `false` and the emulator ignores it (and neither handles nor stops it, so the window may), `true` and the emulator takes it. The handler may call
   * `preventDefault` for a key it handles itself.
   */
  readonly setKeys: (handler: (event: KeyboardEvent) => boolean) => void;
  /** New colours and font on the live emulator: nothing is created again. */
  readonly setAppearance: (appearance: EngineAppearance) => void;
  /** Whether typing reaches the feed. An ended terminal takes none. */
  readonly setInput: (on: boolean) => void;
  /** Turns the screen reader mode on or off on the live emulator (the window's choice changed): nothing is created again. */
  readonly setScreenReaderMode: (on: boolean) => void;
  /**
   * Switches the renderer. It answers once the new one is in place and never rejects: the GPU's code is a chunk of its own, and its cells are not the DOM's (it rounds the cell to whole device pixels), so
   * whoever asked measures the host again then.
   */
  readonly setRenderer: (renderer: EngineRenderer) => Promise<void>;
  /** The name of the input and what it says to a person who cannot see the screen. */
  readonly describe: (label: string, descriptionId: string) => void;
  readonly focus: () => void;
  readonly hasFocus: () => boolean;
  readonly hasSelection: () => boolean;
  readonly selection: () => string;
  /** Clears the scrollback and the screen but for the line the cursor is on, as the shell's own `clear` leaves its prompt. */
  readonly clear: () => void;
  /** Selects the whole buffer (the screen and the scrollback). */
  readonly selectAll: () => void;
  /** The program rang the bell (BEL). Returns what stops listening. The host draws it: the emulator makes no sound. */
  readonly onBell: (listener: () => void) => () => void;
  readonly dispose: () => void;
};

/** Makes an emulator. Loading the emulator's code is the one asynchronous step: the factory it answers with is synchronous. */
export type EngineLoader = () => Promise<(options: EngineOptions) => Engine>;

/** A full reset (RIS), in band: the first thing a replay writes, so that the emulator parses it in order with the bytes after it. */
export const FULL_RESET = '\u001bc';

/**
 * The two sequences that make a fresh emulator draw its cursor: a switch to the alternate screen and straight back. xterm 6.0.0 draws no cursor (not the hollow one of a terminal without the focus either) until its first
 * focus, its first key or a switch of screen, and an emulator that is only written to, as a replay writes it, is none of them: a restored terminal would show no cursor until the person typed. The bounce clears nothing of the
 * normal screen or its scrollback. It is written right after the reset, on the empty screen and at the start of the replay's bytes, where nothing is cut: written between the replay and the live output it would break an escape
 * sequence that the host's cut falls inside (a cut is the end of a read, not the end of a sequence). It is for bytes that start on the normal screen: the switch to the alternate screen draws the cursor itself, and a bounce
 * there would take the emulator off the screen it is on.
 */
export const CURSOR_INIT = '\u001b[?47h\u001b[?47l';

/** The sequences that switch on the mouse encodings the host reports by number: the default one (0, X10) needs none; 1 is UTF-8, 2 SGR and 3 urxvt. */
const MOUSE_ENCODINGS = ['', '\u001b[?1005h', '\u001b[?1006h', '\u001b[?1015h'];

/**
 * The escape sequences that put a fresh emulator in the modes a terminal's bytes were written under (T2-go 2.4 rule 4): the alternate screen first (the keyboard protocol's flags are a stack of each screen), the mouse (the
 * tracking bits, the smallest first, and then the encoding), bracketed paste, application cursor keys, focus events, a hidden cursor, and one push of the keyboard protocol for each flag, the bottom of the stack first. The
 * emulator sends a focus report when focus events are switched on, as it does for a query: whoever writes this mutes what the emulator says.
 */
export function modesPrologue(modes: TerminalModes): string {
  let text = modes.altScreen ? '\u001b[?1049h' : '';
  text += (modes.mouseTracking & 1) === 0 ? '' : '\u001b[?1000h';
  text += (modes.mouseTracking & 2) === 0 ? '' : '\u001b[?1002h';
  text += (modes.mouseTracking & 4) === 0 ? '' : '\u001b[?1003h';
  text += MOUSE_ENCODINGS[modes.mouseEncoding] ?? '';
  text += modes.bracketedPaste ? '\u001b[?2004h' : '';
  text += modes.applicationCursor ? '\u001b[?1h' : '';
  text += modes.focusEvents ? '\u001b[?1004h' : '';
  text += modes.cursorHidden ? '\u001b[?25l' : '';
  for (const flag of modes.kittyKeyboard) {
    text += `\u001b[>${String(flag)}u`;
  }

  return text;
}
