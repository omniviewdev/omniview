import { cleanup, render, screen } from '@testing-library/react';
import { ThemeProvider } from '@omniviewdev/base-ui';
import { afterEach, describe, expect, it, vi } from 'vitest';
import UiZoomController from './UIZoomController';

const mocks = vi.hoisted(() => ({ commit: vi.fn(), showSnackbar: vi.fn(), showAppError: vi.fn() }));
vi.mock('@omniviewdev/runtime', () => ({
  HOST_SETTINGS_SCOPE: { kind: 'host' },
  useScopedSettings: () => ({ commit: mocks.commit }),
  useSnackbar: () => ({ showSnackbar: mocks.showSnackbar }),
  showAppError: mocks.showAppError,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

describe('UI text sizing interactions', () => {
  it('does not steal editor, unmodified, or composing keyboard input', () => {
    render(<ThemeProvider themeId='void'><UiZoomController><div className='monaco-editor'><input aria-label='Editor' /></div></UiZoomController></ThemeProvider>);
    for (const [target, detail] of [
      [document.body, { key: '-' }],
      [document.body, { key: '-', ctrlKey: true, isComposing: true }],
      [document.body, { key: '-', ctrlKey: true, altKey: true }],
      [screen.getByLabelText('Editor'), { key: '-', metaKey: true }],
    ] as const) {
      const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...detail });
      target.dispatchEvent(event);
      expect(event.defaultPrevented).toBe(false);
    }

    expect(mocks.commit).not.toHaveBeenCalled();
  });
});
