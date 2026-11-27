import { describe, expect, it, vi } from 'vitest';
import type { EngineAppearance } from './engine';
import type { PlacedMark, TerminalMark, TerminalReplay } from './feed';
import type { GutterEvent } from './gutter/commandGutter';
import { createScreen, FLOW, type TerminalScreen } from './screen';
import { createScreenReaderChoice } from './screenReader';
import { fakeEngineLoader, fakeTerminalFeed, type FakeEngine, type FakeTerminalFeed } from './testing';

// THE SCREEN AND THE MARKS (issue #694 step 5). The feed hands each mark over with the bytes that end at it, and the screen writes the bytes up to it, waits for the emulator to PARSE them, and only then makes the marker (xterm.js
// #5214), so a marker stands on the line the parse left the cursor on. What it writes is the bytes, all of them and unchanged, cut at the marks; what it acknowledges is those bytes. A replay brings its marks with it, and a replay
// that starts the screen afresh lets go of the commands of the screen that was. Against the fake emulator, whose plain buffer counts the line feeds it has parsed.

const APPEARANCE: EngineAppearance = {
  theme: { background: '#000', foreground: '#fff', cursor: '#fff', cursorAccent: '#000', selectionBackground: '#222', selectionInactiveBackground: '#111', palette: Array.from({ length: 16 }, () => '#888') },
  fontFamily: 'monospace',
  fontSize: 12,
  lineHeight: 1.33,
};

const NO_MODES = { altScreen: false, bracketedPaste: false, applicationCursor: false, focusEvents: false, cursorHidden: false, mouseTracking: 0, mouseEncoding: 0, kittyKeyboard: [] } as const;
const bytesOf = (text: string): Uint8Array => new TextEncoder().encode(text);
const mark = (kind: TerminalMark['kind'], extra: Partial<TerminalMark> = {}): TerminalMark => ({ kind, at: 0, end: 1, trust: 'unverified', ...extra });
const placed = (at: number, one: TerminalMark): PlacedMark => ({ mark: one, at });
const A = (id = 'c1') => mark('prompt-start', { id });
const B = (id = 'c1') => mark('input-start', { id });
const C = (command: string | undefined, id = 'c1') => mark('command-start', { id, ...(command === undefined ? {} : { trust: 'nonce', command }) });
const D = (exit: number, id = 'c1') => mark('command-end', { id, exit, durationMs: 1_500 });

type Rig = {
  readonly screen: TerminalScreen;
  readonly feed: FakeTerminalFeed;
  readonly engine: () => FakeEngine;
  readonly frame: () => void;
  readonly copied: string[];
  readonly events: GutterEvent[];
};

async function rig(options: { readonly auto?: boolean; readonly replay?: TerminalReplay; readonly state?: 'running' | 'ended' } = {}): Promise<Rig> {
  const feed = fakeTerminalFeed({ ...(options.replay === undefined ? {} : { replay: options.replay }), takeReplay: true, state: options.state ?? 'running' });
  const loader = fakeEngineLoader({ auto: options.auto ?? true });
  const host = document.createElement('div');
  const queue: Array<() => void> = [];
  const copied: string[] = [];
  const events: GutterEvent[] = [];
  const screen = createScreen({
    feed,
    load: loader.load,
    appearance: () => APPEARANCE,
    platform: 'other',
    label: 'Terminal input, Terminal',
    descriptionId: 'hint-1',
    screenReader: createScreenReaderChoice(false),
    frame: (callback) => {
      queue.push(callback);
      return () => undefined;
    },
    later: () => () => undefined,
    observe: () => () => undefined,
    fontsReady: async () => Promise.resolve(),
    copy: async (text) => {
      copied.push(text);
      return Promise.resolve(true);
    },
    warn: () => undefined,
  });
  screen.mount(host);
  screen.show();
  for (let turn = 0; turn < 8; turn += 1) {
    await Promise.resolve();
  }

  screen.commands.onEvent((event) => {
    events.push(event);
  });
  const engine = () => {
    const made = loader.engines.at(-1);
    if (made === undefined) {
      throw new Error('no emulator was made');
    }

    return made;
  };

  return {
    screen,
    feed,
    engine,
    copied,
    events,
    frame: () => {
      for (const callback of queue.splice(0)) {
        callback();
      }
    },
  };
}

