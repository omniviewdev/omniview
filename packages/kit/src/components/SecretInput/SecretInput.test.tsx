import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createEvent, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { Field } from '../Field';
import { SecretInput, type SecretInputProps } from './SecretInput';
import * as examples from './SecretInput.examples';

// What a secret looks like to the tests: a string nothing else on the page says, searched for in every attribute, every text and every
// accessible name the part makes. The typed text may be in ONE place, the `value` of the input that holds it.
const SENTINEL = 'sk-live-7f3a9c2e41-SENTINEL';
const noop = () => undefined;

const secret = (props: Partial<SecretInputProps> = {}) => <SecretInput label="API token" presence="unset" changed={false} onValueChange={noop} {...props} />;
const box = () => screen.getByLabelText<HTMLInputElement>('API token', { selector: 'input' });
const replace = () => screen.getByRole('button', { name: 'Replace API token' });
const cancel = () => screen.getByRole('button', { name: 'Cancel replacing API token' });
const eye = () => screen.getByRole('button', { name: 'Show API token' });
const type = (text: string) => fireEvent.change(box(), { target: { value: text } });

/** What describes `element`, as assistive technology reads it: the text of every element its `aria-describedby` names, in order. */
const description = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ');

/** Every place the page says something that is not the `value` property of an input: attributes, text, and the title of every element. */
function everywhere(root: ParentNode = document.body): string[] {
  const found: string[] = [];
  const walk = (node: Element) => {
    for (const attribute of node.attributes) {
      found.push(`${node.tagName}[${attribute.name}]=${attribute.value}`);
    }

    for (const child of node.childNodes) {
      if (child.nodeType === 3) {
        found.push(`#text=${child.textContent ?? ''}`);
      } else if (child.nodeType === 1) {
        walk(child as Element);
      }
    }
  };

  for (const element of Array.from(root.children)) {
    walk(element);
  }

  return found;
}

const leaks = () => everywhere().filter((place) => place.includes(SENTINEL));

