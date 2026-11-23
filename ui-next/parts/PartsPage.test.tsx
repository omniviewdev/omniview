import { cleanup, render, screen, within } from '@testing-library/react/pure';
import { MenuHost, ThemeProvider } from '@omniviewdev/kit';
import { examples } from '@omniviewdev/kit/examples';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PartsPage } from './PartsPage';

/** The name of an example in words, as the page captions it: `WithIconDisabled` is "With icon disabled". */
const inWords = (name: string) => name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^(.)(.*)$/, (_match, first: string, rest: string) => first + rest.toLowerCase());

const parts = Object.entries(examples);

// The page is drawn ONCE for the whole file, and every test reads what was drawn. It is about 5,500 nodes, and jsdom answers a query by walking all of
// them: a lookup costs 5 ms to 30 ms, whatever it asks for. The tests used to draw the page five times and look each part and each example up with a query
// of its own (35 `getByRole` calls and 293 `querySelector` calls): parts and examples times nodes, 0.9 s and 1.6 s on a laptop, 2.6 s to 3.5 s on the CI
// runner and 5.5 s at its worst, where the test that did it timed out at vitest's 5 s twice on 2026-11-21 (docs/ui-next/status/FM2a-fix.md). Every part
// and example added makes it dearer, so the page is read once (one pass over its figures into a map, one query for its headings) and a test looks its
// part up in what was read. `/pure` registers no cleanup after each test: `afterAll` takes the page away. The one test that acts on the page, the
// focus test, puts the focus back.
let page: HTMLElement;
let rootStyleBefore: string | null;
const figures = new Map<string, Element[]>();

beforeAll(() => {
  rootStyleBefore = document.documentElement.getAttribute('style');
  ({ container: page } = render(
    <ThemeProvider>
      <MenuHost>
        <PartsPage />
      </MenuHost>
    </ThemeProvider>,
  ));
  for (const figure of page.querySelectorAll('[data-example]')) {
    const id = figure.getAttribute('data-example') ?? '';
    figures.set(id, [...(figures.get(id) ?? []), figure]);
  }
});

afterAll(() => {
  cleanup();
});

describe('the parts page', () => {
  it('shows every part of the examples entry under a heading of its own name', () => {
    expect(screen.getByRole('heading', { level: 2, name: 'Parts' })).toBeInTheDocument();
    expect(parts.length).toBeGreaterThanOrEqual(3);
    // The page's own headings, not the ones an example draws for itself: one query, each part exactly once, whatever the order.
    const headings = screen.getAllByRole('heading', { level: 3 }).filter((heading) => heading.closest('[data-example]') === null);
    expect(headings.map((heading) => heading.textContent).sort()).toEqual(parts.map(([part]) => part).sort());
  });

  it.each(parts)('renders every example of %s once, captioned with its name in words', (part, set) => {
    for (const name of Object.keys(set)) {
      const id = `${part}/${name}`;
      const found = figures.get(id) ?? [];
      expect(found, id).toHaveLength(1);
      expect(found[0]?.querySelector('figcaption')?.textContent, id).toBe(inWords(name));
    }
  });

  it('renders no example that the examples entry does not have', () => {
    const known = new Set(parts.flatMap(([part, set]) => Object.keys(set).map((name) => `${part}/${name}`)));
    expect([...figures.keys()].filter((id) => !known.has(id))).toEqual([]);
  });

  it('shows the Button examples as buttons, each with a name from its own markup', () => {
    const buttons = screen.getAllByRole('button');
    expect(buttons.length).toBeGreaterThan(30);
    for (const button of buttons) {
      expect(button.getAttribute('aria-label') ?? button.textContent, button.outerHTML).not.toBe('');
      expect(button.hasAttribute('title')).toBe(false);
    }

    expect(page.querySelector('[title]')).toBeNull();
    const primary = within(page.querySelector<HTMLElement>('[data-example="Button/Primary"]')!).getByRole('button', { name: 'Create' });
    expect(primary).toHaveProperty('dataset.ovVariant', 'primary');
  });

  it('keeps a reasoned-disabled example focusable and described', () => {
    const example = page.querySelector<HTMLElement>('[data-example="IconButton/DisabledWithVisibleReason"]')!;
    const button = within(example).getByRole('button', { name: 'Refresh items', description: 'Refreshing' });
    expect(button.getAttribute('aria-disabled')).toBe('true');
    button.focus();
    try {
      expect(document.activeElement).toBe(button);
      expect(within(example).getAllByText('Refreshing').length).toBeGreaterThanOrEqual(1);
    } finally {
      button.blur();
    }
  });

  it('never writes a style or a custom property on the document root', () => {
    const root = document.documentElement;
    expect(root.getAttribute('style')).toBe(rootStyleBefore);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});
