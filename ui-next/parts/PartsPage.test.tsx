import { cleanup, render, screen, within } from '@testing-library/react';
import { ThemeProvider } from '@omniviewdev/kit';
import { examples } from '@omniviewdev/kit/examples';
import { afterEach, describe, expect, it } from 'vitest';
import { PartsPage } from './PartsPage';

afterEach(() => {
  cleanup();
});

const renderPage = () =>
  render(
    <ThemeProvider>
      <PartsPage />
    </ThemeProvider>,
  );

describe('the parts page', () => {
  it('shows every part of the examples entry under a heading of its own name', () => {
    renderPage();
    expect(screen.getByRole('heading', { level: 2, name: 'Parts' })).toBeInTheDocument();
    const parts = Object.keys(examples);
    expect(parts.length).toBeGreaterThanOrEqual(3);
    for (const part of parts) {
      expect(screen.getByRole('heading', { level: 3, name: part })).toBeInTheDocument();
    }
  });

  it('renders every example of every part once, captioned with its name in words', () => {
    const { container } = renderPage();
    for (const [part, set] of Object.entries(examples)) {
      for (const name of Object.keys(set)) {
        const figure = container.querySelector(`[data-example="${part}/${name}"]`);
        expect(figure, `${part}/${name}`).not.toBeNull();
        expect(figure?.querySelector('figcaption')?.textContent).toBe(name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^(.)(.*)$/, (_match, first: string, rest: string) => first + rest.toLowerCase()));
      }
    }

    const total = Object.values(examples).reduce((sum, set) => sum + Object.keys(set).length, 0);
    expect(container.querySelectorAll('[data-example]')).toHaveLength(total);
  });

  it('shows the Button examples as buttons, each with a name from its own markup', () => {
    const { container } = renderPage();
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(30);
    for (const button of buttons) {
      expect(button.getAttribute('aria-label') ?? button.textContent, button.outerHTML).not.toBe('');
      expect(button.hasAttribute('title')).toBe(false);
    }

    expect(container.querySelector('[title]')).toBeNull();
    const primary = within(container.querySelector('[data-example="Button/Primary"]')!).getByRole('button', { name: 'Create' });
    expect(primary).toHaveProperty('dataset.ovVariant', 'primary');
  });

  it('keeps a reasoned-disabled example focusable and described', () => {
    const { container } = renderPage();
    const example = container.querySelector('[data-example="IconButton/DisabledWithVisibleReason"]')!;
    const button = within(example).getByRole('button', { name: 'Refresh Pods', description: 'Refreshing' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.focus();
    expect(document.activeElement).toBe(button);
    expect(within(example).getAllByText('Refreshing').length).toBeGreaterThanOrEqual(1);
  });

  it('never writes a style or a custom property on the document root', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    renderPage();
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});
