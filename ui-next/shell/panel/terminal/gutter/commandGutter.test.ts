import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Engine, EngineAppearance, EngineDecoration, EngineMarker } from '../engine';
import type { TerminalMark } from '../feed';
import { createXtermEngine } from '../xtermEngine';
import { createCommandGutter, MAX_COMMANDS, type CommandGutter, type GutterEvent } from './commandGutter';

// THE MODEL OF THE COMMAND GUTTER over a REAL emulator (issue #694 step 5). Where a marker lands, when it dies and what the selection is cannot be proved against a fake emulator that keeps its own idea of a line, so these run the real
// xterm.js: every mark is taken in the callback of the write that ends where the mark stands, as the screen takes it. The facts of a command are the producer's: the model reads no clock.

const APPEARANCE: EngineAppearance = {
  theme: { background: '#000', foreground: '#fff', cursor: '#fff', cursorAccent: '#000', selectionBackground: '#222', selectionInactiveBackground: '#111', palette: Array.from({ length: 16 }, () => '#888') },
  fontFamily: 'monospace',
  fontSize: 12,
  lineHeight: 1.33,
  cursorStyle: 'block',
};

const mark = (kind: TerminalMark['kind'], extra: Partial<TerminalMark> = {}): TerminalMark => ({ kind, at: 0, end: 1, trust: 'unverified', ...extra });
const A = (id = 'c1'): TerminalMark => mark('prompt-start', { id });
const B = (id = 'c1'): TerminalMark => mark('input-start', { id });
const C = (command: string | undefined, id = 'c1'): TerminalMark => mark('command-start', { id, ...(command === undefined ? {} : { trust: 'nonce', command }), timeMs: 1_000 });
const D = (exit: number | undefined, durationMs: number | undefined, id = 'c1'): TerminalMark => mark('command-end', { id, ...(exit === undefined ? {} : { exit }), ...(durationMs === undefined ? {} : { durationMs }), timeMs: 3_000 });
const CWD = (cwd: string, trust: TerminalMark['trust'] = 'nonce'): TerminalMark => mark('cwd', { cwd, trust });

type Decoration = { readonly marker: EngineMarker; readonly paint: (element: HTMLElement) => void; refreshed: number; disposed: boolean };

const rigs: Array<() => void> = [];

function setup(options: { readonly rows?: number; readonly scrollback?: number; readonly open?: boolean } = {}) {
  const host = document.createElement('div');
  document.body.append(host);
  const real = createXtermEngine({ cols: 80, rows: options.rows ?? 24, scrollback: options.scrollback ?? 1000, appearance: APPEARANCE, screenReaderMode: false });
  if (options.open === true) {
    real.open(host);
  }

  const decorations: Decoration[] = [];
  const engine: Engine = {
    ...real,
    decorate: (marker, paint) => {
      const inner = real.decorate(marker, paint);
      const record: Decoration = { marker, paint, refreshed: 0, disposed: false };
      decorations.push(record);
      marker.onDispose(() => {
        record.disposed = true;
      });
      const handle: EngineDecoration = {
        refresh: () => {
          record.refreshed += 1;
          inner?.refresh();
        },
        dispose: () => {
          record.disposed = true;
          inner?.dispose();
        },
      };
      return handle;
    },
  };
  const gutter: CommandGutter = createCommandGutter(engine);
  const events: GutterEvent[] = [];
  gutter.onEvent((event) => {
    events.push(event);
  });
  /** Writes `text`, and takes `marks` in the callback of the write: the place the parse stands at when the text is parsed. */
  const feed = async (text: string, marks: readonly TerminalMark[] = []): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    engine.write(text, () => {
      gutter.ingest(marks);
      resolve();
    });
    return promise;
  };

  const prompt = async (id = 'c1'): Promise<void> => {
    await feed('', [A(id)]);
    await feed('$ ', [B(id)]);
  };

  /** A whole command: the prompt, the line typed, the output, the end. `proven`: the shell proved the line with the nonce. */
  const run = async (command: string, output: string, init: { readonly id?: string; readonly exit?: number | undefined; readonly ms?: number | undefined; readonly proven?: boolean } = {}): Promise<void> => {
    const id = init.id ?? 'c1';
    await prompt(id);
    await feed(`${command}\r\n`, [C(init.proven === false ? undefined : command, id)]);
    await feed(output, [D('exit' in init ? init.exit : 0, 'ms' in init ? init.ms : 1_500, id)]);
  };

  const close = () => {
    gutter.dispose();
    real.dispose();
    host.remove();
  };

  rigs.push(close);
  return { engine, gutter, events, decorations, feed, prompt, run, host };
}

afterEach(() => {
  for (const close of rigs.splice(0)) {
    close();
  }

  vi.restoreAllMocks();
});

