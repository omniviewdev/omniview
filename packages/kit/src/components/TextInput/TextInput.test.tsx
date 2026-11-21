import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';
import { useState, type ComponentType } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { Field } from '../Field';
import { TextInput, type TextInputProps } from './TextInput';
import * as examples from './TextInput.examples';

const input = (props: Partial<TextInputProps> = {}) => <TextInput label="API URL" value="" onValueChange={() => undefined} {...props} />;
const box = () => screen.getByRole<HTMLInputElement>('textbox');

/** What describes `element`, as assistive technology reads it: the text of every element its `aria-describedby` names, in order. */
const description = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ');

describe('TextInput', () => {
  describe('the input', () => {
    it('is a native text input named by its label, with no title and no autocomplete of the browser\'s', () => {
      render(input());
      const control = screen.getByRole<HTMLInputElement>('textbox', { name: 'API URL' });
      expect(control.tagName).toBe('INPUT');
      expect(control.type).toBe('text');
      expect(control.hasAttribute('title')).toBe(false);
      expect(control.getAttribute('autocomplete')).toBe('off');
      expect(control.getAttribute('spellcheck')).toBe('false');
      expect(control.getAttribute('autocapitalize')).toBe('off');
    });

    it('is controlled: it shows the value it is given and reports what is typed, and changes nothing itself', () => {
      const onValueChange = vi.fn();
      const { rerender } = render(input({ value: 'https://a', onValueChange }));
      expect(box().value).toBe('https://a');
      fireEvent.change(box(), { target: { value: 'https://ab' } });
      expect(onValueChange).toHaveBeenCalledWith('https://ab');
      expect(box().value).toBe('https://a');
      rerender(input({ value: 'https://ab', onValueChange }));
      expect(box().value).toBe('https://ab');
    });

    it('reports every keystroke at once: a commit is a different event', () => {
      const onValueChange = vi.fn();
      const onCommit = vi.fn();
      render(input({ onValueChange, onCommit }));
      fireEvent.change(box(), { target: { value: 'a' } });
      fireEvent.change(box(), { target: { value: 'ab' } });
      expect(onValueChange.mock.calls).toEqual([['a'], ['ab']]);
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('says what it is for in a placeholder that stays until there is text', () => {
      render(input({ placeholder: 'Authorization' }));
      expect(box().getAttribute('placeholder')).toBe('Authorization');
    });

    it('takes the code face and a width of the mock\'s three (112, 280 and 320 px) or the width of its place', () => {
      const { rerender } = render(input());
      expect(box().getAttribute('data-ov-width')).toBe('fill');
      expect(box().hasAttribute('data-ov-mono')).toBe(false);
      rerender(input({ mono: true, width: 'normal' }));
      expect(box().getAttribute('data-ov-width')).toBe('normal');
      expect(box().getAttribute('data-ov-mono')).toBe('true');
      for (const width of ['short', 'wide'] as const) {
        rerender(input({ width }));
        expect(box().getAttribute('data-ov-width')).toBe(width);
      }
    });

    it('holds at most the length it is given', () => {
      render(input({ maxLength: 64 }));
      expect(box().maxLength).toBe(64);
    });

    it('passes data attributes to the input and nothing else', () => {
      render(input({ 'data-testid': 'url' }));
      expect(screen.getByTestId('url')).toBe(box());
    });

    it('is one element: nothing is drawn around it', () => {
      const { container } = render(input());
      expect(container.querySelectorAll('*')).toHaveLength(1);
    });
  });

  describe('invalid', () => {
    it('is marked invalid for assistive technology when it is told so, and not otherwise', () => {
      const { rerender } = render(input());
      expect(box().hasAttribute('aria-invalid')).toBe(false);
      rerender(input({ invalid: true }));
      expect(box().getAttribute('aria-invalid')).toBe('true');
    });

    it('is marked invalid by the error of its field, and says it in the lane', () => {
      render(
        <Field label="Name" message={{ kind: 'error', text: 'Name has a space. Use letters and digits.' }}>
          <TextInput value="bad name" onValueChange={() => undefined} />
        </Field>,
      );
      expect(box().getAttribute('aria-invalid')).toBe('true');
      expect(description(box())).toBe('Error: Name has a space. Use letters and digits.');
      expect(box().value).toBe('bad name');
    });
  });

  describe('the keyboard (design S125: a text field commits on Enter or blur, never per keystroke; Escape puts the applied value back)', () => {
    it('commits on a plain Enter and keeps the key from submitting anything', () => {
      const onCommit = vi.fn();
      render(input({ value: 'https://a', onCommit }));
      const enter = createEvent.keyDown(box(), { key: 'Enter' });
      fireEvent(box(), enter);
      expect(onCommit).toHaveBeenCalledTimes(1);
      expect(onCommit).toHaveBeenCalledWith('https://a');
      expect(enter.defaultPrevented).toBe(true);
    });

    it('does not commit an Enter that confirms a composition, nor one with a chord', () => {
      const onCommit = vi.fn();
      render(input({ onCommit }));
      fireEvent.keyDown(box(), { key: 'Enter', isComposing: true });
      fireEvent.keyDown(box(), { key: 'Enter', shiftKey: true });
      fireEvent.keyDown(box(), { key: 'Enter', metaKey: true });
      fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
      fireEvent.keyDown(box(), { key: 'Enter', altKey: true });
      expect(onCommit).not.toHaveBeenCalled();
    });

    it('reports that focus left, once, and never while a composition is open', () => {
      const onBlur = vi.fn();
      render(input({ onBlur }));
      fireEvent.compositionStart(box());
      fireEvent.blur(box());
      expect(onBlur).not.toHaveBeenCalled();
      fireEvent.compositionEnd(box());
      fireEvent.blur(box());
      expect(onBlur).toHaveBeenCalledTimes(1);
    });

    it('puts the applied value back on Escape when there is a draft, and keeps the key from reaching anything that would close the dialog or page', () => {
      const onRevert = vi.fn();
      const outside = vi.fn();
      render(
        <div onKeyDown={outside}>
          {input({ dirty: true, onRevert })}
        </div>,
      );
      const escape = createEvent.keyDown(box(), { key: 'Escape' });
      fireEvent(box(), escape);
      expect(onRevert).toHaveBeenCalledTimes(1);
      expect(escape.defaultPrevented).toBe(true);
      expect(outside).not.toHaveBeenCalled();
    });

    it('lets Escape through when there is nothing to put back: the dialog or page decides what it means', () => {
      const onRevert = vi.fn();
      const outside = vi.fn();
      render(<div onKeyDown={outside}>{input({ dirty: false, onRevert })}</div>);
      fireEvent.keyDown(box(), { key: 'Escape' });
      expect(onRevert).not.toHaveBeenCalled();
      expect(outside).toHaveBeenCalledTimes(1);
    });

    it('does not revert on an Escape of a composition or of a chord', () => {
      const onRevert = vi.fn();
      render(input({ dirty: true, onRevert }));
      fireEvent.keyDown(box(), { key: 'Escape', isComposing: true });
      fireEvent.keyDown(box(), { key: 'Escape', ctrlKey: true });
      expect(onRevert).not.toHaveBeenCalled();
    });

    it('works end to end with a caller that owns the draft and the applied value', () => {
      function Caller() {
        const [applied, setApplied] = useState('collector:4318');
        const [draft, setDraft] = useState(applied);
        return (
          <TextInput
            label="Endpoint"
            value={draft}
            dirty={draft !== applied}
            onValueChange={setDraft}
            onCommit={(value) => {
              setApplied(value);
            }}
            onRevert={() => {
              setDraft(applied);
            }}
          />
        );
      }

      render(<Caller />);
      fireEvent.change(box(), { target: { value: 'collector:9999' } });
      fireEvent.keyDown(box(), { key: 'Escape' });
      expect(box().value).toBe('collector:4318');
      fireEvent.change(box(), { target: { value: 'collector:9999' } });
      fireEvent.keyDown(box(), { key: 'Enter' });
      fireEvent.keyDown(box(), { key: 'Escape' });
      expect(box().value).toBe('collector:9999');
    });
  });

  describe('a character that is not allowed (design S125: illegal characters are refused at once)', () => {
    const typed = (data: string, options: { composing?: boolean; inputType?: string } = {}) => {
      const event = new InputEvent('beforeinput', { data, inputType: options.inputType ?? 'insertText', isComposing: options.composing ?? false, bubbles: true, cancelable: true });
      fireEvent(box(), event);
      return event;
    };

    const digits = (text: string) => /^[0-9]*$/.test(text);

    it('is refused before the input takes it, and one that is allowed goes through', () => {
      render(input({ allows: digits }));
      expect(typed('7').defaultPrevented).toBe(false);
      expect(typed('x').defaultPrevented).toBe(true);
      expect(typed('7a').defaultPrevented).toBe(true);
    });

    it('is asked about what is inserted, whatever way it comes in: a paste or a drop as well as a key', () => {
      render(input({ allows: digits }));
      expect(typed('12345', { inputType: 'insertFromPaste' }).defaultPrevented).toBe(false);
      expect(typed('12a45', { inputType: 'insertFromPaste' }).defaultPrevented).toBe(true);
      expect(typed('x', { inputType: 'insertFromDrop' }).defaultPrevented).toBe(true);
    });

    it('never interferes with deleting, nor with a composition', () => {
      render(input({ allows: digits }));
      expect(typed('', { inputType: 'deleteContentBackward' }).defaultPrevented).toBe(false);
      expect(typed('x', { composing: true, inputType: 'insertCompositionText' }).defaultPrevented).toBe(false);
    });

    it('refuses nothing when it is not told what is allowed', () => {
      render(input());
      expect(typed('anything at all').defaultPrevented).toBe(false);
    });
  });

  describe('unavailable for a reason (design P2, DR1)', () => {
    it('stays focusable and selectable, says it is unavailable, and has the reason as its description', () => {
      render(input({ value: 'collector:4318', disabledReason: 'Turn on Send telemetry to change this.' }));
      const control = box();
      expect(control.getAttribute('aria-disabled')).toBe('true');
      expect(control.readOnly).toBe(true);
      expect(control.disabled).toBe(false);
      expect(control.tabIndex).not.toBe(-1);
      control.focus();
      expect(document.activeElement).toBe(control);
      expect(description(control)).toBe('Turn on Send telemetry to change this.');
    });

    it('changes nothing and commits nothing', () => {
      const onValueChange = vi.fn();
      const onCommit = vi.fn();
      const onRevert = vi.fn();
      render(input({ dirty: true, disabledReason: 'Why.', onValueChange, onCommit, onRevert }));
      fireEvent.change(box(), { target: { value: 'x' } });
      fireEvent.keyDown(box(), { key: 'Enter' });
      fireEvent.keyDown(box(), { key: 'Escape' });
      expect(onValueChange).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
      expect(onRevert).not.toHaveBeenCalled();
    });

    it('takes an empty reason for no reason', () => {
      render(input({ disabledReason: '' }));
      expect(box().hasAttribute('aria-disabled')).toBe(false);
      expect(box().readOnly).toBe(false);
    });

    it('is told by its field, which prints the reason itself: the control adds no second description', () => {
      const { container } = render(
        <Field label="Auth header" disabledReason="Turn on Send telemetry to change this.">
          <TextInput value="" onValueChange={() => undefined} />
        </Field>,
      );
      expect(box().getAttribute('aria-disabled')).toBe('true');
      expect(box().readOnly).toBe(true);
      expect(container.querySelectorAll('[hidden]')).toHaveLength(0);
      expect(description(box())).toBe('Turn on Send telemetry to change this.');
    });
  });

  describe('read-only (design F-4: a fact that can be selected, never disabled)', () => {
    it('is a read-only input that is not dimmed, not marked unavailable and still a tab stop', () => {
      render(input({ value: '/var/omniview', readOnly: true }));
      expect(box().readOnly).toBe(true);
      expect(box().hasAttribute('aria-disabled')).toBe(false);
      expect(box().disabled).toBe(false);
      expect(box().tabIndex).not.toBe(-1);
    });

    it('changes nothing and commits nothing', () => {
      const onValueChange = vi.fn();
      const onCommit = vi.fn();
      render(input({ readOnly: true, onValueChange, onCommit }));
      fireEvent.change(box(), { target: { value: 'x' } });
      fireEvent.keyDown(box(), { key: 'Enter' });
      expect(onValueChange).not.toHaveBeenCalled();
      expect(onCommit).not.toHaveBeenCalled();
    });
  });

  describe('a name', () => {
    it('is taken from the label of its field and never from an aria-label of its own', () => {
      render(
        <Field label="Endpoint">
          <TextInput label="Something else" value="" onValueChange={() => undefined} />
        </Field>,
      );
      expect(box().hasAttribute('aria-label')).toBe(false);
      expect(screen.getByRole('textbox', { name: 'Endpoint' })).toBe(box());
    });

    it('has the name it is given when it has no field around it', () => {
      render(input({ label: 'Search the table' }));
      expect(box().getAttribute('aria-label')).toBe('Search the table');
    });
  });
});

describe('the examples of TextInput', () => {
  const entries = Object.entries(examples) as Array<[string, ComponentType]>;

  it('has an example for every state of a field: idle, dirty, checking, invalid, could not check, unavailable for a reason, read-only and not supported, and the two faces', () => {
    expect(entries.map(([name]) => name).sort()).toEqual(
      ['Idle', 'Dirty', 'Validating', 'Invalid', 'CouldNotCheck', 'DisabledWithReason', 'ReadOnlyNotSupported', 'Mono', 'Filtered'].sort(),
    );
  });

  for (const [name, Example] of entries) {
    it(`renders ${name} with a named input, no title and no inline style`, () => {
      const { container } = render(<Example />);
      expect(screen.getByRole('textbox', { name: /./ })).toBeTruthy();
      expect(container.querySelector('[title], [style]')).toBeNull();
    });
  }

  it('lets the idle example be typed in', () => {
    render(<examples.Idle />);
    fireEvent.change(box(), { target: { value: 'https://example.test' } });
    expect(box().value).toBe('https://example.test');
  });

  it('shows the dirty example with its draft, and puts the applied value back on Escape', () => {
    render(<examples.Dirty />);
    // It opens with a draft (:9999) that differs from what the host has (:4318): Escape puts the applied value back.
    expect(box().value).toBe('collector.example.test:9999');
    fireEvent.keyDown(box(), { key: 'Escape' });
    expect(box().value).toBe('collector.example.test:4318');
  });

  it('refuses a letter in the filtered example', () => {
    render(<examples.Filtered />);
    const event = new InputEvent('beforeinput', { data: 'q', inputType: 'insertText', bubbles: true, cancelable: true });
    fireEvent(box(), event);
    expect(event.defaultPrevented).toBe(true);
  });
});

const own = await readFile(path.join(import.meta.dirname, 'TextInput.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(own, selector);

describe('the TextInput stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(own.trimStart()).toMatch(/^(?:\/\*[\s\S]*?\*\/\s*)?@layer ov\.components \{/);
    for (const entry of cssRules(own)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('gives the input the mock\'s three widths and the width of its place, never wider than that place', () => {
    expect(rule('.input[data-ov-width=\'short\']').width).toBe('112px');
    expect(rule('.input[data-ov-width=\'normal\']').width).toBe('280px');
    expect(rule('.input[data-ov-width=\'wide\']').width).toBe('320px');
    expect(rule('.input[data-ov-width=\'fill\']').width).toBe('100%');
    expect(rule('.input')['max-width']).toBe('100%');
  });
});
