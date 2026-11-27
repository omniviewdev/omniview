import userEvent from '@testing-library/user-event';
import type { ISearchOptions, SearchAddon } from '@xterm/addon-search';
import { Terminal, type IBuffer, type IDecoration, type ILink, type ILinkProvider } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FIND_LIMIT, FULL_RESET, modesPrologue, type Engine, type EngineAppearance, type EngineLoader, type FindOptions, type FindState, type Finder, type LinkHandler, type LinkHover } from './engine';
import type { TerminalMark, TerminalModes, TerminalReplay } from './feed';
import { findDecorations } from './findColours';
import { createScreen, SCROLLBACK, type ScreenDeps, type TerminalScreen } from './screen';
import { createScreenReaderChoice } from './screenReader';
import { fakeTerminalFeed, type FakeTerminalFeed } from './testing';
import { createXtermEngine } from './xtermEngine';

// The emulators the module made, in order: the engine makes its own inside, and the cursor tests read the one the screen drove (and the private flag it keeps) through it.
const made = vi.hoisted((): Terminal[] => []);
vi.mock('@xterm/xterm', async (importOriginal) => {
  const actual = await importOriginal<{ readonly Terminal: typeof Terminal }>();
  class Recording extends actual.Terminal {
    constructor(options?: ConstructorParameters<typeof Terminal>[0]) {
      super(options);
      made.push(this);
    }
  }

  return { ...actual, Terminal: Recording };
});

// The search addon as the module made it (T3a): how many times its code was asked for (the first find asks, nothing else does), and each addon the engine made, with what it was given and every step it was asked. The addon
// underneath is the real one.
const searched = vi.hoisted(() => ({ loads: 0, addons: [] as Array<{ readonly options: unknown; readonly steps: Array<{ readonly direction: 'next' | 'previous'; readonly term: string; readonly options: unknown }> }> }));
vi.mock('@xterm/addon-search', async (importOriginal) => {
  searched.loads += 1;
  const actual = await importOriginal<{ readonly SearchAddon: typeof SearchAddon }>();
  class Recording extends actual.SearchAddon {
    private readonly seen: (typeof searched.addons)[number];

    constructor(options?: ConstructorParameters<typeof SearchAddon>[0]) {
      super(options);
      this.seen = { options, steps: [] };
      searched.addons.push(this.seen);
    }

    override findNext(...args: Parameters<SearchAddon['findNext']>): boolean {
      this.seen.steps.push({ direction: 'next', term: args[0], options: args[1] });
      return super.findNext(...args);
    }

    override findPrevious(...args: Parameters<SearchAddon['findPrevious']>): boolean {
      this.seen.steps.push({ direction: 'previous', term: args[0], options: args[1] });
      return super.findPrevious(...args);
    }
  }

  return { ...actual, SearchAddon: Recording };
});

// The GPU addon as the module made it (#698 item 15): each one the engine made, whether it was disposed, and a way to lose its context or to make the next one fail to be made. In 0.19.0 an addon's `dispose()` does not release
// its GL context and WebKit allows 16 live ones in a page, so what counts is how many were made.
const gpus = vi.hoisted(() => ({ made: [] as Array<{ disposed: boolean; lose: () => void }>, failNext: 0 }));
vi.mock('@xterm/addon-webgl', () => {
  class Fake {
    private readonly seen: { disposed: boolean; lose: () => void };
    private readonly listeners: Array<() => void> = [];

    constructor() {
      if (gpus.failNext > 0) {
        gpus.failNext -= 1;
        throw new Error('no WebGL');
      }

      this.seen = { disposed: false, lose: () => {
        for (const listener of this.listeners) {
          listener();
        }
      },
      };
      gpus.made.push(this.seen);
    }

    onContextLoss(listener: () => void): { dispose: () => void } {
      this.listeners.push(listener);
      return { dispose: () => undefined };
    }

    activate(): void {
      // The real addon makes its context here.
    }

    dispose(): void {
      this.seen.disposed = true;
    }
  }

  return { WebglAddon: Fake };
});

// The real emulator (xterm.js, headless: its parser, its modes, its answers and its buffers need no layout), brought to where a terminal is by a replay (T2-go 2.4 rule 4). The fake emulator of the other tests knows no mode,
// no query and no cursor, so it cannot prove these four things: that the prologue of `engine.ts` puts a REAL emulator in the modes a terminal's bytes were written under, that the emulator DOES say things of its own while it
// is replayed (the premise of muting what it says), that the screen keeps all of it from the shell and lets through what the emulator answers to the live output after it, and that the emulator DRAWS ITS CURSOR when a
// replay has been applied, with the screen, the scrollback and the join with the live output exactly as the bytes alone make them. What the real renderer draws is the probes' to prove.

const NO_MODES: TerminalModes = { altScreen: false, bracketedPaste: false, applicationCursor: false, focusEvents: false, cursorHidden: false, mouseTracking: 0, mouseEncoding: 0, kittyKeyboard: [] };

const APPEARANCE: EngineAppearance = {
  theme: { background: '#000', foreground: '#fff', cursor: '#fff', cursorAccent: '#000', selectionBackground: '#222', selectionInactiveBackground: '#111', palette: Array.from({ length: 16 }, () => '#888') },
  fontFamily: 'monospace',
  fontSize: 12,
  lineHeight: 1.33,
  cursorStyle: 'block',
};

const OPTS: FindOptions = { caseSensitive: false, regex: false, wholeWord: false };

const HEX = /^#[0-9a-f]{6}$/;

/** Writes to the emulator and answers when it has parsed what it was given. */
async function parsed(terminal: Terminal, data: string | Uint8Array): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  terminal.write(data, resolve);
  return promise;
}

/** A fresh emulator, after what a terminal wrote before (`before`), and then the full reset and the modes the prologue gives. */
async function brought(modes: Partial<TerminalModes>, before = ''): Promise<Terminal> {
  const terminal = new Terminal({ allowProposedApi: true, cols: 80, rows: 24 });
  await parsed(terminal, `${before}${FULL_RESET}${modesPrologue({ ...NO_MODES, ...modes })}`);
  return terminal;
}

/** A replay of `data` for an emulator of 80 by 24 cells in no mode, whose end has the size and the modes it started with (`patch` changes what is given). */
const replayOf = (data: string | Uint8Array, patch: Partial<TerminalReplay> = {}): TerminalReplay => {
  const kept = typeof data === 'string' ? new TextEncoder().encode(data) : data;
  return { data: kept, startSize: { cols: 80, rows: 24 }, startModes: NO_MODES, size: { cols: 80, rows: 24 }, modes: NO_MODES, end: kept.length, ...patch };
};

/** The emulator's own input, which takes the keys, the text and the pastes that a browser sends to it. */
function inputOf(terminal: Terminal): HTMLTextAreaElement {
  if (terminal.textarea === undefined) {
    throw new Error('the emulator made no input to send keys to');
  }

  return terminal.textarea;
}

// What a browser delivers to the emulator's input when the person types, as the emulator reads it: the events themselves, dispatched on the input, which the emulator listens to (it reads `keyCode` and `charCode`).

/**
 * A character typed, as a browser delivers it: a keydown, and the keypress that follows it only when nothing cancelled the keydown. The emulator sends a lower-case letter from the keydown and cancels it, so no keypress comes;
 * it leaves the keydown of an upper-case letter alone (for the input methods of a Mac) and takes the letter from the keypress.
 */
function typeCharacter(input: HTMLElement, character: string): void {
  const kept = input.dispatchEvent(new KeyboardEvent('keydown', { key: character, code: `Key${character.toUpperCase()}`, keyCode: character.toUpperCase().charCodeAt(0), bubbles: true, cancelable: true }));
  if (kept) {
    input.dispatchEvent(new KeyboardEvent('keypress', { key: character, charCode: character.charCodeAt(0), keyCode: character.charCodeAt(0), bubbles: true, cancelable: true }));
  }
}

/** Enter pressed: a keydown, from which the emulator takes the carriage return. */
function pressEnter(input: HTMLElement): void {
  input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true, cancelable: true }));
}

/** A paste of `text`: the event carries it on its clipboard data. */
function pasteInto(input: HTMLElement, text: string): void {
  const event = new Event('paste', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'clipboardData', { value: { getData: (type: string) => (type === 'text/plain' ? text : '') } });
  input.dispatchEvent(event);
}

/** Text a keyboard or an input method inserted into the input with no key (an emoji picker, dictation): an input event. */
function insertInto(input: HTMLElement, text: string): void {
  input.dispatchEvent(new InputEvent('input', { data: text, inputType: 'insertText', bubbles: true }));
}

describe('the modes a prologue puts a real emulator in', () => {
  it('is the normal screen, no tracking and no mode for a terminal in no mode', async () => {
    const terminal = await brought({});
    expect(terminal.buffer.active.type).toBe('normal');
    expect(terminal.modes).toMatchObject({ mouseTrackingMode: 'none', bracketedPasteMode: false, applicationCursorKeysMode: false, sendFocusMode: false });
    terminal.dispose();
  });

  it('is the alternate screen for a terminal that has one up (vim)', async () => {
    const terminal = await brought({ altScreen: true });
    expect(terminal.buffer.active.type).toBe('alternate');
    terminal.dispose();
  });

  it.each([
    [1, 'vt200'],
    [2, 'drag'],
    [4, 'any'],
    [7, 'any'],
  ] as const)('is the mouse tracking the bits %i stand for: %s (the largest of them rules)', async (bits, tracking) => {
    const terminal = await brought({ mouseTracking: bits });
    expect(terminal.modes.mouseTrackingMode).toBe(tracking);
    terminal.dispose();
  });

  it('is bracketed paste, application cursor keys and focus events, each when the terminal has it', async () => {
    const terminal = await brought({ bracketedPaste: true, applicationCursor: true, focusEvents: true });
    expect(terminal.modes).toMatchObject({ bracketedPasteMode: true, applicationCursorKeysMode: true, sendFocusMode: true });
    terminal.dispose();
  });

  it('starts from a full reset: what the emulator had switched on before is off unless the terminal has it, and the screen is the one the terminal has', async () => {
    const terminal = await brought({ applicationCursor: true }, '\u001b[?1049h\u001b[?2004h\u001b[?1002h\u001b[?1004h');
    expect(terminal.buffer.active.type).toBe('normal');
    expect(terminal.modes).toMatchObject({ mouseTrackingMode: 'none', bracketedPasteMode: false, sendFocusMode: false, applicationCursorKeysMode: true });
    terminal.dispose();
  });

  it('leaves the text of the bytes to the bytes: what is written after the prologue is on the screen the prologue chose', async () => {
    const terminal = await brought({ altScreen: true });
    await parsed(terminal, new TextEncoder().encode('kept line'));
    expect(terminal.buffer.active.getLine(0)?.translateToString(true)).toBe('kept line');
    terminal.dispose();
  });

  it('keeps the size the emulator was given: the full reset does not touch it, so the screen may size the emulator before the reset is parsed', async () => {
    const terminal = new Terminal({ allowProposedApi: true, cols: 80, rows: 24 });
    terminal.resize(100, 30);
    await parsed(terminal, `${FULL_RESET}${modesPrologue({ ...NO_MODES, altScreen: true })}`);
    expect(terminal.cols).toBe(100);
    expect(terminal.rows).toBe(30);
    terminal.dispose();
  });
});

describe('what a real emulator says on its own while it is replayed', () => {
  it('answers the queries in the bytes it is written, and reports focus when its mode is switched on: none of it was asked of it by the shell that is listening now, which is why it is muted', async () => {
    const heard: string[] = [];
    const engine = createXtermEngine({ cols: 80, rows: 24, scrollback: 100, appearance: APPEARANCE, screenReaderMode: false });
    engine.onData((data) => {
      heard.push(data);
    });
    const written = async (data: string) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      engine.write(data, resolve);
      return promise;
    };

    await written(`${FULL_RESET}${modesPrologue({ ...NO_MODES, focusEvents: true })}`);
    expect(heard).toEqual(['\u001b[O']);
    await written('text\u001b[6n\u001b[c');
    expect(heard).toHaveLength(3);
    expect(heard[1]).toBe('\u001b[1;5R');
    expect(heard[2]).toMatch(/^\u001b\[\?\d+(;\d+)*c$/);
    engine.dispose();
  });
});

// The search addon is a chunk of the emulator's own (T3a): the engine fetches it when the person first searches, and a terminal nobody searches costs none of it. No test above this one asks for a find, so the first ask is the one
// that is counted.
describe('the search addon of a real emulator', () => {
  it('is loaded by the first find and not before: a terminal nobody searches costs none of it, and every later ask is given the same finder', async () => {
    const { engine, close } = emulator();
    expect(searched.loads).toBe(0);
    const first = await engine.find();
    expect(searched.loads).toBe(1);
    expect(await engine.find()).toBe(first);
    expect(searched.loads).toBe(1);
    expect(searched.addons).toHaveLength(1);
    close();
  });
});

