import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Field } from '../Field';
import { Checkbox } from './Checkbox';

describe('Checkbox', () => {
  it('is a native checkbox named by its text, and asks for the other state when it is pressed', () => {
    const onCheckedChange = vi.fn();
    const { rerender } = render(<Checkbox label="Match case" checked={false} onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole('checkbox', { name: 'Match case' });
    expect(box.tagName).toBe('INPUT');
    expect(box.tabIndex).toBe(0);
    fireEvent.click(box);
    expect(onCheckedChange).toHaveBeenLastCalledWith(true);
    // the value is the caller's: nothing changed until it says so
    expect((box as HTMLInputElement).checked).toBe(false);
    rerender(<Checkbox label="Match case" checked onCheckedChange={onCheckedChange} />);
    expect(screen.getByRole<HTMLInputElement>('checkbox').checked).toBe(true);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onCheckedChange).toHaveBeenLastCalledWith(false);
  });

  it('shows mixed as indeterminate, and a click on it asks for checked', () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Select all" checked="mixed" onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole<HTMLInputElement>('checkbox', { name: 'Select all' });
    expect(box.indeterminate).toBe(true);
    fireEvent.click(box);
    expect(onCheckedChange).toHaveBeenCalledWith(true);
  });

  it('is named by its Field when it is bare', () => {
    render(
      <Field label="Match case" layout="stacked">
        <Checkbox checked={false} onCheckedChange={() => undefined} />
      </Field>,
    );
    expect(screen.getByRole('checkbox', { name: 'Match case' })).toBeTruthy();
  });

  it('stays focusable and does nothing when it is unavailable for a reason, which describes it', () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox label="Match case" checked={false} disabledReason="The pattern is not text." onCheckedChange={onCheckedChange} />);
    const box = screen.getByRole('checkbox', { name: 'Match case' });
    expect(box.getAttribute('aria-disabled')).toBe('true');
    expect(box.hasAttribute('disabled')).toBe(false);
    expect(box.tabIndex).toBe(0);
    expect(document.getElementById(box.getAttribute('aria-describedby') ?? '')?.textContent).toBe('The pattern is not text.');
    fireEvent.click(box);
    expect(onCheckedChange).not.toHaveBeenCalled();
  });
});
