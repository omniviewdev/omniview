import type { FileCandidates, FileLinkHandler, FileLinkHover, ResolvedFile } from '../engine';
import { FILE_LINK_SETTLE_MS } from '../engine';
import { logicalLine, type Cell, type CellBuffer } from './cells';
import { findFileLinks, FILE_LINK_LIMITS } from './fileLinks';

// The file-link provider (#696 step 4): which candidates of the hovered line are links. The matcher (`fileLinks.ts`) finds the candidates in the text of the logical line, `cells.ts` turns their offsets into cells through the
// buffer, and the host (`FileLinkHandler.resolve`, which is `ChannelTerminalResolveLink`) says which of them name a file: a link is made only for those. Nothing here imports the emulator: `xtermEngine.ts` gives the terminal
// as the structure below, and is the only file that does.
//
//   - LAZY. The emulator asks for the links of the row the pointer is on, and only then; a row is looked at after the pointer has rested on it (`FILE_LINK_SETTLE_MS`), and a pointer that crosses lines asks about none of them.
//   - UNDER THE MODIFIER. While the modifier is not held nothing is read or asked, and the emulator is told at once that the row has no links. Pressing the key (or moving with it held) asks after the settle; the emulator keeps the
//     answer it was given for a row until the pointer leaves the row, so when the host has answered the provider makes the emulator ask the row again (two synthetic moves of the pointer: to the next row and back), and answers it
//     from what the host said. Every answer to the emulator is immediate: a provider that left its question open would hold back the links of every provider after it (the emulator gives a provider's links only when all before it have
//     answered, and its own provider of hyperlinks answers with an empty list, which counts as a link), so the web links of the row would not be reported while a file question waits for its key.
//   - BOUNDED. A line over 2,000 characters has no file links and is read for a bounded number of rows (the rows 2,001 characters fill), at most 10 candidates of a line are asked about, and the work for a line does not depend on how
//     long the line the row belongs to is.
//   - NO URL. The matcher gives no candidate inside a printed web address (it is the web link's): the host is never asked to look at a URL.

/** The structure of an emulator's terminal the provider reads: its size, the active buffer's rows and the registry of link providers. */
export type ProviderTerminal = {
  readonly cols: number;
  readonly rows: number;
  readonly element: HTMLElement | undefined;
  readonly buffer: { readonly active: CellBuffer & { readonly type: string; readonly viewportY: number } };
  readonly registerLinkProvider: (provider: ProviderLinks) => { readonly dispose: () => void };
};

type Range = { readonly start: { readonly x: number; readonly y: number }; readonly end: { readonly x: number; readonly y: number } };

/** A link as the emulator takes it (`ILink`): its range in cells (1-based, the end included), its text and what the pointer does with it. */
export type ProvidedLink = {
  readonly range: Range;
  readonly text: string;
  readonly activate: (event: MouseEvent, text: string) => void;
  readonly hover: (event: MouseEvent, text: string) => void;
  readonly leave: (event: MouseEvent, text: string) => void;
};

export type ProviderLinks = { readonly provideLinks: (line: number, callback: (links: ProvidedLink[] | undefined) => void) => void };

/** The lines in view that `candidatesInView` reads, and the candidates it gives in all: what a person with no pointer asks the host about (every one is a call of the host). */
export const VIEW_FILE_LINES = 20;
export const VIEW_FILE_CANDIDATES = 40;

/** One candidate of a logical line: the text as printed (the path and its suffix) and where it is. */
type Candidate = { readonly text: string; readonly start: number; readonly end: number };

/** The candidates of a logical line: what the matcher finds (it gives none inside a web address: `xtermEngine.test.ts` holds that, over a real emulator), as the text printed. */
function candidatesOf(text: string): Candidate[] {
  return findFileLinks(text)
    .slice(0, FILE_LINK_LIMITS.maxLinks)
    .map((one) => ({ text: text.slice(one.start, one.end), start: one.start, end: one.end }));
}

/** The cells a candidate covers, as the emulator's range: the first cell to the last, the last as wide as it is. Absent when the buffer no longer has them. */
function rangeOf(cells: readonly Cell[], candidate: Candidate): Range | undefined {
  const first = cells[candidate.start];
  const last = cells[candidate.end - 1];
  if (first === undefined || last === undefined) {
    return undefined;
  }

  return { start: { x: first.x + 1, y: first.row + 1 }, end: { x: last.x + last.width, y: last.row + 1 } };
}

/**
 * The candidates of the logical lines in view, newest line first, at most `VIEW_FILE_LINES` lines and `VIEW_FILE_CANDIDATES` candidates: what a person with no pointer asks the host about. Nothing on the alternate screen (a
 * program that has the whole screen has no paths of a command).
 */
