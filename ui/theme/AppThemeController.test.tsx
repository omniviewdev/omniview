import { act, cleanup, render, screen } from '@testing-library/react';
import { useTheme } from '@omniviewdev/base-ui';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const settings: Record<string, unknown> = {};

  return {
    settings,
    setSetting: vi.fn(),
    showSnackbar: vi.fn(),
    showAppError: vi.fn(),
  };
});

vi.mock('@omniviewdev/runtime', () => ({
  useSettings: () => ({ settings: mocks.settings }),
  HOST_SETTINGS_SCOPE: { kind: 'host' },
  useScopedSettings: () => ({ commit: mocks.setSetting }),
  useSnackbar: () => ({ showSnackbar: mocks.showSnackbar }),
  showAppError: mocks.showAppError,
  useExtensionPoint: () => undefined,
}));


import AppThemeController, {
  useAppTheme,
  type AppThemeContextValue,
} from './AppThemeController';

const BOOTSTRAP_KEY = 'ov-theme-bootstrap-v1';
let controller: AppThemeContextValue;

function Probe() {
  controller = useAppTheme();
  const providerTheme = useTheme();

  return (
    <output data-testid="theme-state">
      {JSON.stringify({
        requestedThemeId: controller.requestedThemeId,
        activeThemeId: controller.activeTheme.id,
        isFallback: controller.isFallback,
        providerRequestedThemeId: providerTheme.requestedThemeId,
        density: providerTheme.density,
        textSize: providerTheme.textSize,
        motion: providerTheme.motion,
      })}
    </output>
  );
}

function readThemeState() {
  return JSON.parse(screen.getByTestId('theme-state').textContent ?? '{}') as Record<string, unknown>;
}

function renderController() {
  return render(
    <AppThemeController>
      <Probe />
    </AppThemeController>,
  );
}

function createDeferred() {
  const { promise, resolve, reject } = Promise.withResolvers<{ applied: boolean; uncertain: boolean; message: string }>();
  return {
    promise,
    resolve: () => {
      resolve({ applied: true, uncertain: false, message: '' });
    },
    reject,
  };
}

