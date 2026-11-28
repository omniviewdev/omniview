import { type Terminal } from '@xterm/xterm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Engine, EngineAppearance } from './engine';
import { createXtermEngine } from './xtermEngine';

// THE MARKERS OF A REAL EMULATOR (issue #694 step 5). The gutter stands on what xterm.js does with a marker, and the fake emulator of the other tests keeps its own buffer, so it cannot prove any of it: that a marker made in the callback
// of a write is on the line the parse left the cursor on (and one made before the parse is not: xterm.js #5214), that it moves with the text, that the scrollback and a clear take it, that the alternate screen has none, and that the
// view and the text can be read and set by line.

const APPEARANCE: EngineAppearance = {
  theme: { background: '#000', foreground: '#fff', cursor: '#fff', cursorAccent: '#000', selectionBackground: '#222', selectionInactiveBackground: '#111', palette: Array.from({ length: 16 }, () => '#888') },
  fontFamily: 'monospace',
  fontSize: 12,
  lineHeight: 1.33,
  cursorStyle: 'block',
};

const EMPTY = new Uint8Array(0);
const opened: Array<{ readonly engine: Engine; readonly host: HTMLElement }> = [];
const registered: Terminal[] = [];

function emulator(scrollback = 100, rows = 24, open = true) {
  const host = document.createElement('div');
  document.body.append(host);
  const engine = createXtermEngine({ cols: 80, rows, scrollback, appearance: APPEARANCE, screenReaderMode: false });
  if (open) {
    engine.open(host);
  }

  opened.push({ engine, host });
  /** Writes and answers once the emulator has parsed it. */
  const parsed = async (data: string | Uint8Array): Promise<void> => {
    const { promise, resolve } = Promise.withResolvers<void>();
    engine.write(data, resolve);
    return promise;
  };

  return { engine, host, parsed };
}

afterEach(() => {
  for (const { engine, host } of opened.splice(0)) {
    engine.dispose();
    host.remove();
  }

  registered.length = 0;
  vi.restoreAllMocks();
});

describe('a marker made where the parse stands', () => {
  it('is on the line the cursor is on once the bytes before it are parsed: made in the callback of the write that ends at the mark', async () => {
    const { engine, parsed } = emulator();
    let made: ReturnType<Engine['mark']>;
    const { promise, resolve } = Promise.withResolvers<void>();
    engine.write('one\r\ntwo\r\nthree', () => {
      made = engine.mark();
      resolve();
    });
    await promise;
    expect(made?.marker.line()).toBe(2);
    expect(made?.column).toBe(5);
    await parsed('\r\nfour\r\n');
    expect(made?.marker.line(), 'it stays on its line as the text goes on').toBe(2);
    expect(engine.cursor()).toEqual({ line: 4, column: 0 });
  });

  it('is on line 0 when it is made while the write that moves the cursor is still waiting: the pitfall (xterm.js #5214) that makes the gutter create its markers in the callback and nowhere else', async () => {
    const { engine, parsed } = emulator();
    engine.write('one\r\ntwo\r\nthree\r\n');
    const early = engine.mark();
    expect(early?.marker.line(), 'the bytes were handed over and not parsed').toBe(0);
    await parsed(EMPTY);
    expect(engine.cursor().line).toBe(3);
    expect(early?.marker.line(), 'the marker does not follow the cursor').toBe(0);
  });

  it('is where an empty write that waits behind the bytes puts it: how a mark at the very start of a read, or after bytes already handed over, gets its place', async () => {
    const { engine } = emulator();
    const lines: number[] = [];
    const first = Promise.withResolvers<void>();
    const second = Promise.withResolvers<void>();
    engine.write('a\r\nb\r\n', first.resolve);
    engine.write(EMPTY, () => {
      lines.push(engine.mark()?.marker.line() ?? -1);
      second.resolve();
    });
    await Promise.all([first.promise, second.promise]);
    expect(lines).toEqual([2]);
  });

  it('moves up with the text as the buffer scrolls, and is gone when the scrollback drops its line: its listener is told once', async () => {
    const { engine, parsed } = emulator(5, 5);
    await parsed('top\r\n');
    const made = engine.mark();
    const gone = vi.fn();
    made?.marker.onDispose(gone);
    expect(made?.marker.line()).toBe(1);
    await parsed('1\r\n2\r\n3\r\n');
    expect(made?.marker.line(), 'the lines above it are still held').toBe(1);
    expect(gone).not.toHaveBeenCalled();
    let text = '';
    for (let line = 0; line < 30; line += 1) {
      text += `row ${String(line)}\r\n`;
    }

    await parsed(text);
    expect(made?.marker.line(), 'the scrollback of 5 lines dropped it').toBe(-1);
    expect(gone).toHaveBeenCalledTimes(1);
  });

  it('is gone after a clear, the one on the cursor\'s line too (the emulator keeps that line and disposes every marker)', async () => {
    const { engine, parsed } = emulator();
    await parsed('old\r\n');
    const old = engine.mark();
    await parsed('prompt');
    const current = engine.mark();
    expect(old?.marker.line()).toBe(1);
    expect(current?.marker.line()).toBe(1);
    engine.clear();
    expect(engine.cursor().line, 'the cursor\'s line is kept and is the first line now').toBe(0);
    expect(old?.marker.line()).toBe(-1);
    expect(current?.marker.line(), 'the emulator disposes every marker of the buffer, the cursor\'s line too').toBe(-1);
  });

  it('is gone when it is disposed, and a listener added after that is told at once; a listener that was stopped is not told', async () => {
    const { engine, parsed } = emulator();
    await parsed('x\r\n');
    const made = engine.mark();
    const told = vi.fn();
    const stopped = vi.fn();
    made?.marker.onDispose(told);
    made?.marker.onDispose(stopped)();
    made?.marker.dispose();
    expect(made?.marker.line()).toBe(-1);
    expect(told).toHaveBeenCalledTimes(1);
    expect(stopped).not.toHaveBeenCalled();
    const late = vi.fn();
    made?.marker.onDispose(late);
    expect(late).toHaveBeenCalledTimes(1);
  });
});

