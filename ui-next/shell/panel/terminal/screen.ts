import type { Platform } from '../../core/chords';
import { CURSOR_INIT, FULL_RESET, modesPrologue, type Engine, type EngineAppearance, type EngineLoader, type EngineOptions } from './engine';
import type { TerminalFeedHandle, TerminalFeedSnapshot, TerminalReplay, TerminalSize } from './feed';
import { keyOf, sequenceOf } from './keys';
import type { ScreenReaderSource } from './screenReader';
import { drainLine, exitLine, failureLines } from './state';

// The screen of a terminal session: the one object between a feed and an emulator (docs/ui-next/status/T1.md, "The screen"). It is framework-free and knows no xterm: it is written against `Engine`, and the body
// (`TerminalBody.tsx`) only gives it a host element and tells it whether it is on screen. The rules:
//
//   - NOTHING happens before the screen is first shown: the emulator's code is not asked for, no emulator is made, nothing listens (a terminal that is not on screen costs no code and no time);
//   - while it is shown, the feed wakes it once between two reads and it draws in the NEXT FRAME, never in the event; a frame takes only what the emulator can parse (`FLOW.high` bytes accepted and not parsed),
//     cut in slices the emulator parses without a long task (`FLOW.slice`), and what is more stays in the feed. Every byte it hands the emulator is acknowledged to the feed WHEN THE EMULATOR HAS PARSED IT, which
//     is what the host paces the shell by (docs/ui-next/status/T1-go.md 2.8.6, docs/ui-next/status/T2a.md): a screen that is slow to parse slows the shell, and nothing is dropped anywhere;
//   - the size of the host is measured by an observer (before paint, once a frame at most), the emulator follows it, and the feed is told only a size that changed, and only once the GPU renderer is in place (its cells
//     are not the DOM's): the first size the feed gets starts the process, so it must be the size the person sees, and nothing is resized after the start (the feed settles the rest);
//   - while it is hidden it goes on reading, parsing and acknowledging, in frames of a smaller share (`FLOW.hiddenFrame`), and draws nothing itself: no observer, no GPU context, no measure, and no frame once the feed has
//     nothing more. A build in a session that is not shown must not be stalled by the view: VS Code writes every chunk into xterm and acknowledges it from the write callback whether or not the terminal is shown
//     (`terminalInstance.ts`, `_writeProcessData`). What it costs the main thread is MEASURED, not assumed zero (docs/ui-next/status/T2a.md): the parse, and the emulator's own bookkeeping inside its hidden element
//     (the probe counts its DOM changes: they are bounded by the share and none is in the page's own DOM);
//   - a window that is minimized or covered gives no animation frames, whether the screen is shown or hidden: the screen asks for a timer (`HIDDEN_TICK_MS`) beside every frame it asks for, and whichever comes first runs the
//     pump once and cancels the other, at the share the screen has then (the shown one while it is shown, the hidden one while it is hidden), so that a build is never stalled by a window that cannot draw;
//   - the window's screen reader choice is read when the emulator is made and followed while the screen is on screen, one call to the emulator for each change; a hidden screen listens to nothing, its emulator is out of the mode
//     while it is hidden (an accessibility layer refreshes itself a second after the lines it was given, which must not happen in a hidden panel), and the choice made meanwhile is taken when the screen is shown again;
//   - a terminal the page took back after a reload (T2-go 2.4) has its replay taken first, before any live byte is read (the feed gives none until then). The emulator is reset, made to draw its cursor (an emulator that is
//     only written to draws none: `CURSOR_INIT`), sized and put in the modes the host's bytes were written under, and then written them, in slices within the frame's share, with what the emulator says MUTED until the
//     last slice is parsed: it answers the queries in those bytes, and the program that asked them is long past, so its answers must never reach the shell. Not one replayed byte is acknowledged (the host counts what it
//     delivered live). When the last is parsed the emulator takes the size the host's terminal has, and then the panel's measure; when the size the feed is told is that size, a full-screen program is made to paint again (a
//     size that did not change signals nothing). A hidden screen applies a replay too, and only parses;
//   - a replay may come LATE (T2d): when the page's stream dropped and the host no longer has the bytes the page asked for, or the host reports a gap (bytes it overwrote before it sent them: a replay of nothing, at the byte after the gap), the screen is
//     brought to the host's ring by a replay while the emulator holds output. The screen asks the feed for a replay on every pump (a function call) and applies the one it is given as the first one is applied, once the emulator
//     has parsed what it already holds (the answers to those bytes are the shell's), one at a time. That replay RESETS the emulator and REPLACES its buffers, the normal screen and the alternate one, the scrollback included,
//     by the host's ring: nothing of what the emulator held before it is left, and what is written after it is the live bytes. When the host's terminal then has another size than the panel, the feed is told the panel's size again;
//   - what the person types while a replay is applied is theirs, and is not lost with what the emulator says (which is dropped): the engine says which is which (`user`), and the screen keeps the typing, in order and bounded
//     (`HELD_TYPING`), and sends it through the feed's own `write` once the last slice is parsed, so that the host numbers it after the replay; a terminal that takes no input by then drops it;
//   - the emulator, with its screen and its scrollback, is made once and kept for the life of the session (a replay brings it to another state, it does not make another), and is disposed once, with the session.

