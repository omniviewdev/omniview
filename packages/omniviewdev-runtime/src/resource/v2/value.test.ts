import { describe, expect, it } from 'vitest';
import type { Value } from './domain';
import { jsonTextToValue, jsonToValue, valueToJSON, valueToJSONText } from './value';

describe('exact resource integer conversions', () => {
  it.each([
    ['-9223372036854775808', 'int64'],
    ['9223372036854775807', 'int64'],
    ['9223372036854775808', 'uint64'],
    ['18446744073709551615', 'uint64'],
  ] as const)('preserves boundary %s without a JS number', (decimal, kind) => {
    const value: Value = { kind, value: decimal };
    expect(valueToJSON(value)).toBe(BigInt(decimal));
    expect(valueToJSONText(value)).toBe(decimal);
    expect(jsonTextToValue(decimal)).toEqual(value);
    expect(jsonToValue(BigInt(decimal))).toEqual(value);
  });

  it.each(['-9223372036854775809', '18446744073709551616'])('rejects integer outside the domain: %s', (decimal) => {
    expect(() => jsonTextToValue(decimal)).toThrow(RangeError);
    expect(() => jsonToValue(BigInt(decimal))).toThrow(RangeError);
  });

  it('does not infer integers from quoted decimal strings', () => {
    const decimal = '18446744073709551615';
    expect(jsonToValue(decimal)).toEqual({ kind: 'string', value: decimal });
    expect(jsonTextToValue(JSON.stringify(decimal))).toEqual({ kind: 'string', value: decimal });
  });

  it('accepts safe integer numbers and rejects numbers already subject to precision loss', () => {
    expect(jsonToValue(Number.MAX_SAFE_INTEGER)).toEqual({ kind: 'int64', value: '9007199254740991' });
    expect(jsonToValue(Number.MIN_SAFE_INTEGER)).toEqual({ kind: 'int64', value: '-9007199254740991' });
    expect(() => jsonToValue(Number.MAX_SAFE_INTEGER + 1)).toThrow(RangeError);
    expect(() => jsonToValue(Number.MIN_SAFE_INTEGER - 1)).toThrow(RangeError);
  });

  it('projects unsigned zero exactly without changing the canonical kind', () => {
    const value: Value = { kind: 'uint64', value: '0' };
    expect(valueToJSON(value)).toBe(0);
    expect(valueToJSONText(value)).toBe('0');
    // Native JSON has no signedness tag. Authored integer lexemes use int64 when representable.
    expect(jsonTextToValue('0')).toEqual({ kind: 'int64', value: '0' });
  });

  it.each([
    ['-9007199254740991', 'int64', -9007199254740991],
    ['9007199254740991', 'int64', 9007199254740991],
    ['7', 'uint64', 7],
    ['-9007199254740992', 'int64', -9007199254740992n],
    ['9007199254740992', 'uint64', 9007199254740992n],
  ] as const)('projects only exactly safe integer %s', (decimal, kind, expected) => {
    const value: Value = { kind, value: decimal };
    expect(valueToJSON(value)).toBe(expected);
    expect(value).toEqual({ kind, value: decimal });
  });
});

describe('resource floating-point and timestamp presentation', () => {
  it.each([-0, 0, 1, -7, 1.25, 1e20, 1e-20, Number.MIN_VALUE, Number.MAX_VALUE])('preserves double intent for %s in editor text', (number) => {
    const value: Value = { kind: 'double', value: number };
    const text = valueToJSONText(value);
    const parsed = jsonTextToValue(text);
    expect(parsed.kind).toBe('double');
    expect(parsed).toEqual(value);
    expect(Object.is(valueToJSON(value), number)).toBe(true);
    if (Object.is(number, -0)) {
      expect(text).toBe('-0.0');
      expect(parsed.kind === 'double' && Object.is(parsed.value, -0)).toBe(true);
    }
  });

  it('distinguishes an integer lexeme from decimal and exponent intent', () => {
    expect(jsonTextToValue('1')).toEqual({ kind: 'int64', value: '1' });
    expect(jsonTextToValue('1.0')).toEqual({ kind: 'double', value: 1 });
    expect(jsonTextToValue('1e0')).toEqual({ kind: 'double', value: 1 });
    expect(jsonTextToValue('-0')).toEqual({ kind: 'double', value: -0 });
    expect(jsonToValue(-0)).toEqual({ kind: 'double', value: -0 });
  });

  it.each([NaN, Infinity, -Infinity])('rejects non-finite double %s', (number) => {
    expect(() => jsonToValue(number)).toThrow(TypeError);
    expect(() => valueToJSONText({ kind: 'double', value: number })).toThrow(TypeError);
  });

  it.each(['1969-12-31T23:59:59.123456789Z', '1900-01-01T00:00:00.000000001Z'])('does not round pre-epoch nanoseconds in %s', (timestamp) => {
    const value: Value = { kind: 'timestamp', value: timestamp };
    expect(valueToJSON(value)).toBe(timestamp);
    expect(valueToJSONText(value)).toBe(JSON.stringify(timestamp));
    // JSON editor text is native JSON, not a tagged Value serialization.
    expect(jsonTextToValue(valueToJSONText(value))).toEqual({ kind: 'string', value: timestamp });
  });
});