describe('the screen over a real emulator', () => {
  // The screen's frames and the emulator's own write buffer run on timers: under fake ones the whole path is driven by the test's clock, with no wait.
  beforeEach(() => {
    vi.useFakeTimers();
    made.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** A feed that was reattached: it holds its replay until the reader takes it, and reads nothing before. */
  function reattachedFeed(replay: TerminalReplay): FakeTerminalFeed {
    const base = fakeTerminalFeed();
    let held: TerminalReplay | undefined = replay;
    return {
      ...base,
      read: (max) => (held === undefined ? base.read(max) : { chunks: [], bytes: 0 }),
      takeReplay: () => {
        const found = held;
        held = undefined;
        return found;
      },
    };
  }

  /** A feed that reads live output from the start and is given a replay LATER (`give`): what a rejoin whose gap the host's ring no longer covers does. It reads nothing while that replay waits, as every feed does. */
  function lateFeed(): FakeTerminalFeed & { readonly give: (replay: TerminalReplay) => void } {
    const base = fakeTerminalFeed();
    let held: TerminalReplay | undefined;
    return {
      ...base,
      read: (max) => (held === undefined ? base.read(max) : { chunks: [], bytes: 0 }),
      takeReplay: () => {
        const found = held;
        held = undefined;
        return found;
      },
      give: (replay) => {
        held = replay;
        base.wake();
      },
    };
  }

  /** Lets the timers of the screen and of the emulator run: what the emulator was given is parsed, in order, and what it says is said. */
  const settle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(1_000);
  };

  /**
   * The screen over the REAL emulator, reading `feed`, once everything it was given is parsed. The emulator is the one the module recorded. It draws nothing here (its `open` does nothing) unless the test gives it a `host`:
   * then it is opened there, and its own input takes the keys that are sent to it. With `frames` the screen's frames are the test's: they are collected there and nothing is drawn until the test runs them, and the emulator is
   * let come and no more. `extra` is more of what the screen is given (the find bar's handlers).
   */
  async function showOver(feed: FakeTerminalFeed, host?: HTMLElement, frames?: Array<() => void>, extra: Partial<ScreenDeps> = {}): Promise<{ readonly screen: TerminalScreen; readonly terminal: Terminal }> {
    const load: EngineLoader = async () => (options) => ({ ...createXtermEngine(options), ...(host === undefined ? { open: () => undefined } : {}), setRenderer: async () => undefined });
    const screen = createScreen({
      feed,
      load,
      appearance: () => APPEARANCE,
      platform: 'mac',
      label: 'Terminal input, Terminal',
      descriptionId: 'hint-1',
      screenReader: createScreenReaderChoice(),
      frame: (callback) => {
        if (frames !== undefined) {
          frames.push(callback);
          return () => {
            const at = frames.indexOf(callback);
            if (at !== -1) {
              frames.splice(at, 1);
            }
          };
        }

        const timer = setTimeout(callback, 0);
        return () => {
          clearTimeout(timer);
        };
      },
      observe: () => () => undefined,
      fontsReady: async () => Promise.resolve(),
      copy: async () => Promise.resolve(false),
      warn: () => undefined,
      ...extra,
    });
    screen.mount(host ?? document.createElement('div'));
    screen.show();
    await (frames === undefined ? settle() : vi.advanceTimersByTimeAsync(0));
    const terminal = made.at(-1);
    if (terminal === undefined) {
      throw new Error('the screen made no emulator');
    }

    return { screen, terminal };
  }

  /** The screen over the real emulator, reading a feed that was reattached (and holds `live` after its replay), once everything it was given is parsed. */
  async function shownOver(replay: TerminalReplay, live?: string | Uint8Array): Promise<{ readonly screen: TerminalScreen; readonly feed: FakeTerminalFeed; readonly terminal: Terminal }> {
    const feed = reattachedFeed(replay);
    if (live !== undefined) {
      feed.push(live);
    }

    return { ...(await showOver(feed)), feed };
  }

  const sum = (numbers: readonly number[]): number => numbers.reduce((total, value) => total + value, 0);

  it('keeps every answer the emulator gives to a replay from the shell, and sends the answer to a query that is live: the emulator is the real one, and so are its answers', async () => {
    // A full-screen program's screen, as the host kept it: it asked the cursor position and the terminal's kind, and put the emulator's focus reports on.
    const kept = new TextEncoder().encode('vim screen\u001b[6n and more\u001b[c');
    const replay: TerminalReplay = { data: kept, startSize: { cols: 80, rows: 24 }, startModes: { ...NO_MODES, altScreen: true, focusEvents: true }, size: { cols: 80, rows: 24 }, modes: { ...NO_MODES, altScreen: true, focusEvents: true }, end: kept.length };
    const live = 'now\u001b[6n';
    // The emulator parses what it was given in order, on its own timer, and says it has: every live byte is acknowledged after the whole replay was parsed, and its answer to the live query was given by then.
    const { screen, feed } = await shownOver(replay, live);
    expect(sum(feed.acks())).toBe(live.length);
    expect(feed.typed()).toHaveLength(1);
    expect(feed.typed()[0]).toMatch(/^\u001b\[\d+;\d+R$/);
    screen.dispose();
  });

  // xterm 6.0.0 draws no cursor (the hollow one of an unfocused terminal, nor the solid one) until its first focus, its first key or a switch of screen: its flag for it is false in an emulator that was only written to, and
  // the DOM renderer checks it. A restored terminal is only written to, and is not focused, so without the bounce through the alternate screen that the screen writes after the reset it shows no cursor until the person types.
  describe('what a replay makes of a real emulator: its cursor, and the screen it brings it to', () => {
    /**
     * xterm's own flag for "draw the cursor", which its public API does not give. The one private member this file reads, because it is the fact the bounce exists for: it fails in words, and does not answer wrongly, if the
     * emulator moves it.
     */
    function cursorInitialised(terminal: Terminal): boolean {
      const core: unknown = Reflect.get(terminal, '_core');
      if (typeof core === 'object' && core !== null && 'coreService' in core) {
        const service = core.coreService;
        if (typeof service === 'object' && service !== null && 'isCursorInitialized' in service && typeof service.isCursorInitialized === 'boolean') {
          return service.isCursorInitialized;
        }
      }

      throw new Error('xterm no longer keeps its cursor flag where this test reads it: terminal._core.coreService.isCursorInitialized');
    }

    /** Every line of a buffer, the scrollback first, as the text on it. */
    const linesOf = (buffer: IBuffer): string[] => Array.from({ length: buffer.length }, (_, index) => buffer.getLine(index)?.translateToString(true) ?? '');

    /** Where the cursor is, and which part of the buffer is in view. */
    const placeOf = (buffer: IBuffer) => ({ x: buffer.cursorX, y: buffer.cursorY, base: buffer.baseY, top: buffer.viewportY });

    const ALT: TerminalModes = { ...NO_MODES, altScreen: true };

    /**
     * What the same bytes make of an emulator that is only written to, with no bounce: the reset, the modes and the bytes, in one write each, at the size the bytes were written under, and then what was live. It is the
     * control that says what the bounce leaves as it was.
     */
    async function writtenOnly(replay: TerminalReplay, live?: Uint8Array): Promise<Terminal> {
      const terminal = new Terminal({ allowProposedApi: true, cols: replay.startSize.cols, rows: replay.startSize.rows, scrollback: SCROLLBACK });
      terminal.write(`${FULL_RESET}${modesPrologue(replay.startModes)}`);
      terminal.write(replay.data);
      if (live !== undefined) {
        terminal.write(live);
      }

      await settle();
      return terminal;
    }

    /** Sixty numbered lines and a prompt: more than the 24 rows of the screen, so some are in the scrollback. */
    const session = (): string => `${Array.from({ length: 60 }, (_, index) => `line ${String(index)}\r\n`).join('')}prompt $ `;

    it('has none in an emulator that was only written to, which is the premise of the bounce: a replay with the reset, the modes and the bytes leaves the flag false (xterm 6.0.0: if this goes red, the bounce is no longer needed)', async () => {
      const written = await writtenOnly(replayOf(session()));
      expect(cursorInitialised(written)).toBe(false);
      written.dispose();
    });

    it('is drawn once the screen has applied a replay that starts on the normal screen, which stays the screen the emulator is on: no line of it, no line of its scrollback and no position changes', async () => {
      const replay = replayOf(session());
      const { screen, terminal } = await shownOver(replay);
      const written = await writtenOnly(replay);
      expect(cursorInitialised(terminal)).toBe(true);
      expect(terminal.buffer.active.type).toBe('normal');
      expect(linesOf(terminal.buffer.normal).length).toBeGreaterThan(terminal.rows);
      expect(linesOf(terminal.buffer.normal)).toEqual(linesOf(written.buffer.normal));
      expect(placeOf(terminal.buffer.normal)).toEqual(placeOf(written.buffer.normal));
      expect(terminal.buffer.normal.getLine(terminal.buffer.normal.length - 1)?.translateToString(true)).toContain('prompt $');
      screen.dispose();
      written.dispose();
    });

    it('is drawn for a replay with no bytes too: the emulator is reset, and shows its cursor', async () => {
      const { screen, terminal } = await shownOver(replayOf(''));
      expect(cursorInitialised(terminal)).toBe(true);
      expect(terminal.buffer.active.type).toBe('normal');
      screen.dispose();
    });

    it('is drawn by the switch of screen itself for a replay that starts on the alternate screen, which stays the screen the emulator is on: a bounce there would take a full-screen program off its screen', async () => {
      const replay = replayOf('\u001b[H\u001b[2Jnotes.txt  1,1  All', { startModes: ALT, modes: ALT });
      const { screen, terminal } = await shownOver(replay);
      const written = await writtenOnly(replay);
      expect(cursorInitialised(terminal)).toBe(true);
      expect(terminal.buffer.active.type).toBe('alternate');
      expect(linesOf(terminal.buffer.alternate)).toEqual(linesOf(written.buffer.alternate));
      expect(linesOf(terminal.buffer.alternate)[0]).toBe('notes.txt  1,1  All');
      screen.dispose();
      written.dispose();
    });

    it('is drawn, and the screen is the normal one, for a replay that starts on the alternate screen and leaves it: the program ended in the bytes', async () => {
      const replay = replayOf('\u001b[H\u001b[2Jnotes.txt\u001b[?1049l$ ls\r\nnotes.txt\r\n$ ', { startModes: ALT });
      const { screen, terminal } = await shownOver(replay);
      const written = await writtenOnly(replay);
      expect(cursorInitialised(terminal)).toBe(true);
      expect(terminal.buffer.active.type).toBe('normal');
      expect(linesOf(terminal.buffer.normal)).toEqual(linesOf(written.buffer.normal));
      screen.dispose();
      written.dispose();
    });

    it('joins the live output exactly where the replay ends, also when the cut falls inside a character: the host cuts at the end of a read, and the emulator finishes the character it began', async () => {
      const kept = Uint8Array.from([...new TextEncoder().encode('plain '), 0xe2, 0x82]);
      const live = Uint8Array.from([0xac, ...new TextEncoder().encode(' end')]);
      const replay = replayOf(kept);
      const { screen, terminal } = await shownOver(replay, live);
      const written = await writtenOnly(replay, live);
      expect(cursorInitialised(terminal)).toBe(true);
      expect(linesOf(terminal.buffer.normal)[0]).toBe('plain \u20ac end');
      expect(linesOf(terminal.buffer.normal)).toEqual(linesOf(written.buffer.normal));
      screen.dispose();
      written.dispose();
    });

    it('joins the live output with the escape sequence the replay began, and the colour is the one it asks for: a sequence cut at the end of a read is the emulator\'s to finish, and anything written between the two breaks it', async () => {
      const kept = new TextEncoder().encode('plain \u001b[3');
      const live = new TextEncoder().encode('1mred');
      const replay = replayOf(kept);
      const { screen, terminal } = await shownOver(replay, live);
      const written = await writtenOnly(replay, live);
      expect(linesOf(terminal.buffer.normal)[0]).toBe('plain red');
      const red = terminal.buffer.normal.getLine(0)?.getCell(6);
      expect(red?.getChars()).toBe('r');
      expect(red?.isFgPalette()).toBe(true);
      expect(red?.getFgColor()).toBe(1);
      expect(red?.getFgColor()).toBe(written.buffer.normal.getLine(0)?.getCell(6)?.getFgColor());
      screen.dispose();
      written.dispose();
    });

    // A replay that comes LATE (T2d): the emulator already holds output, and the screen applies the replay as the first one is applied. What the buffer is after it must be what that replay's bytes alone make.
    it('brings an emulator that holds output to the host\'s ring when a replay comes late: the buffer is what the replay\'s bytes alone make, no line of what was drawn before it is left, the scrollback included, and the cursor is drawn', async () => {
      const feed = lateFeed();
      feed.push(session());
      const { screen, terminal } = await showOver(feed);
      expect(linesOf(terminal.buffer.normal).join('\n')).toContain('line 59');
      expect(linesOf(terminal.buffer.normal).length).toBeGreaterThan(terminal.rows);
      expect(cursorInitialised(terminal)).toBe(false);
      const replay = replayOf('ring 1\r\nring 2\r\nring 3\r\n$ ');
      feed.give(replay);
      await settle();
      const written = await writtenOnly(replay);
      expect(terminal.buffer.active.type).toBe('normal');
      expect(linesOf(terminal.buffer.normal)).toEqual(linesOf(written.buffer.normal));
      expect(placeOf(terminal.buffer.normal)).toEqual(placeOf(written.buffer.normal));
      expect(linesOf(terminal.buffer.normal).join('\n')).not.toContain('line 59');
      expect(linesOf(terminal.buffer.normal)).toHaveLength(terminal.rows);
      expect(cursorInitialised(terminal)).toBe(true);
      screen.dispose();
      written.dispose();
    });

    it('brings an emulator that holds output to a full-screen program the host\'s terminal has up: the alternate screen, and what is on it, as the replay\'s bytes alone make them', async () => {
      const feed = lateFeed();
      feed.push(session());
      const { screen, terminal } = await showOver(feed);
      const replay = replayOf('\u001b[H\u001b[2Jnotes.txt  1,1  All', { startModes: ALT, modes: ALT });
      feed.give(replay);
      await settle();
      const written = await writtenOnly(replay);
      expect(terminal.buffer.active.type).toBe('alternate');
      expect(linesOf(terminal.buffer.alternate)).toEqual(linesOf(written.buffer.alternate));
      expect(linesOf(terminal.buffer.alternate)[0]).toBe('notes.txt  1,1  All');
      expect(linesOf(terminal.buffer.normal)).toEqual(linesOf(written.buffer.normal));
      screen.dispose();
      written.dispose();
    });

    it('keeps the answers the emulator gives to a late replay from the shell, joins the live output after it exactly, and sends the answer to a query that is live', async () => {
      const feed = lateFeed();
      feed.push('before\u001b[6n');
      const { screen, terminal } = await showOver(feed);
      expect(feed.typed()).toHaveLength(1);
      const replay = replayOf('ring \u001b[6n and more\u001b[c');
      const live = new TextEncoder().encode(' tail\u001b[6n');
      feed.give(replay);
      feed.push(live);
      await settle();
      const written = await writtenOnly(replay, live);
      expect(linesOf(terminal.buffer.normal)).toEqual(linesOf(written.buffer.normal));
      // The answer to the query that was live before the replay, and the one to the query that is live after it: the answers to the two queries in the replay are not the shell's.
      expect(feed.typed()).toHaveLength(2);
      expect(feed.typed()[1]).toMatch(/^\u001b\[\d+;\d+R$/);
      expect(sum(feed.acks())).toBe('before\u001b[6n'.length + live.length);
      screen.dispose();
      written.dispose();
    });
  });

  // What the person types while a replay is applied (T2d fix round), over the real emulator and the events a browser sends to its input. The emulator answers the queries in the replay, and what it answers is dropped; what the
  // person types, pastes or inserts in the same window is kept and sent once the replay is applied, in order, and none of the answers is sent with it. The frames of the screen are the test's, so that the window is open
  // when the person types: the replay is written to the emulator, and the emulator's timers, which parse it, are the test's too.
  describe('what the person types while the real emulator is parsing a replay', () => {
    const QUERY = '\u001b[6n';

    const runAll = (frames: Array<() => void>): void => {
      for (const frame of frames.splice(0)) {
        frame();
      }
    };

    /** A screen over the real emulator, in the document, that drew some output and was then given a replay by a rejoin whose gap the host's ring no longer covers: the frame that applies it has run, and nothing is parsed. */
    async function applyingLate(replayed: string) {
      const host = document.createElement('div');
      document.body.append(host);
      const frames: Array<() => void> = [];
      const feed = lateFeed();
      feed.push('before\r\n');
      const { screen, terminal } = await showOver(feed, host, frames);
      runAll(frames);
      await settle();
      feed.give(replayOf(replayed));
      runAll(frames);
      return { feed, frames, input: inputOf(terminal), close: () => {
        screen.dispose();
        host.remove();
      } };
    }

    /** A screen over the real emulator, in the document, over a feed that holds the replay of a terminal the page took back: the frame that applies it has run, and nothing is parsed. */
    async function applyingFirst(replayed: string) {
      const host = document.createElement('div');
      document.body.append(host);
      const frames: Array<() => void> = [];
      const feed = reattachedFeed(replayOf(replayed));
      const { screen, terminal } = await showOver(feed, host, frames);
      runAll(frames);
      return { feed, frames, input: inputOf(terminal), close: () => {
        screen.dispose();
        host.remove();
      } };
    }

    describe.each([
      ['a replay that comes late', applyingLate],
      ['the first replay of a terminal the page took back', applyingFirst],
    ] as const)('in %s', (_name, begin) => {
      it('keeps what the person types in the window and sends it once, after the replay, in order: none of it while the emulator parses the replay, and none of the answers it gives to the queries in it', async () => {
        const { feed, input, close } = await begin(`old${QUERY}more${QUERY}`);
        typeCharacter(input, 'l');
        typeCharacter(input, 's');
        pressEnter(input);
        expect(feed.typed()).toEqual([]);
        await settle();
        expect(feed.typed()).toEqual(['l', 's', '\r']);
        typeCharacter(input, 'x');
        expect(feed.typed()).toEqual(['l', 's', '\r', 'x']);
        close();
      });

      it('keeps a paste, and text inserted with no key, in order with the keys around them', async () => {
        const { feed, input, close } = await begin(`old${QUERY}`);
        typeCharacter(input, 'a');
        pasteInto(input, 'echo hi');
        insertInto(input, 'é');
        typeCharacter(input, 'b');
        expect(feed.typed()).toEqual([]);
        await settle();
        expect(feed.typed()).toEqual(['a', 'echo hi', 'é', 'b']);
        close();
      });

      it('drops the emulator\'s answers for the replay alone: the answer to a query in the output that is live after it is sent to the shell', async () => {
        const { feed, frames, input, close } = await begin(`old${QUERY}`);
        typeCharacter(input, 'a');
        await settle();
        expect(feed.typed()).toEqual(['a']);
        feed.push(`live${QUERY}`);
        runAll(frames);
        await settle();
        expect(feed.typed()).toHaveLength(2);
        expect(feed.typed()[1]).toMatch(/^\u001b\[\d+;\d+R$/);
        close();
      });
    });
  });

  it('finds a line the replay wrote: the replayed scrollback is the emulator\'s own buffer, so a find over a terminal that came back after a reload counts and selects what the host kept', async () => {
    const kept = `${Array.from({ length: 60 }, (_, line) => `row ${String(line)}${line === 7 || line === 41 ? ' needle' : ''}\r\n`).join('')}$ `;
    const host = document.createElement('div');
    document.body.append(host);
    const { screen, terminal } = await showOver(reattachedFeed(replayOf(kept)), host);
    const finder = await screen.find();
    const states: FindState[] = [];
    finder?.onChange((state) => {
      states.push(state);
    });
    finder?.next('needle', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 2, capped: false });
    expect(terminal.getSelection()).toBe('needle');
    finder?.next('needle', OPTS);
    expect(states.at(-1)).toEqual({ index: 1, count: 2, capped: false });
    screen.dispose();
    host.remove();
  });

  // Escape with the find bar open (T3a), over the real emulator and a real event on its input: when the bar takes the key the emulator does not send it to the shell, and the event goes no further (the window's region keys, which
  // would move the focus to the page, do not see it). When the bar does not take it Escape is the shell's, as it always was: the emulator sends it, and stops the event itself.
  describe('Escape with the find bar open', () => {
    async function withBar(takes: boolean) {
      const host = document.createElement('div');
      document.body.append(host);
      const feed = fakeTerminalFeed();
      const { screen, terminal } = await showOver(feed, host, undefined, { onFindClose: () => takes });
      const seen: KeyboardEvent[] = [];
      const regions = (event: KeyboardEvent): void => {
        seen.push(event);
      };

      document.addEventListener('keydown', regions);
      return {
        feed,
        input: inputOf(terminal),
        seen,
        close: () => {
          document.removeEventListener('keydown', regions);
          screen.dispose();
          host.remove();
        },
      };
    }

    const escape = (): KeyboardEvent => new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true, cancelable: true });

    it('does not send Escape to the shell when the bar takes it, and the event goes no further than the emulator\'s input', async () => {
      const { feed, input, seen, close } = await withBar(true);
      const event = escape();
      input.dispatchEvent(event);
      expect(feed.typed()).toEqual([]);
      expect(event.defaultPrevented).toBe(true);
      expect(seen).toEqual([]);
      close();
    });

    it('sends Escape to the shell when the bar does not take it, as it always did: the emulator sends it, and stops the event itself', async () => {
      const { feed, input, seen, close } = await withBar(false);
      const event = escape();
      input.dispatchEvent(event);
      expect(feed.typed()).toEqual(['\u001b']);
      expect(event.defaultPrevented).toBe(true);
      expect(seen).toEqual([]);
      close();
    });

    it('sends the Escape of a key that is held with a modifier to the shell, whatever the bar says: Shift Escape is not the bar\'s', async () => {
      const { feed, input, close } = await withBar(true);
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, shiftKey: true, bubbles: true, cancelable: true }));
      expect(feed.typed()).toEqual(['\u001b']);
      close();
    });
  });

  // A terminal whose input is off (its shell ended, or it never started) has nothing to type in, yet xterm 6.0.0 takes the Tab that reaches its input and cancels it: the browser never moves the focus, so the focus stays in
  // the emulator for every Tab that follows, and the controls of the lane after the screen are out of reach (WCAG 2.1.1, a keyboard trap). The screen's key handler gives Tab to the browser then. The keys are sent to the
  // emulator's own input, as a browser sends them: what the emulator cancels is what the browser does not act on, and user-event does what a browser does with the Tab that is left (it moves the focus).
  describe('the Tab of a real emulator\'s input', () => {
    /** The screen over the real emulator opened in the document, with a control before it (the panel's tools) and one after it (the lane's), and a way to take it all away. */
    async function opened(feed: FakeTerminalFeed) {
      const before = document.createElement('button');
      const host = document.createElement('div');
      const after = document.createElement('button');
      document.body.append(before, host, after);
      const { screen, terminal } = await showOver(feed, host);
      return {
        input: inputOf(terminal),
        before,
        after,
        close: () => {
          screen.dispose();
          before.remove();
          host.remove();
          after.remove();
        },
      };
    }

    /** What a Tab is pressed with: Shift, Option (which is how Safari reaches a button, as it leaves them out of the Tab order), both, or nothing. */
    type TabKeys = { readonly shiftKey?: boolean; readonly altKey?: boolean };
    const TABS: readonly TabKeys[] = [{}, { shiftKey: true }, { altKey: true }, { altKey: true, shiftKey: true }];

    /** A Tab sent to the emulator's input, and whether the emulator cancelled it: the browser does nothing with a key the emulator cancelled, and the focus stays. */
    const cancelled = (input: HTMLElement, keys: TabKeys = {}): boolean => {
      const event = new KeyboardEvent('keydown', { key: 'Tab', code: 'Tab', keyCode: 9, ...keys, bubbles: true, cancelable: true });
      input.dispatchEvent(event);
      return event.defaultPrevented;
    };

    it('is the premise: a real emulator whose input is off still cancels the Tab that reaches its input, and sends nothing (xterm 6.0.0: if this goes red, the screen no longer needs to give the key away)', () => {
      const host = document.createElement('div');
      document.body.append(host);
      const terminal = new Terminal({ allowProposedApi: true, disableStdin: true });
      const sent: string[] = [];
      terminal.onData((data) => {
        sent.push(data);
      });
      terminal.open(host);
      expect(cancelled(inputOf(terminal))).toBe(true);
      expect(sent).toEqual([]);
      terminal.dispose();
      host.remove();
    });

    it('cancels the Tab and the Shift Tab of a terminal that runs, with Option or without, and sends them to the shell: they are its own (completion)', async () => {
      const feed = fakeTerminalFeed();
      const { input, close } = await opened(feed);
      for (const keys of TABS) {
        expect(cancelled(input, keys)).toBe(true);
      }

      expect(feed.typed()).toEqual(['\t', '\u001b[Z', '\t', '\u001b[Z']);
      close();
    });

    it.each([
      ['has ended', { state: 'ended' }],
      ['has ended with an exit', { state: 'ended', exit: { code: 0 } }],
      ['has failed', { state: 'failed', cause: { stage: 'session', message: 'x' } }],
    ] as const)('does not cancel the Tab and the Shift Tab of a session that %s, with Option or without, and sends nothing: the keys are the browser\'s, which moves the focus on', async (_name, patch) => {
      const feed = fakeTerminalFeed();
      const { input, close } = await opened(feed);
      feed.set(patch);
      await settle();
      for (const keys of TABS) {
        expect(cancelled(input, keys)).toBe(false);
      }

      expect(feed.typed()).toEqual([]);
      close();
    });

    it('moves the focus out of the emulator\'s input to the control after the screen with Tab or Option Tab, and to the one before it with Shift Tab, once the session has ended, and keeps it in the input while the session runs: the lane\'s Take it back can be reached', async () => {
      const user = userEvent.setup({ delay: null });
      const feed = fakeTerminalFeed();
      const { input, before, after, close } = await opened(feed);
      // user-event's key events have no `keyCode`, which every browser sends and the emulator reads to know a Tab: a listener that runs before the emulator's gives it.
      const giveKeyCode = (event: KeyboardEvent): void => {
        if (event.key === 'Tab') {
          Object.defineProperty(event, 'keyCode', { value: 9 });
        }
      };

      document.addEventListener('keydown', giveKeyCode, true);
      try {
        input.focus();
        await user.tab();
        expect(input).toHaveFocus();
        await user.tab({ shift: true });
        expect(input).toHaveFocus();
        await user.keyboard('{Alt>}{Tab}{/Alt}');
        expect(input).toHaveFocus();
        feed.set({ state: 'ended' });
        await settle();
        await user.tab();
        expect(after).toHaveFocus();
        input.focus();
        await user.tab({ shift: true });
        expect(before).toHaveFocus();
        input.focus();
        await user.keyboard('{Alt>}{Tab}{/Alt}');
        expect(after).toHaveFocus();
      } finally {
        document.removeEventListener('keydown', giveKeyCode, true);
        close();
      }
    });
  });

  // Review of #791: the separator a restart writes between the ended process and the new shell, on the real emulator. DECSTR resets the saved cursor and `?1049l` restores it, which homed the cursor and wrote over the transcript.
  describe('what the real emulator answers across a restart (review of #791)', () => {
    /** Runs the frames the screen asked for, one round. */
    const runFrames = (frames: Array<() => void>): void => {
      for (const callback of frames.splice(0)) {
        callback();
      }
    };

    it('answers a cursor position query of the NEW feed\'s output to the new feed while the old feed\'s bytes are still queued in the emulator: the muting ends at the barrier after the old writes, not when nothing is pending', async () => {
      const frames: Array<() => void> = [];
      const feed = fakeTerminalFeed();
      const { screen, terminal } = await showOver(feed, undefined, frames);
      feed.push(`old output\r\n${'x'.repeat(2_000)}\r\n`);
      runFrames(frames);
      feed.set({ state: 'ended', exit: { code: 0 } });
      const next = fakeTerminalFeed({ state: 'starting' });
      // No timer has run: the emulator has parsed none of what it was written, and the new feed's query is queued behind it.
      screen.continueWith(next);
      next.set({ state: 'running' });
      next.push('\u001b[6n');
      runFrames(frames);
      await settle();
      expect(next.replies().join('')).toMatch(/^\u001b\[\d+;\d+R$/);
      expect(feed.replies(), 'nothing the old bytes drew is sent to the ended feed').toEqual([]);
      expect(terminal.buffer.active.type).toBe('normal');
    });

    it('does not send to the new feed what the OLD feed\'s queued bytes make the emulator answer (a query that was in them)', async () => {
      const frames: Array<() => void> = [];
      const feed = fakeTerminalFeed();
      const { screen } = await showOver(feed, undefined, frames);
      feed.push('\u001b[6n');
      runFrames(frames);
      feed.set({ state: 'ended', exit: { code: 0 } });
      const next = fakeTerminalFeed({ state: 'starting' });
      screen.continueWith(next);
      next.set({ state: 'running' });
      await settle();
      expect(next.replies()).toEqual([]);
    });
  });

  describe('an old multi-line command after a restart, on the real emulator with bracketed paste off (review of #791)', () => {
    it('types nothing into the new shell: the emulator\'s paste turns the line feed into a carriage return, which would run the first line', async () => {
      const at = (kind: TerminalMark['kind'], extra: Partial<TerminalMark>, offset: number) => ({ mark: { kind, at: 0, end: 1, trust: 'unverified' as const, ...extra }, at: offset });
      const host = document.createElement('div');
      document.body.append(host);
      const feed = fakeTerminalFeed();
      const { screen, terminal } = await showOver(feed, host);
      feed.push('$ a\r\n', [at('prompt-start', { id: 'c1' }, 0), at('input-start', { id: 'c1' }, 2), at('command-start', { id: 'c1', trust: 'nonce', command: 'touch /tmp/x\necho b' }, 5), at('command-end', { id: 'c1', exit: 0, durationMs: 5 }, 5)]);
      await settle();
      feed.set({ state: 'ended', exit: { code: 0 } });
      await settle();
      const next = fakeTerminalFeed({ state: 'starting' });
      screen.continueWith(next);
      next.set({ state: 'running' });
      next.push('$ ');
      await settle();
      expect(terminal.modes.bracketedPasteMode).toBe(false);
      screen.commands.rerun();
      await settle();
      expect(next.typed()).toEqual([]);
      host.remove();
    });
  });

  describe('two restarts before the middle feed\'s bytes are parsed, on the real emulator (review of #791)', () => {
    it('sends nothing the middle feed\'s queued bytes make the emulator answer to the third feed: only the barrier of the LAST restart ends the muting', async () => {
      const frames: Array<() => void> = [];
      const feed = fakeTerminalFeed();
      const { screen } = await showOver(feed, undefined, frames);
      const run = (): void => {
        for (const callback of frames.splice(0)) {
          callback();
        }
      };

      feed.set({ state: 'ended', exit: { code: 0 } });
      const second = fakeTerminalFeed({ state: 'running' });
      screen.continueWith(second);
      second.push(`\u001b[6n\u001b[5n${'y'.repeat(2_000)}`);
      run();
      second.set({ state: 'ended', exit: { code: 0 } });
      const third = fakeTerminalFeed({ state: 'running' });
      screen.continueWith(third);
      await settle();
      expect(second.replies(), 'the middle feed ended').toEqual([]);
      expect(third.replies(), 'what the middle feed\'s bytes drew is not for the third shell').toEqual([]);
      // The third feed's own query is answered to it: the muting ended at the barrier of the last restart, and is not on for ever.
      third.push('\u001b[6n');
      run();
      await settle();
      expect(third.replies().join(''), 'the third feed\'s own cursor position query is answered').toMatch(/^\u001b\[\d+;\d+R$/);
    });
  });

  describe('the separator of a restart, on the real emulator', () => {
    const rows = (terminal: Terminal): string[] => Array.from({ length: terminal.buffer.normal.length }, (_, index) => terminal.buffer.normal.getLine(index)?.translateToString(true) ?? '');

    async function restarted(program: string): Promise<{ readonly terminal: Terminal; readonly next: FakeTerminalFeed }> {
      const feed = fakeTerminalFeed();
      const { screen, terminal } = await showOver(feed);
      feed.push(`transcript one\r\ntranscript two\r\n$ ${program}`);
      await settle();
      feed.set({ state: 'ended', exit: { signal: 'SIGKILL' } });
      await settle();
      const next = fakeTerminalFeed({ state: 'starting' });
      screen.continueWith(next);
      next.set({ state: 'running' });
      next.push('$ new');
      await settle();
      return { terminal, next };
    }

    const expectKept = (terminal: Terminal): void => {
      expect(terminal.buffer.active.type).toBe('normal');
      const lines = rows(terminal).filter((line) => line !== '');
      const at = (text: string): number => lines.findIndex((line) => line.includes(text));
      expect(at('transcript one')).toBe(0);
      expect(at('transcript two')).toBe(1);
      expect(at('[Restarted]')).toBeGreaterThan(at('transcript two'));
      expect(at('$ new')).toBe(at('[Restarted]') + 1);
      expect(terminal.modes).toMatchObject({ mouseTrackingMode: 'none', bracketedPasteMode: false, sendFocusMode: false, applicationCursorKeysMode: false });
    };

    it('keeps the transcript above, the prompt after [Restarted] and every mode off, for vim killed on the alternate screen with the mouse on', async () => {
      const { terminal } = await restarted('vim\r\n\u001b[?1049h\u001b[?1000h\u001b[?1002h\u001b[?1006h\u001b[?2004h\u001b[?1h\u001b[?1004hvim screen');
      expectKept(terminal);
    });

    it('keeps it for a program with the any-motion mouse on, on the normal screen', async () => {
      const { terminal } = await restarted('top\r\n\u001b[?1003h\u001b[?1015h');
      expectKept(terminal);
    });

    it('keeps it for a program that set a scroll region (3;6), and the region is reset: a line feed at its last row moves the cursor on', async () => {
      const { terminal, next } = await restarted('less\r\n\u001b[3;6r\u001b[10;1H');
      expectKept(terminal);
      next.push('\u001b[6;1H\n');
      await settle();
      expect(terminal.buffer.normal.cursorY).toBeGreaterThanOrEqual(6);
    });
  });
});

