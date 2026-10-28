import { describe, expect, it } from 'vitest';
import { encodeRequestJSON } from './requestJSON';

describe('exact Wails request text', () => {
  it('preserves negative zero through ordinary outer JSON.stringify', () => {
    const request = { input: { kind: 'map', value: { zero: { kind: 'double', value: -0 }, wide: { kind: 'uint64', value: '18446744073709551615' } } } };
    const args = JSON.parse(JSON.stringify(['plugin', encodeRequestJSON(request, ['plugin'])]));
    const decoded = JSON.parse(args[1]);
    expect(Object.is(decoded.input.value.zero.value, -0)).toBe(true);
    expect(decoded.input.value.wide.value).toBe('18446744073709551615');
  });
  it('admits realistic 8 MiB bodies without shrinking the SDK profile', () => {
    const request = { input: { kind: 'string', value: 'x'.repeat(8 << 20) } };
    expect(JSON.parse(encodeRequestJSON(request)).input.value.length).toBe(8 << 20);
  });
  it('bounds inner bytes, independently expanded outer bytes and structure', () => {
    expect(() => encodeRequestJSON('x'.repeat(32 << 20))).toThrow(RangeError);
    expect(() => encodeRequestJSON('\\'.repeat((16 << 20) - 4))).toThrow(RangeError);
    expect(() => encodeRequestJSON({ input: 1n })).toThrow(TypeError);
    expect(() => encodeRequestJSON({ input: NaN })).toThrow(TypeError);
    expect(() => encodeRequestJSON({ input: '\ud800' })).toThrow(TypeError);
    expect(() => encodeRequestJSON(new Array(1))).toThrow(TypeError);
  });
});