/** Lines kept above the screen: 5,000, as the library's terminal keeps (LIB-21) and the old host's did not (it took the emulator's 1,000). The mock keeps 2,000 rows of transcript (`TERM_CAP`). */
export const SCROLLBACK = 5_000;

/**
 * The flow of output into the emulator: at most `high` bytes accepted and not yet parsed, in writes of at most `slice` bytes, and at most `frame` bytes taken in one frame while the screen is shown (about 30 MB/s at
 * 60 Hz, twice the fastest pty the host measured) and `hiddenFrame` while it is hidden (about 15 MB/s: a hidden terminal draws nothing and what it costs is the parse, kept to a smaller part of every frame so that the
 * screen that is shown stays smooth). The last bounds keep the work of a frame to a few milliseconds whatever the frame's lateness: a frame that comes late on a busy machine takes its share and the next frame the next
 * share, where without them the backlog was one task of 150 ms (a long task, and a frame of 50 ms, measured in Chromium under load).
 */
export const FLOW = Object.freeze({ high: 4 << 20, slice: 64 << 10, frame: 512 << 10, hiddenFrame: 256 << 10 });

/**
 * The most the screen keeps, in characters, of what the person types while a replay is applied. A replay is applied in a few frames, so what is typed meanwhile is a few keys or a paste, and this is far more than either: the
 * bound is for what is not (a file pasted). What is kept is the START of what was typed: what does not fit is refused, and all that comes after it, so that what is sent is a part of what was typed with no hole in it (the end
 * of a line without its start would be a different command, where a line cut at its end has no Enter).
 */
export const HELD_TYPING = 64 << 10;

/** How long a screen waits for a frame before it goes on from a timer, shown or hidden (the name is from its first use, a hidden screen): a window that is minimized or covered suspends its frames, and a build in a session must not stall for it. */
export const HIDDEN_TICK_MS = 250;

/** The cells an emulator is made with, until the host is measured. */
const INITIAL = Object.freeze({ cols: 80, rows: 24 });

export type ScreenSnapshot = {
  /** The emulator exists and is drawing in the host. */
  readonly ready: boolean;
  /** Some of the output is selected. */
  readonly selected: boolean;
  /** Why the emulator could not start (its code did not load); it is tried again the next time the screen is shown. */
  readonly error: string | undefined;
};

