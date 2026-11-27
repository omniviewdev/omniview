import { describe, expect, it } from 'vitest';
import type { Engine, EngineAppearance } from './engine';
import type { PlacedMark, TerminalMark } from './feed';
import { createScreen } from './screen';
import { createScreenReaderChoice } from './screenReader';
import { fakeTerminalFeed } from './testing';
import type { GutterEvent } from './gutter/commandGutter';
import { createXtermEngine } from './xtermEngine';

// A HELD REVEAL ON A REAL EMULATOR (issue #694 step 6, review). The screen holds Show until it has read what the feed holds AND the emulator has parsed it and run the writes that make the markers; a reveal done before that
// would read a gutter with no command in it. This runs the real xterm.js (the marker writes are the emulator's own, in its own order), not a fake that parses at once: only here does the wait for the marker writes matter.

const APPEARANCE: EngineAppearance = {
  theme: { background: '#000', foreground: '#fff', cursor: '#fff', cursorAccent: '#000', selectionBackground: '#222', selectionInactiveBackground: '#111', palette: Array.from({ length: 16 }, () => '#888') },
  fontFamily: 'monospace',
  fontSize: 12,
  lineHeight: 1.33,
};

const mark = (kind: TerminalMark['kind'], extra: Partial<TerminalMark> = {}): TerminalMark => ({ kind, at: 0, end: 1, trust: 'unverified', ...extra });
const placed = (at: number, one: TerminalMark): PlacedMark => ({ mark: one, at });
const flush = async () => {
  for (let turn = 0; turn < 20; turn += 1) {
    await Promise.resolve();
  }
};

async function rig() {
  const feed = fakeTerminalFeed({ takeReplay: true });
  const queue: Array<() => void> = [];
  const inner = createXtermEngine({ cols: 80, rows: 6, scrollback: 100, appearance: APPEARANCE, screenReaderMode: false });
  const scrolls: number[] = [];
  const real: Engine = {
    ...inner,
    scrollTo: (line) => {
      scrolls.push(line);
      inner.scrollTo(line);
    },
  };
  // Writes whose callbacks the test lets the emulator run, as the real one does: after it has parsed, on its own timer.
  const screen = createScreen({
    feed,
    load: async () => () => real,
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
    copy: async () => Promise.resolve(true),
    warn: () => undefined,
  });
  const host = document.createElement('div');
  document.body.append(host);
  screen.mount(host);
  screen.show();
  await flush();
  const events: GutterEvent[] = [];
  screen.commands.onEvent((event) => {
    events.push(event);
  });
  return {
    screen,
    feed,
    events,
    scrolls,
    said: () => events.filter((one) => one.kind === 'said').map((one) => (one.kind === 'said' ? one.words : '')),
    frame: () => {
      for (const callback of queue.splice(0)) {
        callback();
      }
    },
    parsed: async () => new Promise<void>((resolve) => {
      real.write('', resolve);
    }),
    done: () => {
      screen.dispose();
      inner.dispose();
      host.remove();
    },
  };
}

const COMMAND: readonly PlacedMark[] = [
  placed(0, mark('prompt-start', { id: 'c1' })),
  placed(2, mark('input-start', { id: 'c1' })),
  placed(8, mark('command-start', { id: 'c1', trust: 'nonce', command: 'make' })),
  placed(16, mark('command-end', { id: 'c1', exit: 2, durationMs: 31_000 })),
];

describe('Show on the real emulator', () => {
  it('is held until the markers are parsed, then goes to the command once and says so once (real xterm)', async () => {
    const r = await rig();
    r.feed.push('$ make\r\nout123\r\n', COMMAND);
    // Show arrives before the frame: the feed holds the output and its marks, the gutter is empty.
    r.screen.commands.reveal('c1');
    expect(r.said(), 'before the frame').toEqual([]);
    expect(r.scrolls).toEqual([]);
    // The frame hands the bytes and the marker writes to the emulator, which has parsed none of it yet.
    r.frame();
    expect(r.said(), 'the frame queued the marker writes; the emulator has not run them').toEqual([]);
    expect(r.scrolls).toEqual([]);
    await r.parsed();
    await flush();
    expect(r.scrolls, 'one scroll, to the command\'s line').toEqual([0]);
    expect(r.said()).toEqual(['Command 1 of 1, Failed, exit 2, took 31 s: make']);
    r.done();
  });

  it('says a command that is truly gone is gone, once, after the screen has placed what it holds (real xterm)', async () => {
    const r = await rig();
    r.feed.push('$ make\r\nout123\r\n', COMMAND);
    r.screen.commands.reveal('c99');
    r.frame();
    expect(r.said()).toEqual([]);
    await r.parsed();
    await flush();
    expect(r.scrolls).toEqual([]);
    expect(r.said()).toEqual(['That command is no longer in the terminal']);
    r.done();
  });
});