describe('the commands the marks make', () => {
  it('has a command for each start mark, on the line it was typed on, with what the producer said of it: its line (proven), its exit status, its duration and its directory', async () => {
    const { gutter, feed, run } = setup();
    await feed('', [CWD('/home/u/src')]);
    await run('make test', 'ok\r\n', { exit: 0, ms: 1_500 });
    expect(gutter.commands()).toEqual([{ id: 'c1', state: 'success', command: 'make test', exit: 0, durationMs: 1_500, cwd: '/home/u/src', line: 0 }]);
  });

  it('is `failure` for a status other than 0 and carries it, `success` for 0, and tells the second command from the first by its own line', async () => {
    const { gutter, run } = setup();
    await run('true', '', { id: 'c1', exit: 0 });
    await run('false', 'boom\r\n', { id: 'c2', exit: 3, ms: 20 });
    expect(gutter.commands().map((one) => [one.id, one.state, one.exit, one.line])).toEqual([['c1', 'success', 0, 0], ['c2', 'failure', 3, 1]]);
  });

  it('is `running` from the start mark until the end mark, and then what the end says', async () => {
    const { gutter, feed, prompt } = setup();
    await prompt();
    await feed('sleep 9\r\n', [C('sleep 9')]);
    expect(gutter.commands().map((one) => one.state)).toEqual(['running']);
    expect(gutter.commands()[0]?.durationMs, 'a command that runs has no duration').toBeUndefined();
    expect(gutter.busy()).toBe(true);
    await feed('', [D(1, 9_000)]);
    expect(gutter.commands().map((one) => [one.state, one.exit, one.durationMs])).toEqual([['failure', 1, 9_000]]);
    expect(gutter.busy()).toBe(false);
  });

  it('makes no command of an end with no start (Ctrl-C at an empty prompt), of a prompt, or of an input start: nothing is drawn for a line nobody ran', async () => {
    const { gutter, feed, decorations, prompt } = setup();
    await prompt();
    await feed('^C\r\n', [D(130, undefined, 'c1')]);
    await prompt('c2');
    await prompt('c3');
    expect(gutter.commands()).toEqual([]);
    expect(decorations).toHaveLength(0);
  });

  it('is `incomplete` when the end has no status (a shell that sends none), and when a prompt comes back while it runs (a shell that was replaced, an ssh that ended: nobody printed the end)', async () => {
    const { gutter, feed, prompt, run } = setup();
    await run('echo hi', 'hi\r\n', { id: 'c1', exit: undefined, ms: 5 });
    await prompt('c2');
    await feed('ssh host\r\n', [C('ssh host', 'c2')]);
    await feed('', [A('c3')]);
    expect(gutter.commands().map((one) => [one.id, one.state, one.exit])).toEqual([['c1', 'incomplete', undefined], ['c2', 'incomplete', undefined]]);
    expect(gutter.busy(), 'the shell is back').toBe(false);
  });

  it('ends the running command named by the end mark\'s id, and an end that names none that runs closes nothing', async () => {
    const { gutter, feed, prompt } = setup();
    await prompt('c1');
    await feed('one\r\n', [C('one', 'c1')]);
    await feed('', [D(0, 5, 'c9')]);
    expect(gutter.commands().map((one) => one.state), 'an end for another command is not this one\'s').toEqual(['running']);
    await feed('', [D(0, 5, 'c1')]);
    expect(gutter.commands().map((one) => one.state)).toEqual(['success']);
  });

  it('takes a command line only from a start the host proved: an unverified start that carries one is no command line', async () => {
    const { gutter, feed, prompt } = setup();
    await prompt();
    await feed('x\r\n', [mark('command-start', { id: 'c1', trust: 'unverified', command: 'rm -rf ~' })]);
    expect(gutter.commands()[0]?.command).toBeUndefined();
  });

  it('keeps the line a command was typed on out of what a program can print: a start mark the shell did not prove has no command line, and the hover has none to show', async () => {
    const { gutter, run } = setup();
    await run('echo forged', '', { proven: false });
    const [command] = gutter.commands();
    expect(command).toBeDefined();
    expect(command?.command).toBeUndefined();
    expect(command?.state).toBe('success');
  });

  it('takes a directory only from a mark the shell proved: a directory a program printed (trust unverified) is no one\'s cwd', async () => {
    const { gutter, feed, run } = setup();
    await feed('', [CWD('/forged', 'unverified')]);
    await run('ls', '', { id: 'c1' });
    await feed('', [CWD('/real')]);
    await run('pwd', '/real\r\n', { id: 'c2' });
    expect(gutter.commands().map((one) => one.cwd)).toEqual([undefined, '/real']);
  });

  it('reads no clock: the duration is the host\'s number, whatever time the page has', async () => {
    const { gutter, run, feed } = setup();
    await run('sleep 1', '', { exit: 0, ms: 1_000 });
    expect(gutter.commands()[0]?.durationMs).toBe(1_000);
    // The emulator reads the clock to pace its own writes; what is asked here is the gutter, which takes its marks and answers its questions.
    const now = vi.spyOn(Date, 'now');
    const perf = vi.spyOn(performance, 'now');
    await feed('', []);
    now.mockClear();
    perf.mockClear();
    gutter.ingest([A('c2'), B('c2'), C('next', 'c2'), D(1, 7_000, 'c2')]);
    gutter.commands();
    gutter.jump('previous');
    expect(gutter.commands().at(-1)?.durationMs).toBe(7_000);
    expect(now).not.toHaveBeenCalled();
    expect(perf).not.toHaveBeenCalled();
  });
});