export function fileCandidatesInView(terminal: ProviderTerminal): readonly FileCandidates[] {
  const buffer = terminal.buffer.active;
  if (buffer.type === 'alternate') {
    return [];
  }

  const top = buffer.viewportY;
  const seen = new Set<number>();
  const found: FileCandidates[] = [];
  let total = 0;
  for (let row = top + terminal.rows - 1; row >= top && found.length < VIEW_FILE_LINES && total < VIEW_FILE_CANDIDATES; row -= 1) {
    const line = logicalLine(buffer, terminal.cols, row, FILE_LINK_LIMITS.maxLineLength);
    if (line.tooLong || seen.has(line.first)) {
      continue;
    }

    seen.add(line.first);
    const texts = candidatesOf(line.text).map((one) => one.text).slice(0, VIEW_FILE_CANDIDATES - total);
    if (texts.length > 0) {
      found.push({ row: line.first, texts });
      total += texts.length;
    }
  }

  return found;
}

export type FileLinkProvider = { readonly dispose: () => void };

/** What the pointer of a link is told where it is: the emulator's own computation of a link's first cell in pixels, for the tooltip. */
export type HoverPlace = (event: MouseEvent, path: string, range: Range) => FileLinkHover;

type Waiting = { readonly row: number; timer: ReturnType<typeof setTimeout> | undefined };

/** What the host said of the line the pointer is on: the emulator draws the row again (a cursor, output, a scroll) and asks again, and the answer is the one it had, with no second question and no gap in the underline. */
type Memo = { readonly first: number; readonly text: string; readonly candidates: readonly Candidate[]; readonly cells: readonly Cell[]; readonly answers: ReadonlyArray<ResolvedFile | undefined> };

