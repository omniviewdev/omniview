import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import type { BuiltInThemeId } from '@omniviewdev/base-ui';

import {
  clearLegacyThemeKeys,
  readBootstrapTheme,
  readLegacyPaintHint,
  writeBootstrapTheme,
} from './themeBootstrap';

const BOOTSTRAP_KEY = 'ov-theme-bootstrap-v1';
const BUILT_IN_IDS: BuiltInThemeId[] = [
  'void',
  'dark',
  'light',
  'obsidian',
  'carbon',
  'solarized-dark',
  'solarized-light',
  'high-contrast-dark',
  'high-contrast-light',
];

const startupScript = /<script>([\s\S]*?)<\/script>/.exec(readFileSync('index.html', 'utf8'))![1];

describe('first-paint theme', () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.setAttribute('data-ov-theme', 'void');
    document.documentElement.style.colorScheme = '';
  });

  it.each([
    ['ov-theme-mode', 'light', null, 'light', 'light'],
    ['ov-theme-variant', 'solarized', null, 'solarized-dark', 'dark'],
    ['ov-theme-mode', 'light', '{', 'light', 'light'],
    ['ov-theme-mode', 'light', '{"schemaVersion":2,"themeId":"dark"}', 'light', 'light'],
    ['ov-theme-mode', 'light', '{"schemaVersion":1,"themeId":"carbon"}', 'carbon', 'dark'],
    ['ov-theme-mode', 'plugin:missing/theme', null, 'void', 'dark'],
  ])('paints %s=%s with cache %s as %s', (key, value, cache, expected, scheme) => {
    localStorage.setItem(key, value);
    if (cache !== null) {
      localStorage.setItem(BOOTSTRAP_KEY, cache);
    }

    new Function('document', 'localStorage', startupScript)(document, localStorage);

    expect(document.documentElement.getAttribute('data-ov-theme')).toBe(expected);
    expect(document.documentElement.style.colorScheme).toBe(scheme);
  });
});

describe('theme bootstrap cache', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it.each(BUILT_IN_IDS)('reads cached built-in theme %s', (themeId) => {
    localStorage.setItem(BOOTSTRAP_KEY, JSON.stringify({ schemaVersion: 1, themeId }));

    expect(readBootstrapTheme(localStorage)).toBe(themeId);
  });

  it.each([
    ['malformed JSON', '{'],
    ['the wrong schema version', JSON.stringify({ schemaVersion: 2, themeId: 'light' })],
    ['a custom theme ID', JSON.stringify({ schemaVersion: 1, themeId: 'plugin:acme/slate' })],
    ['a non-object record', JSON.stringify('light')],
  ])('falls back to Void for %s', (_case, value) => {
    localStorage.setItem(BOOTSTRAP_KEY, value);

    expect(readBootstrapTheme(localStorage)).toBe('void');
  });

  it.each([
    ['solarized', 'solarized-dark'],
    ['default', 'void'],
  ])('maps legacy ov-theme-variant %s to %s', (legacy, expected) => {
    localStorage.setItem('ov-theme-variant', legacy);

    expect(readLegacyPaintHint(localStorage)).toBe(expected);
    expect(readBootstrapTheme(localStorage)).toBe(expected);
  });

  it('uses a known built-in from legacy ov-theme-mode', () => {
    localStorage.setItem('ov-theme-mode', 'high-contrast-light');

    expect(readLegacyPaintHint(localStorage)).toBe('high-contrast-light');
    expect(readBootstrapTheme(localStorage)).toBe('high-contrast-light');
  });

  it('prefers a valid versioned cache over legacy paint hints', () => {
    localStorage.setItem(BOOTSTRAP_KEY, JSON.stringify({ schemaVersion: 1, themeId: 'carbon' }));
    localStorage.setItem('ov-theme-variant', 'solarized');
    localStorage.setItem('ov-theme-mode', 'light');

    expect(readBootstrapTheme(localStorage)).toBe('carbon');
  });

  it('ignores unknown legacy values', () => {
    localStorage.setItem('ov-theme-variant', 'custom');
    localStorage.setItem('ov-theme-mode', 'plugin:acme/slate');

    expect(readLegacyPaintHint(localStorage)).toBeNull();
    expect(readBootstrapTheme(localStorage)).toBe('void');
  });

  it('writes a versioned record for a built-in selection', () => {
    writeBootstrapTheme(localStorage, 'solarized-light');

    expect(localStorage.getItem(BOOTSTRAP_KEY)).toBe(
      JSON.stringify({ schemaVersion: 1, themeId: 'solarized-light' }),
    );
  });

  it('writes Void as the safe first paint for a custom selection', () => {
    writeBootstrapTheme(localStorage, 'plugin:acme/slate');

    expect(localStorage.getItem(BOOTSTRAP_KEY)).toBe(
      JSON.stringify({ schemaVersion: 1, themeId: 'void' }),
    );
  });

  it('removes only obsolete theme keys after settings hydrate', () => {
    localStorage.setItem(BOOTSTRAP_KEY, JSON.stringify({ schemaVersion: 1, themeId: 'dark' }));
    localStorage.setItem('ov-theme-variant', 'solarized');
    localStorage.setItem('ov-theme-mode', 'light');
    localStorage.setItem('unrelated', 'keep');

    clearLegacyThemeKeys(localStorage);

    expect(localStorage.getItem('ov-theme-variant')).toBeNull();
    expect(localStorage.getItem('ov-theme-mode')).toBeNull();
    expect(localStorage.getItem(BOOTSTRAP_KEY)).not.toBeNull();
    expect(localStorage.getItem('unrelated')).toBe('keep');
  });
});