describe('SecretInput', () => {
  describe('not set', () => {
    it('is an empty password field that says "Not set", and has no stored value to replace', () => {
      const { container } = render(secret());
      const control = box();
      expect(control.tagName).toBe('INPUT');
      expect(control.type).toBe('password');
      expect(control.value).toBe('');
      expect(control.getAttribute('placeholder')).toBe('Not set');
      expect(control.readOnly).toBe(false);
      expect(screen.queryByRole('button', { name: /^Replace/ })).toBeNull();
      expect(container.firstElementChild?.getAttribute('data-ov-state')).toBe('unset');
    });

    it('offers to show what is typed, and says it cannot yet: there is nothing typed to show', () => {
      render(secret());
      expect(eye().getAttribute('aria-disabled')).toBe('true');
      expect(description(eye())).toBe('Type a value first.');
      expect(eye().getAttribute('aria-pressed')).toBe('false');
    });
  });

  describe('set', () => {
    it('shows that a secret is saved and never what it is: an empty, read-only field that says "Set"', () => {
      const { container } = render(secret({ presence: 'set' }));
      const control = box();
      expect(control.type).toBe('password');
      expect(control.value).toBe('');
      expect(control.getAttribute('placeholder')).toBe('Set');
      expect(control.readOnly).toBe(true);
      expect(control.hasAttribute('value')).toBe(false);
      expect(container.firstElementChild?.getAttribute('data-ov-state')).toBe('locked');
    });

    it('has no way to show it: there is no reveal at all for a secret that is only stored', () => {
      render(secret({ presence: 'set' }));
      expect(screen.queryByRole('button', { name: /show|reveal|hide|eye/i })).toBeNull();
      expect(screen.getAllByRole('button')).toHaveLength(1);
      expect(replace().getAttribute('type')).toBe('button');
      expect(document.body.querySelector('svg[data-ov-glyph^="eye"]')).toBeNull();
    });

    it('cannot be given the stored value: there is no prop for it, and the field never takes one', () => {
      const props: SecretInputProps = {
        label: 'API token',
        presence: 'set',
        changed: false,
        onValueChange: noop,
        // @ts-expect-error a secret has no `value`: the part never receives what is stored
        value: SENTINEL,
      };
      render(<SecretInput {...props} />);
      expect(box().value).toBe('');
      expect(leaks()).toEqual([]);
    });

    it('does not type, and does not commit what it does not hold', () => {
      const onValueChange = vi.fn();
      const onCommit = vi.fn();
      render(secret({ presence: 'set', onValueChange, onCommit }));
      type(SENTINEL);
      fireEvent.keyDown(box(), { key: 'Enter' });
      expect(onValueChange).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
    });
  });

  describe('Replace', () => {
    it('opens an empty field for the new value, puts the focus in it, and offers to cancel', () => {
      const onValueChange = vi.fn();
      const { container } = render(secret({ presence: 'set', onValueChange }));
      fireEvent.click(replace());
      expect(box().readOnly).toBe(false);
      expect(box().value).toBe('');
      expect(document.activeElement).toBe(box());
      expect(container.firstElementChild?.getAttribute('data-ov-state')).toBe('replacing');
      expect(cancel()).toBeTruthy();
      expect(screen.queryByRole('button', { name: 'Replace API token' })).toBeNull();
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('still says "Set" while nothing is typed: the stored secret is still there until it is replaced', () => {
      render(secret({ presence: 'set' }));
      fireEvent.click(replace());
      expect(box().getAttribute('placeholder')).toBe('Set');
    });

    it('offers to show only what is typed, from the moment the field is open', () => {
      render(secret({ presence: 'set' }));
      fireEvent.click(replace());
      expect(eye().getAttribute('aria-disabled')).toBe('true');
      type(SENTINEL);
      expect(eye().hasAttribute('aria-disabled')).toBe(false);
    });

    it('takes the new field back when it is cancelled, with the focus on Replace', () => {
      const onRevert = vi.fn();
      const { container } = render(secret({ presence: 'set', onRevert }));
      fireEvent.click(replace());
      fireEvent.click(cancel());
      expect(box().readOnly).toBe(true);
      expect(container.firstElementChild?.getAttribute('data-ov-state')).toBe('locked');
      expect(document.activeElement).toBe(replace());
      // Nothing was typed, so there is nothing for the model to put back.
      expect(onRevert).not.toHaveBeenCalled();
    });
  });

  describe('typing and pasting', () => {
    it('reports what is typed, at once and whole, and the markup never holds it', () => {
      const onValueChange = vi.fn();
      render(secret({ onValueChange }));
      type(SENTINEL);
      expect(onValueChange).toHaveBeenCalledTimes(1);
      expect(onValueChange).toHaveBeenCalledWith(SENTINEL);
      expect(box().value).toBe(SENTINEL);
      expect(box().hasAttribute('value')).toBe(false);
      expect(leaks()).toEqual([]);
      expect(document.body.innerHTML).not.toContain(SENTINEL);
    });

    it('is uncontrolled: the part is given no value and a rerender never puts one back or takes the typed one away', () => {
      const { rerender } = render(secret({ changed: false }));
      type(SENTINEL);
      for (const changed of [true, true, true]) {
        rerender(secret({ changed }));
        expect(box().value).toBe(SENTINEL);
      }

      expect(leaks()).toEqual([]);
    });

    it('lets a secret be pasted, which is how most of them arrive: nothing in the part stops a paste', () => {
      const onValueChange = vi.fn();
      render(secret({ onValueChange }));
      const paste = createEvent.paste(box(), { clipboardData: { getData: () => SENTINEL } });
      fireEvent(box(), paste);
      expect(paste.defaultPrevented).toBe(false);
      // The browser then inserts the text, which is an input event like any other.
      type(SENTINEL);
      expect(onValueChange).toHaveBeenLastCalledWith(SENTINEL);
    });

    it('does not let the browser keep it for later: no autofill, no suggestions, no spelling, no capitals', () => {
      render(secret());
      expect(box().getAttribute('autocomplete')).toBe('new-password');
      expect(box().getAttribute('autocapitalize')).toBe('off');
      expect(box().getAttribute('autocorrect')).toBe('off');
      expect(box().getAttribute('spellcheck')).toBe('false');
    });

    it('is drawn in the code face, like the mock\'s', () => {
      render(secret());
      expect(box().getAttribute('data-ov-mono')).toBe('true');
    });
  });

  describe('Show (what is typed, and only that)', () => {
    it('turns the typed text into text and back, under one name, and says which it is', () => {
      render(secret());
      type(SENTINEL);
      expect(eye().getAttribute('aria-pressed')).toBe('false');
      fireEvent.click(eye());
      expect(box().type).toBe('text');
      expect(box().value).toBe(SENTINEL);
      expect(screen.getByRole('button', { name: 'Show API token' }).getAttribute('aria-pressed')).toBe('true');
      fireEvent.click(eye());
      expect(box().type).toBe('password');
      expect(box().value).toBe(SENTINEL);
    });

    it('draws the eye and the struck eye, which are decorative', () => {
      render(secret());
      type(SENTINEL);
      expect(eye().querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('eye');
      fireEvent.click(eye());
      expect(eye().querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('eye-off');
      expect(eye().querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    });

    it('keeps the focus in the field when it is pressed with the pointer, so nothing is committed by looking', () => {
      const onBlur = vi.fn();
      render(secret({ onBlur }));
      type(SENTINEL);
      const press = createEvent.mouseDown(eye());
      fireEvent(eye(), press);
      expect(press.defaultPrevented).toBe(true);
      expect(onBlur).not.toHaveBeenCalled();
    });
  });

  describe('being told to let go (the model says `changed` is false: reverted, applied, hidden, gone)', () => {
    it('empties the field in the DOM, covers it again and closes the field it opened', () => {
      const { container, rerender } = render(secret({ presence: 'set', changed: false }));
      fireEvent.click(replace());
      type(SENTINEL);
      rerender(secret({ presence: 'set', changed: true }));
      fireEvent.click(eye());
      expect(box().value).toBe(SENTINEL);
      expect(box().type).toBe('text');
      rerender(secret({ presence: 'set', changed: false }));
      expect(box().value).toBe('');
      expect(box().type).toBe('password');
      expect(box().readOnly).toBe(true);
      expect(container.firstElementChild?.getAttribute('data-ov-state')).toBe('locked');
      expect(screen.queryByRole('button', { name: /show/i })).toBeNull();
      expect(leaks()).toEqual([]);
      expect(document.body.innerHTML).not.toContain(SENTINEL);
    });

    it('empties a field that was never saved, and says "Not set" again', () => {
      const { rerender } = render(secret({ presence: 'unset', changed: false }));
      type(SENTINEL);
      rerender(secret({ presence: 'unset', changed: true }));
      rerender(secret({ presence: 'unset', changed: false }));
      expect(box().value).toBe('');
      expect(box().getAttribute('placeholder')).toBe('Not set');
    });

    it('says "Set" once the host has taken the secret: the field is closed and empty, whatever it held', () => {
      const { rerender } = render(secret({ presence: 'unset', changed: false }));
      type(SENTINEL);
      rerender(secret({ presence: 'unset', changed: true }));
      rerender(secret({ presence: 'set', changed: false }));
      expect(box().value).toBe('');
      expect(box().readOnly).toBe(true);
      expect(box().getAttribute('placeholder')).toBe('Set');
      expect(leaks()).toEqual([]);
    });

    it('keeps what is typed through everything else the model does: a rejection of the host leaves `changed` true and the text where it is', () => {
      const { rerender } = render(secret({ presence: 'set', changed: false }));
      fireEvent.click(replace());
      type(SENTINEL);
      for (let render = 0; render < 5; render += 1) {
        rerender(secret({ presence: 'set', changed: true, invalid: render % 2 === 0 }));
      }

      expect(box().value).toBe(SENTINEL);
      expect(box().readOnly).toBe(false);
    });

    it('says "Changed" for a secret the model holds that this field no longer shows (the field came back empty)', () => {
      render(secret({ presence: 'set', changed: true }));
      expect(box().value).toBe('');
      expect(box().getAttribute('placeholder')).toBe('Changed');
    });

    it('takes the secret with it when it goes: nothing is left in the document', () => {
      const { unmount } = render(secret());
      type(SENTINEL);
      unmount();
      expect(document.body.innerHTML).not.toContain(SENTINEL);
      expect(document.body.querySelector('input')).toBeNull();
    });
  });

  describe('the keyboard (design S125: a secret commits on Enter or blur; Escape puts the applied value back)', () => {
    it('commits on a plain Enter, and not on one that confirms a composition', () => {
      const onCommit = vi.fn();
      render(secret({ onCommit }));
      type(SENTINEL);
      fireEvent.keyDown(box(), { key: 'Enter', isComposing: true });
      fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
      expect(onCommit).not.toHaveBeenCalled();
      const enter = createEvent.keyDown(box(), { key: 'Enter' });
      fireEvent(box(), enter);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(enter.defaultPrevented).toBe(true);
    });

    it('reports that focus left the control, once, and not when it moves to a button of the control', () => {
      const onBlur = vi.fn();
      render(secret({ presence: 'set', onBlur }));
      fireEvent.click(replace());
      type(SENTINEL);
      fireEvent.blur(box(), { relatedTarget: eye() });
      fireEvent.blur(box(), { relatedTarget: cancel() });
      expect(onBlur).not.toHaveBeenCalled();
      fireEvent.blur(box());
      expect(onBlur).toHaveBeenCalledTimes(1);
    });

    it('puts the applied state back on Escape when something is typed: the model is told, the field is emptied, the key goes no further', () => {
      const onRevert = vi.fn();
      const outside = vi.fn();
      render(<div onKeyDown={outside}>{secret({ onRevert, changed: true })}</div>);
      type(SENTINEL);
      const escape = createEvent.keyDown(box(), { key: 'Escape' });
      fireEvent(box(), escape);
      expect(onRevert).toHaveBeenCalledTimes(1);
      expect(escape.defaultPrevented).toBe(true);
      expect(outside).not.toHaveBeenCalled();
      expect(box().value).toBe('');
      expect(leaks()).toEqual([]);
    });

    it('closes the field of a Replace on Escape, and tells the model only when something was typed', () => {
      const onRevert = vi.fn();
      const { rerender } = render(secret({ presence: 'set', onRevert }));
      fireEvent.click(replace());
      fireEvent.keyDown(box(), { key: 'Escape' });
      expect(box().readOnly).toBe(true);
      expect(onRevert).not.toHaveBeenCalled();
      fireEvent.click(replace());
      type(SENTINEL);
      rerender(secret({ presence: 'set', onRevert, changed: true }));
      fireEvent.keyDown(box(), { key: 'Escape' });
      expect(onRevert).toHaveBeenCalledTimes(1);
      expect(box().readOnly).toBe(true);
      expect(box().value).toBe('');
    });

    it('lets Escape through when there is nothing to put back', () => {
      const outside = vi.fn();
      render(<div onKeyDown={outside}>{secret()}</div>);
      fireEvent.keyDown(box(), { key: 'Escape' });
      expect(outside).toHaveBeenCalledTimes(1);
    });

    it('puts a cancelled secret back through the model, empties the field and goes back to Replace', () => {
      const onRevert = vi.fn();
      const { rerender } = render(secret({ presence: 'set', onRevert, changed: false }));
      fireEvent.click(replace());
      type(SENTINEL);
      rerender(secret({ presence: 'set', onRevert, changed: true }));
      fireEvent.click(cancel());
      expect(onRevert).toHaveBeenCalledTimes(1);
      expect(box().value).toBe('');
      expect(replace()).toBeTruthy();
      expect(leaks()).toEqual([]);
    });
  });

  describe('invalid', () => {
    it('is marked invalid for assistive technology, and by the error of its field', () => {
      const { rerender } = render(secret({ invalid: true }));
      expect(box().getAttribute('aria-invalid')).toBe('true');
      rerender(
        <Field label="API token" message={{ kind: 'error', text: 'Too short. Use at least 8 characters.' }}>
          <SecretInput presence="unset" changed onValueChange={noop} />
        </Field>,
      );
      expect(box().getAttribute('aria-invalid')).toBe('true');
      expect(description(box())).toBe('Error: Too short. Use at least 8 characters.');
    });
  });

  describe('unavailable for a reason (design P2, DR1)', () => {
    it('stays focusable, says it is unavailable and why, and offers nothing to do: Replace is unavailable too', () => {
      const onValueChange = vi.fn();
      render(secret({ presence: 'set', disabledReason: 'Start the plugin to change this.', onValueChange }));
      expect(box().getAttribute('aria-disabled')).toBe('true');
      expect(box().readOnly).toBe(true);
      expect(box().disabled).toBe(false);
      expect(description(box())).toBe('Start the plugin to change this.');
      expect(replace().getAttribute('aria-disabled')).toBe('true');
      fireEvent.click(replace());
      expect(box().readOnly).toBe(true);
      type(SENTINEL);
      expect(onValueChange).not.toHaveBeenCalled();
    });

    it('is told by its field, which prints the reason itself', () => {
      render(
        <Field label="API token" disabledReason="Start the plugin to change this.">
          <SecretInput presence="unset" changed={false} onValueChange={noop} />
        </Field>,
      );
      expect(box().getAttribute('aria-disabled')).toBe('true');
      expect(description(box())).toBe('Start the plugin to change this.');
    });
  });

  describe('read-only (design F-4)', () => {
    it('shows that a secret is set, says it cannot be changed, and offers no way to replace it', () => {
      render(secret({ presence: 'set', readOnly: true }));
      expect(box().readOnly).toBe(true);
      expect(box().hasAttribute('aria-disabled')).toBe(false);
      expect(box().getAttribute('placeholder')).toBe('Set');
      expect(screen.queryByRole('button')).toBeNull();
    });
  });

  describe('a name', () => {
    it('is the label of its field, which every button of the part names itself by: nothing is said without it', () => {
      render(
        <Field label="Auth value">
          <SecretInput presence="set" changed={false} onValueChange={noop} />
        </Field>,
      );
      expect(screen.getByLabelText('Auth value', { selector: 'input' }).tagName).toBe('INPUT');
      expect(screen.getByRole('button', { name: 'Replace Auth value' })).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Replace Auth value' }));
      expect(screen.getByRole('button', { name: 'Show Auth value' })).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Cancel replacing Auth value' })).toBeTruthy();
    });
  });

  it('passes data attributes to the root and nothing else', () => {
    render(secret({ 'data-testid': 'token' }));
    expect(screen.getByTestId('token').contains(box())).toBe(true);
  });

  it('draws no title and no inline style', () => {
    const { container } = render(secret({ presence: 'set' }));
    fireEvent.click(replace());
    expect(container.querySelector('[title], [style]')).toBeNull();
  });

  it('leaks nothing, whatever is done to it, in any order (a deterministic walk of 200 steps)', () => {
    const logged = vi.spyOn(console, 'log').mockImplementation(noop);
    const warned = vi.spyOn(console, 'warn').mockImplementation(noop);
    const failed = vi.spyOn(console, 'error').mockImplementation(noop);
    let seed = 7;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed;
    };

    let changed = false;
    let presence: 'set' | 'unset' = 'set';
    const { rerender } = render(secret({ presence, changed }));
    for (let step = 0; step < 200; step += 1) {
      const operation = next() % 9;
      const press = (name: RegExp) => {
        const target = screen.queryByRole('button', { name });
        if (target !== null) {
          fireEvent.click(target);
        }
      };

      if (operation === 0) {
        press(/^Replace/);
      } else if (operation === 1) {
        if (!box().readOnly) {
          type(`${SENTINEL}-${step}`);
        }
      } else if (operation === 2) {
        press(/^Show/);
      } else if (operation === 3) {
        press(/^Cancel/);
      } else if (operation === 4) {
        fireEvent.keyDown(box(), { key: 'Escape' });
      } else if (operation === 5) {
        changed = changed || (!box().readOnly && box().value !== '');
      } else if (operation === 6) {
        changed = false;
      } else if (operation === 7) {
        presence = presence === 'set' ? 'unset' : 'set';
      } else {
        fireEvent.keyDown(box(), { key: 'Enter' });
      }

      rerender(secret({ presence, changed }));
      expect(everywhere().filter((place) => place.includes('sk-live-')), `after step ${step}`).toEqual([]);
    }

    for (const spy of [logged, warned, failed]) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe('the examples of SecretInput', () => {
  const entries = Object.entries(examples) as Array<[string, ComponentType]>;

  it('has an example for a secret that is not set, one that is, one being replaced and every state of a field', () => {
    expect(entries.map(([name]) => name).sort()).toEqual(
      ['NotSet', 'Set', 'Replacing', 'Dirty', 'Validating', 'Invalid', 'CouldNotCheck', 'DisabledWithReason', 'ReadOnlyNotSupported'].sort(),
    );
  });

  for (const [name, Example] of entries) {
    it(`renders ${name} with a named field, no title, no inline style and nothing that holds a secret`, () => {
      const { container } = render(<Example />);
      expect(within(container).getByLabelText(/./, { selector: 'input' })).toBeTruthy();
      expect(container.querySelector('[title], [style]')).toBeNull();
      expect(container.querySelector('input[value]')).toBeNull();
    });
  }
});

const css = await readFile(path.join(import.meta.dirname, 'SecretInput.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the SecretInput stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^(?:\/\*[\s\S]*?\*\/\s*)?@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the mock\'s secret: the field and its buttons in a row, 4 px apart', () => {
    const root = rule('.root');
    expect(root.display).toBe('inline-flex');
    expect(root['align-items']).toBe('center');
    expect(root.gap).toBe('var(--ov-spacing-4)');
    expect(root['min-width']).toBe('0');
    expect(root['max-width']).toBe('100%');
  });

  it('gives the field the mock\'s widths', () => {
    expect(rule('.root[data-ov-width=\'normal\'] > .input').width).toBe('280px');
    expect(rule('.root[data-ov-width=\'short\'] > .input').width).toBe('112px');
    expect(rule('.root[data-ov-width=\'wide\'] > .input').width).toBe('320px');
    expect(rule('.root[data-ov-width=\'fill\'] > .input').flex).toBe('1 1 auto');
  });

  it('keeps the box one size in every state: a room as wide as the Show button stands where it is not drawn, and Replace and Cancel are one width, so a press never moves the field', () => {
    expect(rule('.room').flex).toBe('0 0 var(--ov-control-height)');
    expect(rule('.root > [data-ov-slot=\'action\']')['min-width']).toBe('64px');
  });
});