describe('the screen reader mode', () => {
  it('changes nothing of the markers: a marker made in the callback of a write is on the same line with the mode on, and the mode can be switched on and off with markers alive', async () => {
    const { engine, parsed } = emulator();
    await parsed('one\r\ntwo\r\n');
    const before = engine.mark();
    engine.setScreenReaderMode(true);
    await parsed('three\r\nfour');
    const during = engine.mark();
    expect(before?.marker.line()).toBe(2);
    expect(during?.marker.line()).toBe(3);
    engine.setScreenReaderMode(false);
    expect(before?.marker.line(), 'the mode does not rebuild the buffer').toBe(2);
    expect(during?.marker.line()).toBe(3);
  });
});

describe('the alternate screen', () => {
  it('has no marker: a program that has the whole screen has no command lines, and the screen says it is up (the stylesheet hides the gutter by it)', async () => {
    const { engine, host, parsed } = emulator();
    await parsed('prompt\r\n');
    const before = engine.mark();
    expect(engine.alternate()).toBe(false);
    expect(host.hasAttribute('data-alternate')).toBe(false);
    await parsed('\u001b[?1049h');
    expect(engine.alternate()).toBe(true);
    expect(engine.mark(), 'none is made while the other screen is up').toBeUndefined();
    expect(host.hasAttribute('data-alternate'), 'the decorations are hidden by it').toBe(true);
    await parsed('\u001b[?1049l');
    expect(engine.alternate()).toBe(false);
    expect(host.hasAttribute('data-alternate')).toBe(false);
    expect(before?.marker.line(), 'the marker of the normal screen is where it was').toBe(1);
    expect(engine.mark()).toBeDefined();
  });
});

describe('a decoration', () => {
  it('is made for a marker that lives and for none that is gone, and is one decoration of the emulator for each call (a DOM node each: the caller caps them)', async () => {
    const { engine, parsed } = emulator();
    await parsed('x\r\n');
    const terminal = [...document.querySelectorAll('.xterm')].length;
    expect(terminal).toBeGreaterThan(0);
    const made = engine.mark();
    const marker = made?.marker;
    expect(marker, 'a marker was made').toBeDefined();
    if (marker === undefined) {
      return;
    }

    const painted = vi.fn();
    const first = engine.decorate(marker, painted);
    expect(first).toBeDefined();
    first?.dispose();
    marker.dispose();
    expect(engine.decorate(marker, painted), 'a marker that is gone has nothing to decorate').toBeUndefined();
  });
});

describe('the view and the text, by line', () => {
  it('reads the text of a range of lines: a wrapped line is one, the end of a line is trimmed, the lines are joined with a line feed', async () => {
    const { engine, parsed } = emulator();
    await parsed(`${'x'.repeat(100)}\r\nsecond   \r\nthird\r\n`);
    expect(engine.lines(0, 3), 'rows 0 and 1 are one wrapped line').toBe(`${'x'.repeat(100)}\nsecond`);
    expect(engine.lines(2, 3)).toBe('second');
    expect(engine.lines(3, 4)).toBe('third');
    expect(engine.lines(50, 60), 'a range with no line').toBe('');
  });

  it('selects whole lines, and the selection is their text', async () => {
    const { engine, parsed } = emulator();
    await parsed('zero\r\none\r\ntwo\r\nthree\r\n');
    engine.selectLines(1, 3);
    expect(engine.hasSelection()).toBe(true);
    expect(engine.selection()).toBe('one\ntwo');
  });

  it('scrolls a line to the top of the view and back to the bottom, and says where the view is (an emulator that is not opened: the scroll of an opened one goes through its element, which a document with no layout does not follow; the probe proves that one)', async () => {
    const { engine, parsed } = emulator(1000, 10, false);
    let text = '';
    for (let line = 0; line < 60; line += 1) {
      text += `row ${String(line)}\r\n`;
    }

    await parsed(text);
    expect(engine.viewport()).toEqual({ top: 51, rows: 10, atBottom: true });
    engine.scrollTo(12);
    expect(engine.viewport()).toEqual({ top: 12, rows: 10, atBottom: false });
    engine.scrollToBottom();
    expect(engine.viewport().atBottom).toBe(true);
    engine.scrollTo(500);
    expect(engine.viewport().top, 'as far as the buffer allows').toBe(51);
  });
});
