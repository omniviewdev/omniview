import { Unicode11Addon } from '@xterm/addon-unicode11';
import { Terminal } from '@xterm/xterm';
import { describe, expect, it } from 'vitest';
import { findFileLinks } from './fileLinks';

// The cell ranges of the matcher against a REAL xterm buffer (the emulator of this file: `@xterm/xterm` 6.0.0 with the Unicode 11 addon, as `xtermEngine.ts` loads it; no fake).

async function make(cols: number): Promise<Terminal> {
  const terminal = new Terminal({ allowProposedApi: true, cols, rows: 10 });
  terminal.loadAddon(new Unicode11Addon());
  terminal.unicode.activeVersion = '11';
  return terminal;
}

const write = async (terminal: Terminal, data: string): Promise<void> => new Promise((resolve) => {
  terminal.write(data, resolve); 
});

/** The row (or the chain of wrapped rows) from `y`, as the provider reads it: the joined text, untrimmed, and for each UTF-16 offset the cell (row * cols + x) it begins at. */
function joined(terminal: Terminal, y: number): { text: string; cellAt: number[] } {
  const buffer = terminal.buffer.active;
  let text = '';
  const cellAt: number[] = [];
  let row = y;
  for (;;) {
    const line = buffer.getLine(row);
    if (!line) {
      break;
    }

    for (let x = 0; x < terminal.cols; x += 1) {
      const cell = line.getCell(x);
      const chars = cell?.getChars() ?? '';
      if (cell?.getWidth() === 0) {
        continue;
      }

      // The blank cell that a wide character leaves at the end of a row it did not fit on is padding, not text: it is no character of the path.
      if (chars === '' && x === terminal.cols - 1 && buffer.getLine(row + 1)?.isWrapped) {
        continue;
      }

      const s = chars === '' ? ' ' : chars;
      const at = (row - y) * terminal.cols + x;
      cellAt.push(...Array.from({ length: s.length }, () => at));

      text += s;
    }

    const next = buffer.getLine(row + 1);
    if (!next?.isWrapped) {
      break;
    }

    row += 1;
  }

  cellAt.push((row - y + 1) * terminal.cols);
  return { text, cellAt };
}

describe('the cell range against a real xterm buffer', () => {
  it.each([
    ['cjk', '日本語/ファイル.go:12:3 x'],
    ['cjk before', '名前: 日本語/a.go:1'],
    ['emoji before', '🎉🎉 a.go:1'],
    ['emoji in the path', 'dir/🎉x.go:4'],
    ['combining', 'e\u0301e\u0301 a/é.go:1'],
    ['presentation selector', '\u2764\ufe0f a.go:1'],
    ['text presentation', '\u2764\ufe0e a.go:1'],
    ['flag', '🇩🇪 a.go:1'],
    ['zwj', '👨\u200d👩 a.go:1'],
    ['a tab', 'a\tb/c.go:7'],
    ['fullwidth', 'ＡＢ x/y.go:2'],
  ])('%s: startCell and endCell select the path\'s cells', async (_label, line) => {
    const terminal = await make(60);
    await write(terminal, line);
    const { text, cellAt } = joined(terminal, 0);
    const links = findFileLinks(text);
    expect(links.length).toBeGreaterThan(0);
    expect(cellAt[cellAt.length - 1], 'a row of 60 cells').toBe(60);
    for (const c of links) {
      expect([c.startCell, c.endCell], text.slice(c.start, c.end)).toEqual([cellAt[c.start], cellAt[c.end]]);
    }

    terminal.dispose();
  });

  it('a path that wraps past the width is one candidate over the joined rows, with cells counted from the first row', async () => {
    const terminal = await make(20);
    await write(terminal, 'see 日本語/ファイル/ディレクトリ/a.go:12:3 end');
    const buffer = terminal.buffer.active;
    expect(buffer.getLine(1)?.isWrapped).toBe(true);
    const { text, cellAt } = joined(terminal, 0);
    const [c] = findFileLinks(text);
    expect(c?.path).toBe('日本語/ファイル/ディレクトリ/a.go');
    expect([c?.startCell, c?.endCell]).toEqual([cellAt[c?.start ?? 0], cellAt[c?.end ?? 0]]);
    // the row-relative cell of the end, as the provider turns it into a buffer range
    expect(Math.floor((c?.endCell ?? 0) / 20)).toBeGreaterThanOrEqual(1);
    terminal.dispose();
  });

  it('a wide character that does not fit at the end of a row moves to the next and leaves a padding cell: the provider drops it from the text and maps offsets to cells with its own table, because the matcher counts cells of the text it was given', async () => {
    const terminal = await make(10);
    await write(terminal, 'abcdefghi日本/x.go:5');
    expect(terminal.buffer.active.getLine(1)?.isWrapped).toBe(true);
    const { text, cellAt } = joined(terminal, 0);
    const [c] = findFileLinks(text);
    expect(c?.path).toBe('abcdefghi日本/x.go');
    expect(cellAt[c?.start ?? 0]).toBe(0);
    // the last character of the link, the 5, is the first cell of the third row
    expect(cellAt[(c?.end ?? 0) - 1]).toBe(20);
    // the padding cell is one cell the text does not have
    expect(cellAt[(c?.end ?? 0) - 1] + 1 - (c?.endCell ?? 0)).toBe(1);
    terminal.dispose();
  });

  it('a row alone gives only the part on that row: the unjoined candidate is not the path', async () => {
    const terminal = await make(20);
    await write(terminal, 'see src/deeply/nested/dir/a.go:12 end');
    const first = terminal.buffer.active.getLine(0)?.translateToString(true) ?? '';
    expect(findFileLinks(first).map((c) => c.path)).not.toContain('src/deeply/nested/dir/a.go');
    terminal.dispose();
  });
});
