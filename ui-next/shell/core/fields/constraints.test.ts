import { describe, expect, it } from 'vitest';
import { allows, checkValue, type Found } from './constraints';
import { compileSchema, type CompiledField } from './schema';
import { LIMITS, type Json } from './types';

// The local checks of a value, from the constraints a schema declares: what is wrong (a code and a sentence of at most 80 characters, "Problem. Fix.") and when it is told
// (ch04 "Validation timing and outcome"): at once for an illegal character or a value past its maximum, once the value is complete (blur, Enter, submit) for everything else, and
// for a missing required value only after a submit or an edit that was committed.

function field(spec: Record<string, unknown>, others: ReadonlyArray<Record<string, unknown>> = []): CompiledField {
  const result = compileSchema({ sections: [{ fields: [{ id: 'f', kind: 'text', label: 'Name', ...spec }, ...others] }] });
  if (!result.ok) {
    throw new Error(result.detail);
  }

  const found = result.schema.index.get(typeof spec.id === 'string' ? spec.id : 'f');
  if (found === undefined) {
    throw new Error('no field');
  }

  return found;
}

const codes = (found: readonly Found[]): readonly string[] => found.map((issue) => issue.code);
const first = (found: readonly Found[]): Found => {
  const issue = found[0];
  if (issue === undefined) {
    throw new Error('no issue');
  }

  return issue;
};

describe('a value that is blank', () => {
  it('is fine when the field is not required, whatever the other constraints say', () => {
    for (const [kind, constraints] of [['text', { minLength: 3, pattern: '[a-z]+' }], ['url', {}], ['path', { absolute: true }], ['color', {}], ['number', { min: 5 }], ['select', {}]] as const) {
      expect(checkValue(field({ kind, constraints }), undefined, undefined), kind).toEqual([]);
    }

    expect(checkValue(field({ kind: 'text', constraints: { minLength: 3 } }), '', undefined)).toEqual([]);
  });

  it('is "required" when it is, and only then told after a submit: `required`, with the label in the sentence', () => {
    const [issue] = checkValue(field({ label: 'Name', constraints: { required: true } }), '   ', undefined);
    expect(issue).toMatchObject({ code: 'required', text: 'Name is required.', when: 'required', severity: 'error', source: 'local' });
  });

  it('is required for a list or a choice that has nothing in it, and a switch that is off', () => {
    expect(codes(checkValue(field({ kind: 'list', constraints: { required: true } }), [], undefined))).toEqual(['required']);
    expect(codes(checkValue(field({ kind: 'multiselect', options: [{ value: 'a', label: 'A' }], constraints: { required: true } }), [], undefined))).toEqual(['required']);
    expect(codes(checkValue(field({ kind: 'select', options: [{ value: 'a', label: 'A' }], constraints: { required: true } }), undefined, undefined))).toEqual(['required']);
    expect(first(checkValue(field({ kind: 'boolean', label: 'Accept', constraints: { required: true } }), false, undefined)).text).toBe('Accept must be on.');
    expect(checkValue(field({ kind: 'boolean', constraints: { required: true } }), true, undefined)).toEqual([]);
    expect(checkValue(field({ kind: 'number', constraints: { required: true } }), 0, undefined)).toEqual([]);
  });

  it('is told "too few" when an optional list that is empty has a minimum above zero', () => {
    expect(codes(checkValue(field({ kind: 'list', constraints: { minItems: 2 } }), [], undefined))).toEqual(['min-items']);
  });
});

