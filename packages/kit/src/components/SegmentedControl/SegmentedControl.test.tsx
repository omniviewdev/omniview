import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { SegmentedControl, type SegmentedOption } from './SegmentedControl';

type View = 'table' | 'cards' | 'list';
const options: ReadonlyArray<SegmentedOption<View>> = [
  { value: 'table', label: 'Table' },
  { value: 'cards', label: 'Cards' },
  { value: 'list', label: 'List', disabledReason: 'Not in this build.' },
];

function Harness({ onChange }: { readonly onChange?: (value: View) => void }) {
  const [value, setValue] = useState<View>('table');
  return (
    <SegmentedControl
      label="View as"
      options={options}
      value={value}
      onValueChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

describe('SegmentedControl', () => {
  it('is a named radiogroup of radios that say which one is chosen, with one Tab stop', () => {
    render(<Harness />);
    expect(screen.getByRole('radiogroup', { name: 'View as' })).toBeTruthy();
    expect(screen.getAllByRole('radio').map((radio) => radio.getAttribute('aria-checked'))).toEqual(['true', 'false', 'false']);
    expect(screen.getAllByRole('radio').map((radio) => radio.tabIndex)).toEqual([0, -1, -1]);
  });

  it('moves and chooses with the arrows, Home and End, and skips an option that is unavailable', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const [table, cards] = screen.getAllByRole('radio') as [HTMLElement, HTMLElement, HTMLElement];
    table.focus();
    fireEvent.keyDown(table, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(cards);
    expect(onChange).toHaveBeenLastCalledWith('cards');
    expect(cards.getAttribute('aria-checked')).toBe('true');
    expect(cards.tabIndex).toBe(0);
    // End goes to the last option that can be chosen, and the arrow past it wraps to the first
    fireEvent.keyDown(cards, { key: 'End' });
    expect(document.activeElement).toBe(cards);
    fireEvent.keyDown(cards, { key: 'ArrowRight' });
    expect(document.activeElement).toBe(table);
    expect(onChange).toHaveBeenLastCalledWith('table');
    fireEvent.keyDown(table, { key: 'Home' });
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('chooses an option by a click, and does nothing for one that is unavailable', () => {
    const onChange = vi.fn();
    render(<Harness onChange={onChange} />);
    const list = screen.getByRole('radio', { name: 'List' });
    expect(list.getAttribute('aria-disabled')).toBe('true');
    expect(list.getAttribute('data-ov-tip')).toBe('Not in this build.');
    expect(list.hasAttribute('disabled')).toBe(false);
    fireEvent.click(list);
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Cards' }));
    expect(onChange).toHaveBeenCalledWith('cards');
  });

  it('names an icon-only option by its tip', () => {
    render(<SegmentedControl label="View as" options={[{ value: 'table', icon: 'table', tip: 'Table' }, { value: 'cards', icon: 'layout-grid', tip: 'Cards' }]} value="table" onValueChange={() => undefined} />);
    expect(screen.getByRole('radio', { name: 'Cards' })).toBeTruthy();
  });
});