describe('the marks in the bytes the screen writes', () => {
  it('makes the marker where the mark stands: after the bytes before it are parsed and before the bytes after it, so it is on the line the parse left the cursor on', async () => {
    const { feed, frame, engine, screen } = await rig();
    feed.push('$ ls\r\nout1\r\nout2\r\n', [placed(6, B()), placed(6, C('ls'))]);
    frame();
    expect(engine().markers().map((one) => one.line())).toEqual([1, 1]);
    expect(screen.commands.has()).toBe(true);
  });

  it('writes every byte, unchanged and in order, cut at the marks: no byte is lost, repeated or moved by a mark, and the acknowledgement is of the bytes', async () => {
    const { feed, frame, engine } = await rig();
    const text = 'abcdefghij\r\nklmnop\r\nqrstuvwxyz\r\n';
    feed.push(text, [placed(5, A()), placed(5, B()), placed(12, C('x')), placed(text.length, D(0))]);
    frame();
    const written = engine().writes.filter((one): one is Uint8Array => typeof one !== 'string' && one.length > 0);
    expect(written.map((one) => new TextDecoder().decode(one)).join('')).toBe(text);
    expect(written.map((one) => one.length)).toEqual([5, 7, text.length - 12]);
    expect(feed.acks().reduce((sum, count) => sum + count, 0)).toBe(text.length);
  });

  it('makes no marker before the emulator has parsed the bytes before the mark: a marker made while the write waits would read the line the cursor was on', async () => {
    const { feed, frame, engine } = await rig({ auto: false });
    feed.push('$ ls\r\nout\r\n', [placed(6, C('ls'))]);
    frame();
    expect(engine().markers(), 'the bytes were handed over and not parsed').toHaveLength(0);
    engine().complete(1);
    expect(engine().markers(), 'they are parsed; the write that carries the mark has not run').toHaveLength(0);
    engine().complete(1);
    expect(engine().markers().map((one) => one.line()), 'the marker stands on the line after the first, where the parse of its bytes left the cursor').toEqual([1]);
  });

  it('makes the marker of a mark whose bytes were written before it came, with no bytes of its own, after what was written: the emulator has parsed it all by then', async () => {
    const { feed, frame, engine } = await rig();
    feed.push('$ make\r\n');
    frame();
    feed.push(new Uint8Array(0), [placed(0, C('make'))]);
    frame();
    expect(engine().markers().map((one) => one.line())).toEqual([1]);
  });

  it('cuts a flood at a mark in the middle of it, and writes the rest in slices as before', async () => {
    const { feed, frame, engine } = await rig();
    const text = `${'a'.repeat(FLOW.slice * 2 + 100)}\r\n`;
    const at = FLOW.slice + 7;
    feed.push(text, [placed(at, C('x'))]);
    frame();
    const sizes = engine().writes.filter((one): one is Uint8Array => typeof one !== 'string' && one.length > 0).map((one) => one.length);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(text.length);
    let total = 0;
    const ends = sizes.map((size) => {
      total += size;
      return total;
    });
    expect(ends, 'a write ends exactly at the mark').toContain(at);
    expect(Math.max(...sizes), 'and no write is larger than a slice').toBeLessThanOrEqual(FLOW.slice);
  });

  it('draws no gutter for a terminal that has no marks: nothing is made, and no command is there to jump to', async () => {
    const { feed, frame, engine, screen } = await rig();
    feed.push('$ ls\r\nout\r\n');
    frame();
    expect(engine().markers()).toHaveLength(0);
    expect(screen.commands.has()).toBe(false);
    expect(screen.commands.state()).toEqual({ count: 0, output: false, rerun: 'No commands yet' });
  });
});

