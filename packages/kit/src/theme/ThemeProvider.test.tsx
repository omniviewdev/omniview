import { act, render, renderHook } from '@testing-library/react';
import { StrictMode, type ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { THEMES } from '../generated/tokenNames';
import { ThemeProvider, useTheme } from './ThemeProvider';

const root = document.documentElement;
const attributes = () => ({
  theme: root.getAttribute('data-ov-theme'),
  density: root.getAttribute('data-ov-density'),
  textSize: root.getAttribute('data-ov-text-size'),
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ThemeProvider', () => {
  it('flips the document by attributes, and a rerender flips it again', () => {
    const view = render(<ThemeProvider themeId="dark" density="compact" textSize="125" />);
    expect(attributes()).toEqual({ theme: 'dark', density: 'compact', textSize: '125' });

    view.rerender(<ThemeProvider themeId="light" density="comfortable" textSize="80" />);
    expect(attributes()).toEqual({ theme: 'light', density: 'comfortable', textSize: '80' });
  });

  it('applies the defaults when a host passes nothing', () => {
    render(<ThemeProvider />);
    expect(attributes()).toEqual({ theme: 'void', density: 'comfortable', textSize: '100' });
  });

  it('puts back what was there when it unmounts', () => {
    root.setAttribute('data-ov-theme', 'obsidian');
    const view = render(<ThemeProvider themeId="light" />);
    expect(root.getAttribute('data-ov-theme')).toBe('light');
    view.unmount();
    expect(attributes()).toEqual({ theme: 'obsidian', density: null, textSize: null });
    root.removeAttribute('data-ov-theme');
  });

  it('survives StrictMode mounting its effects twice', () => {
    const view = render(
      <StrictMode>
        <ThemeProvider themeId="carbon" />
      </StrictMode>,
    );
    expect(root.getAttribute('data-ov-theme')).toBe('carbon');
    view.unmount();
    expect(root.getAttribute('data-ov-theme')).toBeNull();
  });

  it('renders the default for a theme id it does not have, and says so', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider themeId="retired-theme">{children}</ThemeProvider>;
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current).toMatchObject({ requestedThemeId: 'retired-theme', isFallback: true });
    expect(result.current.activeTheme.id).toBe('void');
    expect(root.getAttribute('data-ov-theme')).toBe('void');
  });

  it('reports the requested theme as active when the kit has it', () => {
    const wrapper = ({ children }: { children: ReactNode }) => <ThemeProvider themeId="solarized-light">{children}</ThemeProvider>;
    const { result } = renderHook(() => useTheme(), { wrapper });
    expect(result.current).toMatchObject({ requestedThemeId: 'solarized-light', isFallback: false, density: 'comfortable', textSize: '100' });
    expect(result.current.activeTheme).toEqual({ id: 'solarized-light', name: 'Solarized Light', scheme: 'light' });
  });

  it('is required: useTheme outside a provider throws instead of answering with a silent default', () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => renderHook(() => useTheme())).toThrow('useTheme must be used inside a ThemeProvider');
  });
});

describe('the document root', () => {
  it('is never given a style or a custom property, whatever the theme, density or text size', () => {
    const setProperty = vi.spyOn(CSSStyleDeclaration.prototype, 'setProperty');
    const changed = new Set<string | null>();
    const observer = new MutationObserver(() => undefined);
    observer.observe(root, { attributes: true });

    const view = render(<ThemeProvider />);
    for (const theme of THEMES) {
      for (const density of ['comfortable', 'compact'] as const) {
        for (const textSize of ['80', '90', '100', '110', '125'] as const) {
          act(() => {
            view.rerender(<ThemeProvider themeId={theme.id} density={density} textSize={textSize} />); 
          });
          expect(root.getAttribute('style')).toBeNull();
          expect(root.style.length).toBe(0);
        }
      }
    }

    view.unmount();
    for (const record of observer.takeRecords()) {
      changed.add(record.attributeName);
    }

    observer.disconnect();

    expect(setProperty).not.toHaveBeenCalled();
    expect([...changed].sort()).toEqual(['data-ov-density', 'data-ov-text-size', 'data-ov-theme']);
  });
});
