import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType, ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { QuickFilters, type QuickFiltersProps } from './QuickFilters';
import * as examples from './QuickFilters.examples';

const FILTERS = [
  { id: 'running', label: 'Running', count: 80, tone: 'success' },
  { id: 'pending', label: 'Pending', count: 4, tone: 'warning' },
  { id: 'failed', label: 'Failed', count: 3, tone: 'error' },
  { id: 'completed', label: 'Completed', count: 2, tone: 'muted' },
] as const;

const strip = (props: Partial<QuickFiltersProps> = {}) => (
  <QuickFilters label="Item state" total={89} filters={FILTERS} selected={null} onSelect={() => undefined} {...props} />
);

const chip = (name: string) => screen.getByRole('button', { name });
const pressed = () => screen.getAllByRole('button').filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.textContent);

describe('QuickFilters', () => {
  describe('the strip', () => {
    it('is a named group that holds All first and then the filters in the order they are given', () => {
      render(strip());
      const group = screen.getByRole('group', { name: 'Item state' });
      expect(group).toHaveProperty('dataset.ovRoving', 'row');
      expect(within(group).getAllByRole('button').map((button) => button.textContent)).toEqual(['All 89', 'Running 80', 'Pending 4', 'Failed 3', 'Completed 2']);
    });

    it('lays its chips out in a row that wraps, 8 px apart and centred on the line', () => {
      render(strip());
      const group = screen.getByRole('group');
      expect(group).toHaveProperty('dataset.ovGap', '8');
      expect(group).toHaveProperty('dataset.ovWrap', 'true');
      expect(group).toHaveProperty('dataset.ovAlign', 'center');
    });

    it('names each chip by its text and its count, as a toggle button', () => {
      render(strip());
      for (const name of ['All 89', 'Running 80', 'Pending 4', 'Failed 3', 'Completed 2']) {
        const button = chip(name);
        expect(button.getAttribute('type')).toBe('button');
        expect(button.hasAttribute('aria-pressed')).toBe(true);
        expect(button.hasAttribute('title')).toBe(false);
      }
    });

    it('shows no count where none is known yet, and a count of zero where it is zero', () => {
      render(
        strip({
          total: undefined,
          filters: [
            { id: 'running', label: 'Running', tone: 'success' },
            { id: 'pending', label: 'Pending', count: 0, tone: 'warning' },
          ],
        }),
      );
      expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['All', 'Running', 'Pending 0']);
    });

    it('prints a count exactly as it is given: it adds nothing up and rounds nothing', () => {
      render(strip({ total: 1025, filters: [{ id: 'running', label: 'Running', count: 1000 }, { id: 'failed', label: 'Failed', count: 5025 }] }));
      expect(screen.getAllByRole('button').map((button) => button.textContent)).toEqual(['All 1025', 'Running 1000', 'Failed 5025']);
    });
  });

  describe('single choice', () => {
    it('presses All when nothing is selected, and only All', () => {
      render(strip({ selected: null }));
      expect(pressed()).toEqual(['All 89']);
    });

    it('presses the selected filter, and only it', () => {
      render(strip({ selected: 'failed' }));
      expect(pressed()).toEqual(['Failed 3']);
    });

    it('takes a selection that is not one of the filters for All, so exactly one chip is always pressed', () => {
      render(strip({ selected: 'archived' }));
      expect(pressed()).toEqual(['All 89']);
    });

    it('reports the id of the chip that was clicked, and null for All', () => {
      const onSelect = vi.fn();
      render(strip({ onSelect, selected: 'failed' }));
      fireEvent.click(chip('Running 80'));
      fireEvent.click(chip('All 89'));
      expect(onSelect.mock.calls).toEqual([['running'], [null]]);
    });

    it('reports a click on the chip that is already selected: whether it clears the filter is the caller\'s rule', () => {
      const onSelect = vi.fn();
      render(strip({ onSelect, selected: 'failed' }));
      fireEvent.click(chip('Failed 3'));
      expect(onSelect.mock.calls).toEqual([['failed']]);
    });

    it('is controlled: pressing a chip changes nothing until the caller selects it', () => {
      const { rerender } = render(strip({ selected: null }));
      fireEvent.click(chip('Failed 3'));
      expect(pressed()).toEqual(['All 89']);
      rerender(strip({ selected: 'failed' }));
      expect(pressed()).toEqual(['Failed 3']);
    });
  });

  describe('tones', () => {
    const toneOf = (name: string) => chip(name).getAttribute('data-ov-tone');

    it('gives each filter its tone while it has something in it, and All none', () => {
      render(strip());
      expect(toneOf('All 89')).toBeNull();
      expect(toneOf('Running 80')).toBe('success');
      expect(toneOf('Pending 4')).toBe('warning');
      expect(toneOf('Failed 3')).toBe('error');
      expect(toneOf('Completed 2')).toBe('muted');
    });

    it('mutes a filter that has nothing in it: a state with no items is not highlighted', () => {
      render(strip({ filters: [{ id: 'pending', label: 'Pending', count: 0, tone: 'warning' }, { id: 'failed', label: 'Failed', count: 0, tone: 'error' }] }));
      expect(toneOf('Pending 0')).toBe('muted');
      expect(toneOf('Failed 0')).toBe('muted');
    });

    it('mutes a filter whose count is not known yet, and keeps a filter without a tone neutral while it has items', () => {
      render(strip({ filters: [{ id: 'pending', label: 'Pending', tone: 'warning' }, { id: 'all-good', label: 'Healthy', count: 5 }] }));
      expect(toneOf('Pending')).toBe('muted');
      expect(toneOf('Healthy 5')).toBeNull();
    });
  });

  describe('the keyboard', () => {
    it('is one tab stop: the pressed chip, else the first, and the others are out of the tab order', () => {
      const { rerender } = render(strip({ selected: null }));
      const tabindexes = () => screen.getAllByRole('button').map((button) => button.getAttribute('tabindex'));
      expect(tabindexes()).toEqual(['0', '-1', '-1', '-1', '-1']);
      rerender(strip({ selected: 'failed' }));
      // the strip renders again with the new choice: the stop is where the focus last was, or else on the pressed chip
      expect(tabindexes().filter((value) => value === '0')).toHaveLength(1);
    });

    it('moves with Left and Right, goes to the ends with Home and End, and does not wrap', () => {
      render(strip({ selected: 'failed' }));
      act(() => {
        chip('Failed 3').focus();
      });
      const key = (name: string) => fireEvent.keyDown(document.activeElement ?? document.body, { key: name });
      key('ArrowRight');
      expect(document.activeElement).toBe(chip('Completed 2'));
      key('ArrowRight');
      expect(document.activeElement).toBe(chip('Completed 2'));
      key('Home');
      expect(document.activeElement).toBe(chip('All 89'));
      key('ArrowLeft');
      expect(document.activeElement).toBe(chip('All 89'));
      key('End');
      expect(document.activeElement).toBe(chip('Completed 2'));
      key('ArrowLeft');
      expect(document.activeElement).toBe(chip('Failed 3'));
    });

    it('selects with Enter and Space through the button, like a click', () => {
      const onSelect = vi.fn();
      render(strip({ onSelect }));
      act(() => {
        chip('Pending 4').focus();
      });
      // a native button turns Enter and Space into a click: the browser does it, so the test sends the click it would send
      fireEvent.click(document.activeElement ?? document.body);
      expect(onSelect).toHaveBeenCalledWith('pending');
    });
  });

  it('has the elements it says: the strip and, for each chip, a button, a span and a count', () => {
    const { container } = render(strip());
    expect(container.querySelectorAll('*')).toHaveLength(1 + 5 * 3);
    expect(container.querySelectorAll('button')).toHaveLength(5);
    expect(container.querySelectorAll('b')).toHaveLength(5);
  });

  it('passes data-* attributes through and nothing else', () => {
    const Loose = QuickFilters as unknown as ComponentType<Record<string, unknown>>;
    const loose: Record<string, unknown> = {
      label: 'Item state',
      total: 1,
      filters: [],
      selected: null,
      onSelect: () => undefined,
      'data-testid': 'probe',
      className: 'restyled',
      style: { color: 'red' },
      id: 'x',
      title: 'hint',
    };
    render(<Loose {...loose} />);
    const group = screen.getByTestId('probe');
    expect(group.getAttribute('class')).not.toContain('restyled');
    for (const attribute of ['style', 'id', 'title']) {
      expect(group.hasAttribute(attribute), attribute).toBe(false);
    }
  });

  it('has closed props: a label, the filters, a selection and a callback, no className, no style', () => {
    // Types only: these are never rendered.
    const accepted: QuickFiltersProps[] = [
      { label: 'Item state', total: 89, filters: FILTERS, selected: null, onSelect: () => undefined },
      { label: 'Item state', total: undefined, filters: [{ id: 'a', label: 'A', count: undefined, tone: undefined }], selected: 'a', onSelect: (id) => id },
    ];
    // @ts-expect-error a strip is named: the label is required
    const nameless: QuickFiltersProps = { filters: [], selected: null, onSelect: () => undefined };
    // @ts-expect-error className is not a prop of a kit part
    const withClass: QuickFiltersProps = { label: 'x', filters: [], selected: null, onSelect: () => undefined, className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: QuickFiltersProps = { label: 'x', filters: [], selected: null, onSelect: () => undefined, style: { gap: 1 } };
    // @ts-expect-error the choice is controlled: a selection is required, null being All
    const uncontrolled: QuickFiltersProps = { label: 'x', filters: [], onSelect: () => undefined };
    // @ts-expect-error a filter has an id and a label
    const badFilter: QuickFiltersProps = { label: 'x', filters: [{ id: 'a' }], selected: null, onSelect: () => undefined };
    // @ts-expect-error a tone outside the closed set
    const unknownTone: QuickFiltersProps = { label: 'x', filters: [{ id: 'a', label: 'A', tone: 'blue' }], selected: null, onSelect: () => undefined };
    // @ts-expect-error a count is a number
    const textCount: QuickFiltersProps = { label: 'x', filters: [{ id: 'a', label: 'A', count: '3' }], selected: null, onSelect: () => undefined };
    expect([accepted, nameless, withClass, withStyle, uncontrolled, badFilter, unknownTone, textCount]).toHaveLength(8);
  });

  it('writes nothing to the document root: no attribute, no style, no custom property', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    const records: MutationRecord[] = [];
    const observer = new MutationObserver((list) => records.push(...list));
    observer.observe(root, { attributes: true });
    const { rerender } = render(strip());
    fireEvent.click(chip('Failed 3'));
    rerender(strip({ selected: 'failed' }));
    observer.disconnect();
    expect(records).toEqual([]);
    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });
});

