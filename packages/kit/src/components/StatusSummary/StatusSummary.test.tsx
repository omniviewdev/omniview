import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { render, screen } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { rootWrites } from '../../../scripts/rootWrites.ts';
import { StatusSummary, type StatusSummaryItem, type StatusSummaryProps } from './StatusSummary';
import * as examples from './StatusSummary.examples';

const LINE: readonly StatusSummaryItem[] = [{ status: { role: 'healthy', label: 'Available' } }, { value: '3/3', label: 'ready' }, { text: 'up to date' }];

const count = (element: ReactElement) => {
  const { container, unmount } = render(element);
  const total = container.querySelectorAll('*').length;
  unmount();
  return total;
};

const parts = (container: HTMLElement, part: string) => [...container.querySelectorAll(`[data-ov-part="${part}"]`)];

describe('StatusSummary', () => {
  it('is a group named by the caller, in the order the items are given, with a dot between the parts', () => {
    const { container } = render(<StatusSummary label="orders-api status" items={LINE} />);
    const group = screen.getByRole('group', { name: 'orders-api status' });
    expect(group).toBe(container.firstElementChild);
    expect(group.getAttribute('data-ov-part')).toBe('status-summary');
    expect(group.children).toHaveLength(5);
    expect([...group.children].map((child) => child.getAttribute('data-ov-part'))).toEqual(['item', 'separator', 'item', 'separator', 'item']);
    expect(group.textContent).toBe('Available·3/3 ready·up to date');
    for (const attribute of ['title', 'style', 'tabindex']) {
      expect(group.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('hides the dots from assistive technology, and puts none before the first or after the last', () => {
    const { container } = render(<StatusSummary label="orders-api status" items={LINE} />);
    const dots = parts(container, 'separator');
    expect(dots).toHaveLength(2);
    for (const dot of dots) {
      expect(dot.getAttribute('aria-hidden')).toBe('true');
      expect(dot.textContent).toBe('·');
    }

    expect(container.querySelector('[data-ov-part="status-summary"]')?.firstElementChild?.getAttribute('data-ov-part')).toBe('item');
    expect(container.querySelector('[data-ov-part="status-summary"]')?.lastElementChild?.getAttribute('data-ov-part')).toBe('item');
  });

  it('draws a status item with the kit\'s Status: the glyph of its role and the platform\'s word', () => {
    const { container } = render(<StatusSummary label="orders-api status" items={[{ status: { role: 'running', label: 'Running' } }]} />);
    const [item] = parts(container, 'item');
    expect(item?.getAttribute('data-ov-kind')).toBe('status');
    const status = item?.firstElementChild;
    expect(status).toHaveProperty('dataset.ovRole', 'running');
    expect(status?.textContent).toBe('Running');
    expect(status?.querySelector('svg')).toHaveProperty('dataset.ovGlyph', 'play');
    expect(item?.children).toHaveLength(1);
  });

  it('draws a queued progress status with the clock, and the progress status without it with the loader', () => {
    const { container, rerender } = render(<StatusSummary label="status" items={[{ status: { role: 'progress', label: 'Pending', queued: true } }]} />);
    expect(container.querySelector('svg')).toHaveProperty('dataset.ovGlyph', 'clock');
    rerender(<StatusSummary label="status" items={[{ status: { role: 'progress', label: 'Shutting down' } }]} />);
    expect(container.querySelector('svg')).toHaveProperty('dataset.ovGlyph', 'loader-circle');
  });

  it('draws a value as a bold value and the label after it, in one text, as the mock does', () => {
    const { container } = render(<StatusSummary label="status" items={[{ value: '3/3', label: 'ready' }]} />);
    const [item] = parts(container, 'item');
    expect(item?.getAttribute('data-ov-kind')).toBe('value');
    expect(item?.textContent).toBe('3/3 ready');
    expect(item?.querySelectorAll('b')).toHaveLength(1);
    expect(item?.querySelector('b')?.textContent).toBe('3/3');
    expect(item?.lastChild?.textContent).toBe(' ready');
  });

  it('draws a value with no label as the bold value alone, with no stray space', () => {
    const { container, rerender } = render(<StatusSummary label="status" items={[{ value: '12' }]} />);
    expect(parts(container, 'item')[0]?.textContent).toBe('12');
    rerender(<StatusSummary label="status" items={[{ value: '12', label: '' }]} />);
    expect(parts(container, 'item')[0]?.textContent).toBe('12');
  });

  it('draws a text as plain text in one element', () => {
    const { container } = render(<StatusSummary label="status" items={[{ text: 'up to date' }]} />);
    const [item] = parts(container, 'item');
    expect(item?.getAttribute('data-ov-kind')).toBe('text');
    expect(item?.textContent).toBe('up to date');
    expect(item?.children).toHaveLength(0);
  });

  it('turns a tone into a data attribute on a value or a text, and none into none', () => {
    const { container, rerender } = render(<StatusSummary label="status" items={[{ value: '3', label: 'ready' }, { text: 'up to date' }]} />);
    for (const item of parts(container, 'item')) {
      expect(item.hasAttribute('data-ov-tone')).toBe(false);
    }

    for (const tone of ['success', 'warning', 'error', 'info', 'muted'] as const) {
      rerender(<StatusSummary label="status" items={[{ value: '3', label: 'ready', tone }, { text: 'up to date', tone }]} />);
      for (const item of parts(container, 'item')) {
        expect(item, tone).toHaveProperty('dataset.ovTone', tone);
      }
    }
  });

  it('draws nothing at all with no items', () => {
    const { container } = render(<StatusSummary label="status" items={[]} />);
    expect(container.innerHTML).toBe('');
  });

  it('has no tab stop and no control of its own', () => {
    const { container } = render(<StatusSummary label="orders-api status" items={LINE} />);
    expect(container.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
  });

  it('has the elements it says: the group, an item and a dot per part, and what each part holds', () => {
    // group + one text item
    expect(count(<StatusSummary label="s" items={[{ text: 'a' }]} />)).toBe(2);
    // group + item + b
    expect(count(<StatusSummary label="s" items={[{ value: '3', label: 'ready' }]} />)).toBe(3);
    // group + item + status span + svg + path of its glyph
    expect(count(<StatusSummary label="s" items={[{ status: { role: 'running', label: 'Running' } }]} />)).toBeGreaterThanOrEqual(4);
    // group + two items + one dot
    expect(count(<StatusSummary label="s" items={[{ text: 'a' }, { text: 'b' }]} />)).toBe(4);
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = StatusSummary as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { label: 'status', items: LINE, 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, id: 'x', title: 'hint', role: 'list', tabIndex: 5, 'aria-label': 'other' };
    render(<Loose {...loose} />);
    const group = screen.getByTestId('probe');
    expect(group.getAttribute('class')).not.toContain('restyled');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('aria-label')).toBe('status');
    for (const attribute of ['style', 'id', 'title', 'tabindex']) {
      expect(group.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('has closed props: no className, no style, a tone of the scale, a status with a role of the table, three kinds of item', () => {
    // Types only: these are never rendered.
    const accepted: StatusSummaryProps[] = [
      { label: 's', items: LINE },
      { label: 's', items: [{ value: '3', label: undefined, tone: undefined }, { text: 'a', tone: 'muted' }, { status: { role: 'progress', label: 'Pending', queued: true } }] },
      { label: 's', items: [] },
    ];
    // @ts-expect-error className is not a prop of a kit part
    const withClass: StatusSummaryProps = { label: 's', items: LINE, className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: StatusSummaryProps = { label: 's', items: LINE, style: { color: 'red' } };
    // @ts-expect-error a group is named
    const unnamed: StatusSummaryProps = { items: LINE };
    // @ts-expect-error a tone outside the closed set
    const badTone: StatusSummaryProps = { label: 's', items: [{ text: 'a', tone: 'blue' }] };
    // @ts-expect-error a role outside the table of seven
    const badRole: StatusSummaryProps = { label: 's', items: [{ status: { role: 'broken', label: 'Failed' } }] };
    // @ts-expect-error a status has a word
    const wordless: StatusSummaryProps = { label: 's', items: [{ status: { role: 'healthy' } }] };
    // @ts-expect-error a value is text
    const numberValue: StatusSummaryProps = { label: 's', items: [{ value: 3 }] };
    // @ts-expect-error an item is a status, a value or a text
    const empty: StatusSummaryProps = { label: 's', items: [{}] };
    expect([accepted, withClass, withStyle, unnamed, badTone, badRole, wordless, numberValue, empty]).toHaveLength(9);
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const writes = rootWrites(() => {
      const { rerender } = render(<StatusSummary label="status" items={LINE} />);
      rerender(<StatusSummary label="status" items={[{ text: 'a', tone: 'error' }]} />);
    });
    expect(writes).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a summary is shown in.
type Row = {
  /** The name of the group. */
  readonly name: string;
  /** What the line reads as, dots included (they are hidden from assistive technology, and the text of the document has them). */
  readonly text: string;
  /** The tone of the items that have one, by position (the status item has none). */
  readonly tones?: ReadonlyArray<string | undefined>;
  /** The glyph of the status item, if there is one. */
  readonly glyph?: string;
};
const MATRIX: Readonly<Record<string, Row>> = {
  OverviewLine: { name: 'orders-api status', text: 'Available·3/3 ready·up to date·last rollout 3 days ago', tones: [undefined, undefined, undefined, undefined], glyph: 'status-success' },
  Degraded: { name: 'orders-api status', text: 'Degraded·2/3 ready·1 unavailable', tones: [undefined, 'error', 'error'], glyph: 'status-error' },
  ToneSuccess: { name: 'Rollout status', text: '3/3 ready·up to date', tones: ['success', 'success'] },
  ToneWarning: { name: 'Rollout status', text: '2/3 ready·waiting for 1 item', tones: ['warning', 'warning'] },
  ToneError: { name: 'Rollout status', text: '0/3 ready·rollout failed', tones: ['error', 'error'] },
  ToneInfo: { name: 'Rollout status', text: '3 updates·update available', tones: ['info', 'info'] },
  ToneMuted: { name: 'Rollout status', text: '0/3 ready·paused', tones: ['muted', 'muted'] },
  ValueOnly: { name: 'Item count', text: '12', tones: [undefined] },
  TextOnly: { name: 'Item facts', text: 'up to date·last rollout 3 days ago', tones: [undefined, undefined] },
  LongLineWraps: { name: 'orders-api status', text: 'Available·3/3 ready·up to date·last rollout 3 days ago·owned by north-yard·scaled by schedule', tones: [undefined, undefined, undefined, undefined, undefined, undefined], glyph: 'status-success' },
  SingleStatus: { name: 'orders-api status', text: 'Running', tones: [undefined], glyph: 'play' },
  QueuedStatus: { name: 'orders-api status', text: 'Pending·starts in 4 min', tones: [undefined, undefined], glyph: 'clock' },
};

describe('StatusSummary examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: one group named ${row.name}, reading ${row.text}`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      const { container } = render(<Example />);
      const group = screen.getByRole('group', { name: row.name });
      expect(screen.getAllByRole('group')).toHaveLength(1);
      expect(group.textContent).toBe(row.text);
      const items = parts(container, 'item');
      expect(items.map((item) => item.getAttribute('data-ov-tone') ?? undefined)).toEqual(row.tones ?? []);
      // a dot between every two parts and none at the ends, each hidden from assistive technology
      const dots = parts(container, 'separator');
      expect(dots).toHaveLength(items.length - 1);
      for (const dot of dots) {
        expect(dot.getAttribute('aria-hidden')).toBe('true');
      }

      // glyphs are decorative, and the state is in the words
      expect(container.querySelector('svg')?.getAttribute('data-ov-glyph') ?? undefined).toBe(row.glyph);
      for (const svg of container.querySelectorAll('svg')) {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      }

      // it is text: no control, no tab stop, no title
      expect(container.querySelectorAll('button, a, input, [tabindex]')).toHaveLength(0);
      expect(container.querySelector('[title]')).toBeNull();
    });
  }

  it('LongLineWraps: the line sits in a box narrower than it', () => {
    const Example = examples.LongLineWraps;
    const { container } = render(<Example />);
    expect(container.firstElementChild?.contains(screen.getByRole('group'))).toBe(true);
    expect(container.firstElementChild).not.toBe(screen.getByRole('group'));
  });
});

// The stylesheet, as the rules it holds: jsdom lays nothing out, so what the stylesheet must say is asserted here (the numbers of the
// mock's geometry) and what a browser paints from it is measured in WebKit and Chromium against the mock.
const css = await readFile(path.join(import.meta.dirname, 'StatusSummary.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the StatusSummary stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the mock\'s line: a wrapping flex row, 4 px between lines and 8 px between parts, 24 px high at least, 13/16, centred', () => {
    expect(rule('.root')).toMatchObject({
      display: 'flex',
      'flex-wrap': 'wrap',
      'align-items': 'center',
      gap: 'var(--ov-spacing-4) var(--ov-spacing-8)',
      'min-width': '0',
      'min-height': '24px',
      color: 'var(--ov-fg)',
      'font-size': 'var(--ov-fs-13)',
      'line-height': 'var(--ov-lh-16)',
      'font-weight': '400',
    });
  });

  it('sets the type of the interface on the line itself', () => {
    const root = rule('.root');
    expect(root['font-family']).toBe('var(--ov-font-ui)');
    expect(root['font-feature-settings']).toBe('var(--ov-font-features)');
    expect(root['font-synthesis']).toBe('none');
    expect(root['letter-spacing']).toBe('normal');
  });

  it('draws a value in the semibold weight, and no other part', () => {
    expect(rule('.item b')).toEqual({ 'font-weight': '600' });
  });

  it('keeps the box of a status one box with it: a fixed column, centred', () => {
    expect(rule('.item[data-ov-kind=\'status\']')).toEqual({ display: 'flex', 'flex-shrink': '0', 'align-items': 'center' });
  });

  it('colours a toned item with the state colours of the kit, and info with the link colour', () => {
    const tones = { success: '--ov-success-fg', warning: '--ov-warning-fg', error: '--ov-error-fg', info: '--ov-link', muted: '--ov-fg-muted' };
    for (const [tone, token] of Object.entries(tones)) {
      expect(rule(`.item[data-ov-tone='${tone}']`), tone).toEqual({ color: `var(${token})` });
    }
  });

  it('draws the dot muted', () => {
    expect(rule('.separator')).toEqual({ color: 'var(--ov-fg-muted)' });
  });

  it('never fades a state with opacity, and takes its paint from tokens', () => {
    expect(css).not.toMatch(/opacity\s*:/);
    for (const token of ['--ov-fg', '--ov-fg-muted', '--ov-link', '--ov-success-fg', '--ov-warning-fg', '--ov-error-fg']) {
      expect(css, token).toContain(`var(${token})`);
    }
  });
});
