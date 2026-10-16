import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useTheme } from '@omniviewdev/base-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const settings: Record<string, unknown> = {};

  return {
    settings,
    reload: vi.fn(),
    setSetting: vi.fn(),
    showSnackbar: vi.fn(),
    showAppError: vi.fn(),
  };
});

vi.mock('@omniviewdev/runtime', () => ({
  useSettings: () => ({ settings: mocks.settings, reload: mocks.reload }),
  useSnackbar: () => ({ showSnackbar: mocks.showSnackbar }),
  showAppError: mocks.showAppError,
  useExtensionPoint: () => undefined,
}));

vi.mock('@omniviewdev/runtime/api', () => ({
  SettingsProvider: {
    SetSetting: mocks.setSetting,
  },
}));

import AppThemeController, { useAppTheme } from '../AppThemeController';

function Probe() {
  const appTheme = useAppTheme();
  const baseTheme = useTheme();

  return (
    <>
      <output data-testid="theme-state">
        {JSON.stringify({
          appRequestedId: appTheme.requestedThemeId,
          providerRequestedId: baseTheme.requestedThemeId,
          activeId: appTheme.activeTheme.id,
          isFallback: appTheme.isFallback,
          density: baseTheme.density,
        })}
      </output>
      <button type="button" onClick={() => {
        baseTheme.setTheme('solarized-dark');
      }}>
        Use Solarized Dark
      </button>
    </>
  );
}

function readThemeState() {
  return JSON.parse(screen.getByTestId('theme-state').textContent ?? '{}') as Record<string, unknown>;
}

describe('application theme provider integration', () => {
  beforeEach(() => {
    mocks.settings = {};
    mocks.reload.mockReset();
    mocks.setSetting.mockReset();
    mocks.setSetting.mockResolvedValue(undefined);
    mocks.showSnackbar.mockReset();
    mocks.showAppError.mockReset();
    localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    localStorage.clear();
    const root = document.documentElement;
    root.removeAttribute('data-ov-theme');
    root.removeAttribute('data-ov-theme-custom');
    root.removeAttribute('data-ov-density');
    root.removeAttribute('data-ov-motion');
    root.removeAttribute('style');
  });

  it('mounts Base UI in Void compact mode before settings load', () => {
    render(
      <AppThemeController>
        <Probe />
      </AppThemeController>,
    );

    expect(readThemeState()).toMatchObject({
      appRequestedId: 'void',
      providerRequestedId: 'void',
      activeId: 'void',
      isFallback: false,
      density: 'compact',
    });
    expect(document.documentElement.dataset.ovTheme).toBe('void');
    expect(document.documentElement.dataset.ovDensity).toBe('compact');
  });

  it('preserves an unavailable custom request while Base UI safely applies Void', () => {
    mocks.settings = { 'appearance.theme': 'plugin:missing/slate' };

    render(
      <AppThemeController>
        <Probe />
      </AppThemeController>,
    );

    expect(readThemeState()).toMatchObject({
      appRequestedId: 'plugin:missing/slate',
      providerRequestedId: 'plugin:missing/slate',
      activeId: 'void',
      isFallback: true,
    });
    expect(document.documentElement.dataset.ovTheme).toBe('void');
  });

  it('routes Base UI theme requests through optimistic durable selection', async () => {
    mocks.settings = { 'appearance.theme': 'dark' };
    render(
      <AppThemeController>
        <Probe />
      </AppThemeController>,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Use Solarized Dark' }));

    expect(readThemeState()).toMatchObject({
      appRequestedId: 'solarized-dark',
      providerRequestedId: 'solarized-dark',
      activeId: 'solarized-dark',
      isFallback: false,
    });
    expect(document.documentElement.dataset.ovTheme).toBe('solarized-dark');
    await waitFor(() => {
      expect(mocks.setSetting).toHaveBeenCalledWith('appearance.theme', 'solarized-dark');
      expect(mocks.reload).toHaveBeenCalledTimes(1);
    });
    expect(localStorage.getItem('ov-theme-bootstrap-v1')).toBe(
      JSON.stringify({ schemaVersion: 1, themeId: 'solarized-dark' }),
    );
  });
});