// The a11y matrix of the examples: what a user of assistive technology meets for each state a QuickFilters strip is shown in.
type Row = {
  /** The chips in document order, as their accessible names read. */
  readonly chips: readonly string[];
  /** The chip that is pressed (the only one). */
  readonly pressed: string;
  /** Whether the counts are shown and add up: the count of All is the sum of the counts of the states. */
  readonly adds?: true;
};
const MATRIX: Readonly<Record<string, Row>> = {
  Default: { chips: ['All 89', 'Running 80', 'Pending 4', 'Failed 3', 'Completed 2'], pressed: 'All 89', adds: true },
  FailedSelected: { chips: ['All 89', 'Running 80', 'Pending 4', 'Failed 3', 'Completed 2'], pressed: 'Failed 3', adds: true },
  EmptyFilters: { chips: ['All 85', 'Running 80', 'Pending 0', 'Failed 3', 'Completed 2'], pressed: 'All 85', adds: true },
  CountsUnknown: { chips: ['All', 'Running', 'Pending', 'Failed', 'Completed'], pressed: 'All' },
};

describe('QuickFilters examples: the a11y matrix', () => {
  it('has a row for every example, and an example for every row', () => {
    expect(Object.keys(examples).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [exampleName, row] of Object.entries(MATRIX)) {
    const Example = (examples as Record<string, () => ReactElement>)[exampleName];
    it(`${exampleName}: a group of ${row.chips.length} toggle buttons, ${row.pressed} pressed${row.adds === true ? ', the counts add up' : ''}`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      render(<Example />);
      const group = screen.getByRole('group', { name: 'Item state' });
      const buttons = within(group).getAllByRole('button');
      expect(buttons.map((button) => button.textContent)).toEqual([...row.chips]);
      // every chip is a toggle with a name from its own text; exactly one is pressed
      expect(buttons.filter((button) => button.getAttribute('aria-pressed') === 'true').map((button) => button.textContent)).toEqual([row.pressed]);
      expect(buttons.filter((button) => button.getAttribute('aria-pressed') === 'false')).toHaveLength(row.chips.length - 1);
      // one tab stop, on a chip
      expect(buttons.filter((button) => button.getAttribute('tabindex') === '0')).toHaveLength(1);
      // a state is never colour alone: every toned chip also says its state in words
      for (const button of buttons) {
        expect(button.textContent?.trim().length, button.outerHTML).toBeGreaterThan(0);
      }

      if (row.adds === true) {
        const counts = buttons.map((button) => Number(/(\d+)$/.exec(button.textContent ?? '')?.[1]));
        const [total, ...states] = counts;
        expect(states.reduce((sum, count) => sum + count, 0), 'the counts of the states add up to the count of All').toBe(total);
      }

      expect(document.querySelector('[title]')).toBeNull();
    });
  }
});