// Who sends what a real emulator sends toward the shell (T2d fix round). xterm has one event for all it says to the shell, and the screen must tell what the person did (typed, pasted, composed: kept while a replay is
// applied) from what the emulator says by itself (the answers to the queries it parses, the report of its focus: dropped). The engine says which, by the event at the emulator's input that is under way when it sends. Over the
// real emulator, with the events a browser sends to its input; the emulator's timers are the test's.
describe('who sends what a real emulator sends toward the shell: the person, or the emulator itself', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    made.length = 0;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const QUERY = '\u001b[6n';

  /** An emulator opened in the document, and everything it sends to its listener, with who it says sent it. */
  function opened() {
    const host = document.createElement('div');
    document.body.append(host);
    const engine = createXtermEngine({ cols: 80, rows: 24, scrollback: 100, appearance: APPEARANCE, screenReaderMode: false });
    engine.open(host);
    const terminal = made.at(-1);
    if (terminal === undefined) {
      throw new Error('the engine made no emulator');
    }

    const sent: Array<readonly [data: string, user: boolean]> = [];
    engine.onData((data, user) => {
      sent.push([data, user]);
    });
    return { engine, input: inputOf(terminal), sent, close: () => {
      engine.dispose();
      host.remove();
    } };
  }

  it('says the person typed a lower-case letter, and Enter: the emulator sends them from the keydown, inside the event that carried them', () => {
    const { input, sent, close } = opened();
    typeCharacter(input, 'l');
    pressEnter(input);
    expect(sent).toEqual([['l', true], ['\r', true]]);
    close();
  });

  it('says the person typed an upper-case letter, which the emulator takes from the keypress that follows a keydown it left alone', () => {
    const { input, sent, close } = opened();
    typeCharacter(input, 'L');
    expect(sent).toEqual([['L', true]]);
    close();
  });

  it('says the person pasted: the text is the pasted text, whatever it looks like', () => {
    const { input, sent, close } = opened();
    pasteInto(input, `echo hi\n${QUERY}`);
    expect(sent).toEqual([[`echo hi\r${QUERY}`, true]]);
    close();
  });

  it('says the person typed what a keyboard or an input method inserted without a key (an input event)', () => {
    const { input, sent, close } = opened();
    insertInto(input, 'é');
    expect(sent).toEqual([['é', true]]);
    close();
  });

  it('says the person typed the text an input method was composing when the key that ends the composition is pressed: it is sent inside the keydown of that key, before the key itself', async () => {
    const { input, sent, close } = opened();
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = 'あ';
    input.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'あ', bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    pressEnter(input);
    expect(sent).toEqual([['あ', true], ['\r', true]]);
    close();
  });

  it('says the person typed the text an input method commits when the composition ends, though the emulator sends it from a timer of its own, outside any event: and the answer to a query that is parsed after it is not', async () => {
    const { engine, input, sent, close } = opened();
    input.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    input.value = 'あ';
    input.dispatchEvent(new CompositionEvent('compositionupdate', { data: 'あ', bubbles: true }));
    await vi.advanceTimersByTimeAsync(0);
    input.dispatchEvent(new CompositionEvent('compositionend', { data: 'あ', bubbles: true }));
    expect(sent).toEqual([]);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([['あ', true]]);
    engine.write(QUERY);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.[1]).toBe(false);
    close();
  });

  it('says the emulator itself sent the answers to the queries it parses: the position of the cursor and the kind of terminal are not the person\'s', async () => {
    const { engine, sent, close } = opened();
    engine.write(`${QUERY}\u001b[c`);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(2);
    expect(sent.map(([, user]) => user)).toEqual([false, false]);
    expect(sent[0]?.[0]).toMatch(/^\u001b\[\d+;\d+R$/);
    close();
  });

  it('says the emulator itself sent the report of its focus: when its mode is switched on, and when the input is focused with the mode on, which is an event that is not the person\'s typing', async () => {
    const { engine, input, sent, close } = opened();
    engine.write('\u001b[?1004h');
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toEqual([['\u001b[O', false]]);
    input.focus();
    expect(sent).toEqual([['\u001b[O', false], ['\u001b[I', false]]);
    close();
  });

  it('tells them apart by what causes them, and not by the order they come in: a key typed while the emulator holds a query it has not parsed is the person\'s, and the answer it sends when it parses the query is not', async () => {
    const { engine, input, sent, close } = opened();
    engine.write(QUERY);
    typeCharacter(input, 'a');
    expect(sent).toEqual([['a', true]]);
    await vi.advanceTimersByTimeAsync(0);
    expect(sent).toHaveLength(2);
    expect(sent[1]?.[1]).toBe(false);
    expect(sent[1]?.[0]).toMatch(/^\u001b\[\d+;\d+R$/);
    close();
  });
});