describe('the markers of the gutter', () => {
  it('are made at the place the parse stands: the command is on the line the prompt was on, and its output starts on the line after the line typed', async () => {
    const { gutter, run, engine } = setup();
    await run('one', 'a\r\nb\r\n', { id: 'c1' });
    await run('two', 'c\r\n', { id: 'c2' });
    const lines = gutter.commands().map((one) => one.line);
    expect(lines).toEqual([0, 3]);
    expect(engine.lines(0, 5)).toBe('$ one\na\nb\n$ two\nc');
  });

  it('die with their lines when the scrollback drops them: the command goes, its decoration is disposed, the commands below stay', async () => {
    const { gutter, run, decorations } = setup({ rows: 5, scrollback: 6 });
    for (let at = 1; at <= 12; at += 1) {
      await run(`cmd ${String(at)}`, 'x\r\ny\r\n', { id: `c${String(at)}` });
    }

    const ids = gutter.commands().map((one) => one.id);
    expect(ids.length).toBeGreaterThan(0);
    expect(ids.length, 'the older ones were dropped with their lines').toBeLessThan(12);
    expect(ids.at(-1)).toBe('c12');
    const live = decorations.filter((one) => !one.disposed);
    expect(live.length, 'one decoration for each command that is left, and none for the dead').toBe(ids.length);
  });

  it('die on a clear: the emulator disposes every marker of its buffer, and the gutter has no command left to point at a line that is not there', async () => {
    const { gutter, run, engine, decorations } = setup();
    await run('one', 'a\r\n', { id: 'c1' });
    await run('two', 'b\r\n', { id: 'c2' });
    expect(gutter.commands()).toHaveLength(2);
    engine.clear();
    expect(gutter.commands()).toEqual([]);
    expect(decorations.every((one) => one.disposed)).toBe(true);
  });

  it('leave the commands that come after a clear whole: the next command is drawn as the first of the new screen', async () => {
    const { gutter, run, engine } = setup();
    await run('one', 'a\r\n', { id: 'c1' });
    engine.clear();
    await run('two', 'b\r\n', { id: 'c2' });
    expect(gutter.commands().map((one) => one.id)).toEqual(['c2']);
  });

  it('are none in the alternate screen: a start mark taken while a program has it makes no command, and the gutter goes on when the program is gone', async () => {
    const { gutter, feed, run } = setup();
    await run('vim', '', { id: 'c1' });
    await feed('\u001b[?1049h');
    await feed('', [A('c2'), B('c2')]);
    await feed('', [C('ls', 'c2')]);
    expect(gutter.commands().map((one) => one.id), 'nothing is drawn on the other screen').toEqual(['c1']);
    await feed('\u001b[?1049l');
    await run('ls', 'x\r\n', { id: 'c3' });
    expect(gutter.commands().map((one) => one.id)).toEqual(['c1', 'c3']);
  });

  it('are let go with the screen they were made on: a reset (a replay brings the screen afresh) disposes every marker and decoration and forgets the directory', async () => {
    const { gutter, run, decorations, engine } = setup();
    await run('one', 'a\r\n', { id: 'c1' });
    const [first] = decorations;
    gutter.reset();
    expect(gutter.commands()).toEqual([]);
    expect(first?.disposed).toBe(true);
    expect(first?.marker.line()).toBe(-1);
    expect(engine.cursor().line, 'the text is the emulator\'s and is not touched').toBeGreaterThan(0);
  });

  it('are capped: the newest MAX_COMMANDS commands are kept and drawn, the oldest are let go one by one (each is a DOM node of the emulator\'s)', async () => {
    const { gutter, run, decorations } = setup({ scrollback: 10_000 });
    const total = MAX_COMMANDS + 40;
    for (let at = 1; at <= total; at += 1) {
      await run('x', '', { id: `c${String(at)}` });
    }

    const commands = gutter.commands();
    expect(commands).toHaveLength(MAX_COMMANDS);
    expect(commands[0]?.id).toBe(`c${String(total - MAX_COMMANDS + 1)}`);
    expect(commands.at(-1)?.id).toBe(`c${String(total)}`);
    expect(decorations.filter((one) => !one.disposed)).toHaveLength(MAX_COMMANDS);
    expect(decorations).toHaveLength(total);
  });

  it('draw the command on the line it was typed on, and draw it again when its state changes (running, then its status)', async () => {
    const { feed, prompt, decorations, engine } = setup();
    await prompt();
    await feed('sleep 1\r\n', [C('sleep 1')]);
    expect(decorations).toHaveLength(1);
    expect(decorations[0]?.marker.line(), 'the line of the prompt and the typed command').toBe(0);
    const before = decorations[0]?.refreshed ?? 0;
    await feed('', [D(0, 1_000)]);
    expect(decorations[0]?.refreshed).toBe(before + 1);
    expect(engine.lines(0, 1)).toBe('$ sleep 1');
  });
});

