import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { useTheme } from '@omniviewdev/base-ui';

const THEME_SETTING = 'appearance.theme';
let mockSettings: Record<string, unknown> = {};

vi.mock('@omniviewdev/runtime', () => ({
  useSettings: () => ({ settings: mockSettings }),
}));

import AppTheme from '../AppTheme';

function Probe() {
  const { theme } = useTheme();
  return <span data-testid="theme">{theme}</span>;
}

describe('AppTheme', () => {
  afterEach(() => {
    mockSettings = {};
    localStorage.clear();
    const root = document.documentElement;
    ['data-ov-theme', 'data-ov-theme-custom', 'data-ov-density', 'data-ov-motion', 'style'].forEach((attr) => {
      root.removeAttribute(attr);
    });
  });

  it('mounts base-ui in dark compact mode by default', () => {
    render(<AppTheme><Probe /></AppTheme>);
    const root = document.documentElement;
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(root.getAttribute('data-ov-theme')).toBe('dark');
    expect(root.getAttribute('data-ov-density')).toBe('compact');
  });

  it('applies the solarized setting and follows changes back to default', () => {
    mockSettings = { [THEME_SETTING]: 'solarized' };
    const { rerender } = render(<AppTheme><Probe /></AppTheme>);
    const root = document.documentElement;
    expect(screen.getByTestId('theme').textContent).toBe('solarized');
    expect(root.getAttribute('data-ov-theme')).toBe('dark');
    expect(root.getAttribute('data-ov-theme-custom')).toBe('solarized');
    expect(root.style.getPropertyValue('--ov-color-bg-base')).toBe('#002B36');
    expect(localStorage.getItem('ov-theme-variant')).toBe('solarized');

    mockSettings = { [THEME_SETTING]: 'default' };
    rerender(<AppTheme><Probe /></AppTheme>);
    expect(screen.getByTestId('theme').textContent).toBe('dark');
    expect(root.getAttribute('data-ov-theme-custom')).toBeNull();
    expect(root.style.getPropertyValue('--ov-color-bg-base')).toBe('');
    expect(localStorage.getItem('ov-theme-variant')).toBe('default');
  });

  it('starts from the last applied theme before settings load', () => {
    localStorage.setItem('ov-theme-variant', 'solarized');
    render(<AppTheme><Probe /></AppTheme>);
    expect(screen.getByTestId('theme').textContent).toBe('solarized');
  });

  it('does not persist base-ui theme state', () => {
    render(<AppTheme><Probe /></AppTheme>);
    expect(localStorage.getItem('ov-theme-mode')).toBeNull();
    expect(localStorage.getItem('ov-theme-density')).toBeNull();
  });
});
