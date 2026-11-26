import type { TerminalMark, TerminalMarkKind } from './feed';

// The marks frame of the terminal channel (docs/ui-next/terminal-channel-protocol.md section 4a), read: the host's JSON in its own words, checked and turned into the page's `TerminalMark`. The page decides nothing here: `trust` is
// the host's word (it holds the session's nonce; the page never does), and a mark that is not well formed is dropped, one by one, so that a host with a defect costs the page a mark and not the stream.

const KINDS: Readonly<Record<TerminalMarkKind, true>> = { 'prompt-start': true, 'input-start': true, 'command-start': true, 'command-end': true, cwd: true };

/** The version of the frame this reads. */
const FRAME_VERSION = 1;

/** The longest name a command is given in a question: a line is the user's, and the first word of it is enough. */
const MAX_NAME_CHARS = 64;

const isOffset = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

const text = (value: unknown): string | undefined => (typeof value === 'string' ? value : undefined);

const whole = (value: unknown): number | undefined => (typeof value === 'number' && Number.isSafeInteger(value) ? value : undefined);

/** One mark of the frame, or nothing when it is not one: an unknown kind, offsets that are not offsets (or whose sequence is empty), a trust that is neither of the two the host says. */
function markOf(raw: unknown): TerminalMark | undefined {
  if (typeof raw !== 'object' || raw === null) {
    return undefined;
  }

  const kind: unknown = Reflect.get(raw, 'kind');
  const at: unknown = Reflect.get(raw, 'at');
  const end: unknown = Reflect.get(raw, 'end');
  const trust: unknown = Reflect.get(raw, 'trust');
  if (typeof kind !== 'string' || !Object.hasOwn(KINDS, kind) || !isOffset(at) || !isOffset(end) || end <= at || (trust !== 'nonce' && trust !== 'unverified')) {
    return undefined;
  }

  const id = text(Reflect.get(raw, 'id'));
  const command = text(Reflect.get(raw, 'command'));
  const cwd = text(Reflect.get(raw, 'cwd'));
  const exit = whole(Reflect.get(raw, 'exit'));
  const durationMs = whole(Reflect.get(raw, 'duration_ms'));
  const timeMs = whole(Reflect.get(raw, 'time_ms'));
  const redraw: unknown = Reflect.get(raw, 'redraw');
  return {
    kind: kind as TerminalMarkKind,
    at,
    end,
    trust,
    ...(id === undefined ? {} : { id }),
    ...(command === undefined ? {} : { command }),
    ...(cwd === undefined ? {} : { cwd }),
    ...(exit === undefined ? {} : { exit }),
    ...(durationMs === undefined ? {} : { durationMs }),
    ...(timeMs === undefined ? {} : { timeMs }),
    ...(redraw === true ? { redraw } : {}),
  };
}

/** The marks of a frame, in the order the host sent them; none for a frame that is not version 1 with a list of marks. */
export function marksOf(frame: unknown): readonly TerminalMark[] {
  if (typeof frame !== 'object' || frame === null || Reflect.get(frame, 'v') !== FRAME_VERSION) {
    return [];
  }

  const list: unknown = Reflect.get(frame, 'marks');
  if (!Array.isArray(list)) {
    return [];
  }

  return (list as unknown[]).flatMap((raw) => {
    const mark = markOf(raw);
    return mark === undefined ? [] : [mark];
  });
}

/** What a command is called in the question a close asks: the first word of its line, without control characters, at most `MAX_NAME_CHARS`; nothing when the line has none. */
export function commandNameOf(line: string | undefined): string | undefined {
  // eslint-disable-next-line no-control-regex -- a command line is the user's data and may hold control characters
  const word = (line ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().split(/\s+/, 1)[0] ?? '';
  return word === '' ? undefined : [...word].slice(0, MAX_NAME_CHARS).join('');
}
