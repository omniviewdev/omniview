import userEvent from '@testing-library/user-event';
import { Terminal, type IBuffer } from '@xterm/xterm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FULL_RESET, modesPrologue, type EngineAppearance, type EngineLoader } from './engine';
import type { TerminalModes, TerminalReplay } from './feed';
import { createScreen, SCROLLBACK, type TerminalScreen } from './screen';
import { createScreenReaderChoice } from './screenReader';
import { fakeTerminalFeed, type FakeTerminalFeed } from './testing';
import { createXtermEngine } from './xtermEngine';

// jsdom has no canvas, and the emulator's colour code asks for a 2D context when it is imported (it never draws here): without this stand-in jsdom says so in the log once for every run.
vi.hoisted(() => {
  HTMLCanvasElement.prototype.getContext = () => null;
});

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
};

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
   * let come and no more.
   */
  async function showOver(feed: FakeTerminalFeed, host?: HTMLElement, frames?: Array<() => void>): Promise<{ readonly screen: TerminalScreen; readonly terminal: Terminal }> {
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