describe('AppThemeController', () => {
  beforeEach(() => {
    mocks.settings = {};
    mocks.setSetting.mockReset().mockResolvedValue({ applied: true, uncertain: false, message: '' });
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

  it('starts from the bootstrap theme while settings are still empty', () => {
    localStorage.setItem(
      BOOTSTRAP_KEY,
      JSON.stringify({ schemaVersion: 1, themeId: 'obsidian' }),
    );

    renderController();

    expect(readThemeState()).toMatchObject({
      requestedThemeId: 'obsidian',
      activeThemeId: 'obsidian',
      isFallback: false,
      providerRequestedThemeId: 'obsidian',
      density: 'comfortable',
    });
  });

  it('restores cached preferences before settings hydration and applies live backend changes', () => {
    localStorage.setItem('ov-appearance-bootstrap-v1', JSON.stringify({
      schemaVersion: 1, density: 'compact', textSize: '125', motion: 'reduced',
    }));
    const view = renderController();
    expect(readThemeState()).toMatchObject({ density: 'compact', textSize: '125', motion: 'reduced' });

    mocks.settings = {
      'appearance.density': 'comfortable',
      'appearance.textSize': '110',
      'appearance.motion': 'normal',
    };
    view.rerender(<AppThemeController><Probe /></AppThemeController>);
    expect(readThemeState()).toMatchObject({ density: 'comfortable', textSize: '110', motion: 'normal' });
    expect(JSON.parse(localStorage.getItem('ov-appearance-bootstrap-v1') ?? '{}')).toEqual({
      schemaVersion: 1, density: 'comfortable', textSize: '110', motion: 'normal',
    });

    view.unmount();
    mocks.settings = {};
    renderController();
    expect(readThemeState()).toMatchObject({ density: 'comfortable', textSize: '110', motion: 'normal' });
  });

  it('tracks system reduced motion and respects explicit overrides', () => {
    let reduced = false;
    const listeners = new Set<() => void>();
    const original = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation(() => ({
      get matches() { return reduced; },
      addEventListener: (_event: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_event: string, listener: () => void) => listeners.delete(listener),
    }));
    try {
      const view = renderController();
      expect(readThemeState()).toMatchObject({ motion: 'normal' });
      act(() => {
        reduced = true;
        listeners.forEach(listener => listener());
      });
      expect(readThemeState()).toMatchObject({ motion: 'reduced' });
      mocks.settings = { 'appearance.motion': 'normal' };
      view.rerender(<AppThemeController><Probe /></AppThemeController>);
      expect(readThemeState()).toMatchObject({ motion: 'normal' });
      mocks.settings = { 'appearance.motion': 'system' };
      view.rerender(<AppThemeController><Probe /></AppThemeController>);
      expect(readThemeState()).toMatchObject({ motion: 'reduced' });
      act(() => {
        reduced = false;
        listeners.forEach(listener => listener());
      });
      expect(readThemeState()).toMatchObject({ motion: 'normal' });
      view.unmount();
      expect(listeners.size).toBe(0);
    } finally {
      window.matchMedia = original;
    }
  });

  it('lets the loaded canonical backend value win over the bootstrap cache', () => {
    localStorage.setItem(
      BOOTSTRAP_KEY,
      JSON.stringify({ schemaVersion: 1, themeId: 'dark' }),
    );
    localStorage.setItem('ov-theme-variant', 'solarized');
    localStorage.setItem('ov-theme-mode', 'light');
    mocks.settings = { 'appearance.theme': 'solarized-light' };

    renderController();

    expect(readThemeState()).toMatchObject({
      requestedThemeId: 'solarized-light',
      activeThemeId: 'solarized-light',
      isFallback: false,
    });
    expect(localStorage.getItem('ov-theme-variant')).toBeNull();
    expect(localStorage.getItem('ov-theme-mode')).toBeNull();
  });

  it('applies a selection before its persistence promise settles', async () => {
    mocks.settings = { 'appearance.theme': 'dark' };
    const deferred = createDeferred();
    mocks.setSetting.mockReturnValue(deferred.promise);
    renderController();

    let selection!: Promise<void>;
    act(() => {
      selection = controller.selectTheme('light');
    });

    expect(readThemeState()).toMatchObject({
      requestedThemeId: 'light',
      activeThemeId: 'light',
    });
    expect(localStorage.getItem(BOOTSTRAP_KEY)).toBe(
      JSON.stringify({ schemaVersion: 1, themeId: 'dark' }),
    );

    deferred.resolve();
    await act(async () => selection);
  });

  it('writes the bootstrap cache after scoped persistence succeeds', async () => {
    mocks.settings = { 'appearance.theme': 'dark' };
    renderController();

    await act(async () => controller.selectTheme('light'));

    expect(mocks.setSetting).toHaveBeenCalledWith({ 'appearance.theme': 'light' });
    expect(localStorage.getItem(BOOTSTRAP_KEY)).toBe(
      JSON.stringify({ schemaVersion: 1, themeId: 'light' }),
    );
  });

  it('rolls back a rejected selection, reports it, and leaves the cache unchanged', async () => {
    const error = new Error('write failed');
    mocks.settings = { 'appearance.theme': 'dark' };
    localStorage.setItem(
      BOOTSTRAP_KEY,
      JSON.stringify({ schemaVersion: 1, themeId: 'dark' }),
    );
    mocks.setSetting.mockRejectedValue(error);
    renderController();

    await act(async () => controller.selectTheme('light'));

    expect(readThemeState()).toMatchObject({
      requestedThemeId: 'dark',
      activeThemeId: 'dark',
    });
    expect(localStorage.getItem(BOOTSTRAP_KEY)).toBe(
      JSON.stringify({ schemaVersion: 1, themeId: 'dark' }),
    );
    expect(mocks.showAppError).toHaveBeenCalledWith(
      mocks.showSnackbar,
      error,
      'Failed to save theme',
    );
  });

  it('keeps a durably saved theme when application is uncertain', async () => {
    mocks.settings = { 'appearance.theme': 'dark' };
    mocks.setSetting.mockResolvedValue({ applied: false, uncertain: true, message: 'Saved; application uncertain.' });
    renderController();

    await act(async () => controller.selectTheme('light'));

    expect(readThemeState()).toMatchObject({ requestedThemeId: 'light' });
    expect(JSON.parse(localStorage.getItem(BOOTSTRAP_KEY)!)).toMatchObject({ themeId: 'light' });
    expect(mocks.showSnackbar).toHaveBeenCalledWith('Saved; application uncertain.', 'warning');
    expect(mocks.showAppError).not.toHaveBeenCalled();
  });

  it('normalizes a legacy Solarized backend value', () => {
    mocks.settings = { 'appearance.theme': 'solarized' };

    renderController();

    expect(readThemeState()).toMatchObject({
      requestedThemeId: 'solarized-dark',
      activeThemeId: 'solarized-dark',
      isFallback: false,
    });
  });

  it('preserves an unknown backend ID while Base UI renders Void', () => {
    mocks.settings = { 'appearance.theme': 'plugin:missing/slate' };

    renderController();

    expect(readThemeState()).toMatchObject({
      requestedThemeId: 'plugin:missing/slate',
      activeThemeId: 'void',
      isFallback: true,
    });
  });

  it('does not let a stale rejection roll back a newer successful selection', async () => {
    mocks.settings = { 'appearance.theme': 'dark' };
    const first = createDeferred();
    const second = createDeferred();
    mocks.setSetting
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderController();

    let firstSelection!: Promise<void>;
    let secondSelection!: Promise<void>;
    act(() => {
      firstSelection = controller.selectTheme('light');
      secondSelection = controller.selectTheme('carbon');
    });
    expect(readThemeState()).toMatchObject({ requestedThemeId: 'carbon' });

    await act(async () => {
      first.reject(new Error('stale failure'));
      await firstSelection;
    });
    expect(readThemeState()).toMatchObject({ requestedThemeId: 'carbon' });
    expect(mocks.setSetting).toHaveBeenNthCalledWith(2, { 'appearance.theme': 'carbon' });

    second.resolve();
    await act(async () => Promise.all([firstSelection, secondSelection]));

    expect(readThemeState()).toMatchObject({
      requestedThemeId: 'carbon',
      activeThemeId: 'carbon',
    });
    expect(localStorage.getItem(BOOTSTRAP_KEY)).toBe(
      JSON.stringify({ schemaVersion: 1, themeId: 'carbon' }),
    );
  });

  it('rolls back to backend hydration that arrives while a write is pending', async () => {
    localStorage.setItem(
      BOOTSTRAP_KEY,
      JSON.stringify({ schemaVersion: 1, themeId: 'obsidian' }),
    );
    const deferred = createDeferred();
    mocks.setSetting.mockReturnValue(deferred.promise);
    const view = renderController();

    let selection!: Promise<void>;
    act(() => {
      selection = controller.selectTheme('light');
    });

    mocks.settings = { 'appearance.theme': 'carbon' };
    view.rerender(
      <AppThemeController>
        <Probe />
      </AppThemeController>,
    );
    expect(readThemeState()).toMatchObject({ requestedThemeId: 'light' });

    deferred.reject(new Error('write failed'));
    await act(async () => selection);

    expect(readThemeState()).toMatchObject({
      requestedThemeId: 'carbon',
      activeThemeId: 'carbon',
    });
    expect(localStorage.getItem(BOOTSTRAP_KEY)).toBe(
      JSON.stringify({ schemaVersion: 1, themeId: 'carbon' }),
    );
  });

  it('uses pending backend hydration after the latest queued write rejects', async () => {
    localStorage.setItem(
      BOOTSTRAP_KEY,
      JSON.stringify({ schemaVersion: 1, themeId: 'obsidian' }),
    );
    const first = createDeferred();
    const second = createDeferred();
    mocks.setSetting
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    const view = renderController();

    let firstSelection!: Promise<void>;
    let secondSelection!: Promise<void>;
    act(() => {
      firstSelection = controller.selectTheme('light');
      secondSelection = controller.selectTheme('carbon');
    });

    mocks.settings = { 'appearance.theme': 'solarized-light' };
    view.rerender(
      <AppThemeController>
        <Probe />
      </AppThemeController>,
    );

    await act(async () => {
      first.reject(new Error('first failure'));
      await firstSelection;
    });
    expect(readThemeState()).toMatchObject({ requestedThemeId: 'carbon' });

    second.reject(new Error('second failure'));
    await act(async () => Promise.all([firstSelection, secondSelection]));

    expect(readThemeState()).toMatchObject({
      requestedThemeId: 'solarized-light',
      activeThemeId: 'solarized-light',
    });
    expect(localStorage.getItem(BOOTSTRAP_KEY)).toBe(
      JSON.stringify({ schemaVersion: 1, themeId: 'solarized-light' }),
    );
  });

  it('rolls back to the last committed theme when two queued selections reject', async () => {
    mocks.settings = { 'appearance.theme': 'dark' };
    const first = createDeferred();
    const second = createDeferred();
    mocks.setSetting
      .mockReturnValueOnce(first.promise)
      .mockReturnValueOnce(second.promise);
    renderController();

    let firstSelection!: Promise<void>;
    let secondSelection!: Promise<void>;
    act(() => {
      firstSelection = controller.selectTheme('light');
      secondSelection = controller.selectTheme('carbon');
    });
    expect(readThemeState()).toMatchObject({ requestedThemeId: 'carbon' });

    await act(async () => {
      first.reject(new Error('first failure'));
      await firstSelection;
    });
    expect(readThemeState()).toMatchObject({ requestedThemeId: 'carbon' });

    second.reject(new Error('second failure'));
    await act(async () => Promise.all([firstSelection, secondSelection]));

    expect(readThemeState()).toMatchObject({
      requestedThemeId: 'dark',
      activeThemeId: 'dark',
    });
    expect(localStorage.getItem(BOOTSTRAP_KEY)).toBe(
      JSON.stringify({ schemaVersion: 1, themeId: 'dark' }),
    );
  });
});