/** An engine over the real emulator, opened in the document, with a way to write to it that answers when the emulator has parsed what it was given. `findLimit` is the most matches a find counts. */
function emulator(findLimit?: number) {
  const host = document.createElement('div');
  document.body.append(host);
  const engine = createXtermEngine({ cols: 80, rows: 24, scrollback: 100, appearance: APPEARANCE, screenReaderMode: false, findLimit });
  engine.open(host);
  const terminal = made.at(-1);
  if (terminal === undefined) {
    throw new Error('the engine made no emulator');
  }

  return {
    engine,
    terminal,
    host,
    write: async (data: string): Promise<void> => {
      const { promise, resolve } = Promise.withResolvers<void>();
      engine.write(data, resolve);
      return promise;
    },
    close: () => {
      engine.dispose();
      host.remove();
    },
  };
}

/** The finder of an engine, and every state it tells. */
async function finding(engine: Engine): Promise<{ readonly finder: Finder; readonly states: FindState[] }> {
  const finder = await engine.find();
  const states: FindState[] = [];
  finder.onChange((state) => {
    states.push(state);
  });
  return { finder, states };
}

/**
 * The decorations an emulator is asked for, with the background each was asked to have: the colours the matches of a find are drawn in, as the emulator was given them (a decoration is drawn from them when its row is
 * rendered, which jsdom does not do). `live` is the backgrounds of those that are not disposed. It has to be put on before the find loads the addon.
 */
function drawing(terminal: Terminal): { readonly live: () => Array<string | undefined> } {
  const asked = new Map<IDecoration, string | undefined>();
  const register = terminal.registerDecoration.bind(terminal);
  terminal.registerDecoration = (options) => {
    const decoration = register(options);
    if (decoration !== undefined) {
      asked.set(decoration, options.backgroundColor);
    }

    return decoration;
  };

  return { live: () => [...asked].filter(([decoration]) => !decoration.isDisposed).map(([, colour]) => colour) };
}

