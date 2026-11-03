import { beforeEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_APPEARANCE,
  readAppearanceBootstrap,
  resolveAppearance,
  writeAppearanceBootstrap,
} from './appearancePreferences';

describe('appearance preferences', () => {
  beforeEach(() => localStorage.clear());

  it('defaults to comfortable density, independent default text, and system motion', () => {
    expect(readAppearanceBootstrap(null)).toEqual({ density: 'comfortable', textSize: '100', motion: 'system' });
    expect(resolveAppearance({ density: 'tiny', textSize: 125, motion: true })).toEqual(DEFAULT_APPEARANCE);
  });

  it('restores supported preferences without accepting unknown values', () => {
    const saved = { density: 'compact', textSize: '125', motion: 'reduced' } as const;
    writeAppearanceBootstrap(localStorage, saved);
    expect(readAppearanceBootstrap(localStorage)).toEqual(saved);
    expect(resolveAppearance({ textSize: '110', motion: 'normal' }, saved)).toEqual({
      density: 'compact', textSize: '110', motion: 'normal',
    });
  });

  it.each(['80', '90', '100', '110', '125'] as const)('restores and resolves %s percent text', (textSize) => {
    const saved = { density: 'compact', textSize, motion: 'reduced' } as const;
    writeAppearanceBootstrap(localStorage, saved);
    expect(readAppearanceBootstrap(localStorage)).toEqual(saved);
    expect(resolveAppearance({ textSize })).toEqual({ ...DEFAULT_APPEARANCE, textSize });
    expect(resolveAppearance({ textSize: '95' }, saved)).toEqual(saved);
  });

  it('ignores malformed and future caches', () => {
    for (const raw of ['{', 'null', '[]', '{"schemaVersion":2,"density":"compact"}']) {
      localStorage.setItem('ov-appearance-bootstrap-v1', raw);
      expect(readAppearanceBootstrap(localStorage)).toEqual(DEFAULT_APPEARANCE);
    }
  });
});
