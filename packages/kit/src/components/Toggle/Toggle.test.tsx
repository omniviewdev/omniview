import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { Field } from '../Field';
import { Toggle, type ToggleProps } from './Toggle';
import * as examples from './Toggle.examples';

const toggle = (props: Partial<ToggleProps> = {}) => <Toggle label="Folding" checked={false} onCheckedChange={() => undefined} {...props} />;
const control = () => screen.getByRole('switch');

/** What describes `element`, as assistive technology reads it: the text of every element its `aria-describedby` names, in order. */
const description = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ');

describe('Toggle', () => {
  describe('the switch', () => {
    it('is a native button with the switch role, named by its label and one tab stop, that never submits a form', () => {
      render(toggle());
      const button = screen.getByRole('switch', { name: 'Folding' });
      expect(button.tagName).toBe('BUTTON');
      expect(button.getAttribute('type')).toBe('button');
      expect(button.tabIndex).not.toBe(-1);
      expect(button.hasAttribute('title')).toBe(false);
    });

    it('says whether it is on, and is not a pressed button', () => {
      const { rerender } = render(toggle({ checked: false }));
      expect(control().getAttribute('aria-checked')).toBe('false');
      expect(control().hasAttribute('aria-pressed')).toBe(false);
      rerender(toggle({ checked: true }));
      expect(control().getAttribute('aria-checked')).toBe('true');
      expect(screen.getByRole('switch', { name: 'Folding', checked: true })).toBeTruthy();
    });

    it('keeps one name for both states: the name does not say On or Off', () => {
      const { rerender } = render(toggle({ checked: false }));
      expect(screen.getByRole('switch', { name: 'Folding' })).toBeTruthy();
      rerender(toggle({ checked: true }));
      expect(screen.getByRole('switch', { name: 'Folding' })).toBeTruthy();
    });

    it('asks for the other state when it is pressed, and changes nothing itself: the value is the caller\'s', () => {
      const onCheckedChange = vi.fn();
      const { rerender } = render(toggle({ checked: false, onCheckedChange }));
      fireEvent.click(control());
      expect(onCheckedChange).toHaveBeenLastCalledWith(true);
      expect(control().getAttribute('aria-checked')).toBe('false');
      rerender(toggle({ checked: true, onCheckedChange }));
      fireEvent.click(control());
      expect(onCheckedChange).toHaveBeenLastCalledWith(false);
    });

    it('draws a track and a knob that are the same elements in both states, and nothing for assistive technology to read in them', () => {
      const { container, rerender } = render(toggle());
      const track = container.querySelector('[data-ov-part="track"]');
      expect(track).not.toBeNull();
      expect(track?.getAttribute('aria-hidden')).toBe('true');
      rerender(toggle({ checked: true }));
      expect(container.querySelector('[data-ov-part="track"]')).toBe(track);
    });

    it('passes data attributes to the button and nothing else', () => {
      render(toggle({ 'data-testid': 'fold' }));
      expect(screen.getByTestId('fold')).toBe(control());
    });

    it('is two elements: the button and its track', () => {
      const { container } = render(toggle());
      expect(container.querySelectorAll('*')).toHaveLength(2);
    });

    it('works end to end with a caller that owns the value', () => {
      function Caller() {
        const [on, setOn] = useState(false);
        return <Toggle label="Folding" checked={on} onCheckedChange={setOn} />;
      }

      render(<Caller />);
      fireEvent.click(control());
      expect(control().getAttribute('aria-checked')).toBe('true');
      fireEvent.click(control());
      expect(control().getAttribute('aria-checked')).toBe('false');
    });
  });

  describe('in a field', () => {
    it('is named by the label of its field, and a click on that label turns it', () => {
      const onCheckedChange = vi.fn();
      render(
        <Field label="Reuse a preview tab">
          <Toggle checked={false} onCheckedChange={onCheckedChange} />
        </Field>,
      );
      expect(screen.getByRole('switch', { name: 'Reuse a preview tab' })).toBe(control());
      expect(control().hasAttribute('aria-label')).toBe(false);
      fireEvent.click(screen.getByText('Reuse a preview tab'));
      expect(onCheckedChange).toHaveBeenCalledWith(true);
    });

    it('has no required state to say: a switch is never required', () => {
      render(
        <Field label="Folding" required>
          <Toggle checked={false} onCheckedChange={() => undefined} />
        </Field>,
      );
      expect(control().hasAttribute('required')).toBe(false);
      expect(control().hasAttribute('aria-required')).toBe(false);
    });

    it('is described by the lane of its field', () => {
      render(
        <Field label="Format on type" message={{ kind: 'info', text: 'Restart required to apply.' }}>
          <Toggle checked onCheckedChange={() => undefined} />
        </Field>,
      );
      expect(description(control())).toBe('Restart required to apply.');
    });
  });

  describe('unavailable for a reason (design P2, DR1)', () => {
    it('stays focusable, says it is unavailable and why, and does nothing', () => {
      const onCheckedChange = vi.fn();
      render(toggle({ disabledReason: 'Turn on Send telemetry to change this.', onCheckedChange }));
      expect(control().getAttribute('aria-disabled')).toBe('true');
      expect((control() as HTMLButtonElement).disabled).toBe(false);
      expect(control().tabIndex).not.toBe(-1);
      expect(description(control())).toBe('Turn on Send telemetry to change this.');
      fireEvent.click(control());
      expect(onCheckedChange).not.toHaveBeenCalled();
    });

    it('takes an empty reason for no reason', () => {
      render(toggle({ disabledReason: ' ' }));
      expect(control().hasAttribute('aria-disabled')).toBe(false);
    });

    it('is told by its field, which prints the reason itself: no second description', () => {
      const onCheckedChange = vi.fn();
      const { container } = render(
        <Field label="Traces" disabledReason="Turn on Send telemetry to change this.">
          <Toggle checked onCheckedChange={onCheckedChange} />
        </Field>,
      );
      expect(control().getAttribute('aria-disabled')).toBe('true');
      expect(description(control())).toBe('Turn on Send telemetry to change this.');
      expect(container.querySelectorAll('[hidden]')).toHaveLength(0);
      fireEvent.click(control());
      expect(onCheckedChange).not.toHaveBeenCalled();
    });
  });

  describe('read-only (design F-4)', () => {
    it('shows its value, says it cannot be changed, is not marked unavailable and does nothing', () => {
      const onCheckedChange = vi.fn();
      render(toggle({ checked: true, readOnly: true, onCheckedChange }));
      expect(control().getAttribute('aria-readonly')).toBe('true');
      expect(control().hasAttribute('aria-disabled')).toBe(false);
      expect(control().getAttribute('aria-checked')).toBe('true');
      fireEvent.click(control());
      expect(onCheckedChange).not.toHaveBeenCalled();
    });

    it('is told by its field', () => {
      render(
        <Field label="Folding" readOnly>
          <Toggle checked onCheckedChange={() => undefined} />
        </Field>,
      );
      expect(control().getAttribute('aria-readonly')).toBe('true');
    });
  });
});

