import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { findFileLinks } from './fileLinks';

// The matcher's contract with the link provider, over a REAL xterm buffer (`@xterm/xterm` 6.0.0 with the Unicode 11 addon, as `xtermEngine.ts` loads it; no fake): the matcher gives UTF-16 offsets into the text and knows no
// cells, because its own width table would disagree with the emulator's (`✅` is 2 cells in xterm, an Arabic mark 0). The provider (step 4) reads the logical line (the wrapped rows joined, from the first row of the chain)
// and maps each offset to the buffer cell that holds it. `logicalLine` below is that mapping; it lives here until step 4 writes the provider, and the tests prove that mapping and the offsets together select the path's cells.

async function make(cols: number): Promise<Terminal> {
  const terminal = new Terminal({ allowProposedApi: true, cols, rows: 10 });
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = '11';
  return terminal;
}

const write = async (terminal: Terminal, data: string): Promise<void> => new Promise((resolve) => {
  terminal.write(data, resolve); 
});

type Cell = { readonly row: number; readonly x: number; readonly chars: string };

/**
 * The logical line that holds buffer row `y`: walks UP to the first row of the wrapped chain (`provideLinks(y)` is given any one row), then DOWN to its last, and gives the joined text with, for each UTF-16 offset, the
 * cell that holds it (one more entry at the end). A width-0 cell is the second half of a wide character and gives no text; the blank padding cell that a wide character leaves at the end of a row it did not fit on gives none
 * either. A cell's characters (a base and its combining marks, a ZWJ cluster) all map to that cell.
 */
function logicalLine(terminal: Terminal, y: number): { text: string; cells: Cell[] } {
  const buffer = terminal.buffer.active;
  let first = y;
  while (buffer.getLine(first)?.isWrapped === true) {
    first -= 1;
  }

  let text = '';
  const cells: Cell[] = [];
  let row = first;
  for (;;) {
    const line = buffer.getLine(row);
    if (!line) {
      break;
    }

    const wrapsOn = buffer.getLine(row + 1)?.isWrapped === true;
    for (let x = 0; x < terminal.cols; x += 1) {
      const cell = line.getCell(x);
      if (cell?.getWidth() === 0) {
        continue;
      }

      const chars = cell?.getChars() ?? '';
      if (chars === '' && x === terminal.cols - 1 && wrapsOn) {
        continue;
      }

      const s = chars === '' ? ' ' : chars;
      const at = { row, x, chars: s };
      cells.push(...Array.from({ length: s.length }, () => at));
      text += s;
    }

    if (!wrapsOn) {
      break;
    }

    row += 1;
  }

  cells.push({ row, x: terminal.cols, chars: '' });
  return { text, cells };
}

/** The cell that holds the first character of a candidate and the one that holds its last: what the provider turns into a buffer range. */
function span(cells: Cell[], start: number, end: number): { first: Cell; last: Cell } {
  return { first: cells[start], last: cells[end - 1] };
}

