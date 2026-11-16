import { describe, expect, it } from 'vitest';
import { tokenVar } from './tokenVar';

describe('tokenVar', () => {
  it('wraps a token name in var()', () => {
    expect(tokenVar('--ov-bg-island')).toBe('var(--ov-bg-island)');
    expect(tokenVar('--ov-spacing-8')).toBe('var(--ov-spacing-8)');
  });

  it('fails type-check for a name the manifest does not generate', () => {
    // @ts-expect-error a misspelled colour role
    expect(tokenVar('--ov-bg-windw')).toBe('var(--ov-bg-windw)');
    // @ts-expect-error a spacing step that is not in the closed scale
    expect(tokenVar('--ov-spacing-5')).toBe('var(--ov-spacing-5)');
    // @ts-expect-error the previous library's name for a role, which no longer exists
    expect(tokenVar('--ov-color-bg-base')).toBe('var(--ov-color-bg-base)');
  });
});
