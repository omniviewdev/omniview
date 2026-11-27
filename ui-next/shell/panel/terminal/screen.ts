import type { Platform } from '../../core/chords';
import { CURSOR_INIT, FULL_RESET, modesPrologue, type Engine, type EngineAppearance, type EngineLoader, type EngineOptions, type Finder, type LinkHandler } from './engine';
import type { PlacedMark, TerminalFeedHandle, TerminalFeedSnapshot, TerminalReplay, TerminalSize } from './feed';
import { keyOf, sequenceOf } from './keys';
import { DEFAULT_PREFERENCES_SOURCE, type PreferencesSource, type TerminalPreferences } from './preferences';
import type { ScreenReaderSource } from './screenReader';
import { createCommandGutter, type CommandGutter, type GutterEvent } from './gutter/commandGutter';
import { COPIED_OUTPUT, COULD_NOT_COPY, INPUT_OFF, NO_COMMANDS, NO_LINE, NO_OUTPUT, NO_SUCH_COMMAND, RERUN_EARLIER, RERUN_RUNNING, RERUN_SENT, RERUN_TYPED, SCREEN_TAKEN } from './gutter/words';
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
//     last slice is parsed: it answers the queries in those bytes, and the program that asked them is long past, so its answers must never reach the shell. The reader acknowledges no replayed byte: the feed credits the replay's bytes to the host as they arrive,
//     since the host counts every output frame against its window. When the last is parsed the emulator takes the size the host's terminal has, and then the panel's measure; when the size the feed is told is that size, a full-screen program is made to paint again (a
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

/** No bytes: a write of them runs when what was written before it is parsed. */
const NOTHING = new Uint8Array(0);

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
  /**
   * The person's settings (`preferences.ts`). The emulator is made after the host's first answer, in the scrollback it holds; a change of the font, its size, its line height or the cursor is applied to the emulator that is there
   * (the font loaded first, when its family changed), at once when the screen is shown and when it is shown again if it was not; the rest of what it holds is read by later steps. Default: the host's own defaults, forever.
   */
  readonly preferences?: PreferencesSource | undefined;
  /** Puts text on the clipboard; says whether it could. */
  readonly copy: (text: string) => Promise<boolean>;
  readonly warn?: ((message: string, error?: unknown) => void) | undefined;
  /** The find chord was pressed in the terminal (Command F, or Control F and Control Shift F elsewhere): the screen stops the key and says so. Without it the key is the terminal's, or the window's, as it was. */
  readonly onFind?: (() => void) | undefined;
  /**
   * A key that steps a find was pressed in the terminal (F3 and Shift F3, and Command G and Command Shift G on a Mac): says whether the find bar took it. When it did the screen stops the key; when it did not, or there is no
   * handler, the key is the terminal's (F3 goes to the shell) or the window's (Command G), as it was.
   */
  readonly onFindStep?: ((direction: 'next' | 'previous') => boolean) | undefined;
  /**
   * Escape was pressed in the terminal with no modifier, with no input method composing: says whether the find bar took it (it closes). The bar is asked first. When it took the key the screen stops it: nothing is sent to the
   * shell, and the window's region keys, which move the focus to the page for an Escape, do not see it. When it did not, or there is no handler, Escape is the shell's, as it is (programs need it).
   */
  readonly onFindClose?: (() => boolean) | undefined;
  /**
   * Enter was pressed in the terminal, plain, while the session takes no input (it ended or failed): says whether the session restarts. When it does the screen stops the key (nothing is sent and the emulator does not take it); when it does
   * not, or there is no handler, Enter is what it was. Never asked while the session takes input: Enter is the shell's.
   */
  readonly onRestart?: (() => boolean) | undefined;
};

/**
 * What a person does with the commands the shell's marks made (issue #694 step 5): jump to the previous and the next, select, copy and run again. Every action says what it did, for a person who cannot see the view move
 * (`onEvent`), and the hover of a mark is told the same way.
 */