describe('the output of a command', () => {
  it('is exactly the lines between the line it was typed on and its end: selected, and read as text', async () => {
    const { gutter, run, engine } = setup({ open: true });
    await run('one', 'a1\r\na2\r\n', { id: 'c1' });
    await run('two', 'b1\r\n', { id: 'c2' });
    const [first, second] = gutter.commands();
    expect(gutter.output(first)).toBe('a1\na2');
    expect(gutter.output(second)).toBe('b1');
    expect(gutter.selectOutput(first)).toBe(true);
    expect(engine.selection()).toBe('a1\na2');
    expect(gutter.selectOutput(second)).toBe(true);
    expect(engine.selection(), 'the second\'s, and nothing of the prompt or of the first').toBe('b1');
  });

  it('includes a last line that has no line feed (the program stopped mid-line), and nothing after it', async () => {
    const { gutter, feed, prompt } = setup({ open: true });
    await prompt();
    await feed('printf abc\r\n', [C('printf abc')]);
    await feed('abc', [D(0, 4)]);
    expect(gutter.output()).toBe('abc');
  });

  it('is nothing for a command that printed nothing: no selection is made, and it is said', async () => {
    const { gutter, run, engine, events } = setup({ open: true });
    await run('true', '', { id: 'c1' });
    expect(gutter.output()).toBeUndefined();
    expect(gutter.selectOutput()).toBe(false);
    expect(engine.hasSelection()).toBe(false);
    expect(events.at(-1)).toEqual({ kind: 'said', words: 'This command printed no output' });
  });

  it('is the lines so far for a command that runs, and the whole when it is over', async () => {
    const { gutter, feed, prompt } = setup();
    await prompt();
    await feed('make\r\n', [C('make')]);
    await feed('step 1\r\nstep 2\r\n');
    expect(gutter.output()).toBe('step 1\nstep 2');
    await feed('step 3\r\n', [D(0, 10)]);
    expect(gutter.output()).toBe('step 1\nstep 2\nstep 3');
  });

  it('is gone with its lines: the output of a command that was dropped is not read', async () => {
    const { gutter, run, engine } = setup({ rows: 5, scrollback: 3 });
    await run('one', 'a\r\nb\r\n', { id: 'c1' });
    const [first] = gutter.commands();
    await run('two', `${'x\r\n'.repeat(20)}`, { id: 'c2' });
    expect(gutter.output(first)).toBeUndefined();
    expect(gutter.selectOutput(first)).toBe(false);
    expect(engine.hasSelection()).toBe(false);
  });
});

describe('what review found', () => {
  it('keeps a command running when the emulator drops its line (an erase), until the shell says it ended: the busy fact is the producer\'s', async () => {
    const { gutter, feed, prompt, engine } = setup();
    await prompt();
    await feed('sleep 9\r\n', [C('sleep 9')]);
    engine.clear();
    expect(gutter.busy()).toBe(true);
    await feed('', [D(0, 9_000)]);
    expect(gutter.busy()).toBe(false);
  });

  it('tells the tooltip the new facts when the command under the pointer finishes', async () => {
    const { feed, prompt, decorations, events } = setup();
    await prompt();
    await feed('sleep 1\r\n', [C('sleep 1')]);
    const element = document.createElement('div');
    decorations[0]?.paint(element);
    element.firstElementChild?.dispatchEvent(new MouseEvent('mouseenter'));
    await feed('', [D(1, 1_000)]);
    const hover = events.findLast((event) => event.kind === 'hover');
    expect(hover).toMatchObject({ kind: 'hover', command: { state: 'failure', exit: 1 } });
  });

  it('freezes the output of a command that was settled by the next prompt: what the next command prints is not its output', async () => {
    const { gutter, feed, prompt } = setup();
    await prompt();
    await feed('printf a\r\n', [C('printf a')]);
    await feed('a\r\n');
    await feed('', [A('c2')]);
    await feed('$ ', [B('c2')]);
    await feed('echo b\r\n', [C('echo b', 'c2')]);
    await feed('b\r\n', [D(0, 5, 'c2')]);
    expect(gutter.output(gutter.commands()[0])).toBe('a');
  });

  it('stops the output at the end column: the prompt that is drawn on the row after output with no line feed is not output', async () => {
    const { gutter, feed, prompt } = setup();
    await prompt();
    await feed('printf abc\r\n', [C('printf abc')]);
    await feed('abc', [D(0, 4)]);
    await feed('', [A('c2')]);
    await feed('$ ', [B('c2')]);
    expect(gutter.output(gutter.commands()[0])).toBe('abc');
  });

  it('reads an unproven line from its terminal cell, not its string index: a wide character in the prompt does not eat the first letter', async () => {
    const { gutter, feed } = setup();
    await feed('', [A()]);
    await feed('\u754c> ', [B()]);
    await feed('echo hi\r\n', [C(undefined)]);
    await feed('hi\r\n', [D(0, 1)]);
    expect(gutter.rerun()).toEqual({ text: 'echo hi', enter: false });
  });

  it('tells that the commands changed when a command settles or goes, so that an open menu can close', async () => {
    const { feed, prompt, events, engine } = setup();
    await prompt();
    await feed('x\r\n', [C('x')]);
    const before = events.filter((event) => event.kind === 'commands').length;
    await feed('', [D(0, 1)]);
    expect(events.filter((event) => event.kind === 'commands').length).toBeGreaterThan(before);
    const mid = events.filter((event) => event.kind === 'commands').length;
    engine.clear();
    expect(events.filter((event) => event.kind === 'commands').length).toBeGreaterThan(mid);
  });
});

