import { describe, expect, it } from 'vitest';
import { block, line, sentenceCase } from './text';

// Plugin text is bounded and cleaned before it reaches a title or a sentence (S74: a title is at most 80 characters, a sentence at most 120; the host sanitises provider text). The mock's
// `line` and `block` (shell-notify.js:72-73), and the host's text gate (docs/ui-next/status/E0-1.md: terminal escapes, control, format and private-use characters dropped, white space collapsed).

describe('line: one line of text', () => {
  it('collapses white space and control characters into one space and trims', () => {
    expect(line('  Scaled \t cart-api \n to 3  replicas  ', 80)).toBe('Scaled cart-api to 3 replicas');
    expect(line('a\u0000b\u0007c\u007fd', 80)).toBe('a b c d');
  });

  it('cuts at the bound with an ellipsis, the cut text included in the bound', () => {
    const cut = line('x'.repeat(100), 80);
    expect(cut).toHaveLength(80);
    expect(cut.endsWith('…')).toBe(true);
    expect(line('x'.repeat(80), 80)).toBe('x'.repeat(80));
  });

  it('never leaves a space before the ellipsis', () => {
    expect(line(`${'a'.repeat(9)} ${'b'.repeat(20)}`, 11)).toBe('aaaaaaaaa…');
  });

  it('never cuts a character in two', () => {
    const text = `${'a'.repeat(78)}😀😀😀`;
    const cut = line(text, 80);
    expect(cut.endsWith('…')).toBe(true);
    expect(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/.test(cut)).toBe(false);
    expect(cut.length).toBeLessThanOrEqual(80);
  });

  it('drops format characters whole: a bidirectional override or a zero-width space cannot disguise a title', () => {
    expect(line('Deploy\u202egnirtS\u202c done', 80)).toBe('DeploygnirtS done');
    expect(line('pa\u200bss\u2066word\u2069', 80)).toBe('password');
    expect(line('a\ufeffb\ue000c', 80)).toBe('abc');
  });

  it('takes text and numbers, and nothing else', () => {
    expect(line(42, 80)).toBe('42');
    expect(line(undefined, 80)).toBe('');
    expect(line(null, 80)).toBe('');
    expect(line({ toString: () => 'x' }, 80)).toBe('');
    expect(line(['a'], 80)).toBe('');
    expect(line(Number.NaN, 80)).toBe('');
  });
});

describe('block: diagnostics', () => {
  it('keeps the lines and the tabs, normalises the line ends and drops the other control characters', () => {
    expect(block('one\r\ntwo\rthree\tx\u0007y\u0000z', 100)).toBe('one\ntwo\nthree\txyz');
  });

  it('drops terminal escapes whole, and format characters', () => {
    expect(block('a\u001b[31mred\u001b[0mb\u202e', 100)).toBe('aredb');
    expect(block('x\u001b]0;a title\u0007y', 100)).toBe('xy');
    expect(line('a\u001b[1;31mred\u001b[0m b', 80)).toBe('ared b');
  });

  it('cuts at the bound', () => {
    expect(block('x'.repeat(50), 10)).toBe('x'.repeat(10));
  });

  it('takes text only', () => {
    expect(block(undefined, 10)).toBe('');
    expect(block(7, 10)).toBe('7');
    expect(block({}, 10)).toBe('');
  });
});

describe('sentenceCase: a plugin id read as a name', () => {
  it('gives the first letter a capital', () => {
    expect(sentenceCase('cloud')).toBe('Cloud');
    expect(sentenceCase('stack-lab')).toBe('Stack-lab');
    expect(sentenceCase('')).toBe('');
  });
});
