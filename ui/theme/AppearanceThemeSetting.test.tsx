import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { themeRegistry } from '@omniviewdev/base-ui';
import type * as AppThemeControllerModule from './AppThemeController';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requestedThemeId: 'dark',
  selectTheme: vi.fn(),
}));

vi.mock('./AppThemeController', async (importOriginal) => {
  const actual = await importOriginal<typeof AppThemeControllerModule>();
  return {
    ...actual,
    useAppTheme: () => ({
      requestedThemeId: mocks.requestedThemeId,
      activeTheme: themeRegistry.get('dark'),
      isFallback: false,
      selectTheme: mocks.selectTheme,
    }),
  };
});

import AppearanceThemeSetting from './AppearanceThemeSetting';

const customThemes = [
  {
    definition: { schemaVersion: 1, id: 'plugin:zulu/theme', name: 'Zulu', base: 'dark', tokens: {} },
    owner: { kind: 'plugin', id: 'zulu' },
  },
  {
    definition: { schemaVersion: 1, id: 'user:zinc', name: 'Zinc', base: 'dark', tokens: {} },
    owner: { kind: 'user', id: 'zinc' },
  },
  {
    definition: { schemaVersion: 1, id: 'plugin:alpha/theme', name: 'Alpha', base: 'dark', tokens: {} },
    owner: { kind: 'plugin', id: 'alpha' },
  },
  {
    definition: { schemaVersion: 1, id: 'user:amber', name: 'Amber', base: 'dark', tokens: {} },
    owner: { kind: 'user', id: 'amber' },
  },
] as const;

let unregisterThemes: Array<() => void> = [];


describe('AppearanceThemeSetting', () => {
  beforeEach(() => {
    mocks.requestedThemeId = 'dark';
    mocks.selectTheme.mockReset().mockResolvedValue(undefined);
    unregisterThemes = customThemes.map(({ definition, owner }) => (
      themeRegistry.register(definition, owner)
    ));
  });

  afterEach(() => {
    cleanup();
    unregisterThemes.forEach((unregister) => {
      unregister();
    });
  });


  it('keeps a missing requested theme visible as an unavailable disabled option', () => {
    mocks.requestedThemeId = 'plugin:missing/theme';

    render(<AppearanceThemeSetting />);

    expect(screen.getByRole('radio', { name: 'Unavailable: plugin:missing/theme' })).toBeDisabled();
    expect(screen.getByRole('radio', { name: 'Unavailable: plugin:missing/theme' })).toBeChecked();
  });

  it('selects Obsidian immediately instead of creating a settings draft', () => {
    render(<AppearanceThemeSetting />);

    fireEvent.click(screen.getByRole('radio', { name: 'Obsidian' }));

    expect(mocks.selectTheme).toHaveBeenCalledWith('obsidian');
  });
  it('selects a plugin theme by its owned ID', () => {
    render(<AppearanceThemeSetting />);
    fireEvent.click(screen.getByRole('radio', { name: 'Zulu' }));
    expect(mocks.selectTheme).toHaveBeenCalledWith('plugin:zulu/theme');
  });

  it('moves keyboard focus with the immediate theme selection', () => {
    render(<AppearanceThemeSetting />);
    screen.getByRole('radio', { name: 'Dark' }).focus();
    fireEvent.keyDown(screen.getByRole('radiogroup'), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Light' })).toHaveFocus();
    expect(mocks.selectTheme).toHaveBeenCalledWith('light');
  });

  it('moves from the focused fallback when the saved theme is unavailable', () => {
    mocks.requestedThemeId = 'plugin:missing/theme';
    render(<AppearanceThemeSetting />);
    const fallback = screen.getByRole('radio', { name: 'Void' });
    fallback.focus();
    fireEvent.keyDown(fallback, { key: 'ArrowLeft' });
    expect(screen.getByRole('radio', { name: 'Zulu' })).toHaveFocus();
    expect(mocks.selectTheme).toHaveBeenCalledWith('plugin:zulu/theme');
  });
});
