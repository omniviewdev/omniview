import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { render, screen, within } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { rootWrites } from '../../../scripts/rootWrites.ts';
import { ListRows, type ListRowsProps } from './ListRows';
import * as examples from './ListRows.examples';

const count = (element: ReactElement) => {
  const { container, unmount } = render(element);
  const total = container.querySelectorAll('*').length;
  unmount();
  return total;
};

describe('ListRows', () => {
  it('is a native ul named by its label, with one li per row in the order given', () => {
    const { container } = render(
      <ListRows
        label="Recent warnings"
        rows={[
          { id: 'a', title: 'FailedScheduling' },
          { id: 'b', title: 'BackOff' },
        ]}
      />,
    );
    const list = screen.getByRole('list', { name: 'Recent warnings' });
    expect(list).toBe(container.firstElementChild);
    expect(list.tagName).toBe('UL');
    expect(list).toHaveProperty('dataset.ovPart', 'list-rows');
    expect([...list.children].map((row) => row.tagName)).toEqual(['LI', 'LI']);
    expect(screen.getAllByRole('listitem').map((row) => row.textContent)).toEqual(['FailedScheduling', 'BackOff']);
    for (const row of list.children) {
      expect(row).toHaveProperty('dataset.ovPart', 'list-row');
    }
  });

  it('renders nothing for no rows', () => {
    const { container } = render(<ListRows label="Recent warnings" rows={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('draws a title alone as a title inside the text box, and no detail, meta or icon', () => {
    const { container } = render(<ListRows label="Groups" rows={[{ id: 'a', title: 'checkout' }]} />);
    const row = container.querySelector('li') as HTMLElement;
    expect([...row.children].map((child) => child.getAttribute('data-ov-part'))).toEqual(['text']);
    const text = row.firstElementChild as HTMLElement;
    expect([...text.children].map((child) => child.getAttribute('data-ov-part'))).toEqual(['title']);
    expect(text.textContent).toBe('checkout');
    expect(container.querySelector('ul')?.hasAttribute('data-ov-icon')).toBe(false);
    expect(container.querySelector('ul')?.hasAttribute('data-ov-meta')).toBe(false);
  });

  it('draws the cells in the order icon, text (title over detail), meta', () => {
    const { container } = render(
      <ListRows label="Events" rows={[{ id: 'a', title: 'Scaled up', detail: 'orders-api from 2 to 3', meta: '2m', icon: <svg aria-hidden="true" /> }]} />,
    );
    const row = container.querySelector('li') as HTMLElement;
    expect([...row.children].map((child) => child.getAttribute('data-ov-part'))).toEqual(['icon', 'text', 'meta']);
    const text = row.querySelector('[data-ov-part="text"]')!;
    expect([...text.children].map((child) => `${child.getAttribute('data-ov-part') ?? ''}:${child.textContent ?? ''}`)).toEqual(['title:Scaled up', 'detail:orders-api from 2 to 3']);
    expect(row.querySelector('[data-ov-part="meta"]')?.textContent).toBe('2m');
  });

  it('marks the text that may be cut for the shared tip host: the title and the detail', () => {
    const { container } = render(<ListRows label="Events" rows={[{ id: 'a', title: 'Scaled up', detail: 'orders-api', meta: '2m' }]} />);
    expect(container.querySelector('[data-ov-part="title"]')?.hasAttribute('data-ov-clip')).toBe(true);
    expect(container.querySelector('[data-ov-part="detail"]')?.hasAttribute('data-ov-clip')).toBe(true);
    expect(container.querySelector('[data-ov-part="meta"]')?.hasAttribute('data-ov-clip')).toBe(false);
  });

  it('says on the list which columns some row uses, so every row shares them', () => {
    const { container, rerender } = render(
      <ListRows
        label="Events"
        rows={[
          { id: 'a', title: 'one', icon: <svg aria-hidden="true" /> },
          { id: 'b', title: 'two' },
        ]}
      />,
    );
    const list = container.querySelector('ul') as HTMLElement;
    expect(list).toHaveProperty('dataset.ovIcon', 'true');
    expect(list.hasAttribute('data-ov-meta')).toBe(false);
    rerender(
      <ListRows
        label="Events"
        rows={[
          { id: 'a', title: 'one' },
          { id: 'b', title: 'two', meta: '3d' },
        ]}
      />,
    );
    expect(list.hasAttribute('data-ov-icon')).toBe(false);
    expect(list).toHaveProperty('dataset.ovMeta', 'true');
    // a row without the cell draws none: the column is the list's
    expect(list.firstElementChild?.querySelector('[data-ov-part="meta"]')).toBeNull();
  });

  it('draws nothing for an empty detail, meta or icon: absent, null, false or an empty string', () => {
    const { container } = render(
      <ListRows
        label="Events"
        rows={[
          { id: 'a', title: 'one', detail: '', meta: null, icon: false },
          { id: 'b', title: 'two', detail: undefined, meta: '', icon: null },
        ]}
      />,
    );
    for (const part of ['detail', 'meta', 'icon']) {
      expect(container.querySelector(`[data-ov-part="${part}"]`), part).toBeNull();
    }

    expect(container.querySelector('ul')?.hasAttribute('data-ov-icon')).toBe(false);
    expect(container.querySelector('ul')?.hasAttribute('data-ov-meta')).toBe(false);
  });

  it('prints zero: a count of zero is a value', () => {
    const { container } = render(<ListRows label="Groups" rows={[{ id: 'a', title: 'checkout', meta: 0 }]} />);
    expect(container.querySelector('[data-ov-part="meta"]')?.textContent).toBe('0');
  });

  it('draws what it is given as it is given: a link in a title stays the caller\'s, and is the row\'s only control', () => {
    render(<ListRows label="Owners" rows={[{ id: 'a', title: <a href="#/x">north-yard</a>, detail: 'Platform' }]} />);
    const link = screen.getByRole('link', { name: 'north-yard' });
    expect(link.closest('[data-ov-part="title"]')).not.toBeNull();
    expect(screen.queryAllByRole('button')).toHaveLength(0);
    expect(link.tabIndex).toBe(0);
  });

  it('keeps a row by its id: reordering rows moves their nodes, it does not recreate them', () => {
    const { container, rerender } = render(
      <ListRows
        label="Events"
        rows={[
          { id: 'a', title: 'one' },
          { id: 'b', title: 'two' },
        ]}
      />,
    );
    const [first, second] = [...container.querySelectorAll('li')];
    rerender(
      <ListRows
        label="Events"
        rows={[
          { id: 'b', title: 'two' },
          { id: 'a', title: 'one' },
        ]}
      />,
    );
    expect([...container.querySelectorAll('li')]).toEqual([second, first]);
  });

  it('has the elements it says: a ul, and per row an li and a text box with its title; a detail, a meta and an icon add one each', () => {
    expect(count(<ListRows label="Groups" rows={[{ id: 'a', title: 'checkout' }]} />)).toBe(1 + 3);
    expect(count(<ListRows label="Groups" rows={[{ id: 'a', title: 'checkout' }, { id: 'b', title: 'orders' }]} />)).toBe(1 + 3 * 2);
    expect(count(<ListRows label="Groups" rows={[{ id: 'a', title: 'checkout', detail: 'x' }]} />)).toBe(1 + 4);
    expect(count(<ListRows label="Groups" rows={[{ id: 'a', title: 'checkout', meta: 'x' }]} />)).toBe(1 + 4);
    expect(count(<ListRows label="Groups" rows={[{ id: 'a', title: 'checkout', icon: 'x' }]} />)).toBe(1 + 4);
    expect(count(<ListRows label="Groups" rows={[{ id: 'a', title: 'checkout', detail: 'x', meta: 'x', icon: 'x' }]} />)).toBe(1 + 6);
  });

  it('has no tab stop, no button and no title of its own: a row is text', () => {
    const { container } = render(<ListRows label="Events" rows={[{ id: 'a', title: 'one', detail: 'two', meta: '3d' }]} />);
    for (const element of container.querySelectorAll('*')) {
      for (const attribute of ['tabindex', 'title', 'style', 'aria-pressed', 'aria-current', 'href']) {
        expect(element.hasAttribute(attribute), `${element.tagName} ${attribute}`).toBe(false);
      }
    }

    expect(within(container).queryAllByRole('button')).toHaveLength(0);
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = ListRows as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { label: 'Events', rows: [{ id: 'a', title: 'one' }], 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, id: 'x', title: 'hint' };
    render(<Loose {...loose} />);
    const list = screen.getByTestId('probe');
    expect(list.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'title']) {
      expect(list.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('has closed props: no className, no style, no title, a named list of rows that each have an id and a title', () => {
    // Types only: these are never rendered.
    const accepted: ListRowsProps[] = [
      { label: 'Events', rows: [] },
      { label: 'Events', rows: [{ id: 'a', title: 'one' }, { id: 'b', title: <b>two</b>, detail: <i>x</i>, meta: 3, icon: <svg /> }] },
      { label: 'Events', rows: [{ id: 'a', title: 'one', detail: undefined, meta: undefined, icon: undefined }] },
    ];
    // @ts-expect-error className is not a prop of a kit part
    const withClass: ListRowsProps = { label: 'Events', rows: [], className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: ListRowsProps = { label: 'Events', rows: [], style: { color: 'red' } };
    // @ts-expect-error a title is not a prop: a tooltip is the shared host's
    const withTitle: ListRowsProps = { label: 'Events', rows: [], title: 'hint' };
    // @ts-expect-error a list is named
    const unnamed: ListRowsProps = { rows: [] };
    // @ts-expect-error a row has an id, which is its key
    const noId: ListRowsProps = { label: 'Events', rows: [{ title: 'one' }] };
    // @ts-expect-error a row has a title
    const noTitle: ListRowsProps = { label: 'Events', rows: [{ id: 'a' }] };
    // @ts-expect-error a row is not a control: it takes no command
    const withCommand: ListRowsProps = { label: 'Events', rows: [{ id: 'a', title: 'one', onSelect: () => undefined }] };
    expect([accepted, withClass, withStyle, withTitle, unnamed, noId, noTitle, withCommand]).toHaveLength(8);
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const writes = rootWrites(() => {
      const { rerender } = render(<ListRows label="Events" rows={[{ id: 'a', title: 'one' }]} />);
      rerender(<ListRows label="Events" rows={[{ id: 'a', title: 'one', meta: '3d', icon: 'x' }]} />);
    });
    expect(writes).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a ListRows is shown in.
type Cells = { readonly title: string; readonly detail?: string; readonly meta?: string };
type Row = {
  /** The list's name. */
  readonly label: string;
  /** The text of each row's title, detail and meta, in order. */
  readonly rows: readonly Cells[];
  /** The columns the list says it has. */
  readonly icon: boolean;
  readonly meta: boolean;
  /** The names of the links: the only Tab stops of a list of rows. */
  readonly links?: readonly string[];
};

const WARNINGS: readonly Cells[] = [
  { title: 'FailedScheduling', detail: 'Container orders-api: readiness probe failed: connection refused', meta: '2m' },
  { title: 'BackOff', detail: 'Back-off restarting failed container', meta: '11m' },
  { title: 'Unhealthy', detail: 'Liveness probe failed: HTTP 503', meta: '3d' },
];

const MATRIX: Readonly<Record<string, Row>> = {
  TitleOnly: { label: 'Groups', rows: [{ title: 'checkout' }, { title: 'north-yard' }], icon: false, meta: false },
  TitleAndDetail: {
    label: 'Releases',
    rows: [
      { title: 'orders-api', detail: 'Rolled out 3 days ago' },
      { title: 'orders-worker', detail: 'Rolled out 5 days ago' },
    ],
    icon: false,
    meta: false,
  },
  WithMeta: { label: 'Releases', rows: [{ title: 'orders-api', meta: '3d' }, { title: 'orders-worker', meta: '12d' }, { title: 'inventory-sync' }], icon: false, meta: true },
  WithIcon: { label: 'Checks', rows: [{ title: 'Readiness' }, { title: 'Liveness' }, { title: 'Startup' }], icon: true, meta: false },
  WithStatus: { label: 'Checks', rows: [{ title: 'Readiness' }, { title: 'Liveness' }], icon: true, meta: false },
  AllFour: {
    label: 'Recent events',
    rows: [
      { title: 'Scaled up', detail: 'orders-api from 2 to 3 replicas', meta: '2m' },
      { title: 'Restarted', detail: 'orders-api in north-yard', meta: '1h' },
    ],
    icon: true,
    meta: true,
  },
  WithLink: {
    label: 'Owners',
    rows: [
      { title: 'north-yard', detail: 'Platform' },
      { title: 'checkout', detail: 'Storefront' },
    ],
    icon: false,
    meta: false,
    links: ['north-yard', 'checkout'],
  },
  LongClipped: {
    label: 'Recent warnings',
    rows: [
      {
        title: 'Readiness probe failed for the orders-api container in the north-yard group',
        detail: 'Container orders-api: readiness probe failed: connection refused while dialling the inventory service on port 8443',
        meta: '2m',
      },
    ],
    icon: true,
    meta: true,
  },
  RecentWarnings: { label: 'Recent warnings', rows: WARNINGS, icon: true, meta: true },
};

describe('ListRows examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: a list "${row.label}" of ${String(row.rows.length)} row${row.rows.length === 1 ? '' : 's'}`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      const { container } = render(<Example />);
      const list = screen.getByRole('list', { name: row.label });
      expect(list.getAttribute('data-ov-part')).toBe('list-rows');
      expect(list.hasAttribute('data-ov-icon')).toBe(row.icon);
      expect(list.hasAttribute('data-ov-meta')).toBe(row.meta);

      const items = screen.getAllByRole('listitem');
      expect(
        items.map((item) => {
          const text = (part: string) => item.querySelector(`[data-ov-part="${part}"]`)?.textContent ?? undefined;
          return { title: text('title'), ...(text('detail') === undefined ? {} : { detail: text('detail') }), ...(text('meta') === undefined ? {} : { meta: text('meta') }) };
        }),
      ).toEqual(row.rows);

      // a row is text: the links in the titles are the only Tab stops, and a native anchor is one
      const stops = [...list.querySelectorAll('a[href], button, [tabindex]')];
      expect(stops.map((stop) => stop.textContent)).toEqual([...(row.links ?? [])]);
      for (const stop of stops) {
        expect(stop.getAttribute('tabindex') ?? '0').toBe('0');
      }

      // glyphs are decorative or named by what they are; no title attribute anywhere
      for (const svg of container.querySelectorAll('svg')) {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      }

      expect(container.querySelector('[title]')).toBeNull();
    });
  }

  it('shows a status in the glyph cell as its glyph and its word', () => {
    render(<examples.WithStatus />);
    expect(screen.getByText('Passed').closest('[data-ov-part="icon"]')?.querySelector('svg')).not.toBeNull();
  });
});

// The stylesheet, as the rules it holds: jsdom lays nothing out, so what the stylesheet must say is asserted here and what a browser
// paints from it is probed in WebKit and Chromium against the mock (packages/kit/probes).
const css = await readFile(path.join(import.meta.dirname, 'ListRows.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the ListRows stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('names no grid line: a CSS Module scopes the names, so the lines are numbered', () => {
    expect(css).not.toMatch(/\[[a-z-]+(?: [a-z-]+)*\]/);
  });

  it('is a grid with the mock\'s tracks: a 4 px edge, the text, a 4 px edge, 8 px apart, with no bullets', () => {
    expect(rule('.root')).toMatchObject({
      display: 'grid',
      'grid-template-columns': '4px minmax(64px, 1fr) 4px',
      'column-gap': 'var(--ov-spacing-8)',
      'min-width': '0',
      margin: '0',
      padding: '0',
      'list-style': 'none',
      'font-family': 'var(--ov-font-ui)',
      'font-feature-settings': 'var(--ov-font-features)',
    });
  });

  it('adds the glyph track only when some row has a glyph, and the meta track only when some row has a meta, up to a third of the line', () => {
    expect(rule('.root[data-ov-icon=\'true\']')['grid-template-columns']).toBe('4px auto minmax(64px, 1fr) 4px');
    expect(rule('.root[data-ov-meta=\'true\']')['grid-template-columns']).toBe('4px minmax(64px, 1fr) fit-content(33%) 4px');
    expect(rule('.root[data-ov-icon=\'true\'][data-ov-meta=\'true\']')['grid-template-columns']).toBe('4px auto minmax(64px, 1fr) fit-content(33%) 4px');
  });

  it('numbers the line of each cell by the columns the list has', () => {
    expect(rule('.root')).toMatchObject({ '--_icon': '2', '--_text': '2', '--_meta': '3' });
    expect(rule('.root[data-ov-icon=\'true\']')).toMatchObject({ '--_text': '3', '--_meta': '4' });
    expect(rule('.icon')['grid-column']).toBe('var(--_icon)');
    expect(rule('.text')['grid-column']).toBe('var(--_text)');
    expect(rule('.meta')['grid-column']).toBe('var(--_meta)');
  });

  it('makes a row a subgrid over every column, 24 px at the least with the density padding above and below', () => {
    expect(rule('.row')).toMatchObject({
      display: 'grid',
      'grid-column': '1 / -1',
      'grid-template-columns': 'subgrid',
      'align-items': 'center',
      'min-height': 'var(--ov-row-height)',
      padding: 'var(--ov-row-pad) 0',
      'box-sizing': 'border-box',
    });
    // the rows take the list's column gap: a subgrid with a gap of its own would move every cell
    expect(rule('.row')['column-gap']).toBeUndefined();
  });

  it('draws the glyph in the icon role, centred in its track', () => {
    expect(rule('.icon')).toMatchObject({ display: 'flex', 'align-items': 'center', 'justify-content': 'center', color: 'var(--ov-icon)' });
  });

  it('stacks the title over the detail in a box that clips, each on one line with an ellipsis', () => {
    expect(rule('.text')).toMatchObject({ display: 'flex', 'flex-direction': 'column', 'min-width': '0', overflow: 'hidden', 'white-space': 'nowrap' });
    expect(rule('.title')).toMatchObject({ 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' });
    expect(rule('.detail')).toMatchObject({ overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' });
  });

  it('draws the detail muted at 12/16', () => {
    expect(rule('.detail')).toMatchObject({ color: 'var(--ov-fg-muted)', 'font-size': 'var(--ov-fs-12)', 'line-height': 'var(--ov-lh-16)' });
  });

  it('draws the meta muted, at the end of its track, clipped to it, with the text size of the row', () => {
    expect(rule('.meta')).toMatchObject({ display: 'flex', 'align-items': 'center', 'justify-self': 'end', gap: 'var(--ov-spacing-8)', 'min-width': '0', 'max-width': '100%', overflow: 'hidden', color: 'var(--ov-fg-muted)' });
    expect(rule('.meta')['font-size']).toBeUndefined();
  });

  it('is not a control: no pointer, no hover, no focus rule, no fill', () => {
    expect(css).not.toMatch(/cursor|outline|:hover|:focus|background/);
  });
});
