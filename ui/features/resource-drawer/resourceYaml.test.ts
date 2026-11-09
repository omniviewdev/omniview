import { describe, expect, it } from 'vitest';
import type { Value } from '@omniviewdev/runtime';
import { resourceYaml, parseResourceYaml } from './resourceYaml';

describe('canonical resource YAML', () => {
  const original: Value = { kind: 'map', value: {
    name: { kind: 'string', value: 'before' },
    nested: { kind: 'list', value: [
      { kind: 'double', value: 1 },
      { kind: 'double', value: -0 },
      { kind: 'uint64', value: '7' },
      { kind: 'uint64', value: '18446744073709551615' },
      { kind: 'int64', value: '-9223372036854775808' },
    ] },
  } };
  it('preserves scalar intent on roundtrip and unrelated edits', () => {
    const text = resourceYaml(original);
    expect(parseResourceYaml(text, original, text)).toEqual(original);
    const edited = parseResourceYaml(text.replace('before', 'after'), original, text);
    expect(edited).toEqual({ ...original, value: { ...original.value, name: { kind: 'string', value: 'after' } } });
    if (edited.kind !== 'map' || edited.value.nested.kind !== 'list') {
      throw new Error('Expected nested list');
    }

    const negativeZero = edited.value.nested.value[1];
    if (negativeZero.kind !== 'double') {
      throw new Error('Expected double');
    }

    expect(Object.is(negativeZero.value, -0)).toBe(true);
  });
  it('validates explicit scalar changes', () => {
    const text = resourceYaml(original);
    const edited = parseResourceYaml('count: 4\nfloat: !!float 2.0\n', original, text);
    expect(edited).toEqual({ kind: 'map', value: { count: { kind: 'int64', value: '4' }, float: { kind: 'double', value: 2 } } });
    expect(() => parseResourceYaml('float: !!float .inf\n', original, text)).toThrow();
  });
});
