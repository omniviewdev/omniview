import { MenuHost } from '@omniviewdev/kit';
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { App } from './App';

// The whole screen, with the page of parts under the controls drawn for real. The tests that are only about the controls and the theme engine are in
// `App.appearance.test.tsx`, which draws the App without that page: the page is 5,500 nodes, and every lookup in it is dear (docs/ui-next/status/FM2a-fix.md).

const root = document.documentElement;
const renderApp = () => render(<MenuHost><App /></MenuHost>);

afterEach(() => {
  cleanup();
});

describe('ui-next App', () => {
  it('renders the single ui-next screen', () => {
    renderApp();

    expect(screen.getByRole('heading', { level: 1, name: 'Omniview ui-next' })).toBeInTheDocument();
  });

  it('draws its three controls with the kit Button and shows the parts examples under them', () => {
    renderApp();

    for (const name of ['Next theme', 'Next density', 'Next text size']) {
      expect(screen.getByRole('button', { name })).toHaveProperty('dataset.ovVariant', 'secondary');
    }

    expect(screen.getByRole('heading', { level: 2, name: 'Parts' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Button' })).toBeInTheDocument();
  });

  it('never writes a style or a custom property on the document root', async () => {
    const user = userEvent.setup();
    renderApp();
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
