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

  /** Lets the timers of the screen and of the emulator run: what the emulator was given is parsed, in order, and what it says is said. */
  const settle = async (): Promise<void> => {
    await vi.advanceTimersByTimeAsync(1_000);
  };

  /** The screen over the REAL emulator, reading a feed that was reattached (and holds `live` after its replay), once everything it was given is parsed. The emulator is the one the module recorded. */
  async function shownOver(replay: TerminalReplay, live?: string | Uint8Array): Promise<{ readonly screen: TerminalScreen; readonly feed: FakeTerminalFeed; readonly terminal: Terminal }> {
    const feed = reattachedFeed(replay);
    if (live !== undefined) {
      feed.push(live);
    }

    const load: EngineLoader = async () => (options) => ({ ...createXtermEngine(options), open: () => undefined, setRenderer: async () => undefined });
    const screen = createScreen({
      feed,
      load,
      appearance: () => APPEARANCE,
      platform: 'mac',
      label: 'Terminal input, Terminal',
      descriptionId: 'hint-1',
      screenReader: createScreenReaderChoice(),
      frame: (callback) => {
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
    screen.mount(document.createElement('div'));
    screen.show();
    await settle();
    const terminal = made.at(-1);
    if (terminal === undefined) {
      throw new Error('the screen made no emulator');
    }

    return { screen, feed, terminal };
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
  describe('the cursor of an emulator that a replay brought to where a terminal is', () => {
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

    const replayOf = (data: string | Uint8Array, patch: Partial<TerminalReplay> = {}): TerminalReplay => {
      const kept = typeof data === 'string' ? new TextEncoder().encode(data) : data;
      return { data: kept, startSize: { cols: 80, rows: 24 }, startModes: NO_MODES, size: { cols: 80, rows: 24 }, modes: NO_MODES, end: kept.length, ...patch };
    };

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
  });
});