export type ScreenCommands = {
  /** There are commands to act on, and the emulator is not showing a program's alternate screen: the jump keys are the terminal's. */
  readonly has: () => boolean;
  /** What the menu offers now: how many commands, whether the target printed output, and the reason a command cannot be run again (`undefined`: it can). */
  /** A string that changes when what the menu offers may have: cheap (no output is read), for a menu that is open to be put away. */
  readonly revision: () => string;
  readonly state: () => { readonly count: number; readonly output: boolean; readonly rerun: string | undefined };
  readonly jump: (direction: 'previous' | 'next', options?: { readonly select?: boolean }) => void;
  /** Moves the view to the command with this id and says where it went. Held until the screen has placed the marks it holds (the feed's held output and the markers of its replay), then done once: a command the placed screen does not hold is said to be gone, once. */
  readonly reveal: (command: string, generation?: number) => void;
  readonly selectOutput: () => void;
  readonly copyOutput: () => Promise<boolean>;
  /** Types the target's command line into the shell (and Enter only for a line the shell proved). */
  readonly rerun: () => void;
  /** The gutter's events: where the pointer is on a mark, and what an action did. Returns what stops it. */
  readonly onEvent: (listener: (event: GutterEvent) => void) => () => void;
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
  /** The emulator's finder, once the emulator is there (`undefined` before it is made, or after the screen is disposed): see `Engine.find`. The code that finds is loaded by the first call. */
  readonly find: () => Promise<Finder | undefined>;
  /** Whether the program in the terminal has the mouse (false before the emulator is made). */
  readonly mouseReporting: () => boolean;
  /** Pastes text as the person's own input (nothing before the emulator is made). */
  readonly paste: (text: string) => void;
  /** Sets these attributes on the element that takes the keys, and removes those an earlier call set that are not in these. What is asked before the emulator is made is given to it when it is. */
  readonly decorateInput: (attributes: Readonly<Record<string, string>>) => void;
  /** The links in the output are given to `handler`; `undefined` makes none. What is asked before the emulator is made is given to it when it is. */
  readonly setLinks: (handler: LinkHandler | undefined) => void;
  /** Selects the whole buffer, the screen and the scrollback (nothing before the emulator is made): the key does it too. */
  readonly selectAll: () => void;
  /**
   * The session was given another feed in place of the ended one that this screen shows (a restart): the screen goes on with it, with the emulator it has, so that the transcript stays above the new process, after a separator. The ended feed is let
   * go of, and the new one is told the size of the screen at once. Nothing before the emulator is made, and nothing once the screen is disposed.
   */
  readonly continueWith: (next: TerminalFeedHandle) => void;
  /** Draws what the feed still holds and how it ended, now: what a restart does before it lets the ended feed go. */
  readonly flush: () => void;
  /** The commands of the shell's marks: nothing before the emulator is made. */
  readonly commands: ScreenCommands;
};

/** Text in the muted colour of the transcript's own lines, on a line of its own (the escape sequences are the emulator's: reset, bright black, reset). The palette's bright black is the theme's muted text; the emulator's dim style would be half the opacity of any colour, which no contrast rule can pass. */
const muted = (text: string): string => `\u001b[0m\r\n\u001b[90m${text}\u001b[0m\r\n`;

/** What of the person's settings changes how the emulator looks: the font names, the size, the line height and the cursor. */
const lookOf = (preferences: TerminalPreferences): string => JSON.stringify([preferences.fontFamily, preferences.fontSize, preferences.lineHeight, preferences.cursorStyle]);