describe('whether there is output to act on', () => {
  it('says there is none for a command that printed nothing and some for one that did, from the marks alone', async () => {
    const { gutter, run } = setup();
    await run('true', '', { id: 'c1' });
    expect(gutter.hasOutput()).toBe(false);
    await run('ls', 'a\r\n', { id: 'c2' });
    expect(gutter.hasOutput()).toBe(true);
  });
});

describe('markers of a command whose line was erased', () => {
  it('makes no new marker for the end of a command the gutter no longer holds: nothing would own it', async () => {
    const { feed, prompt, engine } = setup();
    await prompt();
    await feed('sleep 9\r\n', [C('sleep 9')]);
    engine.clear();
    const made = vi.spyOn(engine, 'mark');
    await feed('', [D(0, 9_000)]);
    expect(made).not.toHaveBeenCalled();
  });
});

describe('the jump to a command', () => {
  async function three() {
    const rig = setup({ rows: 6 });
    for (let at = 1; at <= 3; at += 1) {
      await rig.run(`cmd ${String(at)}`, 'o1\r\no2\r\no3\r\no4\r\n', { id: `c${String(at)}`, exit: at === 2 ? 1 : 0 });
    }

    await rig.prompt('c4');
    return rig;
  }

  it('goes to the last command from the bottom, then back one command at a time, to the first and no further', async () => {
    const { gutter, engine, events } = await three();
    const lines = gutter.commands().map((one) => one.line);
    expect(lines).toEqual([0, 5, 10]);
    expect(gutter.jump('previous')?.id).toBe('c3');
    expect(engine.viewport().top).toBe(10);
    expect(gutter.jump('previous')?.id).toBe('c2');
    expect(engine.viewport().top).toBe(5);
    expect(gutter.jump('previous')?.id).toBe('c1');
    expect(engine.viewport().top).toBe(0);
    expect(gutter.jump('previous'), 'there is none before the first').toBeUndefined();
    expect(engine.viewport().top, 'and the view stays').toBe(0);
    expect(events.at(-1)).toEqual({ kind: 'said', words: 'No previous command' });
  });

  it('goes forward one command at a time and, past the last, back to the bottom where the prompt is', async () => {
    const { gutter, engine, events } = await three();
    gutter.jump('previous');
    gutter.jump('previous');
    gutter.jump('previous');
    expect(gutter.jump('next')?.id).toBe('c2');
    expect(engine.viewport().top).toBe(5);
    expect(gutter.jump('next')?.id).toBe('c3');
    expect(gutter.jump('next')).toBeUndefined();
    expect(engine.viewport().atBottom).toBe(true);
    expect(events.at(-1)).toEqual({ kind: 'said', words: 'No next command, back at the prompt' });
  });

  it('goes from where the view is when the person scrolled: the previous command above its top line, the next below it', async () => {
    const { gutter, engine } = await three();
    engine.scrollTo(7);
    expect(gutter.jump('previous')?.id, 'the last command that starts above line 7').toBe('c2');
    engine.scrollTo(7);
    expect(gutter.jump('next')?.id).toBe('c3');
  });

  it('says where it went, for a person who cannot see: which command of how many, how it ended and what it was', async () => {
    const { gutter, events } = await three();
    gutter.jump('previous');
    gutter.jump('previous');
    expect(events.at(-1)).toEqual({ kind: 'said', words: 'Command 2 of 3, Failed, exit 1, took 1.5 s: cmd 2' });
  });

  it('selects the output of the command it goes to when it is asked to', async () => {
    const { gutter, engine } = await three();
    const opened = setup({ open: true });
    for (let at = 1; at <= 2; at += 1) {
      await opened.run(`cmd ${String(at)}`, `only ${String(at)}\r\n`, { id: `c${String(at)}` });
    }

    await opened.prompt('c3');
    expect(opened.gutter.jump('previous', { select: true })?.id).toBe('c2');
    expect(opened.engine.selection()).toBe('only 2');
    expect(gutter.commands()).toHaveLength(3);
    expect(engine.hasSelection()).toBe(false);
  });

  it('says there is nothing when there are no commands, and moves nothing', async () => {
    const { gutter, engine, events } = setup({ rows: 6 });
    expect(gutter.jump('previous')).toBeUndefined();
    expect(engine.viewport().top).toBe(0);
    expect(events.at(-1)).toEqual({ kind: 'said', words: 'No commands yet' });
  });

  it('acts on the command it went to: the output, the target and the line to run again are its own, until the person scrolls away', async () => {
    const { gutter, engine } = await three();
    expect(gutter.target()?.id, 'the last command, before any jump').toBe('c3');
    gutter.jump('previous');
    gutter.jump('previous');
    expect(gutter.target()?.id).toBe('c2');
    expect(gutter.output()).toBe('o1\no2\no3\no4');
    engine.scrollTo(0);
    expect(gutter.target()?.id, 'the view moved by something else: the last command again').toBe('c3');
  });
});

