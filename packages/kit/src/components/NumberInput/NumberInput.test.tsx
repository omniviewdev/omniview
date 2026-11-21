import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { Field } from '../Field';
import { NumberInput, type NumberInputProps } from './NumberInput';
import * as examples from './NumberInput.examples';

const number = (props: Partial<NumberInputProps> = {}) => <NumberInput label="Font size" value="11" onValueChange={() => undefined} min={8} max={32} {...props} />;
const field = () => screen.getByRole<HTMLInputElement>('spinbutton');
const decrease = () => screen.getByRole('button', { name: 'Decrease Font size' });
const increase = () => screen.getByRole('button', { name: 'Increase Font size' });

/** What describes `element`, as assistive technology reads it: the text of every element its `aria-describedby` names, in order. */
const description = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ');

describe('NumberInput', () => {
  describe('the field', () => {
    it('is a spin button in a native text input that takes decimals, named by its label, with no title and no help of the browser\'s', () => {
      render(number());
      const control = screen.getByRole<HTMLInputElement>('spinbutton', { name: 'Font size' });
      expect(control.tagName).toBe('INPUT');
      expect(control.type).toBe('text');
      expect(control.getAttribute('inputmode')).toBe('decimal');
      expect(control.getAttribute('autocomplete')).toBe('off');
      expect(control.getAttribute('spellcheck')).toBe('false');
      expect(control.hasAttribute('title')).toBe(false);
    });

    it('sits in a group named by its label, with the two steppers and the unit inside it', () => {
      const { container } = render(number({ unit: 'px' }));
      const group = screen.getByRole('group', { name: 'Font size' });
      expect(group.getAttribute('data-ov-part')).toBe('stepper');
      expect(group.contains(field())).toBe(true);
      expect(group.contains(decrease())).toBe(true);
      expect(group.contains(increase())).toBe(true);
      expect(container.querySelector('[data-ov-part="unit"]')?.textContent).toBe('px');
    });

    it('says its value, its bounds and its unit to assistive technology, and nothing of a text that is not a number', () => {
      const { rerender } = render(number({ unit: 'px' }));
      expect(field().getAttribute('aria-valuenow')).toBe('11');
      expect(field().getAttribute('aria-valuemin')).toBe('8');
      expect(field().getAttribute('aria-valuemax')).toBe('32');
      expect(field().getAttribute('aria-valuetext')).toBe('11 px');
      rerender(number({ value: 'abc', unit: 'px' }));
      expect(field().hasAttribute('aria-valuenow')).toBe(false);
      expect(field().hasAttribute('aria-valuetext')).toBe(false);
      rerender(number({ value: '99' }));
      expect(field().hasAttribute('aria-valuenow')).toBe(false);
      rerender(number({ min: undefined, max: undefined }));
      expect(field().hasAttribute('aria-valuemin')).toBe(false);
      expect(field().hasAttribute('aria-valuemax')).toBe(false);
    });

    it('is controlled and keeps the text as it was typed, whatever it is: it never clamps, rounds or reads it', () => {
      const onValueChange = vi.fn();
      const { rerender } = render(number({ value: '11', onValueChange }));
      fireEvent.change(field(), { target: { value: '1e' } });
      expect(onValueChange).toHaveBeenCalledWith('1e');
      expect(field().value).toBe('11');
      rerender(number({ value: '1e', onValueChange }));
      expect(field().value).toBe('1e');
      fireEvent.blur(field());
      expect(field().value).toBe('1e');
    });

    it('is drawn in tabular figures in the code face, centred', () => {
      render(number());
      expect(field().getAttribute('data-ov-mono')).toBe('true');
    });

    it('draws the unit only when it has one', () => {
      const { container, rerender } = render(number());
      expect(container.querySelector('[data-ov-part="unit"]')).toBeNull();
      rerender(number({ unit: '×' }));
      const unit = container.querySelector('[data-ov-part="unit"]');
      expect(unit?.textContent).toBe('×');
      expect(unit?.getAttribute('aria-hidden')).toBe('true');
    });

    it('passes data attributes to the group and nothing else', () => {
      render(number({ 'data-testid': 'size' }));
      expect(screen.getByTestId('size')).toBe(screen.getByRole('group'));
    });

    it('is four elements and one for the unit: the group, the two steppers, the field, and a glyph and its path in each stepper', () => {
      const count = (props: Partial<NumberInputProps>) => {
        const { container, unmount } = render(number(props));
        const total = container.querySelectorAll('*').length;
        unmount();
        return total;
      };

      // group, button, svg, path, button, svg, path, input
      expect(count({})).toBe(8);
      expect(count({ unit: 'px' })).toBe(9);
    });
  });

  describe('the steppers (design H.stepper: pointer shortcuts of one tab stop)', () => {
    it('are named for the field they step, and are not tab stops: the field is the one stop of the control', () => {
      render(number());
      expect(decrease().getAttribute('tabindex')).toBe('-1');
      expect(increase().getAttribute('tabindex')).toBe('-1');
      expect(decrease().getAttribute('type')).toBe('button');
      expect(decrease().querySelectorAll('svg')).toHaveLength(1);
      expect(decrease().querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('minus');
      expect(increase().querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('plus');
    });

    it('apply at once: the next number is the new text, and it is committed', () => {
      const onValueChange = vi.fn();
      const onCommit = vi.fn();
      render(number({ onValueChange, onCommit }));
      fireEvent.click(increase());
      expect(onValueChange).toHaveBeenLastCalledWith('12');
      expect(onCommit).toHaveBeenLastCalledWith('12');
      fireEvent.click(decrease());
      expect(onValueChange).toHaveBeenLastCalledWith('10');
      expect(onCommit).toHaveBeenLastCalledWith('10');
    });

    it('step by the step of the field, and add up decimals without their error', () => {
      const onValueChange = vi.fn();
      render(number({ value: '1.1', min: 1, max: 3, step: 0.1, onValueChange }));
      fireEvent.click(increase());
      expect(onValueChange).toHaveBeenLastCalledWith('1.2');
      fireEvent.click(decrease());
      expect(onValueChange).toHaveBeenLastCalledWith('1');
    });

    it('start from the minimum when the text is not a number, and stay inside the bounds', () => {
      const onValueChange = vi.fn();
      const { rerender } = render(number({ value: '', onValueChange }));
      fireEvent.click(increase());
      expect(onValueChange).toHaveBeenLastCalledWith('9');
      rerender(number({ value: '99', onValueChange }));
      fireEvent.click(decrease());
      expect(onValueChange).toHaveBeenLastCalledWith('32');
    });

    it('are unavailable at the bounds, say why, and do nothing', () => {
      const onValueChange = vi.fn();
      const onCommit = vi.fn();
      const { rerender } = render(number({ value: '8', onValueChange, onCommit }));
      expect(decrease().getAttribute('aria-disabled')).toBe('true');
      expect(description(decrease())).toBe('Minimum is 8');
      expect(increase().hasAttribute('aria-disabled')).toBe(false);
      fireEvent.click(decrease());
      expect(onValueChange).not.toHaveBeenCalled();
      rerender(number({ value: '32', onValueChange, onCommit }));
      expect(increase().getAttribute('aria-disabled')).toBe('true');
      expect(description(increase())).toBe('Maximum is 32');
      fireEvent.click(increase());
      expect(onValueChange).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('take no focus from the field when they are pressed: the next key is still the field\'s', () => {
      render(number());
      const press = createEvent.mouseDown(increase());
      fireEvent(increase(), press);
      expect(press.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(field());
    });
  });

  describe('the keyboard (design 14 P6: one tab stop, the arrows step it)', () => {
    it('steps by the step on the arrows and applies at once', () => {
      const onValueChange = vi.fn();
      const onCommit = vi.fn();
      render(number({ onValueChange, onCommit }));
      const up = createEvent.keyDown(field(), { key: 'ArrowUp' });
      fireEvent(field(), up);
      expect(up.defaultPrevented).toBe(true);
      expect(onValueChange).toHaveBeenLastCalledWith('12');
      expect(onCommit).toHaveBeenLastCalledWith('12');
      fireEvent.keyDown(field(), { key: 'ArrowDown' });
      expect(onValueChange).toHaveBeenLastCalledWith('10');
    });

    it('steps by a tenth of the range on PageUp and PageDown, and by ten without both bounds', () => {
      const onValueChange = vi.fn();
      const { rerender } = render(number({ value: '11', min: 8, max: 32, onValueChange }));
      fireEvent.keyDown(field(), { key: 'PageUp' });
      expect(onValueChange).toHaveBeenLastCalledWith('13');
      fireEvent.keyDown(field(), { key: 'PageDown' });
      expect(onValueChange).toHaveBeenLastCalledWith('9');
      rerender(number({ value: '5', min: 1, max: 10, step: 1, onValueChange }));
      fireEvent.keyDown(field(), { key: 'PageUp' });
      expect(onValueChange).toHaveBeenLastCalledWith('6');
      rerender(number({ value: '5', min: undefined, max: undefined, onValueChange }));
      fireEvent.keyDown(field(), { key: 'PageUp' });
      expect(onValueChange).toHaveBeenLastCalledWith('15');
    });

    it('refuses to leave the bounds and does not clamp: a step past a bound does nothing', () => {
      const onValueChange = vi.fn();
      render(number({ value: '32', onValueChange }));
      fireEvent.keyDown(field(), { key: 'ArrowUp' });
      fireEvent.keyDown(field(), { key: 'PageUp' });
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('does not step a text that is not a number, or one that is outside the bounds or off the grid: the user is to fix it', () => {
      const onValueChange = vi.fn();
      const { rerender } = render(number({ value: '', onValueChange }));
      for (const value of ['', 'abc', '99', '1', '11.5']) {
        rerender(number({ value, onValueChange }));
        const down = createEvent.keyDown(field(), { key: 'ArrowDown' });
        fireEvent(field(), down);
        expect(down.defaultPrevented, `"${value}"`).toBe(true);
      }

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('leaves a chord to the platform', () => {
      const onValueChange = vi.fn();
      render(number({ onValueChange }));
      for (const modifier of ['shiftKey', 'altKey', 'metaKey', 'ctrlKey']) {
        const event = createEvent.keyDown(field(), { key: 'ArrowUp', [modifier]: true });
        fireEvent(field(), event);
        expect(event.defaultPrevented, modifier).toBe(false);
      }

      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('commits the text as it is on a plain Enter, and not on one that confirms a composition', () => {
      const onCommit = vi.fn();
      render(number({ value: '99', onCommit }));
      fireEvent.keyDown(field(), { key: 'Enter', isComposing: true });
      expect(onCommit).not.toHaveBeenCalled();
      const enter = createEvent.keyDown(field(), { key: 'Enter' });
      fireEvent(field(), enter);
      expect(onCommit).toHaveBeenCalledWith('99');
      expect(enter.defaultPrevented).toBe(true);
    });

    it('reports that focus left the control, once, and not when it moves between the field and a stepper', () => {
      const onBlur = vi.fn();
      render(number({ onBlur }));
      fireEvent.blur(field(), { relatedTarget: increase() });
      expect(onBlur).not.toHaveBeenCalled();
      fireEvent.blur(field());
      expect(onBlur).toHaveBeenCalledTimes(1);
    });

    it('puts the applied value back on Escape when there is a draft, and lets Escape through when there is none', () => {
      const onRevert = vi.fn();
      const outside = vi.fn();
      const { rerender } = render(<div onKeyDown={outside}>{number({ dirty: true, onRevert })}</div>);
      const escape = createEvent.keyDown(field(), { key: 'Escape' });
      fireEvent(field(), escape);
      expect(onRevert).toHaveBeenCalledTimes(1);
      expect(escape.defaultPrevented).toBe(true);
      expect(outside).not.toHaveBeenCalled();
      rerender(<div onKeyDown={outside}>{number({ dirty: false, onRevert })}</div>);
      fireEvent.keyDown(field(), { key: 'Escape' });
      expect(onRevert).toHaveBeenCalledTimes(1);
      expect(outside).toHaveBeenCalledTimes(1);
    });

    it('works end to end with a caller that owns the text', () => {
      function Caller() {
        const [text, setText] = useState('11');
        return <NumberInput label="Font size" value={text} min={8} max={32} unit="px" onValueChange={setText} />;
      }

      render(<Caller />);
      fireEvent.keyDown(field(), { key: 'ArrowUp' });
      fireEvent.keyDown(field(), { key: 'ArrowUp' });
      expect(field().value).toBe('13');
      fireEvent.click(decrease());
      expect(field().value).toBe('12');
      expect(field().getAttribute('aria-valuetext')).toBe('12 px');
    });
  });

  describe('invalid', () => {
    it('is marked invalid for assistive technology when it is told so, and keeps its text', () => {
      const { rerender } = render(number({ value: '99' }));
      expect(field().hasAttribute('aria-invalid')).toBe(false);
      rerender(number({ value: '99', invalid: true }));
      expect(field().getAttribute('aria-invalid')).toBe('true');
      expect(field().value).toBe('99');
    });

    it('is marked invalid by the error of its field, which describes it', () => {
      render(
        <Field label="Font size" message={{ kind: 'error', text: 'Out of range. Use a value from 8 to 32.' }}>
          <NumberInput value="99" min={8} max={32} onValueChange={() => undefined} />
        </Field>,
      );
      expect(field().getAttribute('aria-invalid')).toBe('true');
      expect(description(field())).toBe('Error: Out of range. Use a value from 8 to 32.');
    });
  });

  describe('a name', () => {
    it('is the label of its field: the field is named by it, the group is too, and each stepper says which field it steps', () => {
      render(
        <Field label="Line height">
          <NumberInput value="1" min={1} max={3} step={0.1} onValueChange={() => undefined} />
        </Field>,
      );
      expect(screen.getByRole('spinbutton', { name: 'Line height' })).toBeTruthy();
      expect(screen.getByRole('group', { name: 'Line height' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Decrease Line height' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Increase Line height' })).toBeTruthy();
      expect(field().hasAttribute('aria-label')).toBe(false);
    });
  });

  describe('unavailable for a reason (design P2, DR1)', () => {
    it('stays focusable, says it is unavailable and why, and takes both steppers with it', () => {
      render(number({ disabledReason: 'Turn on Send telemetry to change this.' }));
      expect(field().getAttribute('aria-disabled')).toBe('true');
      expect(field().readOnly).toBe(true);
      expect(field().disabled).toBe(false);
      expect(description(field())).toBe('Turn on Send telemetry to change this.');
      expect(decrease().getAttribute('aria-disabled')).toBe('true');
      expect(increase().getAttribute('aria-disabled')).toBe('true');
    });

    it('changes nothing: neither the steppers, the arrows, Enter nor typing', () => {
      const onValueChange = vi.fn();
      const onCommit = vi.fn();
      render(number({ disabledReason: 'Why.', dirty: true, onValueChange, onCommit }));
      fireEvent.click(increase());
      fireEvent.keyDown(field(), { key: 'ArrowUp' });
      fireEvent.keyDown(field(), { key: 'Enter' });
      fireEvent.change(field(), { target: { value: '12' } });
      expect(onValueChange).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('is told by its field, which prints the reason itself', () => {
      const { container } = render(
        <Field label="Font size" disabledReason="Start the plugin to change this.">
          <NumberInput value="11" min={8} max={32} onValueChange={() => undefined} />
        </Field>,
      );
      expect(field().getAttribute('aria-disabled')).toBe('true');
      expect(description(field())).toBe('Start the plugin to change this.');
      expect(container.querySelectorAll('[hidden]').length).toBe(2);
    });
  });

  describe('read-only (design F-4)', () => {
    it('is a read-only field that is not dimmed and not marked unavailable, and its steppers do nothing', () => {
      const onValueChange = vi.fn();
      render(number({ readOnly: true, onValueChange }));
      expect(field().readOnly).toBe(true);
      expect(field().hasAttribute('aria-disabled')).toBe(false);
      expect(decrease().getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(increase());
      fireEvent.keyDown(field(), { key: 'ArrowUp' });
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });
});

describe('the examples of NumberInput', () => {
  const entries = Object.entries(examples) as Array<[string, ComponentType]>;

  it('has an example for every state of a field, and one with a unit, one with decimals', () => {
    expect(entries.map(([name]) => name).sort()).toEqual(
      ['Idle', 'Dirty', 'Validating', 'Invalid', 'CouldNotCheck', 'DisabledWithReason', 'ReadOnlyNotSupported', 'WithUnit', 'Decimals', 'AtTheMinimum'].sort(),
    );
  });

  for (const [name, Example] of entries) {
    it(`renders ${name} with a named spin button, no title and no inline style`, () => {
      const { container } = render(<Example />);
      expect(screen.getByRole('spinbutton', { name: /./ })).toBeTruthy();
      expect(container.querySelector('[title], [style]')).toBeNull();
    });
  }

  it('steps the idle example with its buttons', () => {
    render(<examples.Idle />);
    const before = Number(field().value);
    fireEvent.click(screen.getByRole('button', { name: /^Increase/ }));
    expect(Number(field().value)).toBe(before + 1);
  });
});

const css = await readFile(path.join(import.meta.dirname, 'NumberInput.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the NumberInput stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^(?:\/\*[\s\S]*?\*\/\s*)?@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the mock\'s input group: one face of the control height, 4 px between the steppers, the field and the unit, 2 px inside the edge', () => {
    const group = rule('.group');
    expect(group.display).toBe('flex');
    expect(group.width).toBe('fit-content');
    expect(group['max-width']).toBe('100%');
    expect(group['align-items']).toBe('center');
    expect(group.gap).toBe('var(--ov-spacing-4)');
    expect(group['padding-inline']).toBe('var(--ov-spacing-2)');
    expect(group['min-height']).toBe('var(--ov-control-height)');
    expect(group.border).toBe('1px solid var(--_border)');
    expect(group['border-radius']).toBe('var(--ov-radius-control)');
    expect(group['background-color']).toBe('var(--_bg)');
    expect(group['--_border']).toBe('var(--ov-border-control)');
  });

  it('takes the focus ring on the group when the field has the focus, and the error colours when the field is invalid', () => {
    expect(rule('.group:focus-within').outline).toBe('2px solid var(--_ring)');
    expect(rule('.group:focus-within')['--_border']).toBe('var(--ov-bg-island)');
    expect(rule('.group:has([aria-invalid=\'true\'])')['--_border']).toBe('var(--ov-error-control-inactive)');
    expect(rule('.group:has([aria-invalid=\'true\']):focus-within')['--_ring']).toBe('var(--ov-error-control)');
  });

  it('paints a read-only group and an unavailable one on the inline surface with a quiet edge, as the mock does, and dims the text of an unavailable one', () => {
    expect(rule('.group:has(> input[readonly])')['--_bg']).toBe('var(--ov-bg-inline)');
    expect(rule('.group:has(> input[readonly])')['--_border']).toBe('var(--ov-border-subtle)');
    expect(rule('.group:has(> input[aria-disabled=\'true\'])')['--_fg']).toBe('var(--ov-fg-disabled)');
  });

  it('keeps the field as wide as 20 characters of its own face and the number in tabular figures, centred, without the browser\'s spin buttons', () => {
    const field = rule('.field');
    expect(field.width).toBe('calc(180px * var(--ov-text-scale))');
    expect(field['text-align']).toBe('center');
    expect(field['font-variant-numeric']).toBe('tabular-nums');
    expect(field.appearance).toBe('textfield');
    expect(field.border).toBe('0');
    expect(field.background).toBe('transparent');
    expect(field.padding).toBe('0');
  });

  it('draws the steppers 24 px square whatever the density', () => {
    const step = rule('.group > [data-ov-slot=\'decrease\']');
    expect(step.width).toBe('24px');
    expect(step['min-width']).toBe('24px');
    expect(step.height).toBe('24px');
    expect(step['min-height']).toBe('24px');
    expect(step.padding).toBe('0');
    expect(step.flex).toBe('0 0 24px');
  });

  it('draws the unit in the muted role', () => {
    const unit = rule('.unit');
    expect(unit.color).toBe('var(--ov-fg-muted)');
    expect(unit['white-space']).toBe('nowrap');
  });
});