/** Registers the provider with the emulator, and listens to the modifier and the pointer until it is disposed. */
export function createFileLinkProvider(terminal: ProviderTerminal, handler: FileLinkHandler, place: HoverPlace): FileLinkProvider {
  let held = false;
  let live = true;
  /** The row the emulator last asked about: where the pointer is. */
  let current: number | undefined;
  /** The question that waits for its settle or its answer. */
  let waiting: Waiting | undefined;
  let memo: Memo | undefined;
  /** Where the pointer was and which keys it held, from the pointer's own events: what the two moves that make the emulator ask again are made from. */
  let pointer: { readonly x: number; readonly y: number } | undefined;
  let jiggling = false;

  const stop = (one: Waiting | undefined): void => {
    if (one?.timer !== undefined) {
      clearTimeout(one.timer);
      one.timer = undefined;
    }
  };

  const made = (known: Memo): ProvidedLink[] => {
    const links: ProvidedLink[] = [];
    known.candidates.forEach((candidate, index) => {
      const resolved = known.answers[index];
      const range = resolved === undefined ? undefined : rangeOf(known.cells, candidate);
      if (resolved === undefined || range === undefined) {
        return;
      }

      links.push({
        range,
        text: candidate.text,
        activate: (event) => {
          if (live && handler.held(event)) {
            handler.activate(resolved, event);
          }
        },
        hover: (event) => {
          if (live) {
            handler.hover({ ...resolved, ...pick(place(event, resolved.path, range)) });
          }
        },
        leave: () => {
          if (live) {
            handler.hover(undefined);
          }
        },
      });
    });
    return links;
  };

  const screen = terminal.element?.querySelector('.xterm-screen') ?? undefined;

  /** The pointer moves to the next row and back, as events of the screen: the emulator asks the row again, and the provider answers from what the host said. A pointer with no known place is not moved. */
  const askAgain = (keys: Pick<MouseEventInit, 'metaKey' | 'ctrlKey'>): void => {
    if (screen === undefined || pointer === undefined) {
      return;
    }

    const rect = screen.getBoundingClientRect();
    const cell = rect.height / Math.max(1, terminal.rows);
    const other = pointer.y + cell < rect.bottom ? pointer.y + cell : pointer.y - cell;
    const move = (y: number): void => {
      screen.dispatchEvent(new MouseEvent('mousemove', { bubbles: true, cancelable: true, clientX: pointer?.x ?? 0, clientY: y, ...keys }));
    };

    // The visit to the next row is told to nobody (`jiggling`); the move back is the emulator asking the row again, and it is answered.
    jiggling = true;
    try {
      move(other);
    } finally {
      jiggling = false;
    }

    move(pointer.y);
  };

  const ask = async (one: Waiting): Promise<void> => {
    const line = logicalLine(terminal.buffer.active, terminal.cols, one.row, FILE_LINK_LIMITS.maxLineLength);
    const candidates = line.tooLong ? [] : candidatesOf(line.text);
    if (candidates.length === 0) {
      return;
    }

    let answers: ReadonlyArray<ResolvedFile | undefined>;
    try {
      answers = await handler.resolve(line.first, candidates.map((candidate) => candidate.text));
    } catch {
      answers = [];
    }

    // A pointer that moved on, a handler that was taken away, a key that was let go: the answer is for a row nobody is on.
    if (!live || waiting !== one || current !== one.row || !held) {
      return;
    }

    waiting = undefined;
    memo = { first: line.first, text: line.text, candidates, cells: line.cells, answers };
    if (answers.some((answer) => answer !== undefined)) {
      askAgain({ metaKey: lastKeys.metaKey, ctrlKey: lastKeys.ctrlKey });
    }
  };

  const schedule = (): void => {
    if (!held || current === undefined || waiting?.row === current) {
      return;
    }

    stop(waiting);
    const one: Waiting = { row: current, timer: undefined };
    waiting = one;
    one.timer = setTimeout(() => {
      one.timer = undefined;
      if (waiting === one && held && live) {
        void ask(one);
      }
    }, FILE_LINK_SETTLE_MS);
  };

  const registration = terminal.registerLinkProvider({
    provideLinks: (line, callback) => {
      if (jiggling) {
        // The row the pointer visits on its way to be asked again: it has no links, and the answer for the row it came from is kept.
        callback(undefined);
        return;
      }

      if (terminal.buffer.active.type === 'alternate') {
        current = undefined;
        stop(waiting);
        waiting = undefined;
        callback(undefined);
        return;
      }

      const row = line - 1;
      if (current !== row) {
        stop(waiting);
        waiting = undefined;
      }

      current = row;
      const same = held && memo !== undefined ? logicalLine(terminal.buffer.active, terminal.cols, row, FILE_LINK_LIMITS.maxLineLength) : undefined;
      if (memo !== undefined && same !== undefined && !same.tooLong && same.first === memo.first && same.text === memo.text) {
        const found = made({ ...memo, cells: same.cells });
        callback(found.length === 0 ? undefined : found);
        return;
      }

      if (memo !== undefined) {
        const now = logicalLine(terminal.buffer.active, terminal.cols, row, FILE_LINK_LIMITS.maxLineLength);
        if (now.first !== memo.first || now.text !== memo.text) {
          memo = undefined;
        } else if (!held) {
          // The same line without the modifier: no links, and the answer is kept for the key.
          callback(undefined);
          return;
        }
      }

      callback(undefined);
      schedule();
    },
  });

  // The modifier, as the pointer and the keys say it. The pointer's own events come first (capture, at the screen), so the held state is the pointer's when the emulator asks about a row.
  const lastKeys = { metaKey: false, ctrlKey: false };
  const changed = (next: boolean, keys: Pick<MouseEventInit, 'metaKey' | 'ctrlKey'>): void => {
    const was = held;
    held = next;
    lastKeys.metaKey = keys.metaKey === true;
    lastKeys.ctrlKey = keys.ctrlKey === true;
    if (next && !was) {
      schedule();
    } else if (!next && was) {
      stop(waiting);
      waiting = undefined;
      memo = undefined;
    }
  };

  const onMove = (event: MouseEvent): void => {
    if (!jiggling) {
      pointer = { x: event.clientX, y: event.clientY };
    }

    changed(handler.held(event), event);
  };

  const onLeave = (event: Event): void => {
    // `mouseleave` does not bubble, but it is captured on its way to the element that was left: one for every row and every span the pointer crosses. Only the pointer leaving the screen itself ends the question.
    if (event.target !== screen) {
      return;
    }

    stop(waiting);
    waiting = undefined;
    current = undefined;
    memo = undefined;
    pointer = undefined;
  };

  const onKey = (event: KeyboardEvent): void => {
    changed(handler.held(event), event);
  };

  const onBlur = (): void => {
    changed(false, {});
  };

  screen?.addEventListener('mousemove', onMove as EventListener, true);
  screen?.addEventListener('mouseleave', onLeave, true);
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
  window.addEventListener('blur', onBlur);

  return {
    dispose: () => {
      live = false;
      stop(waiting);
      waiting = undefined;
      memo = undefined;
      registration.dispose();
      screen?.removeEventListener('mousemove', onMove as EventListener, true);
      screen?.removeEventListener('mouseleave', onLeave, true);
      window.removeEventListener('keydown', onKey, true);
      window.removeEventListener('keyup', onKey, true);
      window.removeEventListener('blur', onBlur);
    },
  };
}

/** The position of a hover, and nothing else of it. */
function pick(hover: FileLinkHover): { readonly x: number; readonly y: number } {
  return { x: hover.x, y: hover.y };
}
