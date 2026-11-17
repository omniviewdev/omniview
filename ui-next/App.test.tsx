import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

const root = document.documentElement;

afterEach(() => {
  cleanup();
});

describe('ui-next App', () => {
  it('renders the single ui-next screen', () => {
    render(<App />);

    expect(screen.getByRole('heading', { level: 1, name: 'Omniview ui-next' })).toBeInTheDocument();
  });

  it('applies the default theme, density and text size to the document through the kit', () => {
    render(<App />);

    expect(root.getAttribute('data-ov-theme')).toBe('void');
    expect(root.getAttribute('data-ov-density')).toBe('comfortable');
    expect(root.getAttribute('data-ov-text-size')).toBe('100');
    expect(screen.getByText('Void')).toBeInTheDocument();
  });

  it('flips the theme, density and text size by attribute, and the screen reads them back', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Next theme' }));
    expect(root.getAttribute('data-ov-theme')).toBe('dark');
    expect(screen.getByText('Dark')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next density' }));
    expect(root.getAttribute('data-ov-density')).toBe('compact');
    expect(screen.getByText('compact')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Next text size' }));
    expect(root.getAttribute('data-ov-text-size')).toBe('110');
    expect(screen.getByText('110%')).toBeInTheDocument();
  });

  it('walks every theme and comes back to the first', async () => {
    const user = userEvent.setup();
    render(<App />);
    const seen: Array<string | null> = [root.getAttribute('data-ov-theme')];
    for (let step = 0; step < 9; step += 1) {
      await user.click(screen.getByRole('button', { name: 'Next theme' }));
      seen.push(root.getAttribute('data-ov-theme'));
    }

    expect(seen).toEqual([
      'void',
      'dark',
      'light',
      'obsidian',
      'carbon',
      'solarized-dark',
      'solarized-light',
      'high-contrast-dark',
      'high-contrast-light',
      'void',
    ]);
  });

  it('never writes a style or a custom property on the document root', async () => {
    const user = userEvent.setup();
    render(<App />);
    // The shared test setup paints color-scheme on <html> before any test; what must hold is that the screen adds nothing.
    const before = root.getAttribute('style');
    for (const name of ['Next theme', 'Next density', 'Next text size']) {
      await act(async () => {
        await user.click(screen.getByRole('button', { name }));
      });
      expect(root.getAttribute('style')).toBe(before);
      expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
    }
  });
});