describe('the offsets of a candidate select its cells in a real xterm buffer', () => {
  it.each([
    ['cjk', '日本語/ファイル.go:12:3 x'],
    ['cjk before', '名前: 日本語/a.go:1'],
    ['emoji before', '🎉🎉 a.go:1'],
    ['a wide bmp emoji before', '✅ src/a.test.ts:12:3'],
    ['wide bmp emoji, a star, a clock, a bolt', '❌✨⚡⭐⌛ a.go:1'],
    ['a mahjong tile', '\u{1f004} a.go:1'],
    ['emoji in the path', 'dir/🎉x.go:4'],
    ['combining', 'e\u0301e\u0301 a/é.go:1'],
    ['arabic marks', 'ك\u064e\u064f a/b.go:1'],
    ['thai marks', 'ก\u0e31\u0e49 a/b.go:1'],
    ['nfd jamo', '\u1100\u1161\u11a8 a/b.go:1'],
    ['a kana with a voiced mark', 'か\u3099 a/b.go:1'],
    ['presentation selector', '\u2764\ufe0f a.go:1'],
    ['text presentation', '\u2764\ufe0e a.go:1'],
    ['flag', '🇩🇪 a.go:1'],
    ['zwj', '👨\u200d👩 a.go:1'],
    ['a tab', 'a\tb/c.go:7'],
    ['fullwidth', 'ＡＢ x/y.go:2'],
  ])('%s', async (_label, line) => {
    const terminal = await make(60);
    await write(terminal, line);
    const { text, cells } = logicalLine(terminal, 0);
    const links = findFileLinks(text);
    expect(links.length, text).toBeGreaterThan(0);
    for (const c of links) {
      const { first, last } = span(cells, c.start, c.end);
      expect(first.chars.includes(text[c.start]), `the first cell of ${text.slice(c.start, c.end)}`).toBe(true);
      expect(last.chars.includes(text[c.end - 1]), `the last cell of ${text.slice(c.start, c.end)}`).toBe(true);
      // the cell is where the emulator put it: the text drawn from that cell on is the link
      const row = terminal.buffer.active.getLine(first.row)?.translateToString(false, first.x) ?? '';
      expect(row.startsWith(text.slice(c.start, Math.min(c.end, c.start + 3))), 'translateToString from the first cell').toBe(true);
    }

    terminal.dispose();
  });

  it('a wide bmp emoji takes two cells, so the link that follows it starts at cell 3 and not at offset 2', async () => {
    const terminal = await make(60);
    await write(terminal, '✅ src/a.test.ts:12:3');
    const { text, cells } = logicalLine(terminal, 0);
    const [c] = findFileLinks(text);
    expect(c?.start).toBe(2);
    expect(cells[c?.start ?? 0].x).toBe(3);
    terminal.dispose();
  });

  it('a path that wraps is one candidate over the logical line, whichever row the provider is asked for', async () => {
    const terminal = await make(20);
    await write(terminal, 'see 日本語/ファイル/ディレクトリ/a.go:12:3 end');
    expect(terminal.buffer.active.getLine(1)?.isWrapped).toBe(true);
    const fromFirst = logicalLine(terminal, 0);
    const fromSecond = logicalLine(terminal, 1);
    expect(fromSecond.text).toBe(fromFirst.text);
    const [c] = findFileLinks(fromSecond.text);
    expect(c?.path).toBe('日本語/ファイル/ディレクトリ/a.go');
    const { first, last } = span(fromSecond.cells, c?.start ?? 0, c?.end ?? 0);
    expect([first.row, first.x]).toEqual([0, 4]);
    expect(last.row).toBeGreaterThanOrEqual(1);
    terminal.dispose();
  });

  it('a wide character that did not fit at the end of a row leaves a padding cell that is no text: the path stays whole', async () => {
    const terminal = await make(10);
    await write(terminal, 'abcdefghi日本/x.go:5');
    expect(terminal.buffer.active.getLine(1)?.isWrapped).toBe(true);
    const { text, cells } = logicalLine(terminal, 1);
    const [c] = findFileLinks(text);
    expect(c?.path).toBe('abcdefghi日本/x.go');
    const { first, last } = span(cells, c?.start ?? 0, c?.end ?? 0);
    expect([first.row, first.x]).toEqual([0, 0]);
    expect([last.row, last.x]).toEqual([2, 0]);
    terminal.dispose();
  });

  it('one row alone does not give a path that wraps: the provider must join the chain', async () => {
    const terminal = await make(20);
    await write(terminal, 'see src/deeply/nested/dir/a.go:12 end');
    const first = terminal.buffer.active.getLine(0)?.translateToString(true) ?? '';
    expect(findFileLinks(first).map((c) => c.path)).not.toContain('src/deeply/nested/dir/a.go');
    terminal.dispose();
  });
});
