import type { Engine, EngineDecoration, EngineMarker } from '../engine';
import type { TerminalMark } from '../feed';
import { paintGlyph } from './glyph';
import { jumpWords, NO_COMMANDS, NO_NEXT, NO_OUTPUT, NO_PREVIOUS, SELECTED_OUTPUT, type CommandState } from './words';

// THE COMMAND GUTTER's MODEL (issue #694 step 5). The host types the marks of the shell's integration and addresses them by offset in the output; the feed hands each over with the bytes that end at it, and the screen takes it in the
// callback of the write that parses those bytes, so that a marker made here is on the line the parse left the cursor on (xterm.js #5214: a marker made before the parse reads line 0). From the marks the model keeps the commands:
// the line each was typed on, where its output starts and ends, and what the producer said of it, the host's word and the host's times, never a clock of the page.
//
//   - a command is made when its start mark comes (a prompt and an input start are kept for it until then; an end with no start, Ctrl-C at an empty prompt, makes none);
//   - the marker of the line it was typed on is the command's life: when the emulator drops that line (the scrollback is full, the buffer is cleared) the command goes, with its decoration;
//   - only a start mark the shell proved with the nonce has a command line, and only a directory the shell proved is a directory: the host decides it (`trust`), the page does not;
//   - none is made while a program has the alternate screen, and no more than `MAX_COMMANDS` are kept: a decoration is a DOM node of the emulator's for each.

export type GutterCommand = {
  readonly id: string;
  readonly state: CommandState;
  /** The command line, when the shell proved it. */
  readonly command?: string | undefined;
  readonly exit?: number | undefined;
  readonly durationMs?: number | undefined;
  readonly cwd?: string | undefined;
  /** The line of the buffer the command was typed on. */
  readonly line: number;
};

export type GutterEvent =
  | { readonly kind: 'hover'; readonly command: GutterCommand | undefined; readonly x: number; readonly y: number }
  | { readonly kind: 'said'; readonly words: string }
  /** The commands, their states or what the actions can do changed: a menu that is open is out of date. */
  | { readonly kind: 'commands' };

/** The most commands the gutter keeps and draws. */
export const MAX_COMMANDS = 200;

export type GutterEngine = Pick<Engine, 'mark' | 'decorate' | 'cursor' | 'viewport' | 'lines' | 'selectLines' | 'scrollTo' | 'scrollToBottom' | 'alternate'>;

export type CommandGutter = {
  /** Takes the marks that stand at the place the parse is at: call it in the callback of the write that ends there. */
  readonly ingest: (marks: readonly TerminalMark[]) => void;
  /**
   * A new terminal takes the place of the one that ended (a restart): the commands of the old one stay, with the transcript they mark, and the one that was running is `incomplete`; the prompt that was waiting is let go. The new terminal's
   * commands are its own: they never meet the old ones by id (its shell counts from `c1` again).
   */
  readonly seal: () => void;
  /** The screen the markers were on is gone (a replay brings it afresh): every marker and decoration is let go. */
  readonly reset: () => void;
  /** The commands the screen still shows or holds, oldest first. */
  readonly commands: () => readonly GutterCommand[];
  /** The command the actions are for: the one the last jump went to while the view is where it left it, and otherwise the last. */
  readonly target: () => GutterCommand | undefined;
  /** Moves the view to the previous or the next command, and says where it went. `select` selects its output too. */
  readonly jump: (direction: 'previous' | 'next', options?: { readonly select?: boolean }) => GutterCommand | undefined;
  /** Selects the output of a command (the target by default); false, and says so, when there is none to select. */
  readonly selectOutput: (command?: GutterCommand) => boolean;
  /** The text of the output of a command (the target by default): `undefined` when it printed none or its lines are gone. */
  readonly output: (command?: GutterCommand) => string | undefined;
  /** Whether there is output to read, from the marks alone: no text is read. */
  readonly hasOutput: (command?: GutterCommand) => boolean;
  /** What typing a command again takes: its line, and whether the shell proved it (then Enter is pressed; a line read from the screen is left for the person to run). `undefined` while a command runs, on the alternate screen, and for a line that is gone. */
  readonly rerun: (command?: GutterCommand) => { readonly text: string; readonly enter: boolean; readonly earlier?: true } | undefined;
  /** A command runs now (the shell's own word). */
  readonly busy: () => boolean;
  readonly onEvent: (listener: (event: GutterEvent) => void) => () => void;
  readonly dispose: () => void;
};

