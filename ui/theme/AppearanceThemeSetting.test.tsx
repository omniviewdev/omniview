import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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

function openThemePicker() {
  fireEvent.click(screen.getByRole('combobox'));
}

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

  it('shows built-in, user, and plugin themes in registry order', () => {
    render(<AppearanceThemeSetting />);
    expect(screen.getByRole('combobox', { name: 'Theme' })).toBeVisible();

    openThemePicker();

    expect(screen.getAllByRole('option').map(option => option.textContent)).toEqual([
      'Void',
      'Dark',
      'Light',
      'Obsidian',
      'Carbon',
      'Solarized Dark',
      'Solarized Light',
      'High Contrast Dark',
      'High Contrast Light',
      'Amber',
      'Zinc',
      'Alpha',
      'Zulu',
    ]);
  });

  it('keeps a missing requested theme visible as an unavailable disabled option', () => {
    mocks.requestedThemeId = 'plugin:missing/theme';

    render(<AppearanceThemeSetting />);

    expect(screen.getByRole('combobox')).toHaveTextContent('Unavailable: plugin:missing/theme');
    openThemePicker();

    expect(screen.getByRole('option', { name: 'Unavailable: plugin:missing/theme' })).toHaveAttribute('aria-disabled', 'true');
  });

  it('selects Obsidian immediately instead of creating a settings draft', () => {
    render(<AppearanceThemeSetting />);

    openThemePicker();
    const obsidian = within(screen.getByRole('listbox')).getByRole('option', { name: 'Obsidian' });
    fireEvent.mouseMove(obsidian);
    fireEvent.click(obsidian);

    expect(mocks.selectTheme).toHaveBeenCalledWith('obsidian');
  });
});
