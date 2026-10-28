import { describe, expect, it } from 'vitest';

import { ConnectionStatusCode } from './types';
import { withLegacyNames } from './legacyEnum';

describe('withLegacyNames', () => {
  it('keeps the generated members', () => {
    const aliased = withLegacyNames({ $zero: 0, FooBar: 1 } as const, 'Foo');
    expect(aliased.FooBar).toBe(1);
    expect(aliased.$zero).toBe(0);
  });

  it('adds the screaming-snake name the v2 bindings used', () => {
    const aliased: Record<string, unknown> = withLegacyNames(
      { FooBarBaz: 1, FooQux: 2 } as const,
      'Foo',
    );
    expect(aliased.BAR_BAZ).toBe(1);
    expect(aliased.QUX).toBe(2);
  });

  it('leaves members without the prefix alone', () => {
    const aliased: Record<string, unknown> = withLegacyNames({ Other: 1 } as const, 'Foo');
    expect(Object.keys(aliased)).toEqual(['Other']);
  });
});

describe('plugin-facing enums', () => {
  it('exposes ConnectionStatusCode under both spellings', () => {
    const codes = ConnectionStatusCode as unknown as Record<string, string>;
    expect(codes.CONNECTED).toBe('CONNECTED');
    expect(codes.BAD_REQUEST).toBe('BAD_REQUEST');
    expect(codes.REQUEST_ENTITY_TOO_LARGE).toBe('REQUEST_ENTITY_TOO_LARGE');
  });
});
