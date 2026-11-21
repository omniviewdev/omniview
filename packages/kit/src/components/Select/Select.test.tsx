import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { Field } from '../Field';
import { Select, type SelectOption, type SelectProps } from './Select';
import * as examples from './Select.examples';

const OPTIONS: readonly SelectOption[] = [
  { value: 'en', label: 'English' },
  { value: 'es', label: 'Español' },
  { value: 'de', label: 'Deutsch', disabled: true },
];
const select = (props: Partial<SelectProps> = {}) => <Select label="Language" value="en" options={OPTIONS} onValueChange={() => undefined} {...props} />;
const box = () => screen.getByRole<HTMLSelectElement>('combobox');

/** What describes `element`, as assistive technology reads it: the text of every element its `aria-describedby` names, in order. */
const description = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ');

describe('Select', () => {
  describe('the select', () => {
    it('is a native select named by its label, with an option for each of the options it is given and no title', () => {
      render(select());
      const control = screen.getByRole<HTMLSelectElement>('combobox', { name: 'Language' });
      expect(control.tagName).toBe('SELECT');
      expect(control.hasAttribute('title')).toBe(false);
      expect([...control.options].map((option) => [option.value, option.textContent])).toEqual([
        ['en', 'English'],
        ['es', 'Español'],
        ['de', 'Deutsch'],
      ]);
      expect(control.options[2]?.disabled).toBe(true);
    });

    it('is controlled: it shows the value it is given and reports the one that is chosen, and changes nothing itself', () => {
      const onValueChange = vi.fn();
      const { rerender } = render(select({ value: 'en', onValueChange }));
      expect(box().value).toBe('en');
      fireEvent.change(box(), { target: { value: 'es' } });
      expect(onValueChange).toHaveBeenCalledWith('es');
      expect(box().value).toBe('en');
      rerender(select({ value: 'es', onValueChange }));
      expect(box().value).toBe('es');
    });

    it('shows the placeholder for a value that matches no option, whatever the caller holds', () => {
      render(select({ value: 'missing', placeholder: 'Choose a language' }));
      expect(box().value).toBe('');
      expect(box().selectedOptions[0]?.textContent).toBe('Choose a language');
    });

    it('says what is not chosen yet in a placeholder that cannot be chosen again', () => {
      render(select({ value: '', placeholder: 'Choose a language' }));
      expect(box().value).toBe('');
      const placeholder = box().options[0];
      expect(placeholder?.textContent).toBe('Choose a language');
      expect(placeholder?.disabled).toBe(true);
      expect(box().options).toHaveLength(OPTIONS.length + 1);
    });

    it('draws no placeholder when it has none, and shows the option that is chosen', () => {
      render(select());
      expect(box().options).toHaveLength(OPTIONS.length);
      expect(box().selectedOptions[0]?.textContent).toBe('English');
    });

    it('takes the width of its place or the mock\'s least width for a select in a row, and the code face for identifiers', () => {
      const { rerender } = render(select());
      const root = () => box().parentElement;
      expect(root()?.getAttribute('data-ov-part')).toBe('select');
      expect(root()?.getAttribute('data-ov-width')).toBe('fill');
      rerender(select({ width: 'normal', mono: true }));
      expect(root()?.getAttribute('data-ov-width')).toBe('normal');
      expect(box().getAttribute('data-ov-mono')).toBe('true');
    });

    it('draws its arrow as a glyph of the registry that no assistive technology reads and no pointer hits', () => {
      const { container } = render(select());
      const glyph = container.querySelector('svg');
      expect(glyph?.getAttribute('data-ov-glyph')).toBe('chevron-down');
      expect(glyph?.getAttribute('data-ov-size')).toBe('12');
      expect(glyph?.getAttribute('aria-hidden')).toBe('true');
    });

    it('passes data attributes to the select and nothing else', () => {
      render(select({ 'data-testid': 'language' }));
      expect(screen.getByTestId('language')).toBe(box());
    });

    it('is the elements it needs: the box, the select and its options, the arrow and its path', () => {
      const { container } = render(select());
      // root, select, 3 options, chevron wrapper, svg, path
      expect(container.querySelectorAll('*')).toHaveLength(8);
    });

    it('works end to end with a caller that owns the value', () => {
      function Caller() {
        const [value, setValue] = useState('en');
        return <Select label="Language" value={value} options={OPTIONS} onValueChange={setValue} />;
      }

      render(<Caller />);
      fireEvent.change(box(), { target: { value: 'es' } });
      expect(box().value).toBe('es');
    });
  });

  describe('invalid', () => {
    it('is marked invalid for assistive technology when it is told so, and by the error of its field', () => {
      const { rerender } = render(select());
      expect(box().hasAttribute('aria-invalid')).toBe(false);
      rerender(select({ invalid: true }));
      expect(box().getAttribute('aria-invalid')).toBe('true');
      rerender(
        <Field label="Language" message={{ kind: 'error', text: 'Not a language. Choose one of the list.' }}>
          <Select value="xx" options={OPTIONS} onValueChange={() => undefined} />
        </Field>,
      );
      expect(box().getAttribute('aria-invalid')).toBe('true');
      expect(description(box())).toBe('Error: Not a language. Choose one of the list.');
    });
  });

  describe('a name', () => {
    it('is taken from the label of its field, and never from an aria-label of its own', () => {
      render(
        <Field label="Editor theme">
          <Select label="Something else" value="en" options={OPTIONS} onValueChange={() => undefined} />
        </Field>,
      );
      expect(screen.getByRole('combobox', { name: 'Editor theme' })).toBe(box());
      expect(box().hasAttribute('aria-label')).toBe(false);
    });
  });

  describe('unavailable for a reason (design P2, DR1)', () => {
    it('stays focusable, says it is unavailable and why, and keeps its value', () => {
      render(select({ disabledReason: 'Start the plugin to change this.' }));
      expect(box().getAttribute('aria-disabled')).toBe('true');
      expect(box().disabled).toBe(false);
      expect(box().tabIndex).not.toBe(-1);
      expect(description(box())).toBe('Start the plugin to change this.');
      expect(box().value).toBe('en');
    });

    it('does not open and does not change: the pointer and every key that would change it are refused, Tab is not', () => {
      const onValueChange = vi.fn();
      render(select({ disabledReason: 'Why.', onValueChange }));
      const press = createEvent.mouseDown(box());
      fireEvent(box(), press);
      expect(press.defaultPrevented).toBe(true);
      for (const key of ['ArrowDown', 'ArrowUp', ' ', 'Enter', 'Home', 'End', 'PageDown', 'e']) {
        const event = createEvent.keyDown(box(), { key });
        fireEvent(box(), event);
        expect(event.defaultPrevented, key).toBe(true);
      }

      const tab = createEvent.keyDown(box(), { key: 'Tab' });
      fireEvent(box(), tab);
      expect(tab.defaultPrevented).toBe(false);
      fireEvent.change(box(), { target: { value: 'es' } });
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('is told by its field, which prints the reason itself', () => {
      const { container } = render(
        <Field label="Language" disabledReason="Start the plugin to change this.">
          <Select value="en" options={OPTIONS} onValueChange={() => undefined} />
        </Field>,
      );
      expect(box().getAttribute('aria-disabled')).toBe('true');
      expect(description(box())).toBe('Start the plugin to change this.');
      expect(container.querySelectorAll('[hidden]')).toHaveLength(0);
    });
  });

  describe('read-only (the mock: any control but a text field is painted and exposed as unavailable, core.js:188)', () => {
    it('shows its value, is exposed as unavailable and says why, and does not open or change', () => {
      const onValueChange = vi.fn();
      render(select({ readOnly: true, onValueChange }));
      expect(box().getAttribute('aria-disabled')).toBe('true');
      expect(box().hasAttribute('aria-readonly')).toBe(false);
      expect(description(box())).toBe('Read-only.');
      const press = createEvent.mouseDown(box());
      fireEvent(box(), press);
      expect(press.defaultPrevented).toBe(true);
      const arrow = createEvent.keyDown(box(), { key: 'ArrowDown' });
      fireEvent(box(), arrow);
      expect(arrow.defaultPrevented).toBe(true);
      fireEvent.change(box(), { target: { value: 'es' } });
      expect(onValueChange).not.toHaveBeenCalled();
    });
  });

  describe('an available select leaves the keyboard to the platform (design 04: a dropdown keeps the native select\'s keyboard model)', () => {
    it('refuses no key and no press', () => {
      render(select());
      const press = createEvent.mouseDown(box());
      fireEvent(box(), press);
      expect(press.defaultPrevented).toBe(false);
      for (const key of ['ArrowDown', ' ', 'Enter', 'Home', 'a']) {
        const event = createEvent.keyDown(box(), { key });
        fireEvent(box(), event);
        expect(event.defaultPrevented, key).toBe(false);
      }
    });
  });
});

describe('the examples of Select', () => {
  const entries = Object.entries(examples) as Array<[string, ComponentType]>;

  it('has an example for every state of a field, and one that says nothing is chosen yet', () => {
    expect(entries.map(([name]) => name).sort()).toEqual(['Idle', 'Validating', 'Invalid', 'CouldNotCheck', 'DisabledWithReason', 'ReadOnlyNotSupported', 'NothingChosen', 'Mono'].sort());
  });

  for (const [name, Example] of entries) {
    it(`renders ${name} with a named select, no title and no inline style`, () => {
      const { container } = render(<Example />);
      expect(screen.getByRole('combobox', { name: /./ })).toBeTruthy();
      expect(container.querySelector('[title], [style]')).toBeNull();
    });
  }

  it('lets the idle example choose another option', () => {
    render(<examples.Idle />);
    const other = [...box().options].find((option) => option.value !== box().value && !option.disabled);
    fireEvent.change(box(), { target: { value: other?.value } });
    expect(box().value).toBe(other?.value);
  });
});

const css = await readFile(path.join(import.meta.dirname, 'Select.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the Select stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^(?:\/\*[\s\S]*?\*\/\s*)?@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the mock\'s select: the face of an input with room for the arrow at its end, drawn by the part and not by the browser', () => {
    const control = rule('.select');
    expect(control.appearance).toBe('none');
    expect(control.width).toBe('100%');
    expect(control['padding-inline']).toBe('9px 28px');
    expect(control.display).toBe('block');
    expect(control['text-overflow']).toBe('ellipsis');
  });

  it('gives the box the width of its place, or at least the mock\'s 200 px in a row when there is room, never more than its place', () => {
    expect(rule('.root').position).toBe('relative');
    expect(rule('.root[data-ov-width=\'fill\']').display).toBe('block');
    expect(rule('.root[data-ov-width=\'normal\']')['min-width']).toBe('min(200px, 100%)');
    expect(rule('.root')['max-width']).toBe('100%');
  });

  it('puts the 12 px arrow 9 px from the end, centred, in the icon role, out of the pointer\'s way', () => {
    const chevron = rule('.chevron');
    expect(chevron.position).toBe('absolute');
    expect(chevron['inset-inline-end']).toBe('9px');
    expect(chevron['inset-block-start']).toBe('50%');
    expect(chevron['pointer-events']).toBe('none');
    expect(chevron['--_arrow']).toBe('var(--ov-icon)');
    expect(rule('.chevron > svg path[data-ov-stroke=\'chevron\']').stroke).toBe('var(--_arrow)');
  });

  it('draws the arrow in the disabled role when the select is unavailable', () => {
    expect(rule('.select[aria-disabled=\'true\'] ~ .chevron')['--_arrow']).toBe('var(--ov-icon-disabled)');
  });

  it('keeps a select of a set width at the start of its place instead of stretching it across a grid cell', () => {
    expect(rule('.root[data-ov-width=\'normal\']')['justify-self']).toBe('start');
  });
});
