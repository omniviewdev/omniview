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
  /** What the user typed or pasted. Returns what stops it. */
  readonly onData: (listener: (data: string) => void) => () => void;
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
  readonly dispose: () => void;
};

/** Makes an emulator. Loading the emulator's code is the one asynchronous step: the factory it answers with is synchronous. */
export type EngineLoader = () => Promise<(options: EngineOptions) => Engine>;