// The find over a real emulator (T3a): the search addon over the buffer the emulator holds, which is the screen and the scrollback, a replayed one too. The addon draws its highlights with decorations and tells where the find
// stands only when it draws them, so every step carries decorations in the host's colours. It counts from the OLDEST line down and stops at the limit it is given: a find that has more matches than that is capped, and the
// newest are the ones that are not counted.
describe('the find of a real emulator', () => {
  beforeEach(() => {
    searched.addons.length = 0;
  });

  it('counts the matches over the screen and the scrollback and says which one the screen is on: next steps down and wraps past the last, previous steps up and wraps past the first', async () => {
    const { engine, write, close } = emulator();
    // Forty lines scroll past the 24 rows: the first of them are in the scrollback. Every line has one match, and the last has two.
    await write(`${Array.from({ length: 40 }, (_, line) => `line ${String(line)} foo\r\n`).join('')}last foo foo`);
    const { finder, states } = await finding(engine);
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 42, capped: false });
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 1, count: 42, capped: false });
    finder.previous('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 42, capped: false });
    finder.previous('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 41, count: 42, capped: false });
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 42, capped: false });
    close();
  });

  it('selects the match the screen is on, so that it can be copied and is drawn as the current one', async () => {
    const { engine, terminal, write, close } = emulator();
    await write('one needle two\r\n');
    const { finder } = await finding(engine);
    expect(engine.hasSelection()).toBe(false);
    finder.next('needle', OPTS);
    expect(engine.hasSelection()).toBe(true);
    expect(terminal.getSelection()).toBe('needle');
    close();
  });

  it('draws the highlights with decorations in the host\'s colours, and asks the addon for one match more than the limit, to know whether there are more: every step carries `#RRGGBB` colours, and a match has no border while its fill marks it', async () => {
    const { engine, write, close } = emulator();
    await write('foo\r\n');
    const { finder } = await finding(engine);
    finder.next('foo', { caseSensitive: true, regex: false, wholeWord: false });
    const [made1] = searched.addons;
    expect(made1?.options).toEqual({ highlightLimit: FIND_LIMIT + 1 });
    expect(made1?.steps).toEqual([
      {
        direction: 'next',
        term: 'foo',
        options: {
          caseSensitive: true,
          regex: false,
          wholeWord: false,
          decorations: {
            matchBackground: expect.stringMatching(HEX),
            matchOverviewRuler: expect.stringMatching(HEX),
            activeMatchBackground: expect.stringMatching(HEX),
            activeMatchBorder: expect.stringMatching(HEX),
            activeMatchColorOverviewRuler: expect.stringMatching(HEX),
          },
        },
      },
    ]);
    close();
  });

  it('is made with one match more than the limit it was given: a test (or a host) can ask for fewer than the default, and the one more tells whether the find is capped', async () => {
    const { engine, close } = emulator(7);
    await engine.find();
    expect(searched.addons[0]?.options).toEqual({ highlightLimit: 8 });
    close();
  });

  it('uses the colours of the theme it has now: a step after a new theme carries them', async () => {
    const { engine, write, close } = emulator();
    await write('foo\r\n');
    const { finder } = await finding(engine);
    finder.next('foo', OPTS);
    engine.setAppearance({ ...APPEARANCE, theme: { ...APPEARANCE.theme, background: '#ffffff', foreground: '#111111', palette: Array.from({ length: 16 }, () => '#9a6700') } });
    finder.next('foo', OPTS);
    const steps = searched.addons[0]?.steps ?? [];
    expect(steps.at(-1)?.options).not.toEqual(steps[0]?.options);
    close();
  });

  it('draws every match again in the colours of a new theme while a find is up, and keeps the current match, the selection and where the person has scrolled to: the addon draws the matches once for a query, so the others would stay in the colours of the theme before', async () => {
    const { engine, terminal, write, close } = emulator();
    const drawn = drawing(terminal);
    // Forty lines with one match on each, so that the first match is in the scrollback.
    await write(Array.from({ length: 40 }, (_, line) => `line ${String(line)} foo\r\n`).join(''));
    const { finder, states } = await finding(engine);
    finder.next('foo', OPTS);
    const before = findDecorations(APPEARANCE.theme);
    expect(drawn.live().filter((colour) => colour === before.matchBackground)).toHaveLength(40);
    expect(drawn.live().filter((colour) => colour === before.activeMatchBackground)).toHaveLength(1);
    const selection = terminal.getSelectionPosition();
    const told = states.at(-1);
    // The screen is at the end, away from the current match (the first one, in the scrollback).
    const top = terminal.buffer.active.viewportY;
    expect(top).toBeGreaterThan(0);
    // The emulator's viewport does not move under jsdom (there is no layout to scroll), so what is asked of it is recorded: the addon scrolls to a match that is out of view, and the screen is put back where it was.
    const moves: string[] = [];
    const scrollLines = terminal.scrollLines.bind(terminal);
    terminal.scrollLines = (lines) => {
      moves.push(`lines ${String(lines)}`);
      scrollLines(lines);
    };

    const scrollToLine = terminal.scrollToLine.bind(terminal);
    terminal.scrollToLine = (line) => {
      moves.push(`to ${String(line)}`);
      scrollToLine(line);
    };

    const next: EngineAppearance = { ...APPEARANCE, theme: { ...APPEARANCE.theme, background: '#ffffff', foreground: '#111111', selectionBackground: '#a0bef8', palette: Array.from({ length: 16 }, () => '#9a6700') } };
    const after = findDecorations(next.theme);
    expect(after.matchBackground).not.toBe(before.matchBackground);
    engine.setAppearance(next);
    expect(drawn.live().filter((colour) => colour === after.matchBackground)).toHaveLength(40);
    expect(drawn.live().filter((colour) => colour === after.activeMatchBackground)).toHaveLength(1);
    expect(drawn.live()).toHaveLength(41);
    expect(terminal.getSelectionPosition()).toEqual(selection);
    expect(terminal.buffer.active.viewportY).toBe(top);
    expect(moves.some((move) => move.startsWith('lines '))).toBe(true);
    expect(moves.at(-1)).toBe(`to ${String(top)}`);
    expect(states.at(-1)).toEqual(told);
    close();
  });

  it('does not draw the find again for a change that leaves its colours as they were: a new text size is not a new theme, and nothing is found again', async () => {
    const { engine, write, close } = emulator();
    await write('foo\r\n');
    const { finder } = await finding(engine);
    finder.next('foo', OPTS);
    expect(searched.addons[0]?.steps).toHaveLength(1);
    engine.setAppearance({ ...APPEARANCE, fontSize: 14, lineHeight: 1.5 });
    expect(searched.addons[0]?.steps).toHaveLength(1);
    close();
  });

  it('does not look again for a new theme when no find is up: the search code is not even loaded before one, and after a clear nothing is selected or drawn', async () => {
    const { engine, terminal, write, close } = emulator();
    const drawn = drawing(terminal);
    await write('foo\r\n');
    const next: EngineAppearance = { ...APPEARANCE, theme: { ...APPEARANCE.theme, background: '#ffffff', foreground: '#111111', palette: Array.from({ length: 16 }, () => '#9a6700') } };
    engine.setAppearance(next);
    expect(searched.addons).toHaveLength(0);
    const { finder } = await finding(engine);
    finder.next('foo', OPTS);
    finder.clear();
    engine.setAppearance(APPEARANCE);
    expect(terminal.hasSelection()).toBe(false);
    expect(drawn.live()).toEqual([]);
    close();
  });

  it('does not touch a selection the person made when a new theme comes and the query was emptied: there is no find to draw again', async () => {
    const { engine, terminal, write, close } = emulator();
    await write('foo bar\r\n');
    const { finder } = await finding(engine);
    finder.next('foo', OPTS);
    finder.next('', OPTS);
    terminal.select(4, 0, 3);
    engine.setAppearance({ ...APPEARANCE, theme: { ...APPEARANCE.theme, background: '#ffffff', foreground: '#111111', palette: Array.from({ length: 16 }, () => '#9a6700') } });
    expect(terminal.getSelection()).toBe('bar');
    close();
  });

  it('says the find is capped when there are more matches than the limit: the count is a floor then', async () => {
    const { engine, write, close } = emulator(3);
    await write('foo foo foo foo foo\r\n');
    const { finder, states } = await finding(engine);
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 3, capped: true });
    close();
  });

  it('says it is not capped when the matches are exactly the limit: nothing was left out, so the count is not a floor', async () => {
    const { engine, write, close } = emulator(3);
    await write('foo foo foo\r\n');
    const { finder, states } = await finding(engine);
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 3, capped: false });
    finder.previous('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 2, count: 3, capped: false });
    close();
  });

  it('says it is capped at one match more than the limit, and counts the limit: the match that is one more is not in the count, and the screen on it has no place in it', async () => {
    const { engine, terminal, write, close } = emulator(3);
    await write('foo 1\r\nfoo 2\r\nfoo 3\r\nfoo 4\r\n');
    const { finder, states } = await finding(engine);
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 3, capped: true });
    finder.previous('foo', OPTS);
    expect(terminal.getSelectionPosition()).toEqual({ start: { x: 0, y: 3 }, end: { x: 3, y: 3 } });
    expect(states.at(-1)).toEqual({ index: -1, count: 3, capped: true });
    close();
  });

  it('says it is not capped while the matches are fewer than the limit', async () => {
    const { engine, write, close } = emulator(3);
    await write('foo foo\r\n');
    const { finder, states } = await finding(engine);
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 2, capped: false });
    close();
  });

  it('counts from the OLDEST line: past the limit the matches nearest the bottom are the ones that are not counted, so the one the screen is on when it steps back from the end has no place in the count', async () => {
    const { engine, write, close } = emulator(3);
    await write('foo 1\r\nfoo 2\r\nfoo 3\r\nfoo 4\r\nfoo 5\r\n');
    const { finder, states } = await finding(engine);
    finder.previous('foo', OPTS);
    expect(engine.hasSelection()).toBe(true);
    expect(states.at(-1)).toEqual({ index: -1, count: 3, capped: true });
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 3, capped: true });
    close();
  });

  it('throws nothing for a regular expression that does not parse, and finds nothing: what was highlighted is gone, and a pattern that parses finds again', async () => {
    const { engine, write, close } = emulator();
    await write('foo (bar)\r\n');
    const { finder, states } = await finding(engine);
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 1, capped: false });
    expect(() => {
      finder.next('(', { ...OPTS, regex: true });
    }).not.toThrow();
    expect(states.at(-1)).toEqual({ index: -1, count: 0, capped: false });
    expect(engine.hasSelection()).toBe(false);
    expect(() => {
      finder.previous('[', { ...OPTS, regex: true });
    }).not.toThrow();
    expect(states.at(-1)).toEqual({ index: -1, count: 0, capped: false });
    finder.next('\\(bar\\)', { ...OPTS, regex: true });
    expect(states.at(-1)).toEqual({ index: 0, count: 1, capped: false });
    close();
  });

  it('says there is nothing when the query is empty: the highlights and the selection go', async () => {
    const { engine, write, close } = emulator();
    await write('foo\r\n');
    const { finder, states } = await finding(engine);
    finder.next('foo', OPTS);
    finder.next('', OPTS);
    expect(states.at(-1)).toEqual({ index: -1, count: 0, capped: false });
    expect(engine.hasSelection()).toBe(false);
    close();
  });

  it('finds whole words past a partial match in the same line, which the addon\'s own option does not: of `foobar foo xfoo (foo) foo-bar foo_x` it finds `foo`, `(foo)` and `foo-bar`, between characters that are not part of a word', async () => {
    const { engine, write, close } = emulator();
    await write('foobar foo xfoo (foo) foo-bar foo_x\r\n');
    const { finder, states } = await finding(engine);
    finder.next('foo', { ...OPTS, wholeWord: true });
    expect(states.at(-1)).toEqual({ index: 0, count: 3, capped: false });
    expect(engine.hasSelection()).toBe(true);
    finder.next('foo', { ...OPTS, wholeWord: true });
    expect(states.at(-1)).toEqual({ index: 1, count: 3, capped: false });
    close();
  });

  it('takes the query literally for a whole word that is not a regular expression, and as a pattern when it is one: `a.c` is not `abc`, and `fo+` is `foo` and `fooo` and not `xfoo`', async () => {
    const { engine, write, close } = emulator();
    await write('a.c abc foo fooo xfoo\r\n');
    const { finder, states } = await finding(engine);
    finder.next('a.c', { ...OPTS, wholeWord: true });
    expect(states.at(-1)).toEqual({ index: 0, count: 1, capped: false });
    finder.next('fo+', { ...OPTS, wholeWord: true, regex: true });
    expect(states.at(-1)?.count).toBe(2);
    close();
  });

  // The addon runs a regular expression on the line from the column it starts at (`line.slice(offset)` going forward, `line.slice(0, offset)` going back), and a whole word is a regular expression here, so the start of that cut is
  // a start of line to it and the end of that cut an end of line. A find that starts from a selection that begins or ends inside a word would then take the rest of the word for a whole word. So a selection that begins or
  // ends inside a word is let go of before a whole-word step, and the step starts from the edge of the buffer.
  describe('a whole-word find that starts from a selection', () => {
    const WHOLE = { ...OPTS, wholeWord: true } as const;

    it('does not take the rest of a word for a whole word when the same query was just found inside it: `foo` selected in `xfoo foo` is not a whole word, and neither is what is left of `xfoo` after the `x`', async () => {
      const { engine, terminal, write, close } = emulator();
      await write('xfoo foo\r\n');
      const { finder, states } = await finding(engine);
      finder.next('foo', OPTS);
      expect(terminal.getSelectionPosition()).toEqual({ start: { x: 1, y: 0 }, end: { x: 4, y: 0 } });
      expect(states.at(-1)).toEqual({ index: 0, count: 2, capped: false });
      finder.next('foo', WHOLE);
      expect(terminal.getSelectionPosition()).toEqual({ start: { x: 5, y: 0 }, end: { x: 8, y: 0 } });
      expect(states.at(-1)).toEqual({ index: 0, count: 1, capped: false });
      close();
    });

    it('does the same for a selection of the person\'s that ends inside a word, going forward: the match after `foo` of `foofoo` is not a whole word', async () => {
      const { engine, terminal, write, close } = emulator();
      await write('foofoo foo\r\n');
      const { finder, states } = await finding(engine);
      finder.next('foo', WHOLE);
      expect(terminal.getSelectionPosition()).toEqual({ start: { x: 7, y: 0 }, end: { x: 10, y: 0 } });
      terminal.select(0, 0, 3);
      finder.next('foo', WHOLE);
      expect(terminal.getSelectionPosition()).toEqual({ start: { x: 7, y: 0 }, end: { x: 10, y: 0 } });
      expect(states.at(-1)).toEqual({ index: 0, count: 1, capped: false });
      close();
    });

    it('does the same going back from a selection that begins inside a word: the match before the second `foo` of `foofoo` is not a whole word', async () => {
      const { engine, terminal, write, close } = emulator();
      await write('foofoo foo\r\n');
      const { finder, states } = await finding(engine);
      finder.next('foo', WHOLE);
      terminal.select(3, 0, 3);
      finder.previous('foo', WHOLE);
      expect(terminal.getSelectionPosition()).toEqual({ start: { x: 7, y: 0 }, end: { x: 10, y: 0 } });
      expect(states.at(-1)).toEqual({ index: 0, count: 1, capped: false });
      close();
    });

    it('follows a word that wraps onto the next row: a selection that begins inside the wrapped row of one word is inside that word, and what is left of the word after it is not a whole word', async () => {
      const { engine, terminal, write, close } = emulator();
      // 78 characters and `foofoo` wrap at the 80th column: the first row ends `fo`, and the wrapped row is `ofoo`. The selection is its last two cells, which are inside the word that began on the row above.
      await write(`${'x'.repeat(78)}foofoo\r\n`);
      const { finder, states } = await finding(engine);
      terminal.select(2, 1, 2);
      expect(terminal.getSelection()).toBe('oo');
      finder.next('oo', WHOLE);
      expect(terminal.hasSelection()).toBe(false);
      expect(states.at(-1)).toEqual({ index: -1, count: 0, capped: false });
      close();
    });

    it('follows a word that wraps onto the next row from the end of a row: a selection that ends at the last cell of a row whose word goes on in the next one ends inside that word, going back', async () => {
      const { engine, terminal, write, close } = emulator();
      // 77 characters, a space and `foo bar` wrap at the 80th column: the first row ends ` fo`, and the wrapped row is `o bar`. The selection is the `fo`, which ends at the end of the first row, inside `foo`.
      await write(`${'x'.repeat(77)} foo bar\r\n`);
      const { finder, states } = await finding(engine);
      terminal.select(78, 0, 2);
      expect(terminal.getSelection()).toBe('fo');
      finder.previous('fo', WHOLE);
      expect(terminal.hasSelection()).toBe(false);
      expect(states.at(-1)).toEqual({ index: -1, count: 0, capped: false });
      close();
    });

    it('reads a wide character as the character it is, in both of its cells: a selection that ends between the halves of `日本語日本語` and the next word is inside the word', async () => {
      const { engine, terminal, write, close } = emulator();
      await write('日本語日本語 日本語\r\n');
      const { finder, states } = await finding(engine);
      finder.next('日本語', WHOLE);
      expect(terminal.getSelectionPosition()).toEqual({ start: { x: 13, y: 0 }, end: { x: 19, y: 0 } });
      terminal.select(0, 0, 6);
      finder.next('日本語', WHOLE);
      expect(terminal.getSelectionPosition()).toEqual({ start: { x: 13, y: 0 }, end: { x: 19, y: 0 } });
      expect(states.at(-1)).toEqual({ index: 0, count: 1, capped: false });
      close();
    });

    it('keeps a selection at the edges of a word, which is where a find goes on from: `foo` after `foo` after `foo` steps on, and goes on from a selection of the person\'s that is a whole word', async () => {
      const { engine, terminal, write, close } = emulator();
      await write('foo foo foo\r\n');
      const { finder, states } = await finding(engine);
      finder.next('foo', WHOLE);
      expect(states.at(-1)).toEqual({ index: 0, count: 3, capped: false });
      finder.next('foo', WHOLE);
      expect(states.at(-1)).toEqual({ index: 1, count: 3, capped: false });
      terminal.select(4, 0, 3);
      finder.next('foo', WHOLE);
      expect(states.at(-1)).toEqual({ index: 2, count: 3, capped: false });
      finder.next('foo', WHOLE);
      expect(states.at(-1)).toEqual({ index: 0, count: 3, capped: false });
      close();
    });

    it('keeps a selection that is at the edge of a word at its start and its end when the word ends the line or is followed by empty cells: the last `foo` of a line is a whole word', async () => {
      const { engine, terminal, write, close } = emulator();
      await write('a foo\r\nfoo\r\n');
      const { finder, states } = await finding(engine);
      finder.next('foo', WHOLE);
      finder.next('foo', WHOLE);
      expect(states.at(-1)).toEqual({ index: 1, count: 2, capped: false });
      expect(terminal.getSelectionPosition()).toEqual({ start: { x: 0, y: 1 }, end: { x: 3, y: 1 } });
      close();
    });

    it('does not touch the selection when whole word is off: the incremental anchor of a plain find stays inside a word, and a longer query is found where the selection is and not before it', async () => {
      const { engine, terminal, write, close } = emulator();
      await write('foo xfoo\r\n');
      const { finder, states } = await finding(engine);
      finder.next('foo', OPTS);
      finder.next('foo', OPTS);
      expect(terminal.getSelectionPosition()).toEqual({ start: { x: 5, y: 0 }, end: { x: 8, y: 0 } });
      finder.next('fo', OPTS);
      expect(terminal.getSelectionPosition()).toEqual({ start: { x: 5, y: 0 }, end: { x: 7, y: 0 } });
      expect(states.at(-1)).toEqual({ index: 1, count: 2, capped: false });
      close();
    });
  });

  it.each([
    ['the case', 'Foo foo FOO', 'foo', { ...OPTS, caseSensitive: true }, 3, 1],
    ['whole words', 'foobar foo xfoo', 'foo', { ...OPTS, wholeWord: true }, 3, 1],
    ['a regular expression', 'a.c abc', 'a.c', { ...OPTS, regex: true }, 1, 2],
  ] as const)('counts again when the person changes %s and the query is the same: the addon alone would keep the count of the options before', async (_name, text, query, changed, before, after) => {
    const { engine, write, close } = emulator();
    await write(`${text}\r\n`);
    const { finder, states } = await finding(engine);
    finder.next(query, OPTS);
    expect(states.at(-1)?.count).toBe(before);
    finder.next(query, changed);
    expect(states.at(-1)?.count).toBe(after);
    finder.next(query, OPTS);
    expect(states.at(-1)?.count).toBe(before);
    close();
  });

  it('is incremental while a query is typed: the match the screen is on stays while the query grows and still matches there, and the same query again steps on', async () => {
    const { engine, write, close } = emulator();
    await write('xx foo\r\nfoo\r\n');
    const { finder, states } = await finding(engine);
    finder.next('f', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 2, capped: false });
    finder.next('fo', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 2, capped: false });
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 2, capped: false });
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 1, count: 2, capped: false });
    close();
  });

  it('clears the highlights and the selection, and tells there is nothing: the next find draws them again', async () => {
    const { engine, write, close } = emulator();
    await write('foo\r\n');
    const { finder, states } = await finding(engine);
    finder.next('foo', OPTS);
    expect(engine.hasSelection()).toBe(true);
    finder.clear();
    expect(engine.hasSelection()).toBe(false);
    expect(states.at(-1)).toEqual({ index: -1, count: 0, capped: false });
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 1, capped: false });
    close();
  });

  it('stops telling a listener that stopped it, and tells each of the others', async () => {
    const { engine, write, close } = emulator();
    await write('foo\r\n');
    const finder = await engine.find();
    const heard: string[] = [];
    const stop = finder.onChange(() => {
      heard.push('first');
    });
    finder.onChange(() => {
      heard.push('second');
    });
    finder.next('foo', OPTS);
    stop();
    finder.next('foo', OPTS);
    expect(heard).toEqual(['first', 'second', 'second']);
    close();
  });

  it('counts again when output arrives while a find is up: the addon looks again a moment after the last write, and the new count is told', async () => {
    const { engine, write, close } = emulator();
    await write('foo one\r\n');
    const { finder, states } = await finding(engine);
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 1, capped: false });
    vi.useFakeTimers();
    try {
      engine.write('foo two\r\n');
      await vi.advanceTimersByTimeAsync(500);
      expect(states.at(-1)?.count).toBe(2);
    } finally {
      vi.useRealTimers();
    }

    close();
  });

  // The addon looks again 200 ms after the last write, from a timer of its own that only its disposal cancels. A find that was cleared while that timer was waiting has no term when it runs, and the addon then clears the
  // selection: the one the person has made in the terminal since.
  it('does not let a refresh that was waiting when the find was cleared run after it: the selection the person made since is kept, and nothing is told', async () => {
    const { engine, terminal, write, close } = emulator();
    await write('foo one\r\nbar two\r\n');
    const { finder, states } = await finding(engine);
    finder.next('foo', OPTS);
    vi.useFakeTimers();
    try {
      engine.write('more output\r\n');
      // The emulator parses it on a timer of its own, and the addon sets its refresh when it has: 200 ms from then.
      await vi.advanceTimersByTimeAsync(50);
      finder.clear();
      terminal.select(0, 1, 3);
      const told = states.length;
      await vi.advanceTimersByTimeAsync(500);
      expect(terminal.getSelection()).toBe('bar');
      expect(states).toHaveLength(told);
    } finally {
      vi.useRealTimers();
    }

    close();
  });

  it('does not let a refresh that was waiting when a pattern that does not parse took the find down run after it either: the selection the person made since is kept', async () => {
    const { engine, terminal, write, close } = emulator();
    await write('foo one\r\nbar two\r\n');
    const { finder, states } = await finding(engine);
    finder.next('foo', OPTS);
    vi.useFakeTimers();
    try {
      engine.write('more output\r\n');
      await vi.advanceTimersByTimeAsync(50);
      finder.next('(', { ...OPTS, regex: true });
      terminal.select(0, 1, 3);
      const told = states.length;
      await vi.advanceTimersByTimeAsync(500);
      expect(terminal.getSelection()).toBe('bar');
      expect(states).toHaveLength(told);
    } finally {
      vi.useRealTimers();
    }

    close();
  });

  it('keeps the refresh of a find that is up while a clear has no say: output after a clear and a new find is counted again as before, and each step is told once', async () => {
    const { engine, write, close } = emulator();
    await write('foo one\r\n');
    const { finder, states } = await finding(engine);
    finder.next('foo', OPTS);
    finder.clear();
    finder.next('foo', OPTS);
    const told = states.length;
    finder.next('foo', OPTS);
    expect(states).toHaveLength(told + 1);
    vi.useFakeTimers();
    try {
      engine.write('foo two\r\n');
      await vi.advanceTimersByTimeAsync(500);
      expect(states.at(-1)?.count).toBe(2);
    } finally {
      vi.useRealTimers();
    }

    close();
  });

  it('answers a finder that finds nothing when the code of the search cannot be loaded: it never rejects, and a step of it throws nothing', async () => {
    vi.resetModules();
    vi.doMock('@xterm/addon-search', () => {
      throw new Error('the chunk did not load');
    });
    try {
      // A dynamic import, because the engine's module must be evaluated again with the search code failing to load, which the one imported above cannot be.
      const { createXtermEngine: createFresh } = await import('./xtermEngine');
      const host = document.createElement('div');
      document.body.append(host);
      const engine = createFresh({ cols: 80, rows: 24, scrollback: 100, appearance: APPEARANCE, screenReaderMode: false });
      engine.open(host);
      const { finder, states } = await finding(engine);
      expect(() => {
        finder.next('foo', OPTS);
        finder.previous('foo', OPTS);
        finder.clear();
      }).not.toThrow();
      expect(states).toEqual([]);
      engine.dispose();
      host.remove();
    } finally {
      vi.doUnmock('@xterm/addon-search');
      vi.resetModules();
    }
  });

  it('answers a finder that finds nothing for an emulator that is gone: it never rejects', async () => {
    const { engine, close } = emulator();
    close();
    const { finder, states } = await finding(engine);
    expect(() => {
      finder.next('foo', OPTS);
    }).not.toThrow();
    expect(states).toEqual([]);
  });

  it('throws nothing when a finder that was made is used after the emulator is gone: a step finds nothing and never reads the emulator, and a clear makes no new addon for a terminal that is not there', async () => {
    const { engine, terminal, close } = emulator();
    const { finder, states } = await finding(engine);
    close();
    const read = vi.spyOn(terminal, 'buffer', 'get');
    const loaded = vi.spyOn(terminal, 'loadAddon');
    expect(() => {
      finder.next('foo', OPTS);
      finder.previous('foo', OPTS);
      finder.clear();
    }).not.toThrow();
    expect(states.at(-1)).toEqual({ index: -1, count: 0, capped: false });
    expect(loaded).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });

  it('finds on the alternate screen of a full-screen program too, and only there while it is up: it counts and selects what is on that screen, and the current match has its place in the count', async () => {
    const { engine, terminal, write, close } = emulator();
    await write('normal screen foo\r\n');
    await write('\u001b[?1049h\u001b[Halternate foo\u001b[2;1Hand another foo');
    expect(terminal.buffer.active.type).toBe('alternate');
    const { finder, states } = await finding(engine);
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 0, count: 2, capped: false });
    expect(terminal.getSelection()).toBe('foo');
    finder.next('foo', OPTS);
    expect(states.at(-1)).toEqual({ index: 1, count: 2, capped: false });
    close();
  });
});