describe('the marks in a replay', () => {
  const replay = (data: string, marks: readonly PlacedMark[]): TerminalReplay => ({
    data: bytesOf(data),
    startSize: { cols: 80, rows: 24 },
    startModes: NO_MODES,
    size: { cols: 80, rows: 24 },
    modes: NO_MODES,
    end: data.length,
    marks,
  });

  it('brings the gutter back after a reload: the commands that stand in the replayed bytes, each on its own line', async () => {
    const text = '$ one\r\na\r\n$ two\r\nb\r\n';
    const { frame, engine, screen } = await rig({ replay: replay(text, [placed(0, A()), placed(2, B()), placed(7, C('one')), placed(10, D(0)), placed(10, A('c2')), placed(12, B('c2')), placed(18, C('two', 'c2')), placed(text.length, D(3, 'c2'))]) });
    frame();
    expect(screen.commands.state().count).toBe(2);
    expect(engine().markers().length).toBeGreaterThan(0);
    expect(screen.commands.has()).toBe(true);
  });

  it('lets go of the commands of the screen it replaces: a gap or a late replay starts the screen afresh, and what was drawn on it is not there', async () => {
    const { feed, frame, screen } = await rig({ replay: undefined });
    feed.push('$ one\r\na\r\n', [placed(0, A()), placed(2, B()), placed(7, C('one'))]);
    frame();
    expect(screen.commands.state().count).toBe(1);
    feed.offerReplay(replay('fresh\r\n', []));
    frame();
    expect(screen.commands.state().count).toBe(0);
    expect(screen.commands.has()).toBe(false);
  });
});

describe('what the person does with the commands', () => {
  async function withCommands(options: { readonly state?: 'running' | 'ended' } = {}) {
    const r = await rig(options);
    r.feed.push('$ make\r\nout1\r\nout2\r\n', [placed(0, A()), placed(2, B()), placed(8, C('make')), placed(20, D(2))]);
    r.frame();
    return r;
  }

  it('jumps to the previous command and says where it went, and the output of the target is what it printed', async () => {
    const { screen, engine, events } = await withCommands();
    screen.commands.jump('previous');
    expect(engine().scrolls).toEqual([0]);
    expect(events.at(-1)).toEqual({ kind: 'said', words: 'Command 1 of 1, Failed, exit 2, took 1.5 s: make' });
  });

  it('selects the output of the target, and copies it as text', async () => {
    const { screen, engine, copied } = await withCommands();
    screen.commands.selectOutput();
    expect(engine().lineSelections).toEqual([[1, 3]]);
    expect(await screen.commands.copyOutput()).toBe(true);
    expect(copied).toEqual(['out1\nout2']);
  });

  it('says it when there is no output to copy, and copies nothing', async () => {
    const { screen, feed, frame, copied, events } = await rig();
    feed.push('$ true\r\n', [placed(0, A()), placed(2, B()), placed(8, C('true')), placed(8, D(0))]);
    frame();
    expect(await screen.commands.copyOutput()).toBe(false);
    expect(copied).toEqual([]);
    expect(events.at(-1)).toEqual({ kind: 'said', words: 'This command printed no output' });
  });

  it('runs a command again by typing its line, and Enter, as the person\'s own input (a paste, so a program that asked for bracketed paste gets it between its markers)', async () => {
    const { screen, engine, feed } = await withCommands();
    screen.commands.rerun();
    expect(engine().pastes).toEqual(['make']);
    expect(feed.typed()).toEqual(['\r']);
  });

  it('types a line the shell did not prove WITHOUT Enter, and says the person must press it', async () => {
    const { screen, engine, feed, frame, events } = await rig();
    feed.push('$ echo hi\r\nhi\r\n', [placed(0, A()), placed(2, B()), placed(11, C(undefined)), placed(14, D(0))]);
    frame();
    screen.commands.rerun();
    expect(engine().pastes).toEqual(['echo hi']);
    expect(feed.typed(), 'no Enter for a line nobody proved').toEqual([]);
    expect(events.at(-1)).toEqual({ kind: 'said', words: 'The command line is typed; press Enter to run it' });
  });

  it('types nothing of a forged unproven line that has a line break, whether or not the program asked for bracketed paste: nothing with CR or LF reaches the shell', async () => {
    const { screen, engine, feed, frame, events } = await rig();
    feed.push('$ touch /tmp/pwned\r\necho harmless\r\n', [placed(0, A()), placed(2, B()), placed(35, C(undefined)), placed(35, D(0))]);
    frame();
    screen.commands.rerun();
    expect(engine().pastes).toEqual([]);
    expect(feed.typed().join('')).not.toMatch(/[\r\n]/);
    expect(events.at(-1)?.kind).toBe('said');
  });

  it('types nothing while a command runs or when the terminal takes no input, and says why', async () => {
    const running = await rig();
    running.feed.push('$ sleep 9\r\n', [placed(0, A()), placed(2, B()), placed(11, C('sleep 9'))]);
    running.frame();
    running.screen.commands.rerun();
    expect(running.engine().pastes).toEqual([]);
    expect(running.events.at(-1)).toEqual({ kind: 'said', words: 'A command is running' });
    expect(running.screen.commands.state().rerun).toBe('A command is running');
    const ended = await withCommands();
    ended.feed.set({ state: 'ended' });
    ended.screen.commands.rerun();
    expect(ended.engine().pastes).toEqual([]);
    expect(ended.events.at(-1)).toEqual({ kind: 'said', words: 'Input is off' });
  });
});

