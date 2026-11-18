import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { rootWrites } from '../../../scripts/rootWrites.ts';
import { TagList, type TagItem, type TagListProps } from './TagList';
import * as examples from './TagList.examples';

const count = (element: ReactElement) => {
  const { container, unmount } = render(element);
  const total = container.querySelectorAll('*').length;
  unmount();
  return total;
};

const items = (total: number): TagItem[] => Array.from({ length: total }, (_unused, index) => ({ key: `key-${String(index)}`, value: `value-${String(index)}` }));

/** The chips of a rendered list: each one's key text, value text and tip. */
const chipsOf = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-ov-part="tag"]')].map((tag) => ({
    key: tag.querySelector('[data-ov-part="tag-key"]')?.textContent ?? null,
    value: tag.querySelector('[data-ov-part="tag-value"]')?.textContent ?? null,
    tip: tag.getAttribute('data-ov-tip'),
  }));

describe('TagList', () => {
  it('is a group named by its label, with the chips in a row box and nothing else but the toggle', () => {
    const { container } = render(<TagList label="Labels" items={items(2)} />);
    const group = screen.getByRole('group', { name: 'Labels' });
    expect(group).toBe(container.firstElementChild);
    expect(group.tagName).toBe('DIV');
    expect(group).toHaveProperty('dataset.ovPart', 'tag-list');
    expect(group.children).toHaveLength(1);
    expect(group.firstElementChild?.children).toHaveLength(2);
    for (const attribute of ['tabindex', 'title', 'style', 'aria-expanded']) {
      expect(group.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('renders nothing for no items', () => {
    const { container } = render(<TagList label="Labels" items={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('draws a tag as a chip of a key and a value, with the whole pair as its tip', () => {
    const { container } = render(<TagList label="Labels" items={[{ key: 'app', value: 'orders-api' }]} />);
    expect(chipsOf(container)).toEqual([{ key: 'app', value: 'orders-api', tip: 'app = orders-api' }]);
    const tag = container.querySelector('[data-ov-part="tag"]')!;
    expect(tag.tagName).toBe('SPAN');
    expect([...tag.children].map((child) => child.getAttribute('data-ov-part'))).toEqual(['tag-key', 'tag-value']);
    for (const attribute of ['role', 'tabindex', 'title', 'aria-label']) {
      expect(tag.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('draws a tag with no value as its key alone, and the key alone is its tip', () => {
    const { container } = render(<TagList label="Selectors" items={[{ key: 'orders-api' }]} />);
    expect(chipsOf(container)).toEqual([{ key: 'orders-api', value: null, tip: 'orders-api' }]);
    expect(container.querySelector('[data-ov-part="tag-key"]')).toHaveProperty('dataset.ovLone', 'true');
    expect(container.querySelector('[data-ov-part="tag-value"]')).toBeNull();
  });

  it('draws an empty value as an empty value box, and the tip is the key alone', () => {
    const { container } = render(<TagList label="Labels" items={[{ key: 'canary', value: '' }]} />);
    expect(chipsOf(container)).toEqual([{ key: 'canary', value: '', tip: 'canary' }]);
    expect(container.querySelector('[data-ov-part="tag-key"]')?.hasAttribute('data-ov-lone')).toBe(false);
  });

  it('draws a key of twelve characters or fewer whole, and a longer one in two halves that keep its end', () => {
    const { container } = render(
      <TagList
        label="Labels"
        items={[
          { key: 'exactly-12ch', value: 'a' },
          { key: 'exactly-13chr', value: 'b' },
        ]}
      />,
    );
    const [short, long] = [...container.querySelectorAll('[data-ov-part="tag-key"]')];
    expect(short?.children).toHaveLength(0);
    expect(short?.textContent).toBe('exactly-12ch');
    expect(long?.querySelector('[data-ov-clip]')).toHaveProperty('dataset.ovShape', 'split');
    expect(long?.textContent).toBe('exactly-13chr');
  });

  it('keeps the part after the last slash of a key whole, as the mock does: a third of the name when there is no slash', () => {
    const { container } = render(
      <TagList
        label="Labels"
        items={[
          { key: 'example.io/managed-by', value: 'helm' },
          { key: 'a-key-with-no-slash-at-all', value: 'x' },
          { key: 'e.io/a', value: 'x' },
          { key: 'example.io/the-name-after-the-slash-is-so-long-that-it-is-capped', value: 'x' },
        ]}
      />,
    );
    const tails = [...container.querySelectorAll('[data-ov-part="tag-key"]')].map((key) => key.querySelectorAll('[data-ov-text]')[1]?.getAttribute('data-ov-text'));
    // 21 characters, slash at 10: 10 characters stay; 26 with no slash: a third, 8; "e.io/a" is short and whole; the last is capped at 28
    expect(tails[0]).toBe('managed-by');
    expect(tails[1]).toBe('h-at-all');
    expect(tails[2]).toBeUndefined();
    expect(tails[3]?.length).toBe(28);
  });

  it('gives a key of more than 38 characters a value chip of its own, and a key of 38 or fewer keeps its value', () => {
    const key38 = 'k'.repeat(38);
    const key39 = 'k'.repeat(39);
    const { container } = render(
      <TagList
        label="Annotations"
        items={[
          { key: key38, value: 'one' },
          { key: key39, value: 'two' },
        ]}
      />,
    );
    const chips = chipsOf(container);
    expect(chips).toHaveLength(3);
    expect(chips[0]).toEqual({ key: key38, value: 'one', tip: `${key38} = one` });
    // the long key is a chip, then its value is a chip, both with the whole pair as the tip
    expect(chips[1]).toEqual({ key: key39, value: null, tip: `${key39} = two` });
    expect(chips[2]).toEqual({ key: null, value: 'two', tip: `${key39} = two` });
  });

  it('draws a long key with no value as one chip, with no chip of its own for a value that is not there', () => {
    const { container } = render(<TagList label="Selectors" items={[{ key: 'k'.repeat(50) }]} />);
    expect(chipsOf(container)).toHaveLength(1);
  });

  it('puts a value on one line: whitespace runs collapse, and a value of more than 400 characters is cut with an ellipsis', () => {
    const { container } = render(
      <TagList
        label="Annotations"
        items={[
          { key: 'note', value: 'line one\n   line two\tend' },
          { key: 'long', value: 'x'.repeat(500) },
          { key: 'longer', value: 'y'.repeat(700) },
        ]}
      />,
    );
    const [note, long, longer] = chipsOf(container);
    expect(note?.value).toBe('line one line two end');
    expect(long?.value).toBe(`${'x'.repeat(399)}…`);
    expect(Array.from(long?.value ?? '')).toHaveLength(400);
    // the tip keeps what the chip flattens, up to 600 characters
    expect(note?.tip).toBe('note = line one\n   line two\tend');
    expect(long?.tip).toBe(`long = ${'x'.repeat(500)}`);
    expect(longer?.tip).toBe(`longer = ${'y'.repeat(599)}…`);
  });

  it('shows the first six and folds the rest behind "Show all N", and shows no control for six or fewer', () => {
    const { container, rerender } = render(<TagList label="Labels" items={items(7)} />);
    expect(chipsOf(container)).toHaveLength(6);
    const toggle = screen.getByRole('button', { name: 'Show all 7' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    rerender(<TagList label="Labels" items={items(6)} />);
    expect(chipsOf(container)).toHaveLength(6);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('takes the number that show from `visible`, 0 included', () => {
    const { container, rerender } = render(<TagList label="Labels" items={items(5)} visible={2} />);
    expect(chipsOf(container)).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Show all 5' })).toBeDefined();
    rerender(<TagList label="Labels" items={items(5)} visible={5} />);
    expect(screen.queryByRole('button')).toBeNull();
    rerender(<TagList label="Labels" items={items(3)} visible={0} />);
    expect(chipsOf(container)).toHaveLength(0);
    expect(screen.getByRole('button', { name: 'Show all 3' }).hasAttribute('aria-controls')).toBe(false);
  });

  it('opens on "Show all N" and closes on "Show fewer", saying which with aria-expanded', () => {
    const { container } = render(<TagList label="Labels" items={items(9)} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show all 9' }));
    expect(chipsOf(container)).toHaveLength(9);
    const toggle = screen.getByRole('button', { name: 'Show fewer' });
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(screen.queryByRole('button', { name: 'Show all 9' })).toBeNull();
    fireEvent.click(toggle);
    expect(chipsOf(container)).toHaveLength(6);
    expect(screen.getByRole('button', { name: 'Show all 9' }).getAttribute('aria-expanded')).toBe('false');
  });

  it('starts open with `defaultExpanded`, and the state is its own: two lists open and close alone', () => {
    const { container } = render(
      <>
        <TagList label="Labels" items={items(8)} defaultExpanded />
        <TagList label="Annotations" items={items(8)} />
      </>,
    );
    const [labels, annotations] = [...container.querySelectorAll('[data-ov-part="tag-list"]')] as [HTMLElement, HTMLElement];
    expect(chipsOf(labels)).toHaveLength(8);
    expect(chipsOf(annotations)).toHaveLength(6);
    fireEvent.click(within(annotations).getByRole('button', { name: 'Show all 8' }));
    expect(chipsOf(annotations)).toHaveLength(8);
    fireEvent.click(within(labels).getByRole('button', { name: 'Show fewer' }));
    expect(chipsOf(labels)).toHaveLength(6);
    expect(chipsOf(annotations)).toHaveLength(8);
  });

  it('makes the toggle a native button in the tab order that controls the chips', () => {
    const { container } = render(<TagList label="Labels" items={items(8)} />);
    const toggle = screen.getByRole('button', { name: 'Show all 8' });
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    expect(toggle).toHaveProperty('dataset.ovPart', 'toggle');
    expect(toggle.tabIndex).toBe(0);
    for (const attribute of ['title', 'tabindex', 'aria-disabled', 'style']) {
      expect(toggle.hasAttribute(attribute), attribute).toBe(false);
    }

    const controlled = toggle.getAttribute('aria-controls');
    expect(controlled).not.toBeNull();
    expect(container.querySelector(`[id="${String(controlled)}"]`)).toBe(container.querySelector('[data-ov-part="tag-list"] > div'));
    toggle.focus();
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-controls')).toBe(controlled);
  });

  it('never submits a form', () => {
    let submitted = false;
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitted = true;
        }}
      >
        <TagList label="Labels" items={items(8)} />
      </form>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Show all 8' }));
    expect(submitted).toBe(false);
  });

  it('has the elements it says: a group, a row box and, per chip, a chip, a key and a value; the toggle adds a box and a button', () => {
    expect(count(<TagList label="Labels" items={[{ key: 'app', value: 'orders-api' }]} />)).toBe(5);
    expect(count(<TagList label="Labels" items={[{ key: 'app' }]} />)).toBe(4);
    expect(count(<TagList label="Labels" items={items(2)} />)).toBe(8);
    expect(count(<TagList label="Labels" items={items(8)} />)).toBe(2 + 6 * 3 + 2);
    // a long key adds its middle ellipsis: a clipping box, two halves and the name
    expect(count(<TagList label="Labels" items={[{ key: 'example.io/managed-by', value: 'helm' }]} />)).toBe(5 + 4);
    // and a key of more than 38 characters adds the chip of its value: a group, a row box, the key chip (a chip, a key, the four of a middle ellipsis) and the value chip (a chip, a value)
    expect(count(<TagList label="Labels" items={[{ key: 'k'.repeat(40), value: 'v' }]} />)).toBe(2 + 6 + 2);
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = TagList as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = { label: 'Labels', items: items(1), 'data-testid': 'probe', className: 'restyled', style: { color: 'red' }, id: 'x', title: 'hint', role: 'list' };
    render(<Loose {...loose} />);
    const group = screen.getByTestId('probe');
    expect(group.getAttribute('role')).toBe('group');
    expect(group.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'title']) {
      expect(group.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('has closed props: no className, no style, no title, a label that is text, items of a key and an optional value', () => {
    // Types only: these are never rendered.
    const accepted: TagListProps[] = [
      { label: 'Labels', items: [] },
      { label: 'Labels', items: [{ key: 'app' }, { key: 'tier', value: 'backend' }, { key: 'x', value: undefined }], visible: 3, defaultExpanded: true },
      { label: 'Labels', items: [], visible: undefined, defaultExpanded: undefined },
    ];
    // @ts-expect-error className is not a prop of a kit part
    const withClass: TagListProps = { label: 'Labels', items: [], className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: TagListProps = { label: 'Labels', items: [], style: { color: 'red' } };
    // @ts-expect-error a title is not a prop: a tooltip is the shared host's
    const withTitle: TagListProps = { label: 'Labels', items: [], title: 'hint' };
    // @ts-expect-error a group is named
    const unnamed: TagListProps = { items: [] };
    // @ts-expect-error a tag has a key
    const keyless: TagListProps = { label: 'Labels', items: [{ value: 'x' }] };
    // @ts-expect-error a value is text
    const numberValue: TagListProps = { label: 'Labels', items: [{ key: 'x', value: 3 }] };
    // @ts-expect-error `visible` is a number
    const textVisible: TagListProps = { label: 'Labels', items: [], visible: 'all' };
    expect([accepted, withClass, withStyle, withTitle, unnamed, keyless, numberValue, textVisible]).toHaveLength(8);
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const writes = rootWrites(() => {
      render(<TagList label="Labels" items={items(8)} />);
      fireEvent.click(screen.getByRole('button', { name: 'Show all 8' }));
    });
    expect(writes).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a TagList is shown in.
/** A chip as a reader meets it: its key and its value, null where the chip has none. */
type Chip = readonly [key: string | null, value: string | null];
type Row = {
  /** The group's name. */
  readonly label: string;
  /** The chips drawn, in order (a key over 38 characters with a value is two). */
  readonly chips: readonly Chip[];
  /** The toggle's name and state, or none when the set is not folded. */
  readonly toggle?: { readonly name: string; readonly expanded: boolean };
};

const TWELVE: readonly Chip[] = [
  ['app', 'orders-api'],
  ['tier', 'backend'],
  ['owner', 'north-yard'],
  ['release', 'stable'],
  ['region', 'north-1'],
  ['example.io/managed-by', 'helm'],
  ['example.io/part-of', 'checkout'],
  ['example.io/version', '1.8.2'],
  ['cost-centre', '4410'],
  ['team', 'platform'],
  ['tracing', 'enabled'],
  ['canary', 'false'],
];

const MATRIX: Readonly<Record<string, Row>> = {
  FewTags: {
    label: 'Labels',
    chips: [
      ['app', 'orders-api'],
      ['tier', 'backend'],
      ['example.io/managed-by', 'helm'],
    ],
  },
  ManyTagsCollapsed: { label: 'Labels', chips: TWELVE.slice(0, 6), toggle: { name: 'Show all 12', expanded: false } },
  Expanded: { label: 'Labels', chips: TWELVE, toggle: { name: 'Show fewer', expanded: true } },
  ThreeVisible: { label: 'Labels', chips: TWELVE.slice(0, 3), toggle: { name: 'Show all 12', expanded: false } },
  LongValueClamped: {
    label: 'Annotations',
    chips: [
      ['description', 'receives orders from the storefront, checks stock with the inventory service and hands paid orders to fulfilment'],
      ['tier', 'backend'],
    ],
  },
  LongKeyCut: {
    label: 'Labels',
    chips: [
      ['deployment.example.io/orders-api-managed-by', null],
      [null, 'helm'],
      ['app.example.io/managed-by', 'helm'],
    ],
  },
  LongKeyWithValueChip: {
    label: 'Annotations',
    chips: [
      ['deployment.example.io/last-applied-configuration-hash', null],
      [null, 'a1b2c3d4'],
      ['tier', 'backend'],
    ],
  },
  KeyWithoutValue: {
    label: 'Selectors',
    chips: [
      ['orders-api', null],
      ['tier', 'backend'],
      ['north-yard', null],
    ],
  },
  NarrowBox: {
    label: 'Labels',
    chips: [
      ['app', 'orders-api'],
      ['tier', 'backend'],
      ['example.io/managed-by', 'helm'],
      ['owner', 'north-yard'],
      ['release', 'stable'],
      ['canary', null],
    ],
  },
  ManyChipsWrapping: { label: 'Labels', chips: TWELVE },
};

describe('TagList examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: a group "${row.label}" of ${String(row.chips.length)} chips${row.toggle === undefined ? '' : `, "${row.toggle.name}"`}`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      const { container } = render(<Example />);
      const group = screen.getByRole('group', { name: row.label });
      expect(group.getAttribute('data-ov-part')).toBe('tag-list');
      const chips = [...group.querySelectorAll('[data-ov-part="tag"]')];
      expect(chipsOf(group).map((chip) => [chip.key, chip.value])).toEqual(row.chips);

      // the only control is the toggle: a native button with a name and a state, in the tab order; the chips are text
      const buttons = screen.queryAllByRole('button');
      expect(buttons).toHaveLength(row.toggle === undefined ? 0 : 1);
      if (row.toggle !== undefined) {
        const toggle = screen.getByRole('button', { name: row.toggle.name });
        expect(toggle.getAttribute('aria-expanded')).toBe(String(row.toggle.expanded));
        expect(toggle.tabIndex).toBe(0);
        toggle.focus();
        expect(document.activeElement).toBe(toggle);
      }

      // every chip carries its tip; nothing carries a title; a glyph would be hidden
      for (const chip of chips) {
        expect(chip.getAttribute('data-ov-tip')).toBeTruthy();
        expect(chip.hasAttribute('tabindex')).toBe(false);
      }

      expect(container.querySelector('[title]')).toBeNull();
      for (const svg of container.querySelectorAll('svg')) {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      }
    });
  }
});

// The stylesheet, as the rules it holds: jsdom lays nothing out, so what the stylesheet must say is asserted here and what a browser
// paints from it is probed in WebKit and Chromium against the mock (packages/kit/probes).
const css = await readFile(path.join(import.meta.dirname, 'TagList.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the TagList stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('stacks the chips and the toggle 12 px apart', () => {
    expect(rule('.root')).toMatchObject({ display: 'flex', 'flex-direction': 'column', gap: 'var(--ov-spacing-12)', 'min-width': '0' });
    expect(rule('.root')['font-family']).toBe('var(--ov-font-ui)');
    expect(rule('.root')['font-feature-settings']).toBe('var(--ov-font-features)');
  });

  it('wraps the chips in rows 8 px apart, in both directions', () => {
    expect(rule('.chips')).toMatchObject({ display: 'flex', 'flex-wrap': 'wrap', gap: 'var(--ov-spacing-8)', 'align-items': 'center', 'min-width': '0' });
  });

  it('draws a chip as the mock does: inline flex, a 1 px subtle edge, the control radius, the code face at 12/16, never wrapping, never wider than the line', () => {
    expect(rule('.tag')).toMatchObject({
      display: 'inline-flex',
      flex: '0 0 auto',
      'align-items': 'center',
      'min-width': '0',
      'max-width': '100%',
      border: '1px solid var(--ov-border-subtle)',
      'border-radius': 'var(--ov-radius-control)',
      'font-family': 'var(--ov-font-code)',
      'font-size': 'var(--ov-fs-12)',
      'line-height': 'var(--ov-lh-16)',
      'font-variant-ligatures': 'none',
      'white-space': 'nowrap',
      color: 'var(--ov-fg)',
    });
  });

  it('gives the key and the value 2 px by 6 px, one line each, clipped with an ellipsis', () => {
    expect(rule('.key')).toMatchObject({ padding: 'var(--ov-spacing-2) var(--ov-spacing-6)', 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap', 'font-weight': '400', 'font-style': 'normal' });
    expect(rule('.value')).toMatchObject({ padding: 'var(--ov-spacing-2) var(--ov-spacing-6)', 'min-width': '0', overflow: 'hidden', 'text-overflow': 'ellipsis', 'white-space': 'nowrap' });
  });

  it('gives way in a fixed order: the value shrinks first, the key never shrinks and is capped at the chip', () => {
    // the order is in the flex factors: the value has a shrink factor of 1 and the key has none, so the value is clamped before the key is cut
    expect(rule('.value').flex).toBe('0 1 auto');
    expect(rule('.key')).toMatchObject({ flex: '0 0 auto', 'max-width': '100%' });
  });

  it('paints the key muted on the inline fill and the value in the plain colour', () => {
    expect(rule('.key')).toMatchObject({ 'background-color': 'var(--ov-bg-inline)', color: 'var(--ov-fg-muted)' });
    expect(rule('.value').color).toBe('var(--ov-fg)');
  });

  it('draws a key with no value in the plain colour on no fill, and lets it shrink as the only box of the chip', () => {
    expect(rule('.key[data-ov-lone=\'true\']')).toEqual({ flex: '0 1 auto', 'background-color': 'transparent', color: 'var(--ov-fg)' });
  });

  it('draws the toggle as a link-looking button: the link role, the row height, no box, a hand, underlined on hover', () => {
    expect(rule('.toggle')).toMatchObject({
      display: 'inline-flex',
      'align-items': 'center',
      'min-height': 'var(--ov-row-height)',
      padding: 'var(--ov-row-pad) 0',
      border: '0',
      background: 'transparent',
      color: 'var(--ov-link)',
      cursor: 'pointer',
      'font-size': 'var(--ov-fs-13)',
      'line-height': 'var(--ov-lh-16)',
      'font-weight': '400',
    });
    expect(rule('.toggle:hover')).toEqual({ background: 'transparent', 'text-decoration': 'underline' });
  });

  it('draws a focus ring on the toggle for the keyboard only', () => {
    expect(rule('.toggle:focus-visible')).toEqual({ outline: '2px solid var(--ov-accent)', 'outline-offset': '2px' });
    expect(css).not.toMatch(/:focus[^-]/);
  });
});