export type ScreenDeps = {
  readonly feed: TerminalFeedHandle;
  /** Loads the emulator's code: asked for the first time the screen is shown, and again only after it failed. */
  readonly load: EngineLoader;
  /** The look of the screen now, read from around its host element: when the emulator is made and when `refresh` is called. */
  readonly appearance: (host: HTMLElement) => EngineAppearance;
  readonly platform: Platform;
  /** The name of the emulator's input and the id of the element that says how to leave it. */
  readonly label: string;
  readonly descriptionId: string;
  /** The window's screen reader choice (`screenReader.ts`): the emulator is made in the mode it holds, and follows it while the screen is on screen. */
  readonly screenReader: ScreenReaderSource;
  /** Asks for a frame; returns what cancels it. */
  readonly frame: (callback: () => void) => () => void;
  /** Asks for a call after `ms` milliseconds; returns what cancels it. Default: a timer. The screen asks for one beside every frame it asks for, for a window whose frames are suspended. */
  readonly later?: ((callback: () => void, ms: number) => () => void) | undefined;
  /** Observes the size of an element; returns what stops it. */
  readonly observe: (element: HTMLElement, callback: () => void) => () => void;
  /** Resolves when the font (a CSS `font` shorthand: size and family) is loaded, or is not going to be. */
  readonly fontsReady: (font: string) => Promise<void>;
  /** Puts text on the clipboard; says whether it could. */
  readonly copy: (text: string) => Promise<boolean>;
  readonly warn?: ((message: string, error?: unknown) => void) | undefined;
};

export type TerminalScreen = {
  /** The element the emulator draws in. Nothing else happens. */
  readonly mount: (host: HTMLElement) => void;
  /** The screen is on screen: the first time makes the emulator, every time listens to the feed and draws what it held. */
  readonly show: () => void;
  /** The screen is not on screen: it lets go of everything but the emulator's state. */
  readonly hide: () => void;
  /** Puts the keyboard in the emulator. False when it is not there or not on screen. */
  readonly focus: () => boolean;
  readonly clear: () => void;
  /** Copies the selection; says whether anything was copied. */
  readonly copy: () => Promise<boolean>;
  /** The theme or the font changed: read the appearance again and apply it to the emulator that is there. */
  readonly refresh: () => void;
  /** The tab was renamed (the shell said its name): the emulator's input is named again. The label is what a screen reader says for it. */
  readonly rename: (label: string) => void;
  readonly dispose: () => void;
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => ScreenSnapshot;
};

/** Text in the muted colour of the transcript's own lines, on a line of its own (the escape sequences are the emulator's: reset, bright black, reset). The palette's bright black is the theme's muted text; the emulator's dim style would be half the opacity of any colour, which no contrast rule can pass. */
const muted = (text: string): string => `\u001b[0m\r\n\u001b[90m${text}\u001b[0m\r\n`;

const takesInput = (status: TerminalFeedSnapshot): boolean => status.state === 'starting' || status.state === 'running';

const clearers = new WeakMap<Element, () => void>();

/**
 * Clears the screen that holds `target` (the element a key came to) and says whether there was one. Command K is the terminal's while it has the focus (VS Code and JetBrains agree, keys.ts `clear`), and it is also the
 * window's palette chord: the window asks this first.
 */
export function clearScreenIn(target: EventTarget | null): boolean {
  for (let node = target instanceof Element ? target : null; node !== null; node = node.parentElement) {
    const clear = clearers.get(node);
    if (clear !== undefined) {
      clear();
      return true;
    }
  }

  return false;
}