describe('a replay and a marker write that waits', () => {
  it('does not begin a replay while the write that makes a marker has not run: the replay would let go of the gutter under it', async () => {
    const { feed, frame, engine } = await rig({ auto: false });
    feed.push('$ ls\r\n', [placed(6, C('ls'))]);
    frame();
    engine().complete(1);
    expect(engine().pendingWrites(), 'the bytes are parsed, the marker write waits').toBe(1);
    feed.offerReplay({ data: bytesOf('fresh\r\n'), startSize: { cols: 80, rows: 24 }, startModes: NO_MODES, size: { cols: 80, rows: 24 }, modes: NO_MODES, end: 7 });
    frame();
    expect(engine().resets(), 'no reset while the marker write waits').toBe(0);
    engine().complete(1);
    frame();
    expect(engine().resets()).toBe(1);
  });
});

describe('the keys that jump', () => {
  async function withCommands() {
    const r = await rig();
    r.feed.push('$ make\r\nout1\r\nout2\r\n', [placed(0, A()), placed(2, B()), placed(8, C('make')), placed(20, D(2))]);
    r.frame();
    return r;
  }

  it('take Control Up and Down while there are commands: the view jumps and the key is not sent to the shell', async () => {
    const { engine } = await withCommands();
    const up = engine().key({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true });
    expect(up).toEqual({ handled: false, defaultPrevented: true });
    expect(engine().scrolls).toEqual([0]);
    const down = engine().key({ key: 'ArrowDown', code: 'ArrowDown', ctrlKey: true });
    expect(down).toEqual({ handled: false, defaultPrevented: true });
  });

  it('select the output with Shift', async () => {
    const { engine } = await withCommands();
    engine().key({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true, shiftKey: true });
    expect(engine().lineSelections).toEqual([[1, 3]]);
  });

  it('leave the key what it was when there is nothing to jump to: Control Up is the shell\'s, and nothing moves', async () => {
    const { engine } = await rig();
    expect(engine().key({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true })).toEqual({ handled: true, defaultPrevented: false });
    expect(engine().scrolls).toEqual([]);
  });

  it('leave the key to the program while it has the alternate screen up: vim has its own Control Up', async () => {
    const { engine } = await withCommands();
    engine().alternateScreen(true);
    expect(engine().key({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true })).toEqual({ handled: true, defaultPrevented: false });
    expect(engine().scrolls).toEqual([]);
  });
});