describe('running a command again', () => {
  it('types the line the shell proved and presses Enter: the line is the shell\'s own word', async () => {
    const { gutter, run } = setup();
    await run('make test', 'ok\r\n', { exit: 1 });
    expect(gutter.rerun()).toEqual({ text: 'make test', enter: true });
  });

  it('types a line the shell did not prove WITHOUT Enter: the text is read from the screen, from where the input starts, and the person decides', async () => {
    const { gutter, run } = setup();
    await run('echo hi', 'hi\r\n', { proven: false });
    expect(gutter.rerun()).toEqual({ text: 'echo hi', enter: false });
  });

  it('refuses a line the shell did not prove when it has a line break: with bracketed paste off a pasted line feed is a carriage return, and the first line would run (a forged "touch x" over "echo harmless")', async () => {
    const { gutter, feed, prompt } = setup();
    await prompt();
    await feed('touch /tmp/pwned\r\necho harmless\r\n', [C(undefined)]);
    await feed('', [D(0, 1)]);
    expect(gutter.rerun()).toBeUndefined();
  });

  it('types nothing while a command runs: the line would go to the program', async () => {
    const { gutter, feed, prompt } = setup();
    await prompt();
    await feed('sleep 9\r\n', [C('sleep 9')]);
    expect(gutter.rerun()).toBeUndefined();
  });

  it('types nothing on the alternate screen, and nothing for a command whose line is gone', async () => {
    const { gutter, feed, run } = setup({ rows: 5, scrollback: 2 });
    await run('one', 'a\r\n', { id: 'c1', proven: false });
    const [first] = gutter.commands();
    await run('two', `${'x\r\n'.repeat(30)}`, { id: 'c2' });
    expect(gutter.rerun(first), 'a command that was dropped').toBeUndefined();
    await feed('\u001b[?1049h');
    expect(gutter.rerun()).toBeUndefined();
  });

  it('drops the control characters of a line: nothing but text goes to the shell', async () => {
    const { gutter, run } = setup();
    await run('echo a\u001b[201~rm -rf ~\u0003', '', { exit: 0 });
    expect(gutter.rerun()?.text).toBe('echo a[201~rm -rf ~');
  });
});

describe('what the gutter tells', () => {
  it('tells where the pointer is: on the mark of a command, with the command, and off it with nothing; the position is the mark\'s own', async () => {
    const { gutter, run, decorations, events } = setup();
    await run('make', 'ok\r\n', { exit: 2, ms: 3_000 });
    const [decoration] = decorations;
    const element = document.createElement('div');
    document.body.append(element);
    decoration?.paint(element);
    const glyph = element.firstElementChild;
    expect(glyph, 'the decoration is painted').not.toBeNull();
    glyph?.dispatchEvent(new MouseEvent('mouseenter'));
    const hover = events.find((event) => event.kind === 'hover');
    expect(hover).toMatchObject({ kind: 'hover', command: { id: 'c1', state: 'failure', exit: 2, durationMs: 3_000, command: 'make' } });
    glyph?.dispatchEvent(new MouseEvent('mouseleave'));
    expect(events.at(-1)).toEqual({ kind: 'hover', command: undefined, x: 0, y: 0 });
    expect(gutter.commands()).toHaveLength(1);
    element.remove();
  });

  it('is named in the words of the state, never by colour alone: the glyph carries the state and its words', async () => {
    const { run, decorations } = setup();
    await run('make', '', { exit: 2 });
    const element = document.createElement('div');
    decorations[0]?.paint(element);
    const glyph = element.firstElementChild;
    expect(glyph?.getAttribute('data-state')).toBe('failure');
    expect(glyph?.getAttribute('aria-hidden'), 'the announcement of a jump is what a screen reader hears, not a node for each command').toBe('true');
  });

  it('paints a mark again only when its state changed: the emulator draws every decoration on every render, and a repaint that changes nothing is DOM work for each of 200 marks', async () => {
    const { run, decorations } = setup();
    await run('make', '', { exit: 0 });
    const element = document.createElement('div');
    decorations[0]?.paint(element);
    const first = element.firstElementChild;
    const watch = new MutationObserver(() => undefined);
    watch.observe(element, { childList: true, subtree: true, attributes: true });
    decorations[0]?.paint(element);
    decorations[0]?.paint(element);
    expect(watch.takeRecords()).toHaveLength(0);
    expect(element.firstElementChild, 'the same node').toBe(first);
    watch.disconnect();
  });

  it('stops telling the pointer is on a command that is gone: a decoration that is disposed while the pointer is on it says it left', async () => {
    const { run, decorations, events, engine } = setup();
    await run('make', '', { exit: 0 });
    const element = document.createElement('div');
    decorations[0]?.paint(element);
    element.firstElementChild?.dispatchEvent(new MouseEvent('mouseenter'));
    engine.clear();
    expect(events.at(-1)).toEqual({ kind: 'hover', command: undefined, x: 0, y: 0 });
  });
});