/** What the transcript gets between an ended process and its restart, before the muted line: the soft terminal reset (`DECSTR`) after the modes a program may have left on are switched off by name (mouse tracking and its encodings, focus events, bracketed paste, application cursor keys: DECSTR resets none of the mouse), and the way out of the alternate screen that keeps the normal screen's cursor (`?47l`: `?1049l` would restore a saved cursor that DECSTR has reset, to the top). */
const SEPARATOR = '\u001b[?47l\u001b[?1000l\u001b[?1002l\u001b[?1003l\u001b[?1004l\u001b[?1005l\u001b[?1006l\u001b[?1015l\u001b[?2004l\u001b[?1l\u001b[!p';

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
  /** The feed the screen reads: the session's feed, and the next one when the session is restarted (`continueWith`). */
  let feed = deps.feed;
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
  const preferences = deps.preferences ?? DEFAULT_PREFERENCES_SOURCE;
  /** What of the person's settings the emulator was last given (`lookOf`), and the family of its font: a change of the family is a font to load. */
  let appliedLook = lookOf(preferences.getSnapshot());
  let appliedFamily: string | undefined;
  /** The changes of look so far: a font that comes after a later change is not applied. */
  let looks = 0;
  /** A change of look came while the screen was not shown: it is applied when the screen is. */
  let lookWaits = false;
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
  /** A restart came while bytes of the ended feed's replay were still queued in the emulator: what it answers to them is not for the new shell. */
  let draining = false;
  /** The restarts so far: the barrier of a restart ends the muting only when no newer restart came after it (the middle feed's queued bytes are still being parsed then). */
  let restarts = 0;
  let blocked = false;
  /** A replay the feed gave while the emulator was still parsing what came before it: applied once it has, so that what the emulator says of those bytes is the shell's and what it says of the replay is not. */
  let replayHeld: TerminalReplay | undefined;
  /** The emulator holds output: live bytes were written to it, or a replay was applied. A replay that comes after that is a LATE one (a stream that lost bytes, a gap), not the first of a terminal the page took back. */
  let holds = false;
  /** The replay being applied: its bytes are written a share at a time, and nothing the emulator says is heard until the last of them is parsed. */
  let replaying: { readonly replay: TerminalReplay; readonly late: boolean; written: number; marked: number; placing: number; bytesDone: boolean } | undefined;
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
  /** The attributes the host asked the emulator's input to have, and the handler it asked its links to have: kept for an emulator that is not made yet, and given to the one that is. */
  let inputAttributes: Readonly<Record<string, string>> | undefined;
  let linkHandler: LinkHandler | undefined;
  /** The command gutter of the emulator: made with it. */
  let gutter: CommandGutter | undefined;
  /**
   * The commands of the ended terminal are sealed where the emulator stands once it has parsed everything queued before the restart, in order with those writes: the marks the old feed's writes still carry are the old terminal's, and what
   * comes after is the new one's. Like a mark's write, it is no byte and holds a replay back until it has run.
   */
  function sealAfterQueued(emulator: Engine): void {
    markWrites += 1;
    restarts += 1;
    const mine = restarts;
    // Set BEFORE the barrier is queued: an emulator may run its callback at once (an empty queue), and the muting must end there and not be set again after it.
    draining = true;
    emulator.write(NOTHING, () => {
      markWrites -= 1;
      // Everything queued before the restart is parsed: what the emulator answers from here on is for the new shell.
      draining = restarts !== mine;
      gutter?.seal();
      if (markWrites === 0 && replayHeld !== undefined && pending === 0) {
        schedule();
      }

      flushReveal();
    });
  }

  /** The writes that make markers that the emulator has not run yet: a replay is not begun while one waits (it would let go of the gutter under it). */
  let markWrites = 0;
  /** The screen has read everything the feed held and the markers of it are made: a command can be asked for. A request made before is held (one: the newest) and done at that point. */
  let placedOnce = false;
  let heldReveal: { readonly command: string; readonly generation: number | undefined } | undefined;
  const placed = (): boolean => placedOnce && engine !== undefined && markWrites === 0 && replaying === undefined && replayHeld === undefined;
  const doReveal = (command: string, generation: number | undefined): void => {
    if (engine?.alternate() === true) {
      sayCommands(SCREEN_TAKEN);
      return;
    }

    // The gutter says where it went, or that the command is gone.
    if (gutter === undefined) {
      sayCommands(NO_SUCH_COMMAND);
    } else {
      gutter.reveal(command, generation);
    }
  };

  const flushReveal = (): void => {
    if (heldReveal !== undefined && placed()) {
      const { command, generation } = heldReveal;
      heldReveal = undefined;
      doReveal(command, generation);
    }
  };

  const commandListeners = new Set<(event: GutterEvent) => void>();

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
  function parsed(bytes: number, owner: TerminalFeedHandle | undefined): void {
    pending -= bytes;

    // What the emulator parsed is credited to the feed it came from: a restart may have given the screen another feed since.
    owner?.ack(bytes);

    if ((blocked && pending < FLOW.high / 2) || (replayHeld !== undefined && pending === 0 && markWrites === 0)) {
      blocked = false;
      schedule();
    }
  }

  /**
   * The marks of the shell stand here, between the bytes written so far and the bytes after them: an empty write, which the emulator runs when it has parsed what was written before it, makes their markers (a marker made before
   * the parse reads the line the cursor was on, xterm.js #5214). It is no byte, and is neither counted nor acknowledged.
   */
  function place(emulator: Engine, group: readonly PlacedMark[], inReplay?: NonNullable<typeof replaying>): void {
    markWrites += 1;
    if (inReplay !== undefined) {
      inReplay.placing += 1;
    }

    emulator.write(NOTHING, () => {
      markWrites -= 1;
      gutter?.ingest(group.map((one) => one.mark));
      if (inReplay !== undefined) {
        inReplay.placing -= 1;
        if (replaying === inReplay) {
          finishReplayWhenPlaced();
        }
      }

      if (markWrites === 0 && replayHeld !== undefined && pending === 0) {
        schedule();
      }

      flushReveal();
    });
  }

  /** Writes what is held in slices the emulator parses without a long task, counts what it has accepted and not parsed, and tells the feed what it parsed: the host paces the shell by that. The slices end where a mark stands. */
  function send(emulator: Engine, chunks: readonly Uint8Array[], marks: readonly PlacedMark[] = []): void {
    holds = true;
    const owner = feed;
    let piece: Uint8Array | undefined = new Uint8Array(FLOW.slice);
    let filled = 0;
    // The bytes handed over so far, and the next mark that has not been placed.
    let handed = 0;
    let next = 0;
    const flush = () => {
      if (filled === 0) {
        return;
      }

      const bytes = filled;
      pending += bytes;
      // A full scratch is handed over whole and a new one made when more comes; a short one (a mark cut the slice) is copied to a buffer of its own size, so that the write does not hold the 64 KiB until it is parsed.
      const scratch = piece ?? new Uint8Array(0);
      const out = bytes === FLOW.slice ? scratch : scratch.slice(0, bytes);
      emulator.write(out, () => {
        parsed(bytes, owner);
      });
      if (bytes === FLOW.slice) {
        piece = undefined;
      }

      filled = 0;
    };

    const placeDue = (all: boolean) => {
      const from = next;
      while (next < marks.length && (all || (marks[next]?.at ?? Infinity) <= handed)) {
        next += 1;
      }

      if (next > from) {
        flush();
        place(emulator, marks.slice(from, next));
      }
    };

    placeDue(false);
    for (const chunk of chunks) {
      for (let at = 0; at < chunk.length; ) {
        const untilMark = next < marks.length ? Math.max(1, (marks[next]?.at ?? Infinity) - handed) : Infinity;
        const take = Math.min(chunk.length - at, FLOW.slice - filled, untilMark);
        piece ??= new Uint8Array(FLOW.slice);
        piece.set(chunk.subarray(at, at + take), filled);
        filled += take;
        at += take;
        handed += take;
        if (filled === FLOW.slice) {
          flush();
        }

        placeDue(false);
      }
    }

    flush();
    // A mark that claims a place past the bytes (a host that did not cut) stands after them.
    placeDue(true);
  }

  /** One write of a replay: counted as accepted until it is parsed, never acknowledged, and the last of them ends the replay. */
  function writeReplay(emulator: Engine, piece: Uint8Array | string, last: boolean): void {
    const bytes = typeof piece === 'string' ? 0 : piece.length;
    pending += bytes;
    emulator.write(piece, () => {
      parsed(bytes, undefined);
      if (last && replaying !== undefined) {
        replaying.bytesDone = true;
        finishReplayWhenPlaced();
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
    gutter?.reset();
    replaying = { replay: taken, late, written: 0, marked: 0, placing: 0, bytesDone: false };
    const { cols, rows } = taken.startSize;
    const now = emulator.size();
    if (now.cols !== cols || now.rows !== rows) {
      emulator.resize(cols, rows);
    }

    // An emulator that was only written to draws no cursor (`CURSOR_INIT`). The reset leaves it on the normal screen, so a replay that starts there needs the bounce; one that starts on the alternate screen switches to it in its modes.
    const cursor = taken.startModes.altScreen ? '' : CURSOR_INIT;
    writeReplay(emulator, `${FULL_RESET}${cursor}${modesPrologue(taken.startModes)}`, taken.data.length === 0);
    placeReplayMarks(emulator);
  }

  /** Writes the next slice of the replay's bytes, at most `budget` of them, and says how many: none once they all are written, when the parse of the last slice ends the replay. */
  function replaySlice(emulator: Engine, budget: number): number {
    if (replaying === undefined) {
      return 0;
    }

    const { data, marks } = replaying.replay;
    let count = Math.min(data.length - replaying.written, FLOW.slice, budget);
    // The slice ends where the next mark stands.
    const markAt = marks?.[replaying.marked]?.at;
    if (markAt !== undefined && markAt > replaying.written) {
      count = Math.min(count, markAt - replaying.written);
    }

    if (count <= 0) {
      return 0;
    }

    const at = replaying.written;
    replaying.written += count;
    writeReplay(emulator, data.subarray(at, at + count), replaying.written === data.length);
    placeReplayMarks(emulator);
    return count;
  }

  /** Places the marks of the replay that stand at the bytes written so far (the ones at its first byte after its prologue, the ones inside after the slice that ends at them, the ones at its end after the last). */
  function placeReplayMarks(emulator: Engine): void {
    if (replaying === undefined) {
      return;
    }

    const { marks } = replaying.replay;
    const from = replaying.marked;
    let next = from;
    while (next < (marks?.length ?? 0) && (marks?.[next]?.at ?? Infinity) <= replaying.written) {
      next += 1;
    }

    if (marks !== undefined && next > from) {
      replaying.marked = next;
      place(emulator, marks.slice(from, next), replaying);
    }
  }

  /** The last byte of the replay is parsed and every mark of it is placed (the ones at its end after it): the replay is over. A mark placed after the replay ended would be made at a size and a time that are not the replay's. */
  function finishReplayWhenPlaced(): void {
    if (replaying !== undefined && replaying.bytesDone && replaying.placing === 0 && replaying.marked >= (replaying.replay.marks?.length ?? 0)) {
      finishReplay();
    }
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

  /**
   * How the process ended is the last line of its output, and what the host said of a program that kept the terminal open after the shell exited. A terminal this page lost while its shell runs on says so, and says how it ended when it
   * ends later. A start that failed says why, where the shell's prompt would have been. Each is written once for a feed.
   */
  function tellEnd(emulator: Engine): void {
    const status = feed.getSnapshot();
    if (status.state === 'ended') {
      const line = exitLine(status);
      if (line !== endLine) {
        endLine = line;
        emulator.write(muted(line));
      }

      const drain = drainLine(status);
      if (drain !== '' && !drainWritten) {
        drainWritten = true;
        emulator.write(muted(drain));
      }
    }

    if (status.state === 'failed' && !failureWritten) {
      failureWritten = true;
      for (const line of failureLines(status)) {
        emulator.write(muted(line));
      }
    }
  }

  function pump(): void {
    if (engine === undefined) {
      return;
    }

    placedOnce = false;

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
        if (pending > 0 || markWrites > 0) {
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
      if (out.chunks.length === 0 && out.marks === undefined) {
        break;
      }

      send(engine, out.chunks, out.marks);
      taken += out.bytes;
    }

    placedOnce = true;
    tellEnd(engine);
    flushReveal();
  }

  /** The feed told us something: a new status is applied, and whatever it is the output it holds is drawn in the next frame. */
  function heard(): void {
    // The feed holds something that has not been read: the marks it holds are not placed until the next frame has read them.
    placedOnce = false;
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

    // Enter restarts a session that is over, when the session can be restarted (the one who answers knows): it is the key of the lane's Restart. While the session takes input Enter is the shell's.
    if (event.type === 'keydown' && event.key === 'Enter' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && !event.repeat && event.keyCode !== 229 && !takesInput(feed.getSnapshot()) && deps.onRestart?.() === true) {
      event.preventDefault();
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

    const kind = keyOf(event, deps.platform, engine?.hasSelection() === true);
    switch (kind) {
      case 'terminal':
        // Escape closes the find bar first, unless an input method has the key: it cancels a composition, and some browsers report the key that ends one with `isComposing` already false and the key code 229, so both are asked (as the bar's own keys do).
        if (event.type === 'keydown' && event.key === 'Escape' && !event.isComposing && event.keyCode !== 229 && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && deps.onFindClose?.() === true) {
          event.preventDefault();
          event.stopPropagation();
          return false;
        }

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
      case 'find':
        // The find opens, in a terminal that takes input or not (an ended session has its output to search). With no one to tell the key is what it was: Control F is the shell's, and the Command and Control Shift chords the window's.
        if (deps.onFind === undefined) {
          return !event.metaKey && !event.shiftKey;
        }

        event.preventDefault();
        if (event.type === 'keydown') {
          deps.onFind();
        }

        return false;
      case 'findNext':
      case 'findPrevious':
        // The bar takes the step or it does not: when it does not, F3 reaches the shell and Command G is the window's, as they were.
        if (event.type === 'keydown' && deps.onFindStep?.(kind === 'findNext' ? 'next' : 'previous') === true) {
          event.preventDefault();
          return false;
        }

        return !event.metaKey;
      case 'previousCommand':
      case 'nextCommand':
      case 'selectPreviousCommand':
      case 'selectNextCommand':
        // With no commands to go to, or a program that has the whole screen, the key is what it was: the window's on a Mac, the shell's elsewhere.
        if (!commands.has()) {
          return deps.platform !== 'mac' && !event.shiftKey;
        }

        event.preventDefault();
        if (event.type === 'keydown') {
          commands.jump(kind === 'previousCommand' || kind === 'selectPreviousCommand' ? 'previous' : 'next', { select: kind === 'selectPreviousCommand' || kind === 'selectNextCommand' });
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

  /**
   * Applies the look the page reads now (the theme's colours, the person's font, size, line height and cursor) to the emulator that is there. A new FAMILY is a font that may not be loaded: the emulator measures its cell when it is
   * given the font, and measures the fallback's if it is not loaded yet, so the family is awaited first (`fontsReady`) and the look is read again after, in case a later change came meanwhile (that change applies it, and this one
   * ends). A change of the size, the line height or the cursor needs no font and is applied before this returns. The grid is measured again after (a new text size changes the cells that fit while the host's own rectangle did not
   * move, so no observer says it; it sends nothing when the size is the same). A screen that is not shown keeps the change for when it is: nothing is measured behind a hidden element.
   */
  async function look(): Promise<void> {
    const emulator = engine;
    if (emulator === undefined || host === undefined) {
      return;
    }

    if (!visible) {
      lookWaits = true;
      return;
    }

    looks += 1;
    const mine = looks;
    const wanted = deps.appearance(host);
    if (wanted.fontFamily !== appliedFamily) {
      try {
        await deps.fontsReady(`${String(wanted.fontSize)}px ${wanted.fontFamily}`);
      } catch {
        // A font that cannot load is the fallback's.
      }

      if (mine !== looks || disposed || engine !== emulator || host === undefined) {
        return;
      }

      if (!visible) {
        lookWaits = true;
        return;
      }
    }

    const applied = deps.appearance(host);
    emulator.setAppearance(applied);
    appliedFamily = applied.fontFamily;
    fit();
  }

  /** Applies the look and says what could not be: nothing awaits it. */
  function applyLook(): void {
    look().catch((error: unknown) => {
      warn('[terminal] the look of the terminal could not be applied', error);
    });
  }

  /** The host's settings changed (or its first answer came after the emulator was made): a change of what the emulator looks like is applied, and nothing else is told to it. */
  function preferencesChanged(): void {
    const now = lookOf(preferences.getSnapshot());
    if (now === appliedLook) {
      return;
    }

    appliedLook = now;
    applyLook();
  }

  /** The screen is on screen: the emulator draws in the host, follows its size and the window's screen reader choice. */
  function attach(emulator: Engine): void {
    if (lookWaits) {
      lookWaits = false;
      applyLook();
    }

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
    const person = preferences.getSnapshot();
    const look = deps.appearance(host);
    const made = factory({ cols: INITIAL.cols, rows: INITIAL.rows, scrollback: deps.preferences === undefined ? SCROLLBACK : person.scrollback, appearance: look, screenReaderMode: readerMode });
    engine = made;
    appliedLook = lookOf(person);
    appliedFamily = look.fontFamily;
    stops.push(preferences.subscribe(preferencesChanged));
    gutter = createCommandGutter(made);
    stops.push(
      gutter.onEvent((event) => {
        tellCommands(event);
      }),
    );
    made.open(host);
    made.describe(label, deps.descriptionId);
    made.setKeys(onKey);
    if (inputAttributes !== undefined) {
      made.decorateInput(inputAttributes);
    }

    if (linkHandler !== undefined) {
      made.setLinks(linkHandler);
    }

    stops.push(
      made.onData((data, user) => {
        // What the emulator says by itself while a replay is applied is not for the shell: it answers the queries in the bytes, and the program that asked them is long past (switching on focus events makes it report focus, too).
        // What the person types in that window is theirs: it is kept, and sent once the replay is applied.
        if (user) {
          typed(data);
        } else if (replaying === undefined && !draining) {
          feed.write(data, { reply: true });
        }
      }),
      // A mouse report in raw bytes (a legacy X10 click). It refers to the screen the person sees: while a replay is applied the screen is about to be replaced, and the report is dropped, as the emulator's other answers are.
      made.onBinary((bytes) => {
        if (replaying === undefined) {
          feed.writeBinary(bytes);
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
      // The person's font is known before it is loaded: a terminal is made in the settings the host holds and not in the defaults.
      if (deps.preferences !== undefined) {
        await deps.preferences.settled();
      }

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

  const tellCommands = (event: GutterEvent) => {
    for (const listener of [...commandListeners]) {
      listener(event);
    }
  };

  const sayCommands = (words: string) => {
    tellCommands({ kind: 'said', words });
  };

  /** Why the line of the command cannot be typed again now, or nothing when it can. */
  const rerunBlocked = (): string | undefined => {
    if (gutter === undefined || gutter.commands().length === 0) {
      return NO_COMMANDS;
    }

    if (!takesInput(feed.getSnapshot())) {
      return INPUT_OFF;
    }

    if (replaying !== undefined || gutter.busy()) {
      return RERUN_RUNNING;
    }

    return gutter.rerun() === undefined ? NO_LINE : undefined;
  };

  const commands: ScreenCommands = {
    has: () => gutter !== undefined && engine?.alternate() !== true && gutter.commands().length > 0,
    revision: () => `${String(gutter?.commands().length ?? 0)} commands, ${engine?.alternate() === true ? 'alternate' : 'normal'}, ${gutter?.busy() === true ? 'running' : 'idle'}, ${gutter?.hasOutput() === true ? 'output' : 'no output'}, ${takesInput(feed.getSnapshot()) ? 'input' : 'no input'}`,
    state: () => ({ count: gutter?.commands().length ?? 0, output: engine?.alternate() !== true && gutter?.hasOutput() === true, rerun: rerunBlocked() }),
    jump: (direction, options) => {
      gutter?.jump(direction, options);
    },
    reveal: (command, generation) => {
      heldReveal = { command, generation };
      flushReveal();
    },
    selectOutput: () => {
      if (engine?.alternate() === true) {
        sayCommands(NO_OUTPUT);
        return;
      }

      gutter?.selectOutput();
    },
    copyOutput: async () => {
      const text = engine?.alternate() === true ? undefined : gutter?.output();
      if (text === undefined) {
        sayCommands(NO_OUTPUT);
        return false;
      }

      const copied = await deps.copy(text);
      sayCommands(copied ? COPIED_OUTPUT : COULD_NOT_COPY);
      return copied;
    },
    rerun: () => {
      const blocked = rerunBlocked();
      const plan = blocked === undefined ? gutter?.rerun() : undefined;
      if (blocked !== undefined || plan === undefined || engine === undefined) {
        sayCommands(blocked ?? NO_LINE);
        return;
      }

      // The person's own input, as a paste is: a program that asked for bracketed paste gets the line between its markers, and the line is not run by the paste. Enter is pressed only for a line the shell proved.
      engine.paste(plan.text);
      if (plan.enter) {
        typed('\r');
      }

      sayCommands(plan.earlier === true ? RERUN_EARLIER : plan.enter ? RERUN_SENT : RERUN_TYPED);
    },
    onEvent: (listener) => {
      commandListeners.add(listener);
      return () => {
        commandListeners.delete(listener);
      };
    },
  };

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

    selectAll: () => {
      engine?.selectAll();
    },

    flush: () => {
      if (disposed || engine === undefined) {
        return;
      }

      // Everything the feed holds, whatever a frame's share: what is not drawn now is lost when the feed is let go of.
      for (;;) {
        const out = feed.read();
        if (out.chunks.length === 0 && out.marks === undefined) {
          break;
        }

        send(engine, out.chunks, out.marks);
      }

      tellEnd(engine);
    },

    continueWith: (next) => {
      if (disposed) {
        return;
      }

      stopFeed?.();
      stopFeed = undefined;
      feed = next;
      const emulator = engine;
      if (emulator === undefined) {
        // Nothing was drawn yet: there is no transcript to keep, and the emulator that comes reads this feed.
        return;
      }

      // The ended process's end, what it left on, and its failure are told again for the next one; nothing of the earlier feed is held or owed any more.
      replayHeld = undefined;
      // A replay of the ended feed that is still being written is dropped: its remaining slices are never written, what the queued ones make the emulator answer is muted until they are parsed, and what was typed meanwhile was for the ended terminal.
      replaying = undefined;
      // The commands of the ended terminal stay with its transcript, none of them runs any more, and the new terminal's are its own.
      sealAfterQueued(emulator);
      held = [];
      heldLength = 0;
      heldFull = false;
      endLine = '';
      drainWritten = false;
      failureWritten = false;
      settling = undefined;
      told = undefined;
      // A program that was killed may have left modes on (the mouse, bracketed paste, the alternate screen): the new shell starts from the terminal's own.
      emulator.write(`${SEPARATOR}${muted('[Restarted]')}`);
      lastStatus = next.getSnapshot();
      emulator.setInput(takesInput(lastStatus));
      stopFeed = next.subscribe(heard);
      // The size starts the new terminal: it is told at once when the screen is on show, and when it is shown otherwise.
      fit();
      schedule();
    },

    find: async () => (engine === undefined ? undefined : engine.find()),

    mouseReporting: () => engine?.mouseReporting() === true,

    paste: (text) => {
      engine?.paste(text);
    },

    decorateInput: (attributes) => {
      inputAttributes = attributes;
      engine?.decorateInput(attributes);
    },

    setLinks: (handler) => {
      linkHandler = handler;
      engine?.setLinks(handler);
    },

    copy,

    refresh: () => {
      applyLook();
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

      gutter?.dispose();
      gutter = undefined;
      commandListeners.clear();
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

    commands,
  };
}
