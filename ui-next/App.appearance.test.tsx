import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { App } from './App';

// These tests are about the three controls and the theme engine under them, and the page of parts below the controls is not what they prove: the App is
// drawn with that page replaced by nothing (`App.test.tsx` keeps it, for the tests that are about it). The page is 5,500 nodes, and jsdom answers a
// query by walking all of them: one `getByRole('button', { name })` costs 75 ms (it computes the name of each of the page's 380 buttons), nine of them
// 0.7 s, and drawing the page 0.2 s. The walk through the nine themes took 1.9 s on a laptop, 4.2 s at 16 busy loops and 3.8 to 4.5 s on the CI runner,
// against vitest's 5 s, and every part added to the page made it dearer (docs/ui-next/status/FM2a-fix.md). Without the page a lookup costs 2 ms and the
// draw 10 ms, and the controls, the state they flip, the kit's theme provider and the attributes it writes on the document are all the real ones.
vi.mock('./parts/PartsPage', () => ({ PartsPage: () => null }));

const root = document.documentElement;

afterEach(() => {
  cleanup();
});

describe('ui-next App appearance', () => {
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
    // One lookup: the button is the same element through every flip, and a click on one that had gone would not move the theme.
    const nextTheme = screen.getByRole('button', { name: 'Next theme' });
    const seen: Array<string | null> = [root.getAttribute('data-ov-theme')];
    for (let step = 0; step < 9; step += 1) {
      await user.click(nextTheme);
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
});