export function createScreen(deps: ScreenDeps): TerminalScreen {
  const { feed } = deps;
  const warn = deps.warn ?? ((message: string, error?: unknown) => {
    console.warn(message, error);
  });
  const listeners = new Set<() => void>();
  const stops: Array<() => void> = [];
  let snapshot: ScreenSnapshot = { ready: false, selected: false, error: undefined };
  let host: HTMLElement | undefined;
  let factory: ((options: EngineOptions) => Engine) | undefined;
  let engine: Engine | undefined;
  /** The screen reader mode the emulator has now. */
  let readerMode = false;
  let visible = false;
  /** The GPU renderer is in place for this showing: until then nothing is measured, and the feed is told no size. */
  let rendererReady = false;
  /** The showings so far: a renderer that answers for an earlier one is not the one the screen waits for. */
  let showings = 0;
  let disposed = false;
  let loading = false;
  let stopFeed: (() => void) | undefined;
  let stopReader: (() => void) | undefined;
  let stopObserving: (() => void) | undefined;
  let cancelFrame: (() => void) | undefined;
  let cancelLater: (() => void) | undefined;
  let told: { readonly cols: number; readonly rows: number } | undefined;
  let lastStatus: TerminalFeedSnapshot | undefined;
  /** The last end written into the transcript (`exitLine`): when the end says something else, another line is written, as for a terminal this page lost and that then ended. */
  let endLine = '';
  let drainWritten = false;
  let failureWritten = false;
  /** What a screen reader says for the emulator's input: the tab's title, which the shell may rename. */
  let label = deps.label;
  let pending = 0;
  let blocked = false;
  /** A replay the feed gave while the emulator was still parsing what came before it: applied once it has, so that what the emulator says of those bytes is the shell's and what it says of the replay is not. */
  let replayHeld: TerminalReplay | undefined;
  /** The emulator holds output: live bytes were written to it, or a replay was applied. A replay that comes after that is a LATE one (a stream that lost bytes, a gap), not the first of a terminal the page took back. */
  let holds = false;
  /** The replay being applied: its bytes are written a share at a time, and nothing the emulator says is heard until the last of them is parsed. */
  let replaying: { readonly replay: TerminalReplay; readonly late: boolean; written: number } | undefined;
  /**
   * What the screen has still to settle with the host once a replay is parsed: the size the host's terminal has, and whether the replay came late. When the host has the size the panel has, a full-screen program is made to paint
   * again; when it has another and the replay was late, the feed is told the panel's size again (the feed was told it before the gap, and whoever held the terminal meanwhile may have changed the host's: a first replay needs no
   * more, the feed holds the size told before its answer and compares it with the host's).
   */
  let settling: { readonly size: TerminalSize; readonly late: boolean } | undefined;
  /**
   * What the person typed while a replay was applied, in order, for after it: what the emulator says in that window is dropped, and the person's typing is not what it says. At most `HELD_TYPING` characters; `heldFull`
   * once something did not fit, after which nothing more is kept until the replay is applied.
   */
  let held: string[] = [];
  let heldLength = 0;
  let heldFull = false;

  const set = (change: Partial<ScreenSnapshot>) => {
    snapshot = { ...snapshot, ...change };
    for (const listener of [...listeners]) {
      listener();
    }
  };

  const later = deps.later ?? ((callback: () => void, ms: number) => {
    const timer = setTimeout(callback, ms);
    return () => {
      clearTimeout(timer);
    };
  });

  /** The frame came: the timer that stood beside it is not needed. */
  const fromFrame = () => {
    cancelFrame = undefined;
    cancelLater?.();
    cancelLater = undefined;
    pump();
  };

  /** The timer came first (the window's frames are suspended): the frame that stood beside it is not needed. */
  const fromTimer = () => {
    cancelLater = undefined;
    cancelFrame?.();
    cancelFrame = undefined;
    pump();
  };

  const schedule = () => {
    if (engine === undefined) {
      return;
    }

    cancelFrame ??= deps.frame(fromFrame);
    // A timer stands beside every frame, shown or hidden: when the window's frames are suspended (minimized, covered) the parse goes on from it, at the share the screen has then, and whichever comes first runs the pump once.
    cancelLater ??= later(fromTimer, HIDDEN_TICK_MS);
  };

  /** The emulator parsed `bytes` it had accepted: a frame that stopped at the bound goes on once half of it is parsed, a replay that waited for the emulator to be idle comes once it is, and the feed is told what was live, which is what the host paces the shell by. */
  function parsed(bytes: number, live: boolean): void {
    pending -= bytes;
    if (live) {
      feed.ack(bytes);
    }

    if ((blocked && pending < FLOW.high / 2) || (replayHeld !== undefined && pending === 0)) {
      blocked = false;
      schedule();
    }
  }

  /** Writes what is held in slices the emulator parses without a long task, counts what it has accepted and not parsed, and tells the feed what it parsed: the host paces the shell by that. */
  function send(emulator: Engine, chunks: readonly Uint8Array[]): void {
    holds = true;
    let piece = new Uint8Array(FLOW.slice);
    let filled = 0;
    const flush = () => {
      if (filled === 0) {
        return;
      }

      const bytes = filled;
      pending += bytes;
      emulator.write(piece.subarray(0, bytes), () => {
        parsed(bytes, true);
      });
      piece = new Uint8Array(FLOW.slice);
      filled = 0;
    };

    for (const chunk of chunks) {
      for (let at = 0; at < chunk.length; ) {
        const take = Math.min(chunk.length - at, FLOW.slice - filled);
        piece.set(chunk.subarray(at, at + take), filled);
        filled += take;
        at += take;
        if (filled === FLOW.slice) {
          flush();
        }
      }
    }

    flush();
  }

  /** One write of a replay: counted as accepted until it is parsed, never acknowledged, and the last of them ends the replay. */
  function writeReplay(emulator: Engine, piece: Uint8Array | string, last: boolean): void {
    const bytes = typeof piece === 'string' ? 0 : piece.length;
    pending += bytes;
    emulator.write(piece, () => {
      parsed(bytes, false);
      if (last) {
        finishReplay();
      }
    });
  }

  /**
   * A replay was taken: the emulator is reset, made to draw its cursor, sized to the size the bytes were written under and put in the modes they were written under, in one write that is parsed in order with the bytes
   * after it. From here to the parse of the last slice what the emulator says by itself goes nowhere: it answers the queries in the bytes, and the program that asked them is long past. What the person types is kept (`typed`).
   */
  function beginReplay(emulator: Engine, taken: TerminalReplay): void {
    const late = holds;
    holds = true;
    replaying = { replay: taken, late, written: 0 };
    const { cols, rows } = taken.startSize;
    const now = emulator.size();
    if (now.cols !== cols || now.rows !== rows) {
      emulator.resize(cols, rows);
    }

    // An emulator that was only written to draws no cursor (`CURSOR_INIT`). The reset leaves it on the normal screen, so a replay that starts there needs the bounce; one that starts on the alternate screen switches to it in its modes.
    const cursor = taken.startModes.altScreen ? '' : CURSOR_INIT;
    writeReplay(emulator, `${FULL_RESET}${cursor}${modesPrologue(taken.startModes)}`, taken.data.length === 0);
  }

  /** Writes the next slice of the replay's bytes, at most `budget` of them, and says how many: none once they all are written, when the parse of the last slice ends the replay. */
  function replaySlice(emulator: Engine, budget: number): number {
    if (replaying === undefined) {
      return 0;
    }

    const { data } = replaying.replay;
    const count = Math.min(data.length - replaying.written, FLOW.slice, budget);
    if (count <= 0) {
      return 0;
    }

    const at = replaying.written;
    replaying.written += count;
    writeReplay(emulator, data.subarray(at, at + count), replaying.written === data.length);
    return count;
  }

  /**
   * The person typed, or a key sent its own bytes: to the feed, or, while a replay is applied, kept for after it. The feed numbers what it is given in the order it is given, so what is sent once the replay is applied is
   * numbered after the replay.
   */
  function typed(data: string): void {
    if (replaying === undefined) {
      feed.write(data);
    } else if (!heldFull) {
      if (heldLength + data.length > HELD_TYPING) {
        heldFull = true;
      } else {
        held.push(data);
        heldLength += data.length;
      }
    }
  }

  /** The replay is applied: what the person typed meanwhile goes to the shell, in order, when the terminal still takes input. */
  function sendHeld(): void {
    const kept = held;
    held = [];
    heldLength = 0;
    heldFull = false;
    if (takesInput(feed.getSnapshot())) {
      for (const data of kept) {
        feed.write(data);
      }
    }
  }

  /**
   * The last byte of the replay is parsed: what the emulator says is heard again, what the person typed meanwhile is sent, it has the size the host's terminal has, and the panel's measure is taken again (the emulator follows
   * it and the feed is told it), so that a full-screen program is made to paint when that is the size the host's terminal has. What is live goes on.
   */
  function finishReplay(): void {
    if (replaying === undefined || engine === undefined) {
      return;
    }

    const { replay, late } = replaying;
    replaying = undefined;
    sendHeld();
    const { size } = replay;
    const now = engine.size();
    if (now.cols !== size.cols || now.rows !== size.rows) {
      engine.resize(size.cols, size.rows);
    }

    settling = { size, late };
    fit();
    schedule();
  }

  function pump(): void {
    if (engine === undefined) {
      return;
    }

    // Shown, a frame takes its whole share; hidden, a smaller one: nothing is drawn then and the parse is all the work, kept to a bounded part of every frame all the same.
    const share = visible ? FLOW.frame : FLOW.hiddenFrame;
    let taken = 0;
    // A replay is asked of the feed on every pump, a call of a function: the one of a terminal the page took back is applied before anything live is read (the feed reads nothing until it is taken), and a LATE one, for a stream
    // that lost bytes the page asked for or a gap the host reported, comes while the emulator holds output and is applied just the same. One at a time: the next waits in the feed until the one being applied is parsed. The emulator is let
    // parse what it was given first, so that its answers to those bytes are the shell's, and the live bytes after the replay are not read until it is applied (the feed holds them back until the replay is taken, and they
    // follow it).
    if (replaying === undefined) {
      replayHeld ??= feed.takeReplay?.();
      if (replayHeld !== undefined) {
        if (pending > 0) {
          return;
        }

        const next = replayHeld;
        replayHeld = undefined;
        beginReplay(engine, next);
      }
    }

    for (;;) {
      const room = FLOW.high - pending;
      if (room <= 0) {
        blocked = true;
        return;
      }

      const budget = Math.min(room, share - taken);
      if (budget <= 0) {
        // This frame's share is taken: what the feed still holds is the next frame's.
        schedule();
        return;
      }

      if (replaying !== undefined) {
        const written = replaySlice(engine, budget);
        if (written === 0) {
          // Every byte of the replay is written and the last is not parsed yet: its parse goes on.
          return;
        }

        taken += written;
        continue;
      }

      const out = feed.read(budget);
      if (out.chunks.length === 0) {
        break;
      }

      send(engine, out.chunks);
      taken += out.bytes;
    }

    // How the process ended is the last line of its output, and what the host said of a program that kept the terminal open after it. A terminal this page lost while its shell runs on says so, and says how it ended when it
    // ends later. A start that failed says why, where the shell's prompt would have been.
    const status = feed.getSnapshot();
    if (status.state === 'ended') {
      const line = exitLine(status);
      if (line !== endLine) {
        endLine = line;
        engine.write(muted(line));
      }

      const drain = drainLine(status);
      if (drain !== '' && !drainWritten) {
        drainWritten = true;
        engine.write(muted(drain));
      }
    }

    if (status.state === 'failed' && !failureWritten) {
      failureWritten = true;
      for (const line of failureLines(status)) {
        engine.write(muted(line));
      }
    }
  }

  /** The feed told us something: a new status is applied, and whatever it is the output it holds is drawn in the next frame. */
  function heard(): void {
    const status = feed.getSnapshot();
    if (status !== lastStatus) {
      lastStatus = status;
      engine?.setInput(takesInput(status));
    }

    schedule();
  }

  /** Measures the host; the emulator follows it, and the feed is told only a size that changed. */
  function fit(): void {
    // While a replay is written the emulator keeps the size its bytes were written under: the measure is taken when its last byte is parsed.
    if (!visible || engine === undefined || !rendererReady || replaying !== undefined) {
      return;
    }

    const cells = engine.measure();
    if (cells === undefined) {
      return;
    }

    const now = engine.size();
    if (cells.cols !== now.cols || cells.rows !== now.rows) {
      engine.resize(cells.cols, cells.rows);
    }

    // After a replay the host's terminal has the size the replay says. When that is not the panel's and the replay came late, the feed is told the panel's size again: it was told it before the gap, and whoever held the terminal
    // meanwhile (a tab that took it over) may have changed the host's, so that the host and the emulator would stay two sizes. The feed settles what it is told against what it knows of the host's size.
    const host = settling;
    const apart = host !== undefined && (host.size.cols !== cells.cols || host.size.rows !== cells.rows);
    if ((apart && host.late) || told?.cols !== cells.cols || told.rows !== cells.rows) {
      told = cells;
      feed.resize(cells.cols, cells.rows);
    }

    // A replay brought the emulator to the bytes a full-screen program wrote, and the program must paint over them. The host signals it when its terminal changes size; when the size the host has is the one the panel has
    // there is nothing to send, so the program is asked to paint again. A terminal that is over, or that another tab took, has no program for this page to paint.
    if (host !== undefined) {
      settling = undefined;
      if (!apart && takesInput(feed.getSnapshot())) {
        feed.redraw?.();
      }
    }
  }

  function onKey(event: KeyboardEvent): boolean {
    // A session that takes no input has nothing to type in, but the emulator still takes the Tab that reaches its input and cancels it: the focus would stay in the screen for every Tab that follows, and the controls of the lane
    // after it (Take it back) would be out of reach (a keyboard trap, WCAG 2.1.1). So Tab and Shift Tab are the browser's then: not handled and not stopped, and the browser moves the focus on. Option Tab too: Safari leaves
    // buttons out of the Tab order, and Option Tab is how it reaches them (nothing is sent to a session that takes no input, so nothing is lost). A Tab with Control or Command is not this one, and no other key is: they answer
    // as they did. While the session takes input Tab is the shell's, with Option or without, and F6 is the way out of the screen.
    if (event.key === 'Tab' && !event.ctrlKey && !event.metaKey && !takesInput(feed.getSnapshot())) {
      return false;
    }

    const sequence = event.type === 'keydown' ? sequenceOf(event, deps.platform) : undefined;
    if (sequence !== undefined) {
      // A Mac IDE's own bytes for word and line movement (keys.ts): the emulator's encoding of the key is not sent.
      event.preventDefault();
      if (takesInput(feed.getSnapshot())) {
        typed(sequence);
      }

      return false;
    }

    switch (keyOf(event, deps.platform, engine?.hasSelection() === true)) {
      case 'terminal':
        return true;
      case 'leave':
      case 'app':
        return false;
      case 'paste':
        // The emulator must not also send the key: the browser's paste event reaches it.
        return false;
      case 'copy':
        event.preventDefault();
        if (event.type === 'keydown') {
          void copy();
        }

        return false;
      case 'selectAll':
        event.preventDefault();
        if (event.type === 'keydown') {
          engine?.selectAll();
        }

        return false;
      case 'clear':
        event.preventDefault();
        if (event.type === 'keydown') {
          engine?.clear();
        }

        return false;
    }
  }

  async function copy(): Promise<boolean> {
    const text = engine?.selection() ?? '';
    return text === '' ? false : deps.copy(text);
  }

  /** Gives the emulator the window's screen reader choice when it is not what the emulator has: the choice is read when the screen is shown and again whenever it changes while the screen is on screen. */
  function follow(): void {
    const mode = deps.screenReader.getSnapshot();
    if (engine !== undefined && mode !== readerMode) {
      readerMode = mode;
      engine.setScreenReaderMode(mode);
    }
  }

  /** The screen is on screen: the emulator draws in the host, follows its size and the window's screen reader choice. */
  function attach(emulator: Engine): void {
    rendererReady = false;
    showings += 1;
    const showing = showings;
    // The GPU's cells are not the DOM's (it rounds the cell to whole device pixels): until it is in place nothing is measured and the feed is told no size, so that the process starts at the size the person sees and
    // nothing is resized after it started. A renderer that could not be had is the DOM's, which is then the size the person sees.
    const inPlace = () => {
      if (showing === showings && visible) {
        rendererReady = true;
        fit();
      }
    };

    void emulator.setRenderer('gpu').then(inPlace, inPlace);
    if (host !== undefined) {
      stopObserving = deps.observe(host, fit);
    }

    follow();
    stopReader = deps.screenReader.subscribe(follow);
    heard();
  }

  /** The screen is off screen: what only a screen on show needs is let go of. It goes on reading the feed. */
  function detach(): void {
    stopReader?.();
    stopReader = undefined;
    stopObserving?.();
    stopObserving = undefined;
  }

  function create(): void {
    if (factory === undefined || host === undefined) {
      return;
    }

    readerMode = deps.screenReader.getSnapshot();
    const made = factory({ cols: INITIAL.cols, rows: INITIAL.rows, scrollback: SCROLLBACK, appearance: deps.appearance(host), screenReaderMode: readerMode });
    engine = made;
    made.open(host);
    made.describe(label, deps.descriptionId);
    made.setKeys(onKey);
    stops.push(
      made.onData((data, user) => {
        // What the emulator says by itself while a replay is applied is not for the shell: it answers the queries in the bytes, and the program that asked them is long past (switching on focus events makes it report focus, too).
        // What the person types in that window is theirs: it is kept, and sent once the replay is applied.
        if (user) {
          typed(data);
        } else if (replaying === undefined) {
          feed.write(data);
        }
      }),
      made.onSelection(() => {
        const selected = made.hasSelection();
        if (selected !== snapshot.selected) {
          set({ selected });
        }
      }),
      // The emulator is silent: the host shows the bell, on the screen, and never makes a sound. Two names for the one animation restart it for each bell without a timer.
      made.onBell(() => {
        if (host !== undefined) {
          host.setAttribute('data-bell', host.getAttribute('data-bell') === 'a' ? 'b' : 'a');
        }
      }),
    );
    lastStatus = feed.getSnapshot();
    made.setInput(takesInput(lastStatus));
    set({ ready: true });
    // From here on the screen reads whether or not it is shown: a session that is not shown must not stall its shell.
    stopFeed = feed.subscribe(heard);
    attach(made);
  }

  async function start(): Promise<void> {
    const element = host;
    if (loading || element === undefined) {
      return;
    }

    loading = true;
    set({ error: undefined });
    try {
      factory ??= await deps.load();
      const { fontSize, fontFamily } = deps.appearance(element);
      await deps.fontsReady(`${String(fontSize)}px ${fontFamily}`);
    } catch (error) {
      loading = false;
      if (!disposed) {
        warn('[terminal] the terminal view could not be loaded', error);
        set({ error: error instanceof Error ? error.message : String(error) });
      }

      return;
    }

    loading = false;
    // Hidden again, or gone, while the code came: the next show makes the emulator.
    if (!disposed && visible && engine === undefined) {
      create();
    }
  }

  return {
    mount: (element) => {
      host = element;
      clearers.set(element, () => {
        engine?.clear();
      });
    },

    show: () => {
      if (disposed || visible) {
        return;
      }

      visible = true;
      if (engine === undefined) {
        void start();
      } else {
        attach(engine);
      }
    },

    hide: () => {
      if (!visible) {
        return;
      }

      visible = false;
      rendererReady = false;
      if (engine !== undefined) {
        detach();
        void engine.setRenderer('dom');
        // A hidden terminal has no accessibility layer: the emulator refreshes its layer a second at most after the lines it was given, so one printed just before the panel was hidden would be refreshed IN the hidden panel
        // (measured: 37 document mutations). It goes out of the mode here, once, and `follow` puts it back in when the screen is shown.
        if (readerMode) {
          readerMode = false;
          engine.setScreenReaderMode(false);
        }
      }
    },

    focus: () => {
      if (engine === undefined || !visible) {
        return false;
      }

      engine.focus();
      return true;
    },

    clear: () => {
      engine?.clear();
    },

    copy,

    refresh: () => {
      if (host !== undefined) {
        engine?.setAppearance(deps.appearance(host));
        // A new text size changes the cells that fit while the host's own rectangle did not move, so no observer says it: the grid is measured again (it sends nothing when the size is the same).
        fit();
      }
    },

    rename: (next) => {
      if (next === label) {
        return;
      }

      label = next;
      engine?.describe(label, deps.descriptionId);
    },

    dispose: () => {
      if (disposed) {
        return;
      }

      disposed = true;
      if (host !== undefined) {
        clearers.delete(host);
      }

      visible = false;
      detach();
      stopFeed?.();
      stopFeed = undefined;
      cancelFrame?.();
      cancelFrame = undefined;
      cancelLater?.();
      cancelLater = undefined;
      for (const stop of stops.splice(0)) {
        stop();
      }

      engine?.dispose();
      engine = undefined;
    },

    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    getSnapshot: () => snapshot,
  };
}
