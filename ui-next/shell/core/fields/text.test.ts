import { describe, expect, it } from 'vitest';
import { cleanText, clip, scrubber } from './text';

// The text a schema or a host carries is data from a plugin: it is cleaned (the host's `apperror.PublicText` does the same on the Go side, E0-1) and bounded before it is shown.

describe('cleanText', () => {
  it('answers an empty text for anything that is not a text', () => {
    for (const value of [undefined, null, 4, true, {}, [], () => 'x']) {
      expect(cleanText(value, 80)).toBe('');
    }
  });

  it('collapses white space, trims, and treats a tab or a line break as a space', () => {
    expect(cleanText('  Port \t is\n\n in   use  ', 80)).toBe('Port is in use');
  });

  it('removes terminal escapes whole, so no "[31m" is left behind', () => {
    expect(cleanText('\u001b[31mNot found\u001b[0m. Check the path.', 80)).toBe('Not found. Check the path.');
    expect(cleanText('Go\u001b]0;title\u0007 ready', 80)).toBe('Go ready');
  });

  it('removes control, format (bidi, zero width), private-use and surrogate characters', () => {
    expect(cleanText('a\u0000b\u202Ec\u200Bd\uE000e\u0007f', 80)).toBe('abcdef');
    expect(cleanText('a\uD800b', 80)).toBe('ab');
  });

  it('keeps ordinary letters in every script, emoji and combining marks', () => {
    expect(cleanText('Ünïcode 日本語 ✓ 👍 é', 80)).toBe('Ünïcode 日本語 ✓ 👍 é');
  });

  it('cuts at the bound with an ellipsis, by characters and never in the middle of a pair', () => {
    expect(cleanText('x'.repeat(100), 10)).toBe(`${'x'.repeat(9)}…`);
    const cut = cleanText('👍'.repeat(20), 5);
    expect([...cut]).toHaveLength(5);
    expect(cut.endsWith('…')).toBe(true);
  });
});

describe('clip', () => {
  it('is the same text when it fits, and one character shorter than the bound plus an ellipsis when not', () => {
    expect(clip('short', 80)).toBe('short');
    expect(clip('abcdefghij', 5)).toBe('abcd…');
    expect(clip('ab cdefg', 4)).toBe('ab…');
  });
});

describe('scrubber', () => {
  it('replaces every occurrence of a secret, and every secret', () => {
    const scrub = scrubber(() => ['s3cr3t-token', 'hunter22']);
    expect(scrub('bad token s3cr3t-token for hunter22 and s3cr3t-token')).toBe('bad token ••• for ••• and •••');
  });

  it('knows the secrets as they are at the time of the call, not when it was made', () => {
    let secrets: string[] = [];
    const scrub = scrubber(() => secrets);
    expect(scrub('abc-123-xyz')).toBe('abc-123-xyz');
    secrets = ['abc-123-xyz'];
    expect(scrub('abc-123-xyz')).toBe('•••');
  });

  it('does not treat a text that has regular-expression characters in it as a pattern', () => {
    const scrub = scrubber(() => ['a.b*c(d)[e]']);
    expect(scrub('x a.b*c(d)[e] y aXbbbc(d)[e]')).toBe('x ••• y aXbbbc(d)[e]');
  });

  it('replaces a short secret only as a word, so a message is not garbled and the secret is still not shown', () => {
    const scrub = scrubber(() => ['e', 'ab']);
    expect(scrub('The request e failed, ab is wrong, abc stays')).toBe('The request ••• failed, ••• is wrong, abc stays');
  });

  it('leaves a text with no secret in it as it is, and ignores an empty secret', () => {
    const scrub = scrubber(() => ['', 'zzzzz']);
    expect(scrub('nothing to hide')).toBe('nothing to hide');
  });
});