describe('a text', () => {
  it('has a maximum length told at once and a minimum told when it is complete', () => {
    const long = checkValue(field({ constraints: { maxLength: 3 } }), 'abcd', undefined);
    expect(long).toEqual([expect.objectContaining({ code: 'max-length', when: 'now', text: 'Too long. Use at most 3 characters.' })]);
    const short = checkValue(field({ constraints: { minLength: 3 } }), 'ab', undefined);
    expect(short).toEqual([expect.objectContaining({ code: 'min-length', when: 'complete', text: 'Too short. Use at least 3 characters.' })]);
    expect(checkValue(field({ constraints: { minLength: 3, maxLength: 5 } }), 'abcd', undefined)).toEqual([]);
  });

  it('counts a length in characters, so an emoji is one', () => {
    expect(checkValue(field({ constraints: { maxLength: 2 } }), '👍👍', undefined)).toEqual([]);
    expect(codes(checkValue(field({ constraints: { maxLength: 2 } }), '👍👍👍', undefined))).toEqual(['max-length']);
  });

  it('has a pattern that must match the whole value, told when it is complete, with the plugin\'s sentence when it gave one', () => {
    const plain = field({ constraints: { pattern: '[a-z0-9-]+' } });
    expect(checkValue(plain, 'ab-1', undefined)).toEqual([]);
    expect(checkValue(plain, 'Ab', undefined)).toEqual([expect.objectContaining({ code: 'pattern', when: 'complete', text: 'Not in the expected form. Check the value.' })]);
    const said = field({ constraints: { pattern: '[a-z]+', messages: { pattern: 'Not a valid name. Use lowercase letters.' } } });
    expect(first(checkValue(said, '1', undefined)).text).toBe('Not a valid name. Use lowercase letters.');
  });

  it('does not run a pattern on an input past the bound: a plugin\'s expression must not hang the page', () => {
    const slow = field({ constraints: { pattern: '(a+)+$' } });
    const started = performance.now();
    checkValue(slow, `${'a'.repeat(LIMITS.patternInput + 1)}!`, undefined);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it('has characters that may be typed: an illegal one is told at once, and a view can ask before it accepts a key', () => {
    const host = field({ constraints: { allowedChars: 'hostport' } });
    expect(checkValue(host, 'localhost:4318', undefined)).toEqual([]);
    expect(checkValue(host, 'local host', undefined)).toEqual([expect.objectContaining({ code: 'chars', when: 'now' })]);
    expect(allows(host, 'a1.:-')).toBe(true);
    expect(allows(host, 'a b')).toBe(false);
    expect(allows(field({}), 'anything at all')).toBe(true);
    expect(allows(field({ kind: 'number', constraints: {} }), 'abc')).toBe(true);
  });

  it('has a datetime format, RFC 3339', () => {
    const when = field({ constraints: { format: 'datetime' } });
    expect(checkValue(when, '2026-11-01T09:00:00Z', undefined)).toEqual([]);
    expect(checkValue(when, '2026-11-01T09:00:00.5+02:00', undefined)).toEqual([]);
    for (const wrong of ['2026-11-01', '2026-11-01 09:00', '2026-13-45T99:00:00Z', 'tomorrow']) {
      expect(codes(checkValue(when, wrong, undefined)), wrong).toEqual(['format']);
    }
  });

  it('puts the illegal characters first, then the others, so the lane tells the earliest one', () => {
    const both = field({ constraints: { allowedChars: 'digits', minLength: 5, pattern: '[0-9]{5}' } });
    expect(codes(checkValue(both, 'a1', undefined))).toEqual(['chars', 'min-length', 'pattern']);
  });
});

describe('a number', () => {
  it('is a number, or text that is not one yet, which is told when it is complete', () => {
    const number = field({ kind: 'number' });
    expect(checkValue(number, 12, undefined)).toEqual([]);
    expect(checkValue(number, '1e', undefined)).toEqual([expect.objectContaining({ code: 'not-a-number', when: 'complete', text: 'Not a number. Enter digits only.' })]);
  });

  it('has a range: past the maximum is told at once, below the minimum when it is complete, and the sentence names the range when there is one', () => {
    const both = field({ kind: 'number', constraints: { min: 1, max: 300 } });
    expect(checkValue(both, 0, undefined)).toEqual([expect.objectContaining({ code: 'min', when: 'complete', text: 'Out of range. Use a value from 1 to 300.' })]);
    expect(checkValue(both, 301, undefined)).toEqual([expect.objectContaining({ code: 'max', when: 'now', text: 'Out of range. Use a value from 1 to 300.' })]);
    expect(checkValue(both, 300, undefined)).toEqual([]);
    expect(first(checkValue(field({ kind: 'number', constraints: { max: 9 } }), 10, undefined)).text).toBe('Too large. Use 9 or less.');
    expect(first(checkValue(field({ kind: 'number', constraints: { min: 2 } }), 1, undefined)).text).toBe('Too small. Use 2 or more.');
  });

  it('may have to be a whole number, and on a grid from its minimum', () => {
    expect(codes(checkValue(field({ kind: 'number', constraints: { integer: true } }), 1.5, undefined))).toEqual(['not-an-integer']);
    expect(checkValue(field({ kind: 'number', constraints: { integer: true } }), 2, undefined)).toEqual([]);
    const grid = field({ kind: 'number', constraints: { min: 1, max: 3, step: 0.1 } });
    expect(checkValue(grid, 1.3, undefined)).toEqual([]);
    expect(checkValue(grid, 2.7, undefined)).toEqual([]);
    expect(checkValue(grid, 1.25, undefined)).toEqual([expect.objectContaining({ code: 'step', text: 'Off the grid. Use steps of 0.1.' })]);
    expect(checkValue(field({ kind: 'number', constraints: { step: 5 } }), 15, undefined)).toEqual([]);
    expect(codes(checkValue(field({ kind: 'number', constraints: { step: 5 } }), 16, undefined))).toEqual(['step']);
  });
});

describe('a choice', () => {
  const options = [{ value: 'a', label: 'A' }, { value: 3, label: 'Three' }];

  it('is one of the options, compared strictly', () => {
    const select = field({ kind: 'select', options });
    expect(checkValue(select, 'a', undefined)).toEqual([]);
    expect(checkValue(select, 3, undefined)).toEqual([]);
    expect(checkValue(select, '3', undefined)).toEqual([expect.objectContaining({ code: 'not-an-option', text: 'Not an option. Choose one from the list.' })]);
  });

  it('is not checked against a list the provider holds: it cannot be, and the host checks it', () => {
    expect(checkValue(field({ kind: 'select', options: { provider: 'p' } }), 'anything', undefined)).toEqual([]);
  });

  it('may be several: each is an option, each once, and a count that is told: too many at once, too few when it is complete', () => {
    const multi = field({ kind: 'multiselect', options, constraints: { minItems: 1, maxItems: 1 } });
    expect(checkValue(multi, ['a'], undefined)).toEqual([]);
    expect(codes(checkValue(multi, ['a', 'z'], undefined))).toEqual(['not-an-option', 'max-items']);
    expect(checkValue(multi, ['a', 3], undefined).find((issue) => issue.code === 'max-items')?.when).toBe('now');
    expect(codes(checkValue(field({ kind: 'multiselect', options }), ['a', 'a'], undefined))).toEqual(['duplicate']);
    expect(checkValue(field({ kind: 'multiselect', options, constraints: { minItems: 2 } }), ['a'], undefined)[0]?.when).toBe('complete');
  });
});

describe('a list', () => {
  it('has items that are checked as the item kind says, and may have to be different', () => {
    const paths = field({ kind: 'list', constraints: { item: 'path', absolute: true, unique: true } });
    expect(checkValue(paths, ['~/.config/app', '/etc/hosts'], undefined)).toEqual([]);
    expect(codes(checkValue(paths, ['~/.config/app', 'relative/x'], undefined))).toEqual(['path']);
    expect(codes(checkValue(paths, ['/a', '/a'], undefined))).toEqual(['duplicate']);
    expect(first(checkValue(paths, ['/a', '/a'], undefined)).when).toBe('now');
    expect(codes(checkValue(field({ kind: 'list', constraints: { item: 'url' } }), ['https://a.example', 'nope'], undefined))).toEqual(['url']);
    expect(checkValue(field({ kind: 'list' }), ['anything', 'goes'], undefined)).toEqual([]);
  });

  it('has a count: too many at once, too few when it is complete', () => {
    const counted = field({ kind: 'list', constraints: { minItems: 2, maxItems: 3 } });
    expect(checkValue(counted, ['a', 'b'], undefined)).toEqual([]);
    expect(checkValue(counted, ['a'], undefined)).toEqual([expect.objectContaining({ code: 'min-items', when: 'complete' })]);
    expect(checkValue(counted, ['a', 'b', 'c', 'd'], undefined)).toEqual([expect.objectContaining({ code: 'max-items', when: 'now' })]);
  });
});

describe('a path, a url and a colour', () => {
  it('a path may have to be absolute: it starts with a slash, a tilde or a drive; it has no control characters; a file may have to have an extension', () => {
    const path = field({ kind: 'path', constraints: { absolute: true } });
    for (const good of ['/bin/zsh', '~', '~/.config', 'C:\\Users\\a', 'c:/x', '\\\\server\\share']) {
      expect(checkValue(path, good, undefined), good).toEqual([]);
    }

    for (const bad of ['zsh', './x', '~user', '/a\u0007b']) {
      expect(codes(checkValue(path, bad, undefined)), bad).toEqual(['path']);
    }

    expect(checkValue(field({ kind: 'path' }), 'zsh', undefined)).toEqual([]);
    const yaml = field({ kind: 'path', constraints: { extensions: ['.yaml', 'yml'] } });
    expect(checkValue(yaml, '/a/b.yaml', undefined)).toEqual([]);
    expect(checkValue(yaml, '/a/b.YML', undefined)).toEqual([]);
    expect(codes(checkValue(yaml, '/a/b.txt', undefined))).toEqual(['path']);
  });

  it('a url has a scheme this field accepts and, for http, a host', () => {
    const url = field({ kind: 'url' });
    expect(checkValue(url, 'https://mkt.omniview.dev', undefined)).toEqual([]);
    expect(checkValue(url, 'http://localhost:8080/x?y=1', undefined)).toEqual([]);
    for (const bad of ['mkt.omniview.dev', 'ftp://x.example', 'https://', 'javascript:alert(1)', 'http://']) {
      expect(checkValue(url, bad, undefined), bad).toEqual([expect.objectContaining({ code: 'url', text: 'Not a full URL. Use one like https://example.com.' })]);
    }

    const socket = field({ kind: 'url', constraints: { schemes: ['unix', 'tcp'] } });
    expect(checkValue(socket, 'unix:///var/run/app.sock', undefined)).toEqual([]);
    expect(checkValue(socket, 'tcp://10.0.0.1:2375', undefined)).toEqual([]);
    expect(codes(checkValue(socket, 'https://x.example', undefined))).toEqual(['url']);
  });

  it('a colour is six hex digits, with or without the hash', () => {
    const color = field({ kind: 'color' });
    expect(checkValue(color, '#3871E1', undefined)).toEqual([]);
    expect(checkValue(color, '3871e1', undefined)).toEqual([]);
    for (const bad of ['#3871E', '#3871E1F', 'blue', '#GGGGGG']) {
      expect(codes(checkValue(color, bad, undefined)), bad).toEqual(['color']);
    }
  });
});

describe('a confirmation', () => {
  it('must be the other field\'s value, told when it is complete', () => {
    const again = field({ id: 'again', constraints: { sameAs: 'pw' } }, [{ id: 'pw', kind: 'text' }]);
    expect(checkValue(again, 'abc', 'abc')).toEqual([]);
    expect(checkValue(again, 'abd', 'abc')).toEqual([expect.objectContaining({ code: 'same-as', when: 'complete', text: 'Does not match. Enter the same value again.' })]);
    expect(codes(checkValue(again, 'abc', undefined))).toEqual(['same-as']);
    expect(checkValue(again, '', 'abc')).toEqual([]);
  });
});

describe('the sentences', () => {
  it('are at most 80 characters, even with a long label, and a plugin\'s own sentence replaces ours', () => {
    const long = field({ label: 'L'.repeat(110), constraints: { required: true } });
    expect([...first(checkValue(long, '', undefined)).text].length).toBeLessThanOrEqual(LIMITS.message);
    const said = field({ constraints: { required: true, messages: { required: 'Name is needed.' } } });
    expect(first(checkValue(said, '', undefined)).text).toBe('Name is needed.');
  });

  it('never contain the value that was checked', () => {
    const secret = 'sk-live-9f8e7d6c5b4a';
    const checked = field({ kind: 'secret', constraints: { minLength: 40, pattern: '[A-Z]+', allowedChars: 'digits' } });
    for (const issue of checkValue(checked, secret, undefined)) {
      expect(JSON.stringify(issue)).not.toContain(secret);
    }
  });

  it('are the same for the same value: a result does not depend on when it is asked', () => {
    const again = field({ kind: 'number', constraints: { min: 1, max: 5 } });
    const value: Json = 9;
    expect(checkValue(again, value, undefined)).toEqual(checkValue(again, value, undefined));
  });
});
