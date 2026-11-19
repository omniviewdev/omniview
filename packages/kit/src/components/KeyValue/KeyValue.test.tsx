import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { render, screen, within } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { rootWrites } from '../../../scripts/rootWrites.ts';
import { KeyValue, type KeyValueProps } from './KeyValue';
import * as examples from './KeyValue.examples';

const count = (element: ReactElement) => {
  const { container, unmount } = render(element);
  const total = container.querySelectorAll('*').length;
  unmount();
  return total;
};

describe('KeyValue', () => {
  it('is a div that holds a native dl of div > dt + dd, one div per row', () => {
    const { container } = render(
      <KeyValue
        rows={[
          { label: 'Name', value: 'orders-api' },
          { label: 'Group', value: 'checkout' },
        ]}
      />,
    );
    const root = container.firstElementChild as HTMLElement;
    expect(root.tagName).toBe('DIV');
    expect(root).toHaveProperty('dataset.ovPart', 'key-value');
    expect(root.children).toHaveLength(1);
    const list = root.firstElementChild as HTMLElement;
    expect(list.tagName).toBe('DL');
    expect([...list.children].map((row) => row.tagName)).toEqual(['DIV', 'DIV']);
    for (const row of list.children) {
      expect(row).toHaveProperty('dataset.ovPart', 'row');
      expect([...row.children].map((child) => child.tagName)).toEqual(['DT', 'DD']);
      expect(row.children[0]).toHaveProperty('dataset.ovPart', 'label');
      expect(row.children[1]).toHaveProperty('dataset.ovPart', 'value');
    }

    expect([...list.querySelectorAll('dt')].map((term) => term.textContent)).toEqual(['Name', 'Group']);
    expect([...list.querySelectorAll('dd')].map((value) => value.textContent)).toEqual(['orders-api', 'checkout']);
  });

  it('renders nothing for no rows', () => {
    const { container } = render(<KeyValue rows={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('has one column and a 130 px label track unless it is told otherwise, and says so in data attributes the stylesheet reads', () => {
    const { container, rerender } = render(<KeyValue rows={[{ label: 'Name', value: 'orders-api' }]} />);
    const root = container.firstElementChild as HTMLElement;
    expect(root).toHaveProperty('dataset.ovColumns', '1');
    expect(root).toHaveProperty('dataset.ovLabelWidth', '130');
    rerender(<KeyValue columns={3} labelWidth={160} rows={[{ label: 'Name', value: 'orders-api' }]} />);
    expect(root).toHaveProperty('dataset.ovColumns', '3');
    expect(root).toHaveProperty('dataset.ovLabelWidth', '160');
    rerender(<KeyValue columns={2} labelWidth={96} rows={[{ label: 'Name', value: 'orders-api' }]} />);
    expect(root).toHaveProperty('dataset.ovColumns', '2');
    expect(root).toHaveProperty('dataset.ovLabelWidth', '96');
  });

  it('draws a missing value as the dash, named "No <label in lower case>": absent, null and an empty string', () => {
    render(
      <KeyValue
        rows={[
          { label: 'Owner' },
          { label: 'Selector', value: null },
          { label: 'Description', value: '' },
          { label: 'Name', value: 'orders-api' },
        ]}
      />,
    );
    expect(screen.getAllByRole('img').map((dash) => dash.getAttribute('aria-label'))).toEqual(['No owner', 'No selector', 'No description']);
    for (const dash of screen.getAllByRole('img')) {
      expect(dash.textContent).toBe('—');
    }
  });

  it('prints zero: zero is a value, not a missing one', () => {
    render(<KeyValue rows={[{ label: 'Minimum ready seconds', value: 0 }]} />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(screen.getByText('0').closest('dd')).not.toBeNull();
  });

  it('draws a value as given: an element reaches the dd whole', () => {
    render(<KeyValue rows={[{ label: 'State', value: <a href="#/x">orders-api</a> }]} />);
    const value = screen.getByRole('link', { name: 'orders-api' });
    expect(value.closest('dd')).not.toBeNull();
    expect(value.closest('dd')?.children).toHaveLength(1);
  });

  it('puts a code value in a span of its own, and a plain value straight in the dd', () => {
    const { container } = render(
      <KeyValue
        rows={[
          { label: 'Selector', value: 'app=orders-api', mono: true },
          { label: 'Name', value: 'orders-api' },
        ]}
      />,
    );
    const [code, plain] = [...container.querySelectorAll('dd')];
    expect(code?.children).toHaveLength(1);
    expect(code?.firstElementChild?.tagName).toBe('SPAN');
    expect(code?.firstElementChild?.textContent).toBe('app=orders-api');
    expect(plain?.children).toHaveLength(0);
  });

  it('marks a wide row and no other', () => {
    const { container } = render(
      <KeyValue
        columns={2}
        rows={[
          { label: 'Name', value: 'orders-api' },
          { label: 'Description', value: 'Receives orders.', wide: true },
          { label: 'Owner', value: 'north-yard', wide: false },
        ]}
      />,
    );
    const rows = [...container.querySelectorAll('[data-ov-part="row"]')];
    expect(rows.map((row) => row.hasAttribute('data-ov-wide'))).toEqual([false, true, false]);
  });

  it('has the elements it says: a root, a dl, and a row, a dt and a dd for each row', () => {
    expect(count(<KeyValue rows={[{ label: 'Name', value: 'orders-api' }]} />)).toBe(5);
    expect(
      count(
        <KeyValue
          columns={2}
          rows={[
            { label: 'Name', value: 'orders-api' },
            { label: 'Group', value: 'checkout' },
          ]}
        />,
      ),
    ).toBe(8);
    // a code value adds its span; a missing value adds its dash
    expect(count(<KeyValue rows={[{ label: 'Name', value: 'orders-api', mono: true }]} />)).toBe(6);
    expect(count(<KeyValue rows={[{ label: 'Name' }]} />)).toBe(6);
  });

  it('has no tab stop of its own and no role beyond the list', () => {
    const { container } = render(<KeyValue rows={[{ label: 'Name', value: 'orders-api' }]} />);
    for (const element of container.querySelectorAll('*')) {
      for (const attribute of ['tabindex', 'role', 'title', 'style', 'aria-label']) {
        expect(element.hasAttribute(attribute), `${element.tagName} ${attribute}`).toBe(false);
      }
    }
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = KeyValue as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { rows: [{ label: 'Name', value: 'orders-api' }], 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, id: 'x', title: 'hint', role: 'table' };
    render(<Loose {...loose} />);
    const root = screen.getByTestId('probe');
    expect(root.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'title', 'role']) {
      expect(root.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('has closed props: no className, no style, a column count and a label track of the closed sets', () => {
    // Types only: these are never rendered.
    const accepted: KeyValueProps[] = [
      { rows: [] },
      { rows: [{ label: 'Name', value: 'orders-api' }], columns: 3, labelWidth: 96 },
      { rows: [{ label: 'Name', value: <b>x</b>, mono: true, wide: true }], columns: undefined, labelWidth: undefined },
    ];
    // @ts-expect-error className is not a prop of a kit part
    const withClass: KeyValueProps = { rows: [], className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: KeyValueProps = { rows: [], style: { color: 'red' } };
    // @ts-expect-error two or three columns, or one
    const fourColumns: KeyValueProps = { rows: [], columns: 4 };
    // @ts-expect-error a label track of the closed set
    const oddTrack: KeyValueProps = { rows: [], labelWidth: 100 };
    // @ts-expect-error a row's label is text
    const elementLabel: KeyValueProps = { rows: [{ label: <b>Name</b> }] };
    // @ts-expect-error a title is not a prop: a tooltip is the shared host's
    const withTitle: KeyValueProps = { rows: [], title: 'hint' };
    expect([accepted, withClass, withStyle, fourColumns, oddTrack, elementLabel, withTitle]).toHaveLength(7);
  });

  describe('the identity of a row', () => {
    const buttons = (labels: readonly string[]): KeyValueProps['rows'] => labels.map((label) => ({ label, value: <button type="button">{`open ${label}`}</button> }));

    it('is kept when a row before it is removed or the rows change place: the subtree and the focus in it stay', () => {
      const { rerender } = render(<KeyValue rows={buttons(['Name', 'Owner', 'Group'])} />);
      const owner = screen.getByRole('button', { name: 'open Owner' });
      owner.focus();

      rerender(<KeyValue rows={buttons(['Owner', 'Group'])} />);
      expect(screen.getByRole('button', { name: 'open Owner' })).toBe(owner);
      expect(document.activeElement).toBe(owner);

      rerender(<KeyValue rows={buttons(['Group', 'Owner'])} />);
      expect(screen.getByRole('button', { name: 'open Owner' })).toBe(owner);
    });

    it('is the row\'s id when it has one, so a row keeps its subtree while its label changes', () => {
      const row = (label: string): KeyValueProps['rows'] => [{ id: 'owner', label, value: <button type="button">open</button> }];
      const { rerender } = render(<KeyValue rows={row('Owner')} />);
      const open = screen.getByRole('button', { name: 'open' });

      rerender(<KeyValue rows={row('Maintainer')} />);
      expect(screen.getByRole('button', { name: 'open' })).toBe(open);
      expect(screen.getByText('Maintainer')).toBeDefined();
    });

    it('tells two rows of one label apart by their place among the rows of that label, and keeps both when a row before them goes', () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      try {
        const rows = (pairs: ReadonlyArray<readonly [string, string]>): KeyValueProps['rows'] => pairs.map(([label, tag]) => ({ label, value: <button type="button">{tag}</button> }));
        const { rerender } = render(<KeyValue rows={rows([['Name', 'n'], ['Port', 'p1'], ['Port', 'p2']])} />);
        const first = screen.getByRole('button', { name: 'p1' });
        const second = screen.getByRole('button', { name: 'p2' });

        rerender(<KeyValue rows={rows([['Port', 'p1'], ['Port', 'p2']])} />);
        expect(screen.getByRole('button', { name: 'p1' })).toBe(first);
        expect(screen.getByRole('button', { name: 'p2' })).toBe(second);
        // React says so on the console when two children of a list share a key.
        expect(spy).not.toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
    });
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const writes = rootWrites(() => {
      const { rerender } = render(<KeyValue rows={[{ label: 'Name', value: 'orders-api' }]} />);
      rerender(<KeyValue columns={2} rows={[{ label: 'Name' }]} />);
    });
    expect(writes).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a KeyValue is shown in.
type Row = {
  /** The labels, in order: the terms of the list. */
  readonly labels: readonly string[];
  readonly columns: '1' | '2' | '3';
  readonly labelWidth?: '96' | '130' | '160';
  /** The names of the dashes (images) of the missing values. */
  readonly missing?: readonly string[];
  /** The names of the links: each one is a Tab stop. */
  readonly links?: readonly string[];
  /** How many rows are wide, and how many values are in the code face. */
  readonly wide?: number;
  readonly code?: number;
  /** The visible text of the values, in order. */
  readonly values: readonly string[];
};

const DETAILS = ['Name', 'Group', 'Created', 'Replicas', 'Strategy', 'Selector', 'Image', 'Owner'];
const DETAIL_VALUES = ['orders-api', 'checkout', '2026-11-13 09:42', '3 desired, 3 ready', 'Rolling update', 'app=orders-api', 'registry.example.io/orders-api:1.8.2', 'north-yard'];

const MATRIX: Readonly<Record<string, Row>> = {
  OneColumn: { labels: ['Name', 'Group', 'Created'], columns: '1', values: ['orders-api', 'checkout', '2026-11-13 09:42'] },
  TwoColumns: { labels: DETAILS, columns: '2', code: 2, values: DETAIL_VALUES },
  ThreeColumns: { labels: DETAILS, columns: '3', code: 2, values: DETAIL_VALUES },
  LabelWidth96: { labels: ['Name', 'Group'], columns: '1', labelWidth: '96', values: ['orders-api', 'checkout'] },
  LabelWidth160: { labels: ['Minimum ready seconds', 'Revision history limit'], columns: '1', labelWidth: '160', values: ['0', '10'] },
  WideRow: {
    labels: ['Name', 'Group', 'Description', 'Owner'],
    columns: '2',
    wide: 1,
    values: ['orders-api', 'checkout', 'Receives orders from the storefront, checks stock with the inventory service and hands paid orders to fulfilment.', 'north-yard'],
  },
  MissingValues: { labels: ['Name', 'Owner', 'Selector', 'Description'], columns: '1', missing: ['No owner', 'No selector', 'No description'], values: ['orders-api', '—', '—', '—'] },
  StatusValue: { labels: ['Name', 'State', 'Health'], columns: '1', values: ['orders-api', 'Running', 'Available'] },
  LinkValue: { labels: ['Name', 'Group', 'Owner'], columns: '1', links: ['checkout', 'north-yard'], values: ['orders-api', 'checkout', 'north-yard'] },
  CodeValue: { labels: ['Identifier', 'Selector'], columns: '1', code: 2, values: ['i-02048ad7d2f67a78c', 'app=orders-api,tier=backend'] },
  LongValueWrapping: {
    labels: ['Description', 'Image'],
    columns: '1',
    code: 1,
    values: ['Receives orders from the storefront, checks stock with the inventory service and hands paid orders to fulfilment, one line at a time.', 'registry.example.io/platform/orders-api/orders-api-worker:1.8.2-rc1-with-a-very-long-tag'],
  },
  CutValue: { labels: ['Name', 'Instance'], columns: '1', values: ['orders-api', 'orders-api-report-renderer-7d8c6f49b-7x5nx'] },
  NarrowBox: { labels: DETAILS.slice(0, 5), columns: '2', labelWidth: '96', values: DETAIL_VALUES.slice(0, 5) },
};

describe('KeyValue examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: ${String(row.labels.length)} terms in ${row.columns} column${row.columns === '1' ? '' : 's'}`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      const { container } = render(<Example />);
      const part = container.querySelector<HTMLElement>('[data-ov-part="key-value"]')!;
      expect(part).not.toBeNull();
      expect(part.getAttribute('data-ov-columns')).toBe(row.columns);
      expect(part.getAttribute('data-ov-label-width')).toBe(row.labelWidth ?? '130');

      // a description list: every term has its details, and no element is the platform's table or grid in disguise
      const terms = [...part.querySelectorAll('dt')];
      const details = [...part.querySelectorAll('dd')];
      expect(terms.map((term) => term.textContent)).toEqual(row.labels);
      expect(details).toHaveLength(terms.length);
      expect(details.map((value) => value.textContent?.replace(/\s+/g, ' ').trim())).toEqual(row.values);
      expect(part.querySelector('[role]:not([role="img"]):not(a):not(svg)')).toBeNull();

      // the dashes of missing values are named for what is missing
      const dashes = within(part).queryAllByRole('img');
      expect(dashes.map((dash) => dash.getAttribute('aria-label'))).toEqual([...(row.missing ?? [])]);

      // the list is no tab stop; only the links in it are, and a native anchor is one
      const stops = [...part.querySelectorAll('a[href], button, [tabindex]')];
      expect(stops.map((stop) => stop.textContent)).toEqual([...(row.links ?? [])]);
      for (const stop of stops) {
        expect(stop.getAttribute('tabindex') ?? '0').toBe('0');
      }

      expect(part.querySelectorAll('[data-ov-wide]')).toHaveLength(row.wide ?? 0);
      expect(part.querySelectorAll('dd > span:only-child:not([role]):not([data-ov-role]):not([data-ov-clip])')).toHaveLength(row.code ?? 0);
      expect(container.querySelector('[title]')).toBeNull();
      for (const svg of container.querySelectorAll('svg')) {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      }
    });
  }

  it('shows a status value as its glyph and the word, in the dd', () => {
    render(<examples.StatusValue />);
    expect(screen.getByText('Running').closest('dd')?.querySelector('svg')).not.toBeNull();
  });
});

// The stylesheet, as the rules it holds: jsdom lays nothing out, so what the stylesheet must say is asserted here and what a browser
// paints from it is probed in WebKit and Chromium against the mock (packages/kit/probes).
const css = await readFile(path.join(import.meta.dirname, 'KeyValue.module.css'), 'utf8');
// The declarations a selector has in the layer itself, without those a container query adds on top.
const rule = (selector: string) =>
  Object.assign({}, ...cssRules(css).filter((entry) => entry.context.length === 1 && entry.selector.split(/\s*,\s*/).includes(selector)).map((entry) => entry.declarations)) as Record<string, string>;
const within_ = (selector: string, fragment: string) => declarationsOf(css, selector, fragment);

describe('the KeyValue stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('makes the root of a list of many columns the size container its columns answer to, and puts the grid in a descendant', () => {
    expect(rule('.root[data-ov-columns=\'2\']')['container-type']).toBe('inline-size');
    expect(rule('.root[data-ov-columns=\'3\']')['container-type']).toBe('inline-size');
    expect(rule('.root')['min-width']).toBe('0');
    expect(rule('.list').display).toBe('grid');
    expect(rule('.root').display).toBeUndefined();
    expect(rule('.root')['font-family']).toBe('var(--ov-font-ui)');
    expect(rule('.root')['font-feature-settings']).toBe('var(--ov-font-features)');
  });

  it('leaves the root of a one-column list no container: containment would take its width from what it holds, and a card as wide as its content (width: max-content) would lose its facts', () => {
    expect(rule('.root')['container-type']).toBeUndefined();
    expect(rule('.list')['container-type']).toBeUndefined();
  });

  it('is the mock\'s list: one column by default, 24 px between columns and none between rows, no margin', () => {
    expect(rule('.list')).toMatchObject({ 'grid-template-columns': 'minmax(0, 1fr)', gap: '0 var(--ov-spacing-24)', margin: '0', padding: '0' });
    expect(rule('.root[data-ov-columns=\'2\'] .list')['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
    expect(rule('.root[data-ov-columns=\'3\'] .list')['grid-template-columns']).toBe('repeat(3, minmax(0, 1fr))');
  });

  it('has the three label tracks of the mock, 130 px by default', () => {
    expect(rule('.root')['--_label']).toBe('130px');
    for (const width of ['96', '130', '160']) {
      expect(rule(`.root[data-ov-label-width='${width}']`)['--_label']).toBe(`${width}px`);
    }
  });

  it('makes a row a label track and a value 16 px apart, one baseline, the row height tall, with the density padding', () => {
    expect(rule('.row')).toMatchObject({
      display: 'grid',
      'grid-template-columns': 'minmax(0, var(--_label)) minmax(0, 1fr)',
      'column-gap': 'var(--ov-spacing-16)',
      'align-items': 'baseline',
      'min-width': '0',
      'min-height': 'var(--ov-row-height)',
      'padding-block': 'var(--ov-row-pad) calc(var(--ov-row-pad) - 1px)',
      'box-sizing': 'border-box',
    });
  });

  it('lets a wide row span every column', () => {
    expect(rule('.row[data-ov-wide=\'true\']')['grid-column']).toBe('1 / -1');
  });

  it('draws the label as the mock does: muted, 12/16, no margin, breaking only where it must', () => {
    expect(rule('.label')).toMatchObject({
      'min-width': '0',
      margin: '0',
      color: 'var(--ov-fg-muted)',
      'font-size': 'var(--ov-fs-12)',
      'line-height': 'var(--ov-lh-16)',
      'overflow-wrap': 'anywhere',
    });
  });

  it('draws the value as the mock does: 13/16, no margin, breaking only where it must', () => {
    expect(rule('.value')).toMatchObject({ 'min-width': '0', margin: '0', 'font-size': 'var(--ov-fs-13)', 'line-height': 'var(--ov-lh-16)', 'overflow-wrap': 'anywhere' });
  });

  it('draws a code value in the code face at 12/16 without ligatures', () => {
    expect(rule('.code')).toMatchObject({ 'font-family': 'var(--ov-font-code)', 'font-size': 'var(--ov-fs-12)', 'line-height': 'var(--ov-lh-16)', 'font-variant-ligatures': 'none' });
  });

  it('aligns a status to the top of its line, so its word sits on the baseline', () => {
    expect(rule('.value > [data-ov-role]')['vertical-align']).toBe('top');
  });

  it('steps down with the width of the part itself, never the window: three to two below 900 px, two and three to one below 640 px', () => {
    const containers = cssRules(css).filter((entry) => entry.context.some((context) => context.startsWith('@container')));
    expect(cssRules(css).filter((entry) => entry.context.some((context) => context.startsWith('@media')))).toEqual([]);
    expect(containers.map((entry) => [entry.context.at(-1), entry.selector, entry.declarations['grid-template-columns']])).toEqual([
      ['@container (width < 900px)', '.root[data-ov-columns=\'3\'] .list', 'repeat(2, minmax(0, 1fr))'],
      ['@container (width < 640px)', '.root[data-ov-columns=\'2\'] .list, .root[data-ov-columns=\'3\'] .list', 'minmax(0, 1fr)'],
    ]);
    expect(within_('.root[data-ov-columns=\'3\'] .list', 'width < 900px')['grid-template-columns']).toBe('repeat(2, minmax(0, 1fr))');
  });

  it('has no tab stop, no pointer rule and no colour of its own beyond the label and the text', () => {
    expect(css).not.toMatch(/cursor|outline|:hover|:focus/);
    expect(css).not.toMatch(/!important|#[0-9a-fA-F]{3,8}\b/);
  });
});