describe('a new terminal takes the place of an ended one (`seal`, #695 step 5)', () => {
  it('keeps the commands of the old terminal with its transcript, ends the one that ran as incomplete, and has no command running', async () => {
    const { gutter, feed, prompt, run } = setup();
    await run('true', '', { id: 'c1', exit: 0 });
    await prompt('c2');
    await feed('sleep 9\r\n', [C('sleep 9', 'c2')]);
    expect(gutter.busy()).toBe(true);
    gutter.seal();
    expect(gutter.busy()).toBe(false);
    expect(gutter.commands().map((one) => [one.id, one.state])).toEqual([['c1', 'success'], ['c2', 'incomplete']]);
  });

  it('lets the new terminal count from c1 again: its commands never meet the old ones by id, and its end mark closes its own command', async () => {
    const { gutter, feed, run } = setup();
    await run('old', 'out\r\n', { id: 'c1', exit: 7 });
    gutter.seal();
    await run('new', 'out\r\n', { id: 'c1', exit: 0 });
    const commands = gutter.commands();
    expect(commands.map((one) => one.state)).toEqual(['failure', 'success']);
    expect(new Set(commands.map((one) => one.id)).size).toBe(2);
    await feed('', []);
    expect(gutter.output(commands[1])).toBe('out');
    expect(gutter.output(commands[0])).toBe('out');
  });

  it('lets go of the prompt that was waiting: the new terminal\'s first command does not take the old terminal\'s line', async () => {
    const { gutter, feed } = setup();
    await feed('old $ ', [A('c1'), B('c1')]);
    gutter.seal();
    await feed('\r\nnew $ x\r\n', [C('x', 'c1')]);
    expect(gutter.commands().map((one) => one.line), 'a start with no prompt of its own is on its own line, not on the old prompt\'s').toEqual([2]);
  });
});

describe('running again a command of the terminal before a restart (#695 step 5)', () => {
  it('types its line without Enter, and says it came from the terminal before: the old shell\'s proof does not hold for the new one, and its directory may differ; a command of the new terminal is proven as ever', async () => {
    const { gutter, run } = setup();
    await run('make test', 'ok\r\n', { id: 'c1', exit: 0 });
    gutter.seal();
    await run('ls', 'x\r\n', { id: 'c1', exit: 0 });
    const [old, fresh] = gutter.commands();
    expect(gutter.rerun(old)).toEqual({ text: 'make test', enter: false, earlier: true });
    expect(gutter.rerun(fresh)).toEqual({ text: 'ls', enter: true });
  });
});

describe('review of #791: an old command with a line break is not typed (#695 step 5)', () => {
  it('refuses the line of an earlier terminal\'s proven command when it has a line break: it is typed without Enter, and with bracketed paste off a pasted line feed is a carriage return that runs its first line', async () => {
    const { gutter, run } = setup();
    await run('echo a\necho b', 'a\r\nb\r\n', { id: 'c1', exit: 0 });
    gutter.seal();
    const [old] = gutter.commands();
    expect(gutter.rerun(old)).toBeUndefined();
  });

  it('still runs a multi-line proven command of the terminal that runs, as before: the shell proved it and Enter is pressed', async () => {
    const { gutter, run } = setup();
    await run('echo a\necho b', 'a\r\nb\r\n', { id: 'c1', exit: 0 });
    expect(gutter.rerun()).toEqual({ text: 'echo a\necho b', enter: true });
  });
});

// REVEALING A COMMAND BY ITS ID (issue #694 step 6): a notice that says a command finished brings the person to it. It is the jump, to the command the producer named.

