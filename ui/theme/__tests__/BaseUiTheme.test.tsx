import { render, screen } from '@testing-library/react';
import { useColorScheme } from '@mui/material/styles';
import { AppTheme, initThemeRegistry } from '@omniviewdev/ui/theme';
import type { ColorMode } from '@omniviewdev/ui/theme';
import { useTheme as useBaseUiTheme } from '@omniviewdev/base-ui';

import BaseUiTheme from '../BaseUiTheme';

initThemeRegistry();

function Probe() {
  const { mode } = useColorScheme();
  const { theme } = useBaseUiTheme();
  return (
    <>
      <span data-testid="mui-mode">{mode}</span>
      <span data-testid="base-ui-theme">{theme}</span>
    </>
  );
}

function tree(mode: ColorMode) {
  return (
    <AppTheme defaultMode={mode}>
      <BaseUiTheme>
        <Probe />
      </BaseUiTheme>
    </AppTheme>
  );
}

describe('BaseUiTheme', () => {
  afterEach(() => {
    localStorage.clear();
    const root = document.documentElement;
    ['data-ov-theme', 'data-ovl-theme', 'data-ov-density', 'data-ov-motion'].forEach((attr) => {
      root.removeAttribute(attr);
    });
  });

  it('mounts base-ui in dark compact mode next to the legacy theme', () => {
    render(tree('dark'));
    const root = document.documentElement;
    expect(screen.getByTestId('base-ui-theme').textContent).toBe('dark');
    expect(root.getAttribute('data-ov-theme')).toBe('dark');
    expect(root.getAttribute('data-ovl-theme')).toBe('dark');
    expect(root.getAttribute('data-ov-density')).toBe('compact');
  });

  it('follows MUI color mode changes', () => {
    const { rerender } = render(tree('dark'));
    const root = document.documentElement;

    rerender(tree('light'));
    expect(screen.getByTestId('mui-mode').textContent).toBe('light');
    expect(screen.getByTestId('base-ui-theme').textContent).toBe('light');
    expect(root.getAttribute('data-ov-theme')).toBe('light');
    expect(root.getAttribute('data-ovl-theme')).toBe('light');

    rerender(tree('dark'));
    expect(screen.getByTestId('base-ui-theme').textContent).toBe('dark');
    expect(root.getAttribute('data-ov-theme')).toBe('dark');
    expect(root.getAttribute('data-ovl-theme')).toBe('dark');
  });

  it('does not persist base-ui theme state to localStorage', () => {
    render(tree('dark'));
    expect(localStorage.getItem('ov-theme-mode')).toBeNull();
    expect(localStorage.getItem('ov-theme-density')).toBeNull();
  });
});
