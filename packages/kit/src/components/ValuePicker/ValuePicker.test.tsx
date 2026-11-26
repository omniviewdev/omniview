import { fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Field } from '../Field';
import { ValuePicker, type ValuePickerOption } from './ValuePicker';

const OPTIONS: readonly ValuePickerOption[] = [
  { value: 'a', label: 'Alpha', description: '3 connections' },
  { value: 'b', label: 'Beta', description: '2 connections' },
  { value: 'c', label: 'Gamma', disabledReason: 'Not available now.' },
  { value: 'd', label: 'Delta', description: '4 connections' },
];

type HarnessProps = {
  readonly initial?: readonly string[];
  readonly options?: readonly ValuePickerOption[];
  readonly allOption?: string;
  readonly searchable?: boolean;
  readonly onValueChange?: (value: readonly string[]) => void;
};

/** A picker written the way a consumer writes it: the caller holds the choice. */
function Harness({ initial = [], options = OPTIONS, allOption, searchable, onValueChange }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <ValuePicker
      label="Platform"
      options={options}
      value={value}
      allOption={allOption}
      searchable={searchable}
      onValueChange={(next) => {
        onValueChange?.(next);
        setValue(next);
      }}
    />
  );
}

const trigger = () => screen.getByRole('combobox', { name: 'Platform' });
const field = () => screen.getByRole('combobox', { name: 'Search Platform' });
const rows = () => screen.queryAllByRole('option');
/** The text of an option, without its second line. */
const label = (row: HTMLElement | null | undefined) => row?.querySelector('span > span')?.textContent ?? null;
const labels = () => rows().map(label);
/** The option the field says is active. */
const active = () => label(document.getElementById(field().getAttribute('aria-activedescendant') ?? ''));
const open = () => {
  fireEvent.click(trigger());
  return field();
};

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(HTMLElement.prototype, 'scrollTo');
});