describe('resource containers and arbitrary map keys', () => {
  it('preserves mixed nested values and exact integers', () => {
    const value: Value = {
      kind: 'map',
      value: {
        items: {
          kind: 'list',
          value: [
            { kind: 'null' },
            { kind: 'bool', value: false },
            { kind: 'string', value: '' },
            { kind: 'int64', value: '-9223372036854775808' },
            { kind: 'uint64', value: '18446744073709551615' },
            { kind: 'double', value: -0 },
            { kind: 'map', value: { '雪/🌍': { kind: 'string', value: 'line\n\t"\\' } } },
          ],
        },
      },
    };
    expect(valueToJSON(value)).toEqual({ items: [null, false, '', -9223372036854775808n, 18446744073709551615n, -0, { '雪/🌍': 'line\n\t"\\' }] });
    expect(jsonTextToValue(valueToJSONText(value))).toEqual(value);
  });

  it('produces null without a payload and retains empty containers', () => {
    const value = jsonToValue(null);
    expect(value).toEqual({ kind: 'null' });
    expect(Object.prototype.hasOwnProperty.call(value, 'value')).toBe(false);
    expect(valueToJSON(value)).toBeNull();
    expect(valueToJSONText(value)).toBe('null');
    expect(jsonTextToValue(' \n null\t')).toEqual(value);
    expect(jsonTextToValue('[]')).toEqual({ kind: 'list', value: [] });
    expect(jsonTextToValue('{}')).toEqual({ kind: 'map', value: {} });
    expect(valueToJSONText(jsonToValue([{}, []]))).toBe('[{},[]]');
  });

  it('keeps prototype-like names as own data properties without polluting prototypes', () => {
    const text = '{"__proto__":{"p45Polluted":true},"constructor":"literal","prototype":null,"":"empty key","雪/🌍":"unicode","a\\u0000b":"nul key"}';
    const native = JSON.parse(text) as { [key: string]: unknown };
    const parsed = jsonTextToValue(text);
    const authored = jsonToValue(native);
    const plain = valueToJSON(parsed) as { [key: string]: unknown };
    expect(parsed).toEqual(authored);
    expect(plain).toEqual(native);
    expect(Object.getPrototypeOf(plain)).toBe(Object.prototype);
    expect(Object.prototype.hasOwnProperty.call(plain, '__proto__')).toBe(true);
    expect(Object.getOwnPropertyDescriptor(plain, '__proto__')).toMatchObject({ value: { p45Polluted: true }, enumerable: true, writable: true });
    expect(plain.constructor).toBe('literal');
    expect(Object.prototype).not.toHaveProperty('p45Polluted');
    expect(Object.getPrototypeOf({})).toBe(Object.prototype);
    expect(jsonTextToValue(valueToJSONText(parsed))).toEqual(parsed);
  });
});

describe('strict resource editor JSON', () => {
  it.each(['{"x":1,"x":2}', '{"x":1,"\\u0078":2}', '{"__proto__":null,"__proto__":true}'])('rejects duplicate decoded map keys: %s', (text) => {
    expect(() => jsonTextToValue(text)).toThrow(SyntaxError);
  });

  it.each(['"\\ud800"', '"\\udc00"', '"\\ud800x"', '{"\\ud800":null}', JSON.stringify('\ud800'), JSON.stringify('\udc00')])('rejects unpaired Unicode in JSON: %s', (text) => {
    expect(() => jsonTextToValue(text)).toThrow(TypeError);
  });

  it.each(['\ud800', '\udc00', '\ud800x', 'x\udc00'])('rejects unpaired Unicode in authored strings and keys', (text) => {
    expect(() => jsonToValue(text)).toThrow(TypeError);
    expect(() => jsonToValue(Object.fromEntries([[text, null]]))).toThrow(TypeError);
  });

  it('accepts paired Unicode escapes and literal supplementary code points', () => {
    expect(jsonTextToValue('"\\ud83d\\ude00"')).toEqual({ kind: 'string', value: '😀' });
    expect(jsonToValue('😀雪')).toEqual({ kind: 'string', value: '😀雪' });
    expect(valueToJSON(jsonTextToValue('{"\\ud83d\\ude00":"雪"}'))).toEqual({ '😀': '雪' });
  });

  it.each(['', '+1', '01', '-01', '.5', '1.', '1e', '1e+', '--1', 'NaN', 'Infinity', 'undefined', 'null true', '[1,]', '{"x":1,}', '"\\x00"', '"unterminated', '"unescaped\nline"'])('rejects invalid JSON or numeric syntax: %s', (text) => {
    expect(() => jsonTextToValue(text)).toThrow(SyntaxError);
  });

  it.each(['1e999', '-1e999'])('rejects numeric overflow: %s', (text) => {
    expect(() => jsonTextToValue(text)).toThrow(RangeError);
  });

  it('enforces the editor nesting boundary', () => {
    expect(() => jsonTextToValue(`${'['.repeat(64)}null${']'.repeat(64)}`)).not.toThrow();
    expect(() => jsonTextToValue(`${'['.repeat(65)}null${']'.repeat(65)}`)).toThrow(RangeError);
  });
});