// The mouse, a paste, the attributes of the input and the links of a real emulator (T3a).
describe('the mouse of a real emulator', () => {
  it.each([
    ['1000', 'the press and release of a button'],
    ['1002', 'a button and the motion while it is held'],
    ['1003', 'all the motion'],
    ['9', 'the old X10 presses'],
  ] as const)('is reported while the program asked for %s (%s), and not before or after', async (mode, _what) => {
    const { engine, write, close } = emulator();
    expect(engine.mouseReporting()).toBe(false);
    await write(`\u001b[?${mode}h`);
    expect(engine.mouseReporting()).toBe(true);
    await write(`\u001b[?${mode}l`);
    expect(engine.mouseReporting()).toBe(false);
    close();
  });
});

describe('a paste into a real emulator', () => {
  it('is the person\'s own input, with the line breaks as carriage returns: it reaches the listeners as typed', async () => {
    const { engine, close } = emulator();
    const sent: Array<readonly [string, boolean]> = [];
    engine.onData((data, user) => {
      sent.push([data, user]);
    });
    engine.paste('one\ntwo\r\nthree');
    expect(sent).toEqual([['one\rtwo\rthree', true]]);
    close();
  });

  it('is between the markers of bracketed paste when the program asked for them: a multi-line text is one paste the program can tell from typing', async () => {
    const { engine, write, close } = emulator();
    const sent: Array<readonly [string, boolean]> = [];
    engine.onData((data, user) => {
      sent.push([data, user]);
    });
    await write('\u001b[?2004h');
    engine.paste('first\nsecond');
    expect(sent).toEqual([['\u001b[200~first\rsecond\u001b[201~', true]]);
    await write('\u001b[?2004l');
    engine.paste('first\nsecond');
    expect(sent.at(-1)).toEqual(['first\rsecond', true]);
    close();
  });
});

