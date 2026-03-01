import { parseAnsi } from './parseAnsi';
import type { ParsedAnsi } from './parseAnsi';

/** Helper: extract just text from segments for easier assertions. */
function texts(result: ParsedAnsi): string[] {
  return result.segments.map(s => s.text);
}

/** Helper: extract fg colors from segments. */
function fgs(result: ParsedAnsi): (string | undefined)[] {
  return result.segments.map(s => s.fg);
}

describe('parseAnsi', () => {
  // ---- Fast path: no ANSI ----

  it('returns plain text as-is with no segments', () => {
    const result = parseAnsi('hello world');
    expect(result.plain).toBe('hello world');
    expect(result.segments).toEqual([]);
    expect(result.hasAnsi).toBe(false);
  });

  it('returns empty string with no segments', () => {
    const result = parseAnsi('');
    expect(result.plain).toBe('');
    expect(result.segments).toEqual([]);
    expect(result.hasAnsi).toBe(false);
  });

  // ---- Basic SGR ----

  it('parses single color code', () => {
    const result = parseAnsi('\x1b[31mERROR\x1b[0m');
    expect(result.plain).toBe('ERROR');
    expect(result.hasAnsi).toBe(true);
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('ERROR');
    expect(result.segments[0].fg).toBe('#cc0000'); // red
  });

  it('parses color with trailing text after reset', () => {
    const result = parseAnsi('\x1b[31mERROR\x1b[0m normal text');
    expect(result.plain).toBe('ERROR normal text');
    expect(result.segments).toHaveLength(2);
    expect(result.segments[0]).toEqual({ text: 'ERROR', fg: '#cc0000' });
    expect(result.segments[1]).toEqual({ text: ' normal text' });
  });

  it('parses text before, during, and after color', () => {
    const result = parseAnsi('before \x1b[32mgreen\x1b[0m after');
    expect(result.plain).toBe('before green after');
    expect(texts(result)).toEqual(['before ', 'green', ' after']);
    expect(fgs(result)).toEqual([undefined, '#4e9a06', undefined]);
  });

  // ---- Standard colors (30-37) ----

  it.each([
    [30, '#000000', 'black'],
    [31, '#cc0000', 'red'],
    [32, '#4e9a06', 'green'],
    [33, '#c4a000', 'yellow'],
    [34, '#3465a4', 'blue'],
    [35, '#75507b', 'magenta'],
    [36, '#06989a', 'cyan'],
    [37, '#d3d7cf', 'white'],
  ] as const)('maps SGR %i to %s (%s)', (code, expectedColor, _name) => {
    const result = parseAnsi(`\x1b[${code}mtext\x1b[0m`);
    expect(result.segments[0].fg).toBe(expectedColor);
  });

  // ---- Bright colors (90-97) ----

  it.each([
    [90, '#555753', 'bright black'],
    [91, '#ef2929', 'bright red'],
    [92, '#8ae234', 'bright green'],
    [93, '#fce94f', 'bright yellow'],
    [94, '#729fcf', 'bright blue'],
    [95, '#ad7fa8', 'bright magenta'],
    [96, '#34e2e2', 'bright cyan'],
    [97, '#eeeeec', 'bright white'],
  ] as const)('maps SGR %i to %s (%s)', (code, expectedColor, _name) => {
    const result = parseAnsi(`\x1b[${code}mtext\x1b[0m`);
    expect(result.segments[0].fg).toBe(expectedColor);
  });

  // ---- Background colors ----

  it('parses standard background color', () => {
    const result = parseAnsi('\x1b[41mtext\x1b[0m');
    expect(result.segments[0].bg).toBe('#cc0000');
  });

  it('parses bright background color', () => {
    const result = parseAnsi('\x1b[101mtext\x1b[0m');
    expect(result.segments[0].bg).toBe('#ef2929');
  });

  // ---- 256-color mode ----

  it('parses 256-color foreground (standard range 0-7)', () => {
    const result = parseAnsi('\x1b[38;5;1mtext\x1b[0m');
    expect(result.segments[0].fg).toBe('#cc0000');
  });

  it('parses 256-color foreground (bright range 8-15)', () => {
    const result = parseAnsi('\x1b[38;5;9mtext\x1b[0m');
    expect(result.segments[0].fg).toBe('#ef2929');
  });

  it('parses 256-color foreground (color cube 16-231)', () => {
    const result = parseAnsi('\x1b[38;5;196mtext\x1b[0m');
    // 196 = 16 + (5*36 + 0*6 + 0) = index 180 in cube → r=5,g=0,b=0 → #ff0000
    expect(result.segments[0].fg).toBe('#ff0000');
  });

  it('parses 256-color foreground (grayscale 232-255)', () => {
    const result = parseAnsi('\x1b[38;5;240mtext\x1b[0m');
    // 240 - 232 = 8 → 8*10 + 8 = 88 → #585858
    expect(result.segments[0].fg).toBe('#585858');
  });

  it('parses 256-color background', () => {
    const result = parseAnsi('\x1b[48;5;21mtext\x1b[0m');
    expect(result.segments[0].bg).toBeDefined();
  });

  // ---- 24-bit (truecolor) mode ----

  it('parses 24-bit foreground color', () => {
    const result = parseAnsi('\x1b[38;2;255;128;0mtext\x1b[0m');
    expect(result.segments[0].fg).toBe('#ff8000');
  });

  it('parses 24-bit background color', () => {
    const result = parseAnsi('\x1b[48;2;0;64;128mtext\x1b[0m');
    expect(result.segments[0].bg).toBe('#004080');
  });

  // ---- Text attributes ----

  it('parses bold', () => {
    const result = parseAnsi('\x1b[1mtext\x1b[0m');
    expect(result.segments[0].bold).toBe(true);
  });

  it('parses dim', () => {
    const result = parseAnsi('\x1b[2mtext\x1b[0m');
    expect(result.segments[0].dim).toBe(true);
  });

  it('parses italic', () => {
    const result = parseAnsi('\x1b[3mtext\x1b[0m');
    expect(result.segments[0].italic).toBe(true);
  });

  it('parses underline', () => {
    const result = parseAnsi('\x1b[4mtext\x1b[0m');
    expect(result.segments[0].underline).toBe(true);
  });

  it('parses strikethrough', () => {
    const result = parseAnsi('\x1b[9mtext\x1b[0m');
    expect(result.segments[0].strikethrough).toBe(true);
  });

  it('parses combined attributes', () => {
    const result = parseAnsi('\x1b[1;3;31mtext\x1b[0m');
    expect(result.segments[0]).toEqual({
      text: 'text',
      fg: '#cc0000',
      bold: true,
      italic: true,
    });
  });

  // ---- Attribute resets ----

  it('resets bold with SGR 22', () => {
    const result = parseAnsi('\x1b[1mbold\x1b[22mnormal\x1b[0m');
    expect(result.segments[0].bold).toBe(true);
    expect(result.segments[1].bold).toBeUndefined();
  });

  it('resets italic with SGR 23', () => {
    const result = parseAnsi('\x1b[3mitalic\x1b[23mnormal\x1b[0m');
    expect(result.segments[0].italic).toBe(true);
    expect(result.segments[1].italic).toBeUndefined();
  });

  it('resets foreground with SGR 39', () => {
    const result = parseAnsi('\x1b[31mred\x1b[39mnormal\x1b[0m');
    expect(result.segments[0].fg).toBe('#cc0000');
    expect(result.segments[1].fg).toBeUndefined();
  });

  it('resets background with SGR 49', () => {
    const result = parseAnsi('\x1b[41mred bg\x1b[49mnormal\x1b[0m');
    expect(result.segments[0].bg).toBe('#cc0000');
    expect(result.segments[1].bg).toBeUndefined();
  });

  // ---- Bare ESC[m ----

  it('treats bare ESC[m as reset', () => {
    const result = parseAnsi('\x1b[31mred\x1b[mnormal');
    expect(result.segments[0].fg).toBe('#cc0000');
    expect(result.segments[1].fg).toBeUndefined();
  });

  // ---- Segment merging ----

  it('merges consecutive segments with same style', () => {
    // Two red segments back-to-back should merge
    const result = parseAnsi('\x1b[31mhello \x1b[31mworld\x1b[0m');
    expect(result.segments).toHaveLength(1);
    expect(result.segments[0].text).toBe('hello world');
    expect(result.segments[0].fg).toBe('#cc0000');
  });

  // ---- All-default optimization ----

  it('returns empty segments when ANSI is present but only resets', () => {
    const result = parseAnsi('\x1b[0mhello world');
    expect(result.plain).toBe('hello world');
    expect(result.hasAnsi).toBe(true);
    expect(result.segments).toEqual([]); // all-default optimization
  });

  // ---- Non-SGR CSI sequences ----

  it('skips non-SGR CSI sequences (cursor movement)', () => {
    const result = parseAnsi('\x1b[2Ahello');
    expect(result.plain).toBe('hello');
    expect(result.hasAnsi).toBe(true);
  });

  // ---- OSC sequences ----

  it('skips OSC sequence with BEL', () => {
    const result = parseAnsi('\x1b]0;Title\x07hello');
    expect(result.plain).toBe('hello');
  });

  it('skips OSC sequence with ST', () => {
    const result = parseAnsi('\x1b]8;;https://example.com\x1b\\link text\x1b]8;;\x1b\\');
    expect(result.plain).toBe('link text');
  });

  // ---- Two-byte escapes ----

  it('skips charset designation', () => {
    const result = parseAnsi('\x1b(Bhello');
    expect(result.plain).toBe('hello');
  });

  // ---- Realistic log lines ----

  it('handles typical Go structured log', () => {
    const input = '\x1b[90m2024-01-15T10:30:00Z\x1b[0m \x1b[1;31mERROR\x1b[0m \x1b[36mmain.go:42\x1b[0m Failed to connect';
    const result = parseAnsi(input);

    expect(result.plain).toBe('2024-01-15T10:30:00Z ERROR main.go:42 Failed to connect');
    // 6 segments: timestamp(gray), space, ERROR(bold red), space, file(cyan), trailing text
    expect(result.segments).toHaveLength(6);

    expect(result.segments[0]).toEqual({ text: '2024-01-15T10:30:00Z', fg: '#555753' });
    expect(result.segments[1]).toEqual({ text: ' ' });
    expect(result.segments[2]).toEqual({ text: 'ERROR', fg: '#cc0000', bold: true });
    expect(result.segments[3]).toEqual({ text: ' ' });
    expect(result.segments[4]).toEqual({ text: 'main.go:42', fg: '#06989a' });
    expect(result.segments[5]).toEqual({ text: ' Failed to connect' });
  });

  it('handles kubectl multi-container log', () => {
    const input = '\x1b[33m[nginx]\x1b[0m \x1b[32m192.168.1.1\x1b[0m - GET /healthz 200';
    const result = parseAnsi(input);

    expect(result.plain).toBe('[nginx] 192.168.1.1 - GET /healthz 200');
  });

  it('handles Python traceback coloring', () => {
    const input = '\x1b[1;31mTraceback (most recent call last):\x1b[0m\n  File "main.py", line 10';
    const result = parseAnsi(input);

    expect(result.plain).toBe('Traceback (most recent call last):\n  File "main.py", line 10');
    expect(result.segments[0].bold).toBe(true);
    expect(result.segments[0].fg).toBe('#cc0000');
  });

  // ---- Edge cases ----

  it('handles escape at end of string', () => {
    const result = parseAnsi('hello\x1b');
    expect(result.plain).toBe('hello');
  });

  it('handles incomplete CSI sequence', () => {
    const result = parseAnsi('hello\x1b[');
    expect(result.plain).toBe('hello');
  });

  it('handles consecutive escape sequences with no text between', () => {
    const result = parseAnsi('\x1b[1m\x1b[31m\x1b[4mtext\x1b[0m');
    expect(result.segments[0].bold).toBe(true);
    expect(result.segments[0].fg).toBe('#cc0000');
    expect(result.segments[0].underline).toBe(true);
  });

  it('preserves whitespace and special chars', () => {
    const result = parseAnsi('\x1b[31m  tabs\there  \x1b[0m');
    expect(result.plain).toBe('  tabs\there  ');
    expect(result.segments[0].text).toBe('  tabs\there  ');
  });

  // ---- Pathological input ----

  it('handles pathological input with many escape sequences', () => {
    let input = '';
    for (let i = 0; i < 100; i++) {
      input += `\x1b[${30 + (i % 8)}mword${i} `;
    }
    input += '\x1b[0m';

    const result = parseAnsi(input);
    expect(result.plain).toContain('word0');
    expect(result.plain).toContain('word99');
    expect(result.hasAnsi).toBe(true);
  });

  // Performance benchmarks live in parseAnsi.bench.ts — run with `vitest bench`.
});
