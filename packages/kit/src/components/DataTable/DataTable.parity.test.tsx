// What the table does to look like the design mock's table, row 1a.3c (docs/ui-next/status/1a.3c.md). The parity probe
// (packages/kit/probes/table-probe.mjs) reads the pixels in WebKit and Chromium; jsdom has no layout, so what is asserted here is the
// markup that carries the decision and the CSS rule that makes it: each rule names the line of the mock's base.css it answers.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { DataTable } from './DataTable';
import type { DataTableColumn } from './types';

const VIEWPORT = { height: 600, width: 1117 };
const isRegion = (element: HTMLElement) => element.getAttribute('role') === 'region';
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return isRegion(this) ? VIEWPORT.height : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return isRegion(this) ? VIEWPORT.width : 0;
} });

type Item = { readonly key: string; readonly name: string; readonly image: string };
const rows: readonly Item[] = [
  { key: 'a', name: 'alpha', image: 'registry.example.com/a:1' },
  { key: 'b', name: 'beta', image: 'busybox:1.36' },
];
const getRowKey = (row: Item) => row.key;

const columns: ReadonlyArray<DataTableColumn<Item>> = [
  { id: 'name', header: 'Name', fit: 'id', sortKey: (row) => row.name, text: (row) => row.name, cell: (row) => row.name },
  { id: 'ready', header: 'Ready', fit: 'fixed', width: 59, align: 'end', cell: () => '2/2' },
  { id: 'image', header: 'Image', fit: 'flex', text: (row) => row.image, cell: (row) => row.image },
  { id: 'inspect', header: 'Inspect', fit: 'fixed', width: 46, hideHeader: true, cell: () => <button type="button" aria-label="Inspect row">i</button> },
];

const css = await readFile(path.join(import.meta.dirname, 'DataTable.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('which cells clip their text (base.css 1262-1276: only the cells of the flexible columns do)', () => {
  it('marks the cells of a text column and of the identity column as clipping, and no cell of a fixed column', () => {
    render(<DataTable label="Items" rows={rows} getRowKey={getRowKey} columns={columns} />);
    // The rows after the header row: the cells of the first of them.
    const cells = within(screen.getByRole('table'))
      .getAllByRole('row')
      .slice(1)
      .flatMap((row) => within(row).getAllByRole('cell'))
      .slice(0, columns.length);
    expect(cells.map((cell) => cell.hasAttribute('data-ov-flexible'))).toEqual([true, false, true, false]);
  });

  it('marks no header cell as clipping: a header is never cut, the fit never takes a column below its header text', () => {
    render(<DataTable label="Items" rows={rows} getRowKey={getRowKey} columns={columns} onSortChange={() => undefined} />);
    for (const header of screen.getAllByRole('columnheader')) {
      expect(header.hasAttribute('data-ov-flexible')).toBe(false);
    }
  });

  it('clips, in the stylesheet, the cells marked for it and no other cell and no header', () => {
    expect(rule('.cell[data-ov-flexible]')).toMatchObject({ overflow: 'hidden', 'text-overflow': 'ellipsis' });
    for (const base of ['.head, .cell', '.head', '.cell']) {
      const found = cssRules(css).filter((entry) => entry.selector === base);
      for (const entry of found) {
        expect(Object.keys(entry.declarations), `${base} must not clip`).not.toContain('overflow');
        expect(Object.keys(entry.declarations), `${base} must not clip`).not.toContain('text-overflow');
      }
    }
  });
});

describe('a header with no word to show', () => {
  it('keeps its name for assistive technology and draws nothing: a column of commands has no ink in its header (base.css 1282, 1286)', () => {
    render(<DataTable label="Items" rows={rows} getRowKey={getRowKey} columns={columns} />);
    const header = screen.getByRole('columnheader', { name: 'Inspect' });
    expect(header.textContent).toBe('Inspect');
    const word = header.firstElementChild as HTMLElement;
    expect(word.tagName).toBe('SPAN');
    expect(word.hasAttribute('data-ov-hidden')).toBe(true);
  });

  it('is visually hidden by the same rule the mock uses (base.css 1592), and takes no space', () => {
    expect(rule('.hidden')).toMatchObject({
      position: 'absolute',
      width: '1px',
      height: '1px',
      margin: '-1px',
      padding: '0',
      overflow: 'hidden',
      'clip-path': 'inset(50%)',
      'white-space': 'nowrap',
      border: '0',
    });
  });

  it('is not an option of a header that has a sort button: a column that sorts shows its word', () => {
    const sortable: ReadonlyArray<DataTableColumn<Item>> = [{ id: 'name', header: 'Name', fit: 'id', sortKey: (row) => row.name, hideHeader: true, text: (row) => row.name, cell: (row) => row.name }];
    render(<DataTable label="Items" rows={rows} getRowKey={getRowKey} columns={sortable} onSortChange={() => undefined} />);
    expect(screen.getByRole('button', { name: 'Name' })).toBeTruthy();
  });
});

describe('a cell that holds a command (base.css 1317, 1612-1615: it gives back its block padding, so the row keeps its height)', () => {
  it('takes no block padding when a button is what it holds', () => {
    expect(rule('.cell:has(> button)')).toMatchObject({ 'padding-block': '0' });
  });

  it('keeps the 24 px command centred in the cell, as the mock does', () => {
    expect(declarationsOf(css, '.cell')['vertical-align']).toBe('middle');
  });
});

describe('the sort button (base.css 1229, 1243: a 4 px control radius, the icon colour on the arrow)', () => {
  it('has the radius of a control, so that its focus ring follows it, and no padding of its own: the box is the row target', () => {
    const sort = rule('.sort');
    expect(sort['border-radius']).toBe('var(--ov-radius-control)');
    expect(sort.padding).toBe('0');
    expect(sort['min-height']).toBe('var(--ov-row-target)');
  });

  it('paints its arrow in the icon colour at rest, on hover and in focus; only the word changes on hover', () => {
    expect(rule('.sort svg').color).toBe('var(--ov-icon)');
    expect(rule('.sort:hover').color).toBe('var(--ov-fg)');
  });

  it('justifies its content to the start whatever the column\'s alignment: the button is as wide as its content, the cell aligns it', () => {
    expect(cssRules(css).some((entry) => /align='end'\]\s+\.sort/.test(entry.selector) && 'justify-content' in entry.declarations)).toBe(false);
  });
});

describe('the selection mark (base.css 1138-1139)', () => {
  it('is a 16 px box with the radius of a control, an island fill and the raised edge when off', () => {
    expect(rule('.check::before')).toMatchObject({
      width: '16px',
      height: '16px',
      border: '1px solid var(--ov-border-raised)',
      'border-radius': 'var(--ov-radius-control)',
      'background-color': 'var(--ov-bg-island)',
    });
  });

  it('is filled with the accent, edge and all, when on or mixed', () => {
    expect(declarationsOf(css, '.check:checked::before')).toMatchObject({ 'border-color': 'var(--ov-accent)', 'background-color': 'var(--ov-accent)' });
  });
});