describe('onBinary of a real emulator (#698 item 14)', () => {
  it('gives the six raw bytes of a legacy X10 mouse report whole: ESC [ M and three bytes, the coordinates above 127 intact and not UTF-8', async () => {
    const { engine, terminal, write, close } = emulator();
    const sent: number[][] = [];
    const text: string[] = [];
    engine.onBinary((bytes) => {
      sent.push([...bytes]);
    });
    engine.onData((data) => {
      text.push(data);
    });
    engine.resize(200, 24);
    await write('\u001b[?9h');
    // A press of the left button at column 150 (0-based 149), row 5: X10 sends the button and the 1-based cell, each plus 32, so column 150 is 182, above 127.
    const core = (terminal as unknown as { _core: { coreMouseService: { triggerMouseEvent: (event: unknown) => boolean } } })._core;
    const taken = core.coreMouseService.triggerMouseEvent({ col: 149, row: 4, x: 0, y: 0, button: 0, action: 1, ctrl: false, alt: false, shift: false });
    expect(taken).toBe(true);
    expect(sent).toEqual([[0x1b, 0x5b, 0x4d, 0x20, 32 + 150, 32 + 5]]);
    expect(text).toEqual([]);
    close();
  });
});

describe('one paste path into a real emulator (#698 item 13)', () => {
  const HOSTILE = 'a\u001b[201~rm -rf x\r';
  const BRACKETED = '\u001b[200~a[201~rm -rf x\r\u001b[201~';

  function pasting() {
    const { engine, terminal, write, close } = emulator();
    const sent: Array<readonly [string, boolean]> = [];
    engine.onData((data, user) => {
      sent.push([data, user]);
    });
    return { engine, input: inputOf(terminal), write, sent, close };
  }

  it('cannot end the bracket from inside the text: ESC, ETX and C1 0x9b are gone and the whole text is inside one bracket', async () => {
    const { input, write, sent, close } = pasting();
    await write('\u001b[?2004h');
    pasteInto(input, HOSTILE);
    expect(sent).toEqual([[BRACKETED, true]]);
    pasteInto(input, 'x\u0003y\u009bz');
    expect(sent.at(-1)).toEqual(['\u001b[200~xyz\u001b[201~', true]);
    close();
  });

  it('gives the same bytes for the menu\'s paste and the chord\'s paste event', async () => {
    const { engine, input, write, sent, close } = pasting();
    await write('\u001b[?2004h');
    engine.paste(HOSTILE);
    pasteInto(input, HOSTILE);
    expect(sent).toEqual([[BRACKETED, true], [BRACKETED, true]]);
    close();
  });

  it('is one write for one paste event, with the line endings as xterm makes them', async () => {
    const { input, write, sent, close } = pasting();
    pasteInto(input, 'one\ntwo\r\nthree');
    expect(sent).toEqual([['one\rtwo\rthree', true]]);
    await write('\u001b[?2004h');
    pasteInto(input, 'one\ntwo\n');
    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(['\u001b[200~one\rtwo\r\u001b[201~', true]);
    close();
  });

  it('leaves the text alone when the program did not ask for brackets: nothing can end a bracket that is not there', () => {
    const { input, sent, close } = pasting();
    pasteInto(input, 'a\u001b[201~b');
    expect(sent).toEqual([['a\u001b[201~b', true]]);
    close();
  });
});

describe('the input of a real emulator', () => {
  it('has the attributes the host gives it, and only those: a call replaces what an earlier call set, and the emulator\'s own attributes stay', () => {
    const { engine, terminal, close } = emulator();
    const input = inputOf(terminal);
    const own = input.getAttribute('aria-multiline');
    expect(own).not.toBeNull();
    engine.decorateInput({ 'data-ov-menu': 'menu-1', 'data-ov-menu-mode': 'context', 'data-ov-menu-key': 'terminal' });
    expect(input.getAttribute('data-ov-menu')).toBe('menu-1');
    expect(input.getAttribute('data-ov-menu-mode')).toBe('context');
    expect(input.getAttribute('data-ov-menu-key')).toBe('terminal');
    engine.decorateInput({ 'data-ov-menu': 'menu-2' });
    expect(input.getAttribute('data-ov-menu')).toBe('menu-2');
    expect(input.hasAttribute('data-ov-menu-mode')).toBe(false);
    expect(input.hasAttribute('data-ov-menu-key')).toBe(false);
    engine.decorateInput({});
    expect(input.hasAttribute('data-ov-menu')).toBe(false);
    expect(input.getAttribute('aria-multiline')).toBe(own);
    close();
  });

  it('has them from the moment it exists when they were asked for before the emulator was opened', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const engine = createXtermEngine({ cols: 80, rows: 24, scrollback: 100, appearance: APPEARANCE, screenReaderMode: false });
    engine.decorateInput({ 'data-ov-menu': 'menu-1' });
    engine.open(host);
    const terminal = made.at(-1);
    expect(terminal === undefined ? undefined : inputOf(terminal).getAttribute('data-ov-menu')).toBe('menu-1');
    engine.dispose();
    host.remove();
  });
});

describe('the links of a real emulator', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** What a handler for links hears, and the handler. */
  function listening() {
    const hovers: Array<LinkHover | undefined> = [];
    const clicks: Array<readonly [string, MouseEvent]> = [];
    const handler: LinkHandler = {
      activate: (uri, event) => {
        clicks.push([uri, event]);
      },
      hover: (hover) => {
        hovers.push(hover);
      },
    };
    return { handler, hovers, clicks };
  }

  /** The size of a cell in pixels, as the screen element's rectangle gives it: 800 by 480 for 80 by 24 cells. */
  const CELL = { width: 10, height: 20 } as const;

  /** A member of something the emulator keeps, or nothing: what a pointer is measured by is in private members that its public interface does not give. */
  const privately = (owner: unknown, name: string): unknown => (typeof owner === 'object' && owner !== null ? Reflect.get(owner, name) : undefined);

  /** Gives the size of a cell to a member of the emulator that holds one, or fails in words when the emulator keeps it elsewhere now. */
  const sized = (holder: unknown, where: string): void => {
    if (typeof holder !== 'object' || holder === null) {
      throw new Error(`xterm no longer keeps ${where}, where this test sets the size of a cell`);
    }

    Reflect.set(holder, 'width', CELL.width);
    Reflect.set(holder, 'height', CELL.height);
  };

  /**
   * The pointer over the screen of an emulator, as a person moves it, so that the emulator's own linkifier finds the link under it, tells it of the pointer and takes a press and a release on it for a click. The emulator turns
   * a mouse event into the cell it is on by the size of a cell, which jsdom has no layout to measure: the screen element has the rectangle a layout would give it and no padding (jsdom computes none for an element with no
   * style, which the emulator would read as not a number), and the two places the emulator reads the size of a cell from are set. Cells are counted from 1, as the emulator counts them.
   */
  function pointerOn(terminal: Terminal, rectangle = { left: 100, top: 50, width: 800, height: 480 }) {
    const screen = terminal.element?.querySelector('.xterm-screen');
    if (!(screen instanceof HTMLElement)) {
      throw new Error('the emulator has no screen element');
    }

    Object.defineProperty(screen, 'getBoundingClientRect', { value: () => ({ ...rectangle, right: rectangle.left + rectangle.width, bottom: rectangle.top + rectangle.height, x: rectangle.left, y: rectangle.top, toJSON: () => ({}) }) });
    screen.style.paddingLeft = '0px';
    screen.style.paddingTop = '0px';
    const core = privately(terminal, '_core');
    sized(privately(core, '_charSizeService'), 'the size of a character (terminal._core._charSizeService)');
    sized(privately(privately(privately(privately(core, '_renderService'), 'dimensions'), 'css'), 'cell'), 'the size of a cell (terminal._core._renderService.dimensions.css.cell)');
    const event = (type: string, column: number, row: number, init: MouseEventInit): MouseEvent => {
      const made = new MouseEvent(type, { bubbles: true, cancelable: true, clientX: rectangle.left + (column - 0.5) * CELL.width, clientY: rectangle.top + (row - 0.5) * CELL.height, ...init });
      screen.dispatchEvent(made);
      return made;
    };

    return {
      /** The pointer is on a cell: it moves there. */
      over: (column: number, row: number): MouseEvent => event('mousemove', column, row, {}),
      /** A press and a release on a cell, which a click is made of: the release is the event a link is activated with. */
      click: (column: number, row: number, init: MouseEventInit = {}): MouseEvent => {
        event('mousedown', column, row, init);
        return event('mouseup', column, row, init);
      },
      /** The pointer leaves the screen. */
      leave: (): void => {
        screen.dispatchEvent(new MouseEvent('mouseleave'));
      },
      /** Whether the emulator shows the pointer of a link: it does while the pointer is on one. */
      pointing: (): boolean => screen.classList.contains('xterm-cursor-pointer'),
    };
  }

  /**
   * An emulator with a handler for its links, and the link provider the engine registered with it: the emulator asks a provider for the links of a line as the pointer moves over it, and here a test can ask by hand or move
   * the pointer. The screen element has the rectangle a layout would give it (the cells are 10 by 20 pixels), so that where a link is can be told.
   */
  function linked(rectangle?: { left: number; top: number; width: number; height: number }) {
    const { engine, terminal, write, close } = emulator();
    const providers: ILinkProvider[] = [];
    let disposals = 0;
    const register = terminal.registerLinkProvider.bind(terminal);
    terminal.registerLinkProvider = (provider) => {
      providers.push(provider);
      const registration = register(provider);
      return {
        dispose: () => {
          disposals += 1;
          registration.dispose();
        },
      };
    };

    const pointer = pointerOn(terminal, rectangle);
    const { handler, hovers, clicks } = listening();
    engine.setLinks(handler);
    return {
      engine,
      terminal,
      write,
      handler,
      hovers,
      clicks,
      providers,
      pointer,
      disposals: () => disposals,
      close,
      /** The links of a line of the buffer (1-based), as the provider the engine registered finds them. */
      linksOf: async (line: number): Promise<ILink[]> => new Promise((resolve) => {
        const provider = providers.at(-1);
        if (provider === undefined) {
          resolve([]);
          return;
        }

        provider.provideLinks(line, (links) => {
          resolve(links ?? []);
        });
      }),
    };
  }

  /** Text a program writes as a hyperlink (OSC 8): the address, and the words that are the link. */
  const hyperlink = (uri: string, text: string): string => `\u001b]8;;${uri}\u001b\\${text}\u001b]8;;\u001b\\`;

  /** The two things the emulator's own handler of a hyperlink does, which a host never wants: it asks with `confirm`, and it opens a window. */
  function watchingTheWindow() {
    return { asked: vi.spyOn(window, 'confirm').mockReturnValue(false), opened: vi.spyOn(window, 'open').mockImplementation(() => null) };
  }

  it('finds a web address in a line of the output, and its text is the address', async () => {
    const { write, linksOf, close } = linked();
    await write('see https://example.com/a?b=1 now\r\n');
    const links = await linksOf(1);
    expect(links.map((link) => link.text)).toEqual(['https://example.com/a?b=1']);
    expect(links[0]?.range).toEqual({ start: { x: 5, y: 1 }, end: { x: 29, y: 1 } });
    close();
  });

  it('finds nothing in text that is not a web address: plain words, a path, and a scheme the emulator does not link', async () => {
    const { write, linksOf, close } = linked();
    await write('plain words /usr/local/bin ftp://example.com/x mailto:a@b.c\r\n');
    expect(await linksOf(1)).toEqual([]);
    close();
  });

  it('finds an address that wraps onto the next row, as one link', async () => {
    const { write, linksOf, close } = linked();
    await write(`https://example.com/${'a'.repeat(100)}\r\n`);
    const links = await linksOf(1);
    expect(links).toHaveLength(1);
    expect(links[0]?.text).toBe(`https://example.com/${'a'.repeat(100)}`);
    expect(links[0]?.range.start.y).toBe(1);
    expect(links[0]?.range.end.y).toBe(2);
    close();
  });

  it('gives a click to the handler with the address and the event as it came, and opens nothing itself: the host tests the modifier', async () => {
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    const { write, linksOf, clicks, close } = linked();
    await write('https://example.com/docs\r\n');
    const [link] = await linksOf(1);
    const plain = new MouseEvent('click');
    const command = new MouseEvent('click', { metaKey: true });
    link?.activate(plain, link.text);
    link?.activate(command, link.text);
    expect(clicks).toEqual([['https://example.com/docs', plain], ['https://example.com/docs', command]]);
    expect(open).not.toHaveBeenCalled();
    open.mockRestore();
    close();
  });

  it('tells the handler where the pointer is on a link, at the link\'s first cell in the pixels of the viewport, and tells it when the pointer leaves', async () => {
    const { write, linksOf, hovers, close } = linked();
    await write('see https://example.com/a now\r\n');
    const [link] = await linksOf(1);
    const pointer = new MouseEvent('mousemove', { clientX: 321, clientY: 123 });
    link?.hover?.(pointer, link.text);
    // The link starts at column 5 of row 1: four cells of 10 pixels in, and no row down, from the screen's corner at 100, 50.
    expect(hovers).toEqual([{ uri: 'https://example.com/a', x: 140, y: 50 }]);
    link?.leave?.(pointer, link.text);
    expect(hovers).toEqual([{ uri: 'https://example.com/a', x: 140, y: 50 }, undefined]);
    close();
  });

  it('counts the rows from the top of what is in view: a link in the scrollback that has scrolled to the viewport is where it is drawn', async () => {
    const { write, linksOf, terminal, hovers, close } = linked();
    await write(`${Array.from({ length: 40 }, (_, line) => `line ${String(line)}\r\n`).join('')}go https://example.com/z\r\n`);
    // The address is on the 41st line of the buffer; the buffer has scrolled, so the viewport starts below the first lines.
    const top = terminal.buffer.active.viewportY;
    expect(top).toBeGreaterThan(0);
    const [link] = await linksOf(41);
    link?.hover?.(new MouseEvent('mousemove'), link.text);
    expect(hovers).toEqual([{ uri: 'https://example.com/z', x: 130, y: 50 + (40 - top) * 20 }]);
    close();
  });

  it('puts the tooltip at the pointer when the screen has no geometry to tell a cell by', async () => {
    const { write, linksOf, hovers, close } = linked({ left: 0, top: 0, width: 0, height: 0 });
    await write('https://example.com/a\r\n');
    const [link] = await linksOf(1);
    link?.hover?.(new MouseEvent('mousemove', { clientX: 321, clientY: 123 }), link.text);
    expect(hovers).toEqual([{ uri: 'https://example.com/a', x: 321, y: 123 }]);
    close();
  });

  it('stops offering links when the handler is taken away: the pointer on the same address, come to afresh, is on no link and a click there reaches nothing, as on an emulator that never had a handler', async () => {
    const { engine, write, pointer, clicks, hovers, close } = linked();
    await write('see https://example.com/a now\r\n');
    pointer.over(8, 1);
    expect(pointer.pointing()).toBe(true);
    pointer.click(8, 1);
    expect(clicks.map(([uri]) => uri)).toEqual(['https://example.com/a']);
    engine.setLinks(undefined);
    // The pointer goes to another row and comes back: the emulator asks its providers again for a row it comes to from another.
    pointer.over(8, 5);
    pointer.over(8, 1);
    expect(pointer.pointing()).toBe(false);
    pointer.click(8, 1);
    expect(clicks).toHaveLength(1);
    expect(hovers).toHaveLength(1);
    const bare = emulator();
    const barePointer = pointerOn(bare.terminal);
    await bare.write('see https://example.com/a now\r\n');
    barePointer.over(8, 1);
    expect(barePointer.pointing()).toBe(false);
    expect(() => barePointer.click(8, 1)).not.toThrow();
    bare.close();
    close();
  });

  it('lets go of the link provider it registered when the handler is taken away', async () => {
    const { engine, disposals, close } = linked();
    expect(disposals()).toBe(0);
    engine.setLinks(undefined);
    expect(disposals()).toBe(1);
    close();
  });

  it('gives the links to a new handler when the handler changes, and the old one hears nothing more', async () => {
    const { engine, write, linksOf, clicks, disposals, providers, close } = linked();
    await write('https://example.com/a\r\n');
    const other: Array<readonly [string, MouseEvent]> = [];
    engine.setLinks({
      activate: (uri, event) => {
        other.push([uri, event]);
      },
      hover: () => undefined,
    });
    expect(disposals()).toBe(1);
    expect(providers).toHaveLength(2);
    const [link] = await linksOf(1);
    const click = new MouseEvent('click');
    link?.activate(click, link.text);
    expect(other).toEqual([['https://example.com/a', click]]);
    expect(clicks).toEqual([]);
    close();
  });

  it('does not give a click on a link the pointer is on to a handler that was replaced: the emulator keeps the link it found under the pointer, and a press and a release on its cell, with no move, would reach the old handler', async () => {
    const { engine, write, pointer, clicks, hovers, close } = linked();
    await write('see https://example.com/a now\r\n');
    pointer.over(8, 1);
    expect(hovers).toEqual([{ uri: 'https://example.com/a', x: 140, y: 50 }]);
    const next = listening();
    engine.setLinks(next.handler);
    pointer.click(8, 1);
    expect(clicks).toEqual([]);
    expect(next.clicks).toEqual([]);
    // Off the link along its row and back onto it: the emulator offers the link it found before, from what it kept for the row, and the old handler is not told of it. (Nor is the new one: the link is the old one's.)
    pointer.over(1, 1);
    pointer.over(8, 1);
    expect(hovers).toHaveLength(1);
    expect(next.hovers).toEqual([]);
    // The old handler is not told the pointer left the link either, and the new one is told of the link when the pointer comes to it afresh.
    pointer.leave();
    expect(hovers).toHaveLength(1);
    pointer.over(8, 5);
    pointer.over(8, 1);
    expect(next.hovers).toEqual([{ uri: 'https://example.com/a', x: 140, y: 50 }]);
    const up = pointer.click(8, 1);
    expect(next.clicks).toEqual([['https://example.com/a', up]]);
    expect(clicks).toEqual([]);
    close();
  });

  it('does not give a click on a link the pointer is on to a handler that was taken away', async () => {
    const { engine, write, pointer, clicks, hovers, close } = linked();
    await write('see https://example.com/a now\r\n');
    pointer.over(8, 1);
    engine.setLinks(undefined);
    pointer.click(8, 1);
    pointer.leave();
    expect(clicks).toEqual([]);
    expect(hovers).toHaveLength(1);
    close();
  });

  // The emulator has a link provider of its own for the hyperlinks a program writes (OSC 8), which is always there and which acts through the option `linkHandler`: with none it asks the person with `confirm` and opens a
  // window, whatever the host thinks of the click. The engine gives it a handler of its own from the start, which gives the click, the pointer and the leaving to the handler the host set, the same one the printed addresses go
  // to (so the host's rule for them, the key that is held and the schemes it follows, is one rule), and does nothing while there is none.
  describe('and the hyperlinks a program writes (OSC 8)', () => {
    const DOCS = 'https://example.com/docs';
    // `see `, then eight cells of link (the fifth to the twelfth), then ` now`.
    const LINE = `see ${hyperlink(DOCS, 'the docs')} now\r\n`;

    it('gives a click on one to the handler, as it gives a click on a printed address, the event as it came: the emulator\'s own handler (a question, then a window) is never used', async () => {
      const { asked, opened } = watchingTheWindow();
      const { write, pointer, clicks, close } = linked();
      await write(LINE);
      pointer.over(6, 1);
      const plain = pointer.click(6, 1);
      const command = pointer.click(6, 1, { metaKey: true });
      expect(clicks).toEqual([[DOCS, plain], [DOCS, command]]);
      expect(command.metaKey).toBe(true);
      expect(asked).not.toHaveBeenCalled();
      expect(opened).not.toHaveBeenCalled();
      close();
    });

    it('tells the handler where the pointer is on one, at its first cell in the pixels of the viewport, and tells it when the pointer leaves', async () => {
      const { write, pointer, hovers, close } = linked();
      await write(LINE);
      pointer.over(6, 1);
      expect(hovers).toEqual([{ uri: DOCS, x: 140, y: 50 }]);
      pointer.leave();
      expect(hovers).toEqual([{ uri: DOCS, x: 140, y: 50 }, undefined]);
      close();
    });

    it.each(['javascript:alert(1)', 'file:///etc/passwd', 'ftp://example.com/file', 'data:text/html,hi'])('offers no link for %s, whatever the handler: a scheme that is not http or https is not one the emulator hands over', async (uri) => {
      const { asked, opened } = watchingTheWindow();
      const { write, pointer, clicks, hovers, close } = linked();
      await write(`see ${hyperlink(uri, 'the docs')} now\r\n`);
      pointer.over(6, 1);
      expect(pointer.pointing()).toBe(false);
      pointer.click(6, 1);
      expect(hovers).toEqual([]);
      expect(clicks).toEqual([]);
      expect(asked).not.toHaveBeenCalled();
      expect(opened).not.toHaveBeenCalled();
      close();
    });

    it('does nothing for a click on one when there is no handler: no question, no window, and nothing thrown', async () => {
      const { asked, opened } = watchingTheWindow();
      const { terminal, write, close } = emulator();
      const pointer = pointerOn(terminal);
      await write(LINE);
      pointer.over(6, 1);
      expect(() => pointer.click(6, 1)).not.toThrow();
      expect(asked).not.toHaveBeenCalled();
      expect(opened).not.toHaveBeenCalled();
      close();
    });

    it('does nothing for a click on one once the handler is taken away: the handler hears no more, and nothing is asked or opened', async () => {
      const { asked, opened } = watchingTheWindow();
      const { engine, write, pointer, clicks, hovers, close } = linked();
      await write(LINE);
      pointer.over(6, 1);
      pointer.click(6, 1);
      expect(clicks).toHaveLength(1);
      engine.setLinks(undefined);
      pointer.click(6, 1);
      pointer.leave();
      expect(clicks).toHaveLength(1);
      expect(hovers).toHaveLength(1);
      expect(asked).not.toHaveBeenCalled();
      expect(opened).not.toHaveBeenCalled();
      close();
    });

    it('gives a click to the handler that is set when it comes: the old handler hears nothing more, and the one that was set after the pointer came to the link gets the click', async () => {
      const { engine, write, pointer, clicks, hovers, close } = linked();
      const next = listening();
      await write(LINE);
      pointer.over(6, 1);
      engine.setLinks(next.handler);
      const up = pointer.click(6, 1);
      pointer.leave();
      expect(clicks).toEqual([]);
      expect(hovers).toEqual([{ uri: DOCS, x: 140, y: 50 }]);
      expect(next.clicks).toEqual([[DOCS, up]]);
      close();
    });
  });

  it('lets go of its links with the emulator', async () => {
    const { disposals, close } = linked();
    close();
    expect(disposals()).toBe(1);
  });
});

