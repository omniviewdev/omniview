import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { Field } from '../Field';
import { SwatchPicker, type SwatchOption } from './SwatchPicker';

const OPTIONS: readonly SwatchOption[] = [
  { color: 'blue', label: 'Blue' },
  { color: 'green', label: 'Green' },
  { color: 'amber', label: 'Amber' },
];

const radios = () => screen.getAllByRole('radio');
const tabStops = () => radios().filter((radio) => radio.tabIndex === 0);
const press = (key: string) => {
  fireEvent.keyDown(document.activeElement ?? document.body, { key });
};

describe('SwatchPicker', () => {
  it('is a radiogroup of swatches named by their labels, with nothing checked for the default colour and a check mark on the chosen one', () => {
    const { rerender } = render(<SwatchPicker label="Color" options={OPTIONS} value={null} onValueChange={() => undefined} />);
    expect(screen.getByRole('radiogroup', { name: 'Color' })).toBeDefined();
    expect(radios().map((radio) => radio.getAttribute('aria-label'))).toEqual(['Blue', 'Green', 'Amber']);
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false']);
    expect(document.querySelectorAll('svg')).toHaveLength(0);

    rerender(<SwatchPicker label="Color" options={OPTIONS} value="green" onValueChange={() => undefined} />);
    expect(radios().map((radio) => radio.getAttribute('aria-checked'))).toEqual(['false', 'true', 'false']);
    expect(radios().map((radio) => radio.querySelector('svg') !== null)).toEqual([false, true, false]);
  });

  it('is one Tab stop: the chosen swatch, or the first one when none is chosen', () => {
    const { rerender } = render(<SwatchPicker label="Color" options={OPTIONS} value={null} onValueChange={() => undefined} />);
    expect(tabStops()).toEqual([radios()[0]]);
    rerender(<SwatchPicker label="Color" options={OPTIONS} value="amber" onValueChange={() => undefined} />);
    expect(tabStops()).toEqual([radios()[2]]);
  });

  it('moves the focus with the arrows, Home and End, wraps at the ends, takes the Tab stop along, and never chooses', () => {
    const onValueChange = vi.fn();
    render(<SwatchPicker label="Color" options={OPTIONS} value="blue" onValueChange={onValueChange} />);
    act(() => {
      radios()[0]?.focus();
    });

    press('ArrowRight');
    expect(document.activeElement).toBe(radios()[1]);
    expect(tabStops()).toEqual([radios()[1]]);
    press('End');
    expect(document.activeElement).toBe(radios()[2]);
    press('ArrowDown');
    expect(document.activeElement).toBe(radios()[0]);
    press('ArrowLeft');
    expect(document.activeElement).toBe(radios()[2]);
    press('Home');
    expect(document.activeElement).toBe(radios()[0]);
    press('ArrowRight');
    expect(onValueChange).not.toHaveBeenCalled();

    // Once the focus leaves the group, the chosen swatch is the Tab stop again.
    act(() => {
      radios()[1]?.blur();
    });
    expect(tabStops()).toEqual([radios()[0]]);
  });

  it('chooses with the pointer, Enter or Space (a click of a button), once, and not a colour that is already chosen', () => {
    const onValueChange = vi.fn();
    render(<SwatchPicker label="Color" options={OPTIONS} value="blue" onValueChange={onValueChange} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Blue' }));
    expect(onValueChange).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('radio', { name: 'Amber' }));
    expect(onValueChange).toHaveBeenCalledTimes(1);
    expect(onValueChange).toHaveBeenCalledWith('amber');
  });

  it('keeps a swatch that is unavailable in the group and reachable, says why, and chooses nothing with it', () => {
    const onValueChange = vi.fn();
    const options: readonly SwatchOption[] = [
      { color: 'blue', label: 'Blue' },
      { color: 'green', label: 'Green', disabledReason: 'Reserved.' },
      { color: 'amber', label: 'Amber' },
    ];
    render(<SwatchPicker label="Color" options={options} value={null} onValueChange={onValueChange} />);
    const green = screen.getByRole('radio', { name: 'Green' });
    expect(green.getAttribute('aria-disabled')).toBe('true');
    expect(green.getAttribute('data-ov-tip')).toBe('Reserved.');
    expect(document.getElementById(green.getAttribute('aria-describedby') ?? '')?.textContent).toBe('Reserved.');
    expect(screen.getByRole('radio', { name: 'Blue' }).hasAttribute('aria-disabled')).toBe(false);

    act(() => {
      radios()[0]?.focus();
    });
    press('ArrowRight');
    expect(document.activeElement).toBe(green);
    fireEvent.click(green);
    expect(onValueChange).not.toHaveBeenCalled();
  });

  it('is named and described by the Field around it, and locked by the Field\'s reason', () => {
    const onValueChange = vi.fn();
    render(
      <Field label="Color" disabledReason="Resolve the current operation first.">
        <SwatchPicker options={OPTIONS} value="blue" onValueChange={onValueChange} />
      </Field>,
    );
    const group = screen.getByRole('radiogroup', { name: 'Color' });
    expect(group.hasAttribute('aria-label')).toBe(false);
    expect(document.getElementById(group.getAttribute('aria-describedby') ?? '')?.textContent).toContain('Resolve the current operation first.');
    expect(radios().map((radio) => radio.getAttribute('aria-disabled'))).toEqual(['true', 'true', 'true']);
    fireEvent.click(screen.getByRole('radio', { name: 'Green' }));
    expect(onValueChange).not.toHaveBeenCalled();
  });
});