type Anchor = { readonly marker: EngineMarker; readonly column: number };

type Entry = {
  readonly id: string;
  /** The terminal it belongs to (`seal` starts another): a command of an earlier one is never run by a press of Enter in the new shell. */
  readonly epoch: number;
  prompt: Anchor | undefined;
  input: Anchor | undefined;
  readonly start: Anchor;
  end: Anchor | undefined;
  readonly command: string | undefined;
  readonly cwd: string | undefined;
  state: CommandState;
  exit: number | undefined;
  durationMs: number | undefined;
  decoration: EngineDecoration | undefined;
  stop: (() => void) | undefined;
};

/** What a line may carry to the shell: text. The control characters are dropped (an ESC would end a bracketed paste; ETX is an interrupt), and a line feed stays (a command of several lines). */
const unsafe = /[\u0000-\u0009\u000b-\u001f\u007f\u009b]/g;

export function createCommandGutter(engine: GutterEngine): CommandGutter {
  let entries: Entry[] = [];
  let pending: { prompt?: Anchor | undefined; input?: Anchor | undefined } = {};
  let running: Entry | undefined;
  let cwd: string | undefined;
  let counter = 0;
  /** The terminals this gutter has seen before the one now: a new terminal's ids are its own, so they are told apart from the old ones' by it. */
  let epoch = 0;
  let focused: { readonly entry: Entry; readonly top: number } | undefined;
  let hovered: Entry | undefined;
  let hoverAt = { x: 0, y: 0 };
  const listeners = new Set<(event: GutterEvent) => void>();

  const tell = (event: GutterEvent) => {
    for (const listener of [...listeners]) {
      listener(event);
    }
  };

  const say = (words: string) => {
    tell({ kind: 'said', words });
  };

  const anchor = (): Anchor | undefined => {
    const made = engine.mark();
    return made === undefined ? undefined : { marker: made.marker, column: made.column };
  };

  const release = (one: Anchor | undefined) => {
    one?.marker.dispose();
  };

  /** The marker whose line is the command's line: the line it was typed on, the prompt's when the shell sent no input start, the start's when it sent neither. */
  const home = (entry: Entry): Anchor => entry.input ?? entry.prompt ?? entry.start;

  const viewOf = (entry: Entry): GutterCommand => ({
    id: entry.id,
    state: entry.state,
    line: home(entry).marker.line(),
    ...(entry.command === undefined ? {} : { command: entry.command }),
    ...(entry.exit === undefined ? {} : { exit: entry.exit }),
    ...(entry.durationMs === undefined ? {} : { durationMs: entry.durationMs }),
    ...(entry.cwd === undefined ? {} : { cwd: entry.cwd }),
  });

  const unhover = (entry: Entry) => {
    if (hovered === entry) {
      hovered = undefined;
      tell({ kind: 'hover', command: undefined, x: 0, y: 0 });
    }
  };

  /** Lets a command go: its markers, its decoration, and what points at it. */
  const forget = (entry: Entry) => {
    const at = entries.indexOf(entry);
    if (at === -1) {
      return;
    }

    tell({ kind: 'commands' });
    entries.splice(at, 1);
    entry.stop?.();
    entry.stop = undefined;
    entry.decoration?.dispose();
    entry.decoration = undefined;
    release(entry.prompt);
    release(entry.input);
    release(entry.start);
    release(entry.end);
    unhover(entry);
    // `running` stays: that the line is gone (an erase) says nothing of the command; only the shell's end mark, a prompt back or a new start do.
    if (focused?.entry === entry) {
      focused = undefined;
    }
  };

  const paint = (entry: Entry) => (element: HTMLElement) => {
    paintGlyph(element, entry.state, (box) => {
      if (box === undefined) {
        unhover(entry);
      } else {
        hovered = entry;
        hoverAt = { x: box.right, y: box.top };
        tell({ kind: 'hover', command: viewOf(entry), x: box.right, y: box.top });
      }
    });
  };

  const settle = (entry: Entry, state: CommandState) => {
    entry.state = state;
    entry.decoration?.refresh();
    tell({ kind: 'commands' });
    // The pointer is on the mark: the tooltip is told what is true now.
    if (hovered === entry) {
      tell({ kind: 'hover', command: viewOf(entry), x: hoverAt.x, y: hoverAt.y });
    }
  };

  /** Where a command's output ends: here. A command the gutter no longer holds (its line was erased) has nothing to own a marker, and one that already has an end keeps it. */
  const closeOutput = (entry: Entry) => {
    if (entry.end === undefined && entries.includes(entry)) {
      entry.end = anchor();
    }
  };

  const idOf = (id: string | undefined): string | undefined => (id === undefined || epoch === 0 ? id : `${String(epoch)}:${id}`);

  const onPrompt = (mark: TerminalMark) => {
    // A prompt back while a command runs: the shell is back and nobody printed the end (a shell that was replaced, an ssh that ended).
    if (running !== undefined && mark.redraw !== true) {
      // Its output ends where this prompt starts: what comes after is not its.
      closeOutput(running);
      settle(running, 'incomplete');
      running = undefined;
    }

    release(pending.prompt);
    release(pending.input);
    pending = { prompt: anchor() };
  };

  const onInput = () => {
    release(pending.input);
    pending = { ...pending, input: anchor() };
  };

  const onStart = (mark: TerminalMark) => {
    const start = anchor();
    if (start === undefined) {
      // On the alternate screen: nothing is drawn there.
      return;
    }

    if (running !== undefined) {
      closeOutput(running);
      settle(running, 'incomplete');
    }

    counter += 1;
    const entry: Entry = {
      id: idOf(mark.id) ?? `command-${String(counter)}`,
      epoch,
      prompt: pending.prompt,
      input: pending.input,
      start,
      end: undefined,
      command: mark.trust === 'nonce' ? mark.command : undefined,
      cwd,
      state: 'running',
      exit: undefined,
      durationMs: undefined,
      decoration: undefined,
      stop: undefined,
    };
    pending = {};
    entries.push(entry);
    running = entry;
    // The line is the command's life: when it is dropped (the scrollback, a clear) the command goes.
    entry.stop = home(entry).marker.onDispose(() => {
      entry.stop = undefined;
      forget(entry);
    });
    if (entries.includes(entry)) {
      entry.decoration = engine.decorate(home(entry).marker, paint(entry));
    }

    while (entries.length > MAX_COMMANDS) {
      const oldest = entries[0];
      if (oldest === undefined) {
        break;
      }

      forget(oldest);
    }
  };

  const onEnd = (mark: TerminalMark) => {
    const target = running !== undefined && (mark.id === undefined || idOf(mark.id) === running.id) ? running : undefined;
    if (target === undefined) {
      // An end that closes no command that runs: Ctrl-C at an empty prompt, or the end of a command this screen never saw.
      return;
    }

    closeOutput(target);
    target.exit = mark.exit;
    target.durationMs = mark.durationMs;
    running = undefined;
    settle(target, mark.exit === undefined ? 'incomplete' : mark.exit === 0 ? 'success' : 'failure');
  };

  /** The lines `[from, to)` of a command's output: from the line the start mark is on to the line its end is on, which is part of it when the end came after output with no line feed. */
  const rangeOf = (entry: Entry): readonly [number, number, number | undefined] | undefined => {
    const from = entry.start.marker.line();
    if (from < 0) {
      return undefined;
    }

    let to: number;
    let tail: number | undefined;
    if (entry.end === undefined) {
      const cursor = engine.cursor();
      to = cursor.column > 0 ? cursor.line + 1 : cursor.line;
    } else {
      const line = entry.end.marker.line();
      if (line < 0) {
        return undefined;
      }

      to = entry.end.column > 0 ? line + 1 : line;
      // The last row holds the output up to the end mark's column, and then what the shell drew after it.
      tail = entry.end.column > 0 ? entry.end.column : undefined;
    }

    return to > from ? [from, to, tail] : undefined;
  };

  const entryOf = (command: GutterCommand | undefined): Entry | undefined => {
    if (command === undefined) {
      return targetEntry();
    }

    return entries.find((entry) => entry.id === command.id);
  };

  const targetEntry = (): Entry | undefined => {
    if (focused !== undefined && entries.includes(focused.entry) && engine.viewport().top === focused.top) {
      return focused.entry;
    }

    return entries.at(-1);
  };

  const select = (entry: Entry | undefined): boolean => {
    const range = entry === undefined ? undefined : rangeOf(entry);
    if (range === undefined) {
      say(NO_OUTPUT);
      return false;
    }

    engine.selectLines(range[0], range[1]);
    say(SELECTED_OUTPUT);
    return true;
  };

  const jump = (direction: 'previous' | 'next', options?: { readonly select?: boolean }): GutterCommand | undefined => {
    if (entries.length === 0) {
      say(NO_COMMANDS);
      return undefined;
    }

    const view = engine.viewport();
    const current = focused !== undefined && entries.includes(focused.entry) && view.top === focused.top ? focused.entry : undefined;
    let chosen: Entry | undefined;
    if (direction === 'previous') {
      if (current !== undefined) {
        chosen = entries[entries.indexOf(current) - 1];
      } else if (view.atBottom) {
        chosen = entries.at(-1);
      } else {
        chosen = entries.findLast((entry) => home(entry).marker.line() < view.top);
      }
    } else if (current !== undefined) {
      chosen = entries[entries.indexOf(current) + 1];
    } else if (!view.atBottom) {
      chosen = entries.find((entry) => home(entry).marker.line() > view.top);
    }

    if (chosen === undefined) {
      if (direction === 'next') {
        engine.scrollToBottom();
        focused = undefined;
        say(NO_NEXT);
      } else {
        say(NO_PREVIOUS);
      }

      return undefined;
    }

    engine.scrollTo(home(chosen).marker.line());
    focused = { entry: chosen, top: engine.viewport().top };
    say(jumpWords(viewOf(chosen), entries.indexOf(chosen), entries.length));
    if (options?.select === true) {
      select(chosen);
    }

    return viewOf(chosen);
  };

  const output = (command?: GutterCommand): string | undefined => {
    const entry = entryOf(command);
    const range = entry === undefined ? undefined : rangeOf(entry);
    return range === undefined ? undefined : engine.lines(range[0], range[1], range[2] === undefined ? undefined : { to: range[2] });
  };

  const rerun = (command?: GutterCommand): { readonly text: string; readonly enter: boolean; readonly earlier?: true } | undefined => {
    const entry = entryOf(command);
    if (entry === undefined || running !== undefined || engine.alternate()) {
      return undefined;
    }

    if (entry.command !== undefined && entry.command !== '') {
      const earlier = entry.epoch !== epoch;
      return { text: entry.command.replace(unsafe, ''), enter: !earlier, ...(earlier ? { earlier: true as const } : {}) };
    }

    // The shell did not prove the line: it is what the screen shows from where the input starts to where the output starts, and it is the person's to run.
    const input = entry.input;
    const from = input?.marker.line() ?? -1;
    const to = entry.start.marker.line();
    if (input === undefined || from < 0 || to <= from) {
      return undefined;
    }

    const shown = engine.lines(from, to, { from: input.column });
    // A line the shell did not prove is refused when it has a line break: with bracketed paste off a pasted line feed is a carriage return, and the first line would run.
    if (/[\r\n]/.test(shown)) {
      return undefined;
    }

    const text = shown.replace(unsafe, '');
    return text === '' ? undefined : { text, enter: false, ...(entry.epoch === epoch ? {} : { earlier: true as const }) };
  };

  /** Whether the command the actions are for has output lines to read: the marks and the cursor only, never the text. */
  const hasOutput = (command?: GutterCommand): boolean => {
    const entry = entryOf(command);
    return entry !== undefined && rangeOf(entry) !== undefined;
  };

  const reset = () => {
    for (const entry of [...entries]) {
      forget(entry);
    }

    release(pending.prompt);
    release(pending.input);
    pending = {};
    running = undefined;
    cwd = undefined;
    focused = undefined;
    hovered = undefined;
  };

  return {
    ingest: (marks) => {
      for (const mark of marks) {
        switch (mark.kind) {
          case 'prompt-start':
            onPrompt(mark);
            break;
          case 'input-start':
            onInput();
            break;
          case 'command-start':
            onStart(mark);
            break;
          case 'command-end':
            onEnd(mark);
            break;
          case 'cwd':
            // A directory is the shell's word only with the nonce; the host sends no other, and the page does not take one that is not.
            if (mark.trust === 'nonce' && mark.cwd !== undefined) {
              cwd = mark.cwd;
            }

            break;
        }
      }
    },
    reset,
    seal: () => {
      if (running !== undefined) {
        closeOutput(running);
        settle(running, 'incomplete');
        running = undefined;
      }

      release(pending.prompt);
      release(pending.input);
      pending = {};
      cwd = undefined;
      epoch += 1;
    },
    commands: () => entries.map(viewOf),
    target: () => {
      const entry = targetEntry();
      return entry === undefined ? undefined : viewOf(entry);
    },
    jump,
    selectOutput: (command) => select(entryOf(command)),
    output,
    hasOutput,
    rerun,
    busy: () => running !== undefined,
    onEvent: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    dispose: () => {
      reset();
      listeners.clear();
    },
  };
}