describe('the GPU renderer of a real emulator (#698 item 15)', () => {
  const make = () => createXtermEngine({ cols: 80, rows: 24, scrollback: 100, appearance: APPEARANCE, screenReaderMode: false });
  const live = () => gpus.made.filter((addon) => !addon.disposed).length;

  beforeEach(() => {
    gpus.made.length = 0;
    gpus.failNext = 0;
  });

  it('makes the addon once for a terminal: 40 showings and hidings make one, and none is disposed by a hiding', async () => {
    const engine = make();
    for (let cycle = 0; cycle < 40; cycle += 1) {
      await engine.setRenderer('gpu');
      await engine.setRenderer('dom');
    }

    expect(gpus.made).toHaveLength(1);
    expect(live()).toBe(1);
    engine.dispose();
    expect(live()).toBe(0);
  });

  it('makes one addon for each terminal, so that the contexts in a page are at most the terminals', async () => {
    const engines = [make(), make(), make()];
    for (let cycle = 0; cycle < 40; cycle += 1) {
      for (const engine of engines) {
        await engine.setRenderer('gpu');
        await engine.setRenderer('dom');
      }
    }

    expect(gpus.made).toHaveLength(3);
    for (const engine of engines) {
      engine.dispose();
    }
  });

  it('disposes the addon on a lost context and makes a new one at the next showing', async () => {
    const engine = make();
    await engine.setRenderer('gpu');
    gpus.made[0]?.lose();
    expect(gpus.made[0]?.disposed).toBe(true);
    await engine.setRenderer('dom');
    await engine.setRenderer('gpu');
    expect(gpus.made).toHaveLength(2);
    expect(live()).toBe(1);
    engine.dispose();
  });

  it('stays on the DOM renderer for its life after two lost contexts', async () => {
    const engine = make();
    for (let loss = 0; loss < 2; loss += 1) {
      await engine.setRenderer('gpu');
      gpus.made[loss]?.lose();
      await engine.setRenderer('dom');
    }

    for (let cycle = 0; cycle < 5; cycle += 1) {
      await engine.setRenderer('gpu');
      await engine.setRenderer('dom');
    }

    expect(gpus.made).toHaveLength(2);
    expect(live()).toBe(0);
    engine.dispose();
  });

  it('counts a failure to make the addon as one, and stays on the DOM renderer after two', async () => {
    const engine = make();
    gpus.failNext = 2;
    for (let cycle = 0; cycle < 5; cycle += 1) {
      await engine.setRenderer('gpu');
      await engine.setRenderer('dom');
    }

    expect(gpus.made).toHaveLength(0);
    expect(gpus.failNext).toBe(0);
    engine.dispose();
  });

  it('lets a terminal that lost one context have the GPU renderer again, and does not count a context lost by one terminal against another', async () => {
    const first = make();
    const second = make();
    await first.setRenderer('gpu');
    await second.setRenderer('gpu');
    gpus.made[0]?.lose();
    await first.setRenderer('dom');
    await first.setRenderer('gpu');
    await second.setRenderer('dom');
    await second.setRenderer('gpu');
    expect(gpus.made).toHaveLength(3);
    first.dispose();
    second.dispose();
  });
});

// The person's settings reach a real emulator (#697 step 1): the font names, the size, the line height and the cursor are applied to the emulator that is there. It is the same object (the engine is not made again) and its
// scrollback is untouched: the lines written before the change are the lines after it.
describe('the person\'s settings on a real emulator', () => {
  const lines = (terminal: Terminal): string[] => {
    const out: string[] = [];
    const buffer = terminal.buffer.active;
    for (let row = 0; row < buffer.length; row += 1) {
      out.push(buffer.getLine(row)?.translateToString(true) ?? '');
    }

    return out;
  };

  it('is made in the cursor and the font of the settings', () => {
    const before = made.length;
    const engine = createXtermEngine({ cols: 80, rows: 24, scrollback: 777, appearance: { ...APPEARANCE, cursorStyle: 'bar', fontFamily: 'Menlo, monospace', fontSize: 15 }, screenReaderMode: false });
    const terminal = made.at(-1);
    expect(made.length).toBe(before + 1);
    expect(terminal?.options).toMatchObject({ cursorStyle: 'bar', fontFamily: 'Menlo, monospace', fontSize: 15, scrollback: 777 });
    engine.dispose();
  });

  it('changes the font names, the size and the cursor of the emulator that is there: no second emulator, and every line it held is still held', async () => {
    const engine = createXtermEngine({ cols: 20, rows: 4, scrollback: 100, appearance: APPEARANCE, screenReaderMode: false });
    const terminal = made.at(-1);
    if (terminal === undefined) {
      throw new Error('no emulator');
    }

    const written = async (data: string) => {
      const { promise, resolve } = Promise.withResolvers<void>();
      engine.write(data, resolve);
      return promise;
    };

    await written(Array.from({ length: 30 }, (_, index) => `line ${String(index)}`).join('\r\n'));
    const held = lines(terminal);
    expect(held.length).toBeGreaterThan(20);
    const count = made.length;

    engine.setAppearance({ ...APPEARANCE, fontFamily: 'JetBrains Mono, monospace', fontSize: 16, cursorStyle: 'underline' });
    expect(made.length).toBe(count);
    expect(terminal.options).toMatchObject({ fontFamily: 'JetBrains Mono, monospace', fontSize: 16, cursorStyle: 'underline' });
    expect(lines(terminal)).toEqual(held);
    engine.dispose();
  });
});
