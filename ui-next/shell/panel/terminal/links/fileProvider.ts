import type { FileCandidates, FileLinkHandler, FileLinkHover, ResolvedFile } from '../engine';
import { FILE_LINK_SETTLE_MS } from '../engine';
import { logicalLine, type Cell, type CellBuffer } from './cells';
import { findFileLinks, FILE_LINK_LIMITS } from './fileLinks';

// The file-link provider (#696 step 4): which candidates of the hovered line are links. The matcher (`fileLinks.ts`) finds the candidates in the text of the logical line, `cells.ts` turns their offsets into cells through the
// buffer, and the host (`FileLinkHandler.resolve`, which is `ChannelTerminalResolveLink`) says which of them name a file: a link is made only for those. Nothing here imports the emulator: `xtermEngine.ts` gives the terminal
// as the structure below, and is the only file that does.
//
//   - LAZY. The emulator asks for the links of the row the pointer is on, and only then; a row is looked at after the pointer has rested on it (`FILE_LINK_SETTLE_MS`), and a pointer that crosses lines asks about none of them.
//   - UNDER THE MODIFIER. While the modifier is not held the question waits, unanswered, and nothing is read or asked; pressing it asks (a pointer that rests on a path and then meets the key is on a link); releasing it cancels a
//     question that has not been asked. The emulator keeps the answer for a row until the pointer leaves it, so a question answered with "no link" because the key was up would have to be asked again by a move to another row: a question
//     that waits is the way to the key.
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

type Waiting = { readonly row: number; readonly callback: (links: ProvidedLink[] | undefined) => void; timer: ReturnType<typeof setTimeout> | undefined };

/** Registers the provider with the emulator, and listens to the modifier and the pointer until it is disposed. */
export function createFileLinkProvider(terminal: ProviderTerminal, handler: FileLinkHandler, place: HoverPlace): FileLinkProvider {
  let held = false;
  let waiting: Waiting | undefined;
  let live = true;

  const stop = (one: Waiting | undefined): void => {
    if (one?.timer !== undefined) {
      clearTimeout(one.timer);
      one.timer = undefined;
    }
  };

  /** What the host answered for the line the pointer is on: the emulator draws the row again (a cursor, output, a scroll) and asks again, and the answer is the one it had, with no second question and no gap in the underline. */
  let memo: { readonly first: number; readonly text: string; readonly candidates: readonly Candidate[]; readonly cells: readonly Cell[]; readonly answers: ReadonlyArray<ResolvedFile | undefined> } | undefined;

  const made = (candidates: readonly Candidate[], cells: readonly Cell[], answers: ReadonlyArray<ResolvedFile | undefined>): ProvidedLink[] => {
    const links: ProvidedLink[] = [];
    candidates.forEach((candidate, index) => {
      const resolved = answers[index];
      const range = resolved === undefined ? undefined : rangeOf(cells, candidate);
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

  const links = async (one: Waiting): Promise<void> => {
    const line = logicalLine(terminal.buffer.active, terminal.cols, one.row, FILE_LINK_LIMITS.maxLineLength);
    const candidates = line.tooLong ? [] : candidatesOf(line.text);
    if (candidates.length === 0) {
      one.callback(undefined);
      return;
    }

    let answers: ReadonlyArray<ResolvedFile | undefined>;
    try {
      answers = await handler.resolve(line.first, candidates.map((candidate) => candidate.text));
    } catch {
      answers = [];
    }

    // A pointer that moved on, a handler that was taken away: the answer is for a row nobody is on, and the emulator must not be told of it (a reply for another row would land among the replies of the row it is on).
    if (!live || waiting !== one) {
      return;
    }

    memo = { first: line.first, text: line.text, candidates, cells: line.cells, answers };
    const found = made(candidates, line.cells, answers);
    one.callback(found.length === 0 ? undefined : found);
  };

  const schedule = (): void => {
    const one = waiting;
    if (one === undefined || !held) {
      return;
    }

    stop(one);
    one.timer = setTimeout(() => {
      one.timer = undefined;
      if (waiting === one && held) {
        void links(one);
      }
    }, FILE_LINK_SETTLE_MS);
  };

  const registration = terminal.registerLinkProvider({
    provideLinks: (line, callback) => {
      stop(waiting);
      waiting = undefined;
      if (terminal.buffer.active.type === 'alternate') {
        callback(undefined);
        return;
      }

      const again = memo === undefined ? undefined : logicalLine(terminal.buffer.active, terminal.cols, line - 1, FILE_LINK_LIMITS.maxLineLength);
      if (memo !== undefined && held && again !== undefined && !again.tooLong && again.first === memo.first && again.text === memo.text) {
        const found = made(memo.candidates, again.cells, memo.answers);
        callback(found.length === 0 ? undefined : found);
        return;
      }

      if (again !== undefined && (again.first !== memo?.first || again.text !== memo.text)) {
        memo = undefined;
      }

      waiting = { row: line - 1, callback, timer: undefined };
      schedule();
    },
  });

  // The modifier, as the pointer and the keys say it. The pointer's own events come first (capture, at the screen), so the held state is the pointer's when the emulator asks about a row.
  const screen = terminal.element?.querySelector('.xterm-screen') ?? undefined;
  const changed = (next: boolean): void => {
    const was = held;
    held = next;
    if (next && !was) {
      schedule();
    } else if (!next && was) {
      stop(waiting);
    }
  };

  const onMove = (event: MouseEvent): void => {
    changed(handler.held(event));
  };

  const onLeave = (event: Event): void => {
    // `mouseleave` does not bubble, but it is captured on its way to the element that was left: one for every row and every span the pointer crosses. Only the pointer leaving the screen itself ends the question.
    if (event.target !== screen) {
      return;
    }

    stop(waiting);
    waiting = undefined;
    memo = undefined;
  };

  const onKey = (event: KeyboardEvent): void => {
    changed(handler.held(event));
  };

  const onBlur = (): void => {
    changed(false);
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