describe('the examples of Toggle', () => {
  const entries = Object.entries(examples) as Array<[string, ComponentType]>;

  it('has an example for every state of a field: off, on, a change that is being checked, could not be checked, unavailable for a reason, and read-only and not supported', () => {
    expect(entries.map(([name]) => name).sort()).toEqual(['Idle', 'On', 'Validating', 'CouldNotCheck', 'DisabledWithReason', 'ReadOnlyNotSupported'].sort());
  });

  for (const [name, Example] of entries) {
    it(`renders ${name} with a named switch, no title and no inline style`, () => {
      const { container } = render(<Example />);
      expect(screen.getByRole('switch', { name: /./ })).toBeTruthy();
      expect(container.querySelector('[title], [style]')).toBeNull();
    });
  }

  it('turns the idle example on', () => {
    render(<examples.Idle />);
    expect(control().getAttribute('aria-checked')).toBe('false');
    fireEvent.click(control());
    expect(control().getAttribute('aria-checked')).toBe('true');
  });
});

const css = await readFile(path.join(import.meta.dirname, 'Toggle.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the Toggle stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^(?:\/\*[\s\S]*?\*\/\s*)?@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the mock\'s switch button: 34 by 24 px, a transparent 4 px target around the track', () => {
    const root = rule('.root');
    expect(root.width).toBe('34px');
    expect(root['min-width']).toBe('34px');
    expect(root.height).toBe('24px');
    expect(root['min-height']).toBe('24px');
    expect(root.padding).toBe('0');
    expect(root.border).toBe('0');
    expect(root['border-radius']).toBe('var(--ov-radius-control)');
    expect(root['background-color']).toBe('transparent');
    expect(root.display).toBe('inline-flex');
    expect(root['flex-shrink']).toBe('0');
  });

  it('is the mock\'s track: 26 by 16 px, a pill, the control border when off and the accent when on', () => {
    const track = rule('.track');
    expect(track.width).toBe('26px');
    expect(track.height).toBe('16px');
    expect(track['border-radius']).toBe('var(--ov-radius-popup)');
    expect(track['background-color']).toBe('var(--ov-border-control)');
    expect(rule('.root[aria-checked=\'true\'] .track')['background-color']).toBe('var(--ov-accent)');
  });

  it('is the mock\'s knob: 12 px, 2 px in, the icon role when off and the text over the accent when on, moved by a transform and not by layout', () => {
    const knob = rule('.track::after');
    expect(knob.width).toBe('12px');
    expect(knob.height).toBe('12px');
    expect(knob['border-radius']).toBe('50%');
    expect(knob['background-color']).toBe('var(--ov-icon)');
    expect(rule('.root[aria-checked=\'true\'] .track::after').transform).toBe('translateX(10px)');
    expect(rule('.root[aria-checked=\'true\'] .track::after')['background-color']).toBe('var(--ov-fg-over-accent)');
    for (const entry of cssRules(css)) {
      expect(Object.keys(entry.declarations), entry.selector).not.toContain('transition');
    }
  });

  it('paints hover on the target, a ring inside it when it has the keyboard\'s focus, and nothing for an unavailable switch', () => {
    expect(rule('.root:not([aria-disabled=\'true\']):hover')['background-color']).toBe('var(--ov-hover-toolbar)');
    expect(rule('.root:focus-visible').outline).toBe('2px solid var(--ov-accent)');
    expect(rule('.root:focus-visible')['outline-offset']).toBe('-2px');
    expect(rule('.root[aria-disabled=\'true\']').cursor).toBe('default');
  });

  it('paints an unavailable switch with the disabled roles, off or on', () => {
    expect(rule('.root[aria-disabled=\'true\'] .track')['background-color']).toBe('var(--ov-border-disabled)');
    expect(rule('.root[aria-disabled=\'true\'] .track::after')['background-color']).toBe('var(--ov-icon-disabled)');
  });

  it('keeps a read-only switch as legible as an enabled one: it is a fact, and only its hover and cursor say it cannot change', () => {
    expect(rule('.root[aria-readonly=\'true\']').cursor).toBe('default');
    expect(rule('.root[aria-readonly=\'true\']:hover')['background-color']).toBe('transparent');
  });
});