describe('what review found, in the screen', () => {
  const replayWith = (data: string, marks: readonly PlacedMark[]): TerminalReplay => ({ data: bytesOf(data), startSize: { cols: 80, rows: 24 }, startModes: NO_MODES, size: { cols: 80, rows: 24 }, modes: NO_MODES, end: data.length, marks });

  it('keeps Control Shift Up and Down with the window when there are no commands (not handled, as before): only Control without Shift is the shell\'s', async () => {
    const { engine } = await rig();
    expect(engine().key({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true, shiftKey: true })).toEqual({ handled: false, defaultPrevented: false });
    expect(engine().key({ key: 'ArrowUp', code: 'ArrowUp', ctrlKey: true })).toEqual({ handled: true, defaultPrevented: false });
  });

  it('writes a short marked slice in a buffer of its own size: a view of a 64 KiB scratch would hold the whole allocation until the emulator parses it', async () => {
    const { feed, frame, engine } = await rig({ auto: false });
    feed.push('ab\r\ncd\r\n', [placed(4, C('x'))]);
    frame();
    const writes = engine().writes.filter((one): one is Uint8Array => typeof one !== 'string' && one.length > 0);
    expect(writes.map((one) => one.buffer.byteLength)).toEqual(writes.map((one) => one.length));
  });

  it('places the marks at the very end of a replay whose last write is parsed at once, so that the restored command has its exit status and can be run again', async () => {
    const text = '$ ls\r\nout\r\n';
    const { frame, screen } = await rig({ replay: replayWith(text, [placed(0, A()), placed(2, B()), placed(6, C('ls')), placed(text.length, D(0))]) });
    frame();
    expect(screen.commands.state().rerun, 'the command ended: it can be run again').toBeUndefined();
  });

  it('refuses to run a command again while a replay is applied: the line would be queued and sent after a program that started during the replay', async () => {
    const text = '$ ls\r\nout\r\nmore\r\n';
    const { frame, screen, engine } = await rig({ auto: false, replay: replayWith(text, [placed(0, A()), placed(2, B()), placed(6, C('ls')), placed(6, D(0))]) });
    frame();
    for (let guard = 0; guard < 10 && screen.commands.state().count === 0; guard += 1) {
      engine().complete(1);
    }

    expect(screen.commands.state().count).toBe(1);
    expect(engine().pendingWrites(), 'the replay is not over').toBeGreaterThan(0);
    expect(screen.commands.state().rerun).toBeDefined();
  });

  it('offers no output action while a program has the alternate screen: the rows are of the normal screen and the engine reads the active one', async () => {
    const r = await rig();
    r.feed.push('$ make\r\nout1\r\n', [placed(0, A()), placed(2, B()), placed(8, C('make')), placed(15, D(0))]);
    r.frame();
    expect(r.screen.commands.state().output).toBe(true);
    r.engine().alternateScreen(true);
    expect(r.screen.commands.state().output).toBe(false);
    r.screen.commands.selectOutput();
    expect(r.engine().lineSelections).toEqual([]);
    expect(await r.screen.commands.copyOutput()).toBe(false);
    r.engine().alternateScreen(false);
    expect(r.screen.commands.state().output).toBe(true);
  });
});

describe('the cost of the menu\'s revision', () => {
  it('reads no output of the buffer: the revision is asked on every change of the commands, and the text is read only when an item is chosen', async () => {
    const r = await rig();
    r.feed.push('$ make\r\nout1\r\nout2\r\n', [placed(0, A()), placed(2, B()), placed(8, C('make')), placed(20, D(2))]);
    r.frame();
    const read = vi.spyOn(r.engine(), 'lines');
    const revision = r.screen.commands.revision();
    expect(read).not.toHaveBeenCalled();
    r.feed.push('$ x\r\n', [placed(0, A('c2')), placed(2, B('c2')), placed(5, C('x', 'c2')), placed(5, D(0, 'c2'))]);
    r.frame();
    expect(r.screen.commands.revision()).not.toBe(revision);
    expect(read, 'no line was read for a revision or a change').not.toHaveBeenCalled();
  });
});

describe('the output items for a command that printed nothing', () => {
  it('are unavailable: the menu state says no output, and nothing is copied', async () => {
    const r = await rig();
    r.feed.push('$ true\r\n', [placed(0, A()), placed(2, B()), placed(8, C('true')), placed(8, D(0))]);
    r.frame();
    expect(r.screen.commands.state().output).toBe(false);
  });
});

