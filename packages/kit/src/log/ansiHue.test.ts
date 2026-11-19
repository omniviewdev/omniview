// The design paints a coloured span from a closed set of seven hues, each a token of the theme (the mock's `.plog__a[data-hue]`: red, green, amber,
// blue, purple, cyan, gray) and bold; it paints nothing else an escape can say. The parser (HLT-14) is the carried one and speaks hex: this reads its
// palettes and maps them, once per line at ingest. A colour of the 256 or 24-bit palettes is never painted, even when it resolves to the hex of one of
// the 16: the parser says how a foreground was written (`fgExtended`), and the map is read only for the standard and bright codes.
import { describe, expect, it } from 'vitest';
import { hueOfColor, paintedRuns } from './ansiHue';
import { BRIGHT_COLORS, parseAnsi, STANDARD_COLORS } from './parseAnsi';

const runsOf = (text: string) => paintedRuns(parseAnsi(text).segments);

describe('hueOfColor', () => {
  it.each([
    ['31', 'red'],
    ['32', 'green'],
    ['33', 'amber'],
    ['34', 'blue'],
    ['35', 'purple'],
    ['36', 'cyan'],
    ['90', 'gray'],
    ['91', 'red'],
    ['92', 'green'],
    ['93', 'amber'],
    ['94', 'blue'],
    ['95', 'purple'],
    ['96', 'cyan'],
  ])('SGR %s is %s', (code, hue) => {
    expect(runsOf(`\x1b[${code}mtext\x1b[0m`)).toEqual([{ text: 'text', hue }]);
  });

  it.each(['30', '37', '97'])('SGR %s (black or white) has no hue: the default colour stays', (code) => {
    expect(runsOf(`\x1b[${code}mtext\x1b[0m`)).toBeUndefined();
  });

  it('knows no hue for a colour the 16 do not name (256 and 24-bit colours, as the mock)', () => {
    expect(hueOfColor('#ff0000')).toBeUndefined();
    expect(hueOfColor(undefined)).toBeUndefined();
    expect(runsOf('\x1b[38;5;196mred\x1b[0m')).toBeUndefined();
    expect(runsOf('\x1b[38;2;255;0;0mred\x1b[0m')).toBeUndefined();
  });
});

describe('the foreground encoding', () => {
  // SGR 31, the colour 1 of the 256 palette (38;5;1) and the 24-bit colour 204;0;0 (38;2;204;0;0) all resolve to #cc0000. Only the first is a colour of the
  // 16 the design paints; the other two are colours of the 256 and 24-bit palettes, which keep the default colour.
  it('paints SGR 31 as red, and neither 38;5;1 nor 38;2;204;0;0, which resolve to the same hex', () => {
    expect(runsOf('\x1b[31mtext\x1b[0m')).toEqual([{ text: 'text', hue: 'red' }]);
    expect(runsOf('\x1b[38;5;1mtext\x1b[0m')).toBeUndefined();
    expect(runsOf('\x1b[38;2;204;0;0mtext\x1b[0m')).toBeUndefined();
  });

  it.each([...STANDARD_COLORS, ...BRIGHT_COLORS].map((hex, index) => ({ index, hex })))(
    'the colour $index of the 16 ($hex) written as a 256 or a 24-bit colour keeps the default colour',
    ({ index, hex }) => {
      const rgb = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16)).join(';');
      expect(runsOf(`\x1b[38;5;${index}mtext\x1b[0m`)).toBeUndefined();
      expect(runsOf(`\x1b[38;2;${rgb}mtext\x1b[0m`)).toBeUndefined();
    },
  );

  it('keeps a standard and an extended foreground of the same hex apart: they are two runs, one painted', () => {
    expect(runsOf('\x1b[31mred \x1b[38;5;1mdefault\x1b[0m')).toEqual([{ text: 'red ', hue: 'red' }, { text: 'default' }]);
    expect(runsOf('\x1b[38;2;204;0;0mdefault \x1b[31mred\x1b[0m')).toEqual([{ text: 'default ' }, { text: 'red', hue: 'red' }]);
  });

  it('goes by the last foreground written: a standard one after an extended one is painted, and the reverse is not', () => {
    expect(runsOf('\x1b[38;5;1m\x1b[31mtext\x1b[0m')).toEqual([{ text: 'text', hue: 'red' }]);
    expect(runsOf('\x1b[31m\x1b[38;5;1mtext\x1b[0m')).toBeUndefined();
    expect(runsOf('\x1b[38;5;1m\x1b[39mtext\x1b[0m')).toBeUndefined();
  });

  it('keeps the bold of an extended foreground, and no hue', () => {
    expect(runsOf('\x1b[1;38;5;1mtext\x1b[0m')).toEqual([{ text: 'text', bold: true }]);
  });
});

describe('paintedRuns', () => {
  it('keeps the unpainted text between painted runs, so the runs add up to the line', () => {
    const runs = runsOf('request \x1b[33m1233ms\x1b[0m (budget 1000ms)');
    expect(runs).toEqual([{ text: 'request ' }, { text: '1233ms', hue: 'amber' }, { text: ' (budget 1000ms)' }]);
    expect(runs?.map((run) => run.text).join('')).toBe(parseAnsi('request \x1b[33m1233ms\x1b[0m (budget 1000ms)').plain);
  });

  it('keeps bold, with or without a hue', () => {
    expect(runsOf('\x1b[1mbold\x1b[0m plain')).toEqual([{ text: 'bold', bold: true }, { text: ' plain' }]);
    expect(runsOf('\x1b[1;31mboth\x1b[0m')).toEqual([{ text: 'both', hue: 'red', bold: true }]);
  });

  it('ignores what the design does not paint: background, italic, underline, dim, strike-through', () => {
    expect(runsOf('\x1b[41mbg\x1b[0m')).toBeUndefined();
    expect(runsOf('\x1b[3;4;9;2mstyled\x1b[0m')).toBeUndefined();
  });

  it('merges neighbours that came out alike once the ignored styles are gone', () => {
    // Red on red: the background changes the parser's segment, not the paint.
    expect(runsOf('\x1b[31ma\x1b[41mb\x1b[0m')).toEqual([{ text: 'ab', hue: 'red' }]);
  });

  it('returns undefined for a line with no painted run at all: the common case renders a plain string', () => {
    expect(runsOf('no colour here')).toBeUndefined();
    expect(paintedRuns([])).toBeUndefined();
  });
});
