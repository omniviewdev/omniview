import { stripAnsi } from './stripAnsi';

describe('stripAnsi', () => {
  // ---- Fast path ----

  it('returns plain text as-is (no allocation)', () => {
    const input = 'hello world';
    expect(stripAnsi(input)).toBe(input); // same reference
  });

  it('returns empty string as-is', () => {
    expect(stripAnsi('')).toBe('');
  });

  // ---- SGR (color/style) sequences ----

  it('strips basic SGR reset', () => {
    expect(stripAnsi('\x1b[0mhello')).toBe('hello');
  });

  it('strips foreground color', () => {
    expect(stripAnsi('\x1b[31mERROR\x1b[0m')).toBe('ERROR');
  });

  it('strips bold + color combo', () => {
    expect(stripAnsi('\x1b[1;33mWARN\x1b[0m: something')).toBe('WARN: something');
  });

  it('strips multiple colors in one line', () => {
    expect(stripAnsi('\x1b[32mGREEN\x1b[0m and \x1b[34mBLUE\x1b[0m')).toBe('GREEN and BLUE');
  });

  it('strips 256-color foreground', () => {
    expect(stripAnsi('\x1b[38;5;196mred text\x1b[0m')).toBe('red text');
  });

  it('strips 24-bit RGB foreground', () => {
    expect(stripAnsi('\x1b[38;2;255;128;0morange\x1b[0m')).toBe('orange');
  });

  it('strips background colors', () => {
    expect(stripAnsi('\x1b[41mred bg\x1b[0m')).toBe('red bg');
  });

  it('strips bright colors (90-97)', () => {
    expect(stripAnsi('\x1b[91mbright red\x1b[0m')).toBe('bright red');
  });

  // ---- CSI sequences (cursor, erase, etc.) ----

  it('strips cursor movement sequences', () => {
    expect(stripAnsi('\x1b[2Ahello')).toBe('hello');  // cursor up
    expect(stripAnsi('\x1b[5Bhello')).toBe('hello');  // cursor down
    expect(stripAnsi('\x1b[10Chello')).toBe('hello'); // cursor forward
    expect(stripAnsi('\x1b[3Dhello')).toBe('hello');  // cursor back
  });

  it('strips erase sequences', () => {
    expect(stripAnsi('\x1b[2Jhello')).toBe('hello'); // erase screen
    expect(stripAnsi('\x1b[Khello')).toBe('hello');  // erase to end of line
  });

  // ---- OSC sequences ----

  it('strips OSC with BEL terminator', () => {
    expect(stripAnsi('\x1b]0;Window Title\x07hello')).toBe('hello');
  });

  it('strips OSC with ST terminator', () => {
    expect(stripAnsi('\x1b]0;Title\x1b\\hello')).toBe('hello');
  });

  // ---- Two-byte escapes ----

  it('strips charset designation', () => {
    expect(stripAnsi('\x1b(Bhello')).toBe('hello');
  });

  // ---- Realistic log lines ----

  it('handles a typical Go log with color', () => {
    const input = '\x1b[36m2024-01-15T10:30:00Z\x1b[0m \x1b[1;31mERROR\x1b[0m Failed to connect to database';
    expect(stripAnsi(input)).toBe('2024-01-15T10:30:00Z ERROR Failed to connect to database');
  });

  it('handles a kubectl log line with namespace coloring', () => {
    const input = '\x1b[33m[kube-system]\x1b[0m \x1b[32mcoredns-5d78c9869d-abc12\x1b[0m Starting DNS server';
    expect(stripAnsi(input)).toBe('[kube-system] coredns-5d78c9869d-abc12 Starting DNS server');
  });

  it('handles nested/multiple escape codes', () => {
    const input = '\x1b[1m\x1b[4m\x1b[31mBOLD UNDERLINE RED\x1b[0m normal';
    expect(stripAnsi(input)).toBe('BOLD UNDERLINE RED normal');
  });

  // Performance benchmarks live in stripAnsi.bench.ts — run with `vitest bench`.
});