describe('a restart: the screen goes on with the next feed (#695 step 5)', () => {
  it('keeps the commands of the ended terminal, and a command it was running is not running any more: the new terminal can be asked to run a command again', async () => {
    const { feed, frame, screen } = await rig();
    feed.push('$ make\r\n', [placed(0, A()), placed(2, B()), placed(7, C('make'))]);
    frame();
    expect(screen.commands.state().rerun, 'the old command runs').toBeDefined();
    feed.set({ state: 'ended', exit: { signal: 'SIGKILL' } });
    const next = fakeTerminalFeed({ state: 'starting', takeReplay: true });
    screen.continueWith(next);
    expect(screen.commands.state().count).toBe(1);
    expect(screen.commands.state().rerun).toBeUndefined();
  });
});

describe('a restart while the old feed\'s marks are still queued (#695 step 5)', () => {
  it('keeps a mark in an old write that the emulator has not parsed at the restart with the old terminal: its command ends as incomplete, and does not run in the new one', async () => {
    const { feed, frame, engine, screen } = await rig({ auto: false });
    feed.push('$ make\r\n', [placed(0, A()), placed(2, B()), placed(7, C('make'))]);
    frame();
    expect(screen.commands.state().count, 'the old marks are still queued').toBe(0);
    feed.set({ state: 'ended', exit: { signal: 'SIGKILL' } });
    screen.continueWith(fakeTerminalFeed({ state: 'starting', takeReplay: true }));
    engine().complete();
    engine().complete();
    engine().complete();
    expect(screen.commands.state().count).toBe(1);
    expect(screen.commands.state().rerun, 'nothing runs in the new terminal').toBeUndefined();
  });
});

describe('what a restart must not lose of the gutter (#695 step 5)', () => {
  it('keeps a command whose marks the ended feed still held when the screen was told to flush and continue: the loop does not stop at the bytes when only marks are left', async () => {
    const { feed, screen } = await rig();
    feed.push('$ make\r\n', [placed(0, A()), placed(2, B()), placed(7, C('make')), placed(8, D(0))]);
    feed.set({ state: 'ended', exit: { code: 0 } });
    screen.flush();
    screen.continueWith(fakeTerminalFeed({ state: 'starting', takeReplay: true }));
    expect(screen.commands.state().count).toBe(1);
  });

  it('keeps a command whose marks alone are held (their bytes were drawn): the marks are placed all the same', async () => {
    const { feed, frame, screen } = await rig();
    feed.push('$ make\r\n');
    frame();
    feed.push(new Uint8Array(0), [placed(0, C('make'))]);
    feed.set({ state: 'ended', exit: { code: 0 } });
    screen.flush();
    expect(screen.commands.state().count).toBe(1);
  });

  it('runs again a command of the terminal before the restart WITHOUT Enter, and says where the line came from', async () => {
    const { feed, frame, screen, engine, events } = await rig();
    feed.push('$ make\r\nout\r\n', [placed(0, A()), placed(2, B()), placed(7, C('make')), placed(13, D(0))]);
    frame();
    feed.set({ state: 'ended', exit: { code: 0 } });
    const next = fakeTerminalFeed({ state: 'running', takeReplay: true });
    screen.continueWith(next);
    screen.commands.rerun();
    expect(engine().pastes).toEqual(['make']);
    expect(next.typed(), 'no Enter: the old shell\'s proof does not hold for the new one').toEqual([]);
    expect(events.at(-1)).toEqual({ kind: 'said', words: 'The command line is typed from the terminal before the restart; press Enter to run it' });
  });
});

describe('review of #791: nothing with a line break reaches the new shell from an old command (#695 step 5)', () => {
  it('types nothing of an earlier terminal\'s multi-line command, with bracketed paste off or on', async () => {
    const { feed, frame, screen, engine } = await rig();
    feed.push('$ a\r\n', [placed(0, A()), placed(2, B()), placed(5, C('touch /tmp/x\necho b')), placed(5, D(0))]);
    frame();
    feed.set({ state: 'ended', exit: { code: 0 } });
    const next = fakeTerminalFeed({ state: 'running', takeReplay: true });
    screen.continueWith(next);
    screen.commands.rerun();
    expect(engine().pastes).toEqual([]);
    expect(next.typed().join('')).not.toMatch(/[\r\n]/);
  });
});