describe('ValuePicker', () => {
  it('says what is chosen, and opens into a multiselectable list named by its label, with the focus in its search field', async () => {
    const onValueChange = () => undefined;
    const { rerender } = render(<ValuePicker label="Platform" options={OPTIONS} value={[]} onValueChange={onValueChange} />);
    expect(trigger().tagName).toBe('BUTTON');
    expect(trigger().textContent).toBe('None selected');
    rerender(<ValuePicker label="Platform" options={OPTIONS} value={['a', 'b']} onValueChange={onValueChange} allOption="All platforms" />);
    expect(trigger().textContent).toBe('2 selected');
    rerender(<ValuePicker label="Platform" options={OPTIONS} value={[]} onValueChange={onValueChange} allOption="All platforms" />);
    expect(trigger().textContent).toBe('All platforms');

    // Closed, it has no list: the popup is mounted only while it is open.
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
    expect(trigger().getAttribute('aria-haspopup')).toBe('listbox');
    expect(screen.queryByRole('listbox')).toBeNull();
    rerender(<ValuePicker label="Platform" options={OPTIONS} value={['b']} onValueChange={onValueChange} allOption="All platforms" />);
    fireEvent.click(trigger());
    const list = screen.getByRole('listbox', { name: 'Platform' });
    expect(trigger().getAttribute('aria-expanded')).toBe('true');
    expect(trigger().getAttribute('aria-controls')).toBe(list.id);
    expect(list.getAttribute('aria-multiselectable')).toBe('true');
    // The all row first, then the options in order, each saying whether it is chosen; the option that cannot be chosen says so.
    expect(rows().map((row) => [label(row), row.getAttribute('aria-selected'), row.getAttribute('aria-disabled')])).toEqual([
      ['All platforms', 'false', null],
      ['Alpha', 'false', null],
      ['Beta', 'true', null],
      ['Gamma', 'false', 'true'],
      ['Delta', 'false', null],
    ]);
    expect(rows()[1]?.textContent).toContain('3 connections');
    // The option that cannot be chosen says why in its second line, in the place of a description, and in its tooltip; no other row has a tooltip.
    expect(rows()[3]?.textContent).toContain('Not available now.');
    expect(rows().map((row) => row.getAttribute('data-ov-tip'))).toEqual([null, null, null, 'Not available now.', null]);
    // The focus is in the field, which owns the list and names its active row: the first chosen option, here.
    expect(document.activeElement).toBe(field());
    expect(field().getAttribute('aria-controls')).toBe(list.id);
    expect(active()).toBe('Beta');

    const result = await axe.run(document.body, { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } });
    expect(result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`)).toEqual([]);
  });

  it('moves with the arrows, Home and End, chooses with Enter and Space and stays open, and closes with Escape and gives the focus back', () => {
    const onValueChange = vi.fn();
    const outer = vi.fn((event: { readonly key: string }) => event.key);
    render(
      <div onKeyDown={outer}>
        <Harness allOption="All platforms" onValueChange={onValueChange} />
      </div>,
    );
    const input = open();
    expect(active()).toBe('All platforms');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(active()).toBe('Alpha');
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValueChange).toHaveBeenLastCalledWith(['a']);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: ' ' });
    expect(onValueChange).toHaveBeenLastCalledWith(['a', 'b']);
    expect(trigger().textContent).toBe('2 selected');
    expect(rows().map((row) => row.getAttribute('aria-selected'))).toEqual(['false', 'true', 'true', 'false', 'false']);

    // Home and End go to the ends, and the arrows go round.
    fireEvent.keyDown(input, { key: 'End' });
    expect(active()).toBe('Delta');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(active()).toBe('All platforms');
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(active()).toBe('Delta');
    fireEvent.keyDown(input, { key: 'Home' });
    expect(active()).toBe('All platforms');

    // The all row empties the choice; an option that cannot be chosen is reached and read, and never chosen.
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValueChange).toHaveBeenLastCalledWith([]);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(active()).toBe('Gamma');
    const calls = onValueChange.mock.calls.length;
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onValueChange.mock.calls).toHaveLength(calls);
    expect(screen.getByRole('listbox')).toBeDefined();

    // Escape is the popup's: it closes, the trigger has the focus, and nothing around the picker saw the key.
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    expect(outer.mock.calls.some(([event]) => event.key === 'Escape')).toBe(false);
    // An arrow opens it again, and Tab leaves it with the focus on the trigger.
    fireEvent.keyDown(trigger(), { key: 'ArrowDown' });
    expect(screen.getByRole('listbox')).toBeDefined();
    fireEvent.keyDown(field(), { key: 'Tab' });
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it('narrows the list to what is typed, in the labels and the second lines, says when nothing is left, and leaves Space and Home to the text', () => {
    const onValueChange = vi.fn();
    render(<Harness allOption="All platforms" onValueChange={onValueChange} />);
    const input = open();
    fireEvent.change(input, { target: { value: 'ALPH' } });
    expect(labels()).toEqual(['Alpha']);
    // The first row of the result is the active one, so Enter chooses it.
    expect(active()).toBe('Alpha');
    fireEvent.change(input, { target: { value: '4 conn' } });
    expect(labels()).toEqual(['Delta']);
    fireEvent.change(input, { target: { value: 'platf' } });
    expect(labels()).toEqual(['All platforms']);
    // The reason of an option is its second line, and what is seen is what the search reads.
    fireEvent.change(input, { target: { value: 'not available' } });
    expect(labels()).toEqual(['Gamma']);
    fireEvent.change(input, { target: { value: 'zzz' } });
    expect(rows()).toHaveLength(0);
    expect(input.getAttribute('aria-activedescendant')).toBeNull();
    expect(screen.getByText('No matches')).toBeDefined();

    // While the field holds text, Space and Home are not the list's: the key is left to type with, and nothing is chosen.
    fireEvent.change(input, { target: { value: 'a' } });
    expect(fireEvent.keyDown(input, { key: ' ' })).toBe(true);
    expect(fireEvent.keyDown(input, { key: 'Home' })).toBe(true);
    expect(onValueChange).not.toHaveBeenCalled();
    // Empty again, they are the list's.
    fireEvent.change(input, { target: { value: '' } });
    expect(labels()).toHaveLength(5);
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    expect(fireEvent.keyDown(input, { key: ' ' })).toBe(false);
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenLastCalledWith(['a']);
  });

  it('chooses with one handler for all the rows: a press on an option chooses it, one that cannot be chosen does nothing, and a press elsewhere closes the popup', () => {
    const onValueChange = vi.fn();
    render(<Harness allOption="All platforms" onValueChange={onValueChange} />);
    fireEvent.click(trigger());
    fireEvent.click(screen.getByRole('option', { name: /^Beta/ }));
    expect(onValueChange).toHaveBeenLastCalledWith(['b']);
    fireEvent.click(screen.getByRole('option', { name: /^Delta/ }));
    expect(onValueChange).toHaveBeenLastCalledWith(['b', 'd']);
    fireEvent.click(screen.getByRole('option', { name: /^Beta/ }));
    expect(onValueChange).toHaveBeenLastCalledWith(['d']);
    // The popup stays open, and the trigger says the count.
    expect(screen.getByRole('listbox')).toBeDefined();
    expect(trigger().textContent).toBe('1 selected');
    const calls = onValueChange.mock.calls.length;
    fireEvent.click(screen.getByRole('option', { name: /^Gamma/ }));
    expect(onValueChange.mock.calls).toHaveLength(calls);
    fireEvent.click(screen.getByRole('option', { name: /^All platforms/ }));
    expect(onValueChange).toHaveBeenLastCalledWith([]);
    expect(trigger().textContent).toBe('All platforms');

    // The row under the pointer is the active one.
    fireEvent.pointerMove(screen.getByRole('option', { name: /^Delta/ }), { pointerType: 'mouse' });
    expect(active()).toBe('Delta');
    // A press on the trigger closes it and gives the focus back; one anywhere else closes it and takes nothing.
    fireEvent.pointerDown(trigger());
    fireEvent.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).toBe(trigger());
    fireEvent.click(trigger());
    fireEvent.pointerDown(document.body);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(document.activeElement).not.toBe(trigger());
  });

  it('is named by its Field, and a picker that cannot change does not open, says why, stays a tab stop, and closes when it becomes unavailable', () => {
    const noop = () => undefined;
    const inField = render(
      <Field label="Members" layout="stacked" disabledReason="Resolve the current operation first.">
        <ValuePicker label="Folder members" options={OPTIONS} value={['a']} onValueChange={noop} />
      </Field>,
    );
    // The label of the Field names it; its own label is not used inside a Field.
    const box = screen.getByRole('combobox', { name: 'Members' });
    expect(box.hasAttribute('aria-label')).toBe(false);
    expect(box.textContent).toBe('1 selected');
    expect(box.getAttribute('aria-disabled')).toBe('true');
    fireEvent.click(box);
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(screen.queryByRole('listbox')).toBeNull();
    box.focus();
    expect(document.activeElement).toBe(box);
    inField.unmount();

    // On its own, its reason describes it, and it does not open.
    const own = (reason?: string) => <ValuePicker label="Platform" options={OPTIONS} value={['a']} onValueChange={noop} disabledReason={reason} />;
    const alone = render(own('There are no connections to filter.'));
    expect(trigger().getAttribute('aria-disabled')).toBe('true');
    const described = (trigger().getAttribute('aria-describedby') ?? '').split(' ').map((id) => document.getElementById(id)?.textContent);
    expect(described).toContain('There are no connections to filter.');
    fireEvent.click(trigger());
    expect(screen.queryByRole('listbox')).toBeNull();

    // Open, then unavailable: it closes, and it does not open again when it is available.
    alone.rerender(own());
    fireEvent.click(trigger());
    expect(screen.getByRole('listbox')).toBeDefined();
    alone.rerender(own('Not now.'));
    expect(screen.queryByRole('listbox')).toBeNull();
    alone.rerender(own());
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(trigger().getAttribute('aria-expanded')).toBe('false');
  });

  it('mounts a screenful of five thousand options, and keeps the active option mounted as the keys move through it', () => {
    // jsdom lays nothing out: the list has the height of the mock's, and the scroll goes where it is told.
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function height(this: Element) {
      return this.getAttribute('role') === 'listbox' ? 242 : 0;
    });
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockImplementation(function height(this: Element) {
      return this.getAttribute('role') === 'listbox' ? 5000 * 24 : 0;
    });
    Object.defineProperty(HTMLElement.prototype, 'scrollTo', {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        Object.defineProperty(this, 'scrollTop', { configurable: true, writable: true, value: options.top ?? 0 });
        this.dispatchEvent(new Event('scroll'));
      },
    });
    const many = Array.from({ length: 5000 }, (_, index) => ({ value: `item-${index + 1}`, label: `Item ${index + 1}` }));
    render(<Harness options={many} initial={['item-2500']} />);
    const input = open();
    expect(rows().length).toBeGreaterThan(10);
    expect(rows().length).toBeLessThan(50);
    expect(rows().every((row) => row.getAttribute('aria-setsize') === '5000')).toBe(true);
    // The list opens on the option that is chosen, which is deep in it.
    expect(active()).toBe('Item 2500');
    expect(labels()).toContain('Item 2500');
    expect(labels()).not.toContain('Item 1');

    fireEvent.keyDown(input, { key: 'End' });
    expect(active()).toBe('Item 5000');
    expect(rows().at(-1)?.getAttribute('aria-posinset')).toBe('5000');
    fireEvent.keyDown(input, { key: 'Home' });
    expect(active()).toBe('Item 1');
    fireEvent.change(input, { target: { value: 'item 4999' } });
    expect(labels()).toEqual(['Item 4999']);
  });
});