describe('revealing a command by its id', () => {
  async function three() {
    const rig = setup({ rows: 6 });
    for (let at = 1; at <= 3; at += 1) {
      await rig.run(`cmd ${String(at)}`, 'o1\r\no2\r\no3\r\no4\r\n', { id: `c${String(at)}`, exit: at === 2 ? 1 : 0 });
    }

    await rig.prompt('c4');
    return rig;
  }

  it('moves the view to the line of the command, makes it the target and says where it went', async () => {
    const { gutter, engine, events } = await three();
    expect(gutter.reveal('c2')?.id).toBe('c2');
    expect(engine.viewport().top).toBe(5);
    expect(gutter.target()?.id).toBe('c2');
    expect(events.at(-1)).toEqual({ kind: 'said', words: 'Command 2 of 3, Failed, exit 1, took 1.5 s: cmd 2' });
  });

  it('is where the next jump goes on from: the previous command is the one before it', async () => {
    const { gutter } = await three();
    gutter.reveal('c3');
    expect(gutter.jump('previous')?.id).toBe('c2');
  });

  it('says so, and moves nothing, for a command the gutter does not hold', async () => {
    const { gutter, engine, events } = await three();
    const before = engine.viewport().top;
    expect(gutter.reveal('c99')).toBeUndefined();
    expect(engine.viewport().top).toBe(before);
    expect(events.at(-1)).toEqual({ kind: 'said', words: 'That command is no longer in the terminal' });
  });

  it('says so for a command whose line the scrollback dropped: the command went with its line', async () => {
    const { gutter, run, events } = setup({ rows: 4, scrollback: 6 });
    for (let at = 1; at <= 6; at += 1) {
      await run(`cmd ${String(at)}`, 'a\r\nb\r\nc\r\n', { id: `c${String(at)}` });
    }

    expect(gutter.commands().some((one) => one.id === 'c1'), 'the first command is gone').toBe(false);
    expect(gutter.reveal('c1')).toBeUndefined();
    expect(events.at(-1)).toEqual({ kind: 'said', words: 'That command is no longer in the terminal' });
  });

  it('reveals a command that still runs, with its words', async () => {
    const { gutter, prompt, feed, events } = setup({ rows: 6 });
    await prompt('c1');
    await feed('make\r\n', [C('make', 'c1')]);
    expect(gutter.reveal('c1')?.state).toBe('running');
    expect(events.at(-1)).toEqual({ kind: 'said', words: 'Command 1 of 1, Running: make' });
  });
});

// REVEALING AFTER A RESTART (review of #694 step 6): a notice says which terminal of the session the command finished in (its epoch), so the same id in the terminal that came after a restart is not the command it names.

describe('revealing a command of an earlier terminal', () => {
  it('goes to the command of the terminal it was told of, and to the newest terminal\'s command when told of none', async () => {
    const { gutter, engine, run } = setup({ rows: 6 });
    const out = 'o1\r\no2\r\no3\r\n';
    await run('old one', out, { id: 'c1' });
    await run('old two', out, { id: 'c2' });
    gutter.seal();
    await run('new one', out, { id: 'c1' });
    await run('new two', out, { id: 'c2' });
    const lineOf = (text: string) => gutter.commands().find((one) => one.command === text)?.line;
    expect(gutter.reveal('c2', 0)?.command).toBe('old two');
    expect(engine.viewport().top).toBe(lineOf('old two'));
    expect(gutter.reveal('c2', 1)?.command).toBe('new two');
    expect(gutter.reveal('c2')?.command, 'no epoch: the newest terminal\'s').toBe('new two');
  });

  it('says it is gone for a terminal that never had the command', async () => {
    const { gutter, run, events } = setup({ rows: 6 });
    await run('only', 'o\r\n', { id: 'c1' });
    expect(gutter.reveal('c1', 3)).toBeUndefined();
    expect(events.at(-1)).toEqual({ kind: 'said', words: 'That command is no longer in the terminal' });
  });
});

// WHAT DIRECTORY A ROW BELONGS TO (#696 step 4): the file links resolve a path against the directory of the command that printed the row, as the shell proved it. A row before any command, and a command whose directory
// the shell did not prove, belong to no directory: the host then uses the shell's own, and the page never names one of its own.
describe('the directory of a row', () => {
  it('is the directory of the command whose line is at or above the row and whose successor is below it', async () => {
    const { gutter, feed, run } = setup();
    await feed('banner\r\n');
    await feed('', [CWD('/a')]);
    await run('make', 'one\r\ntwo\r\n', { id: 'c1' });
    await feed('', [CWD('/b')]);
    await run('ls', 'x\r\n', { id: 'c2' });
    const lines = gutter.commands().map((one) => one.line);
    expect(lines).toEqual([1, 4]);
    expect([0, 1, 2, 3, 4, 5].map((row) => gutter.directoryAt(row))).toEqual([undefined, '/a', '/a', '/a', '/b', '/b']);
  });

  it('is nothing for a command whose directory the shell did not prove, and nothing past the buffer', async () => {
    const { gutter, feed, run } = setup();
    await feed('', [CWD('/forged', 'unverified')]);
    await run('ls', 'x\r\n', { id: 'c1' });
    expect([0, 1, 2].map((row) => gutter.directoryAt(row))).toEqual([undefined, undefined, undefined]);
    expect(gutter.directoryAt(-1)).toBeUndefined();
    expect(gutter.directoryAt(10_000)).toBeUndefined();
  });

  it('is gone with the command when its line leaves the scrollback: a row that no command owns belongs to no directory', async () => {
    const { gutter, feed, run } = setup({ rows: 5, scrollback: 3 });
    await feed('', [CWD('/a')]);
    await run('first', 'a\r\n', { id: 'c1' });
    for (let index = 0; index < 20; index += 1) {
      await feed(`filler ${String(index)}\r\n`);
    }

    expect(gutter.commands()).toEqual([]);
    expect(gutter.directoryAt(0)).toBeUndefined();
  });
});
