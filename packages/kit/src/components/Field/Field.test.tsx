import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { TextInput } from '../TextInput';
import { Field, type FieldProps } from './Field';
import type { FieldMessage } from './message';
import * as examples from './Field.examples';

const noop = () => undefined;
const input = (props: Partial<Parameters<typeof TextInput>[0]> = {}) => <TextInput value="" onValueChange={noop} {...props} />;
const field = (props: Partial<FieldProps> = {}, control = input()) => (
  <Field label="API URL" {...props}>
    {control}
  </Field>
);
const lane = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-ov-part="lane"]');

/** What describes `element`, as assistive technology reads it: the text of every element its `aria-describedby` names, in order. */
const description = (element: HTMLElement) =>
  (element.getAttribute('aria-describedby') ?? '')
    .split(' ')
    .filter((id) => id !== '')
    .map((id) => element.ownerDocument.getElementById(id)?.textContent ?? '')
    .join(' ');

afterEach(() => {
  vi.useRealTimers();
});

describe('Field', () => {
  describe('the label', () => {
    it('is a real label for the control: it names it and a click on it puts the focus there', () => {
      render(field());
      const control = screen.getByRole('textbox', { name: 'API URL' });
      const label = screen.getByText('API URL');
      expect(label.tagName).toBe('LABEL');
      expect(label.getAttribute('for')).toBe(control.id);
      expect(control.id).not.toBe('');
      expect(control.hasAttribute('aria-label')).toBe(false);
      // A click on a label is a click on its control (the platform's rule), which is how a label of a switch turns it.
      const clicked = vi.fn();
      control.addEventListener('click', clicked);
      fireEvent.click(label);
      expect(clicked).toHaveBeenCalledTimes(1);
    });

    it('marks a required field with an asterisk that no assistive technology reads, and puts `required` on the control', () => {
      const { container } = render(field({ required: true }));
      const mark = container.querySelector('[data-ov-part="required"]');
      expect(mark?.textContent).toBe('*');
      expect(mark?.getAttribute('aria-hidden')).toBe('true');
      const control = screen.getByRole('textbox', { name: 'API URL' });
      expect((control as HTMLInputElement).required).toBe(true);
    });

    it('draws no mark for an optional field, and `aside` says what the field is in a muted word after the label', () => {
      const { container, rerender } = render(field());
      expect(container.querySelector('[data-ov-part="required"]')).toBeNull();
      expect(container.querySelector('[data-ov-part="aside"]')).toBeNull();
      expect(screen.getByRole<HTMLInputElement>('textbox').required).toBe(false);
      rerender(field({ aside: 'optional' }));
      expect(container.querySelector('[data-ov-part="aside"]')?.textContent).toBe('optional');
      expect(screen.getByRole('textbox', { name: 'API URL optional' })).toBeTruthy();
    });

    it('is aligned beside the control unless it is told to stack above it', () => {
      const { container, rerender } = render(field());
      expect(container.firstElementChild?.getAttribute('data-ov-layout')).toBe('aligned');
      rerender(field({ layout: 'stacked' }));
      expect(container.firstElementChild?.getAttribute('data-ov-layout')).toBe('stacked');
    });
  });

  describe('the help', () => {
    it('is a muted line under the control that describes it', () => {
      const { container } = render(field({ help: 'The address of the API.' }));
      const help = container.querySelector<HTMLElement>('[data-ov-part="help"]');
      expect(help?.textContent).toBe('The address of the API.');
      const control = screen.getByRole('textbox');
      expect(control.getAttribute('aria-describedby')).toBe(help?.id);
      expect(description(control)).toBe('The address of the API.');
    });

    it('is not drawn when there is none, and then describes nothing', () => {
      const { container } = render(field());
      expect(container.querySelector('[data-ov-part="help"]')).toBeNull();
      expect(screen.getByRole('textbox').hasAttribute('aria-describedby')).toBe(false);
    });
  });

  describe('the message lane (design S127, A4)', () => {
    it('is not there for a field that has nothing to say, and is there, empty, for a field that can validate: its height is reserved', () => {
      const { container, rerender } = render(field());
      expect(lane(container)).toBeNull();
      rerender(field({ lane: true }));
      const reserved = lane(container);
      expect(reserved).not.toBeNull();
      expect(reserved?.textContent).toBe('');
      expect(reserved?.hasAttribute('data-ov-kind')).toBe(false);
      expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toBe(reserved?.id);
    });

    it('appears for a message even when the field did not ask for it', () => {
      const { container } = render(field({ message: { kind: 'hint', text: 'Letters and digits.' } }));
      expect(lane(container)?.textContent).toBe('Letters and digits.');
    });

    it('is never a live region: the model tells the shell\'s polite region once, and the lane only describes the control', () => {
      const { container } = render(field({ message: { kind: 'error', text: 'Name is taken. Choose another.' } }));
      expect(lane(container)?.getAttribute('aria-live')).toBe('off');
      expect(lane(container)?.hasAttribute('role')).toBe(false);
    });

    const KINDS: ReadonlyArray<[FieldMessage['kind'], string | null, string, string]> = [
      ['hint', null, '', 'Letters and digits.'],
      ['error', 'status-error', 'Error: ', 'Name is taken. Choose another.'],
      ['warning', 'status-warning', 'Warning: ', 'Name is unusual. Check the spelling.'],
      ['saved', 'check', '', 'Saved.'],
      ['info', 'status-info', '', 'Restart required to apply.'],
    ];
    for (const [kind, glyph, word, text] of KINDS) {
      it(`says a ${kind} with ${glyph === null ? 'no glyph' : `the ${glyph} glyph`}${word === '' ? '' : ` and the word "${word.trim()}" for assistive technology`}, never by colour alone`, () => {
        const { container } = render(field({ message: { kind, text } }));
        const shown = lane(container);
        expect(shown?.getAttribute('data-ov-kind')).toBe(kind);
        expect(shown?.querySelector('[data-ov-part="message"]')?.textContent).toBe(text);
        expect(shown?.querySelector('[data-ov-part="word"]')?.textContent ?? '').toBe(word);
        const glyphs = [...(shown?.querySelectorAll('svg') ?? [])].map((svg) => svg.getAttribute('data-ov-glyph'));
        expect(glyphs).toEqual(glyph === null ? [] : [glyph]);
        for (const svg of shown?.querySelectorAll('svg') ?? []) {
          expect(svg.getAttribute('aria-hidden')).toBe('true');
        }

        // The control is described by the lane, and the word is part of what it says.
        expect(description(screen.getByRole('textbox'))).toBe(`${word}${text}`);
      });
    }

    it('says "Checking…" for a check that is running, with the loader in the lane from the start: its second is the stylesheet\'s', () => {
      const { container } = render(field({ message: { kind: 'checking', text: '' } }));
      const shown = lane(container);
      expect(shown?.getAttribute('data-ov-kind')).toBe('checking');
      expect(shown?.querySelector('[data-ov-part="message"]')?.textContent).toBe('Checking…');
      const loader = shown?.querySelector('svg');
      expect(loader?.getAttribute('data-ov-glyph')).toBe('loader');
      expect(loader?.getAttribute('data-ov-busy')).toBe('true');
    });

    it('says what the check is, and the loader goes with the check', () => {
      const { container, rerender } = render(field({ message: { kind: 'checking', text: 'Contacting the server…' } }));
      expect(lane(container)?.textContent).toBe('Contacting the server…');
      expect(lane(container)?.querySelector('svg')).not.toBeNull();
      rerender(field({ message: { kind: 'hint', text: 'Letters only.' } }));
      expect(lane(container)?.querySelector('svg')).toBeNull();
      rerender(field({ message: { kind: 'checking', text: 'Contacting the server…' } }));
      expect(lane(container)?.querySelector('svg')).not.toBeNull();
    });

    it('starts no timer and adds nothing to the page while it waits (a lane that changed the page a second after it mounted broke the row menu probe\'s counts of the page\'s elements)', () => {
      vi.useFakeTimers();
      const { container, unmount } = render(field({ message: { kind: 'checking', text: '' } }));
      const before = container.querySelectorAll('*').length;
      expect(vi.getTimerCount()).toBe(0);
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      expect(container.querySelectorAll('*').length).toBe(before);
      unmount();
    });

    it('says "Couldn\'t check" with a Retry that is a button of its own, and is not an error: the value is not marked invalid', () => {
      const onRetry = vi.fn();
      const { container } = render(field({ message: { kind: 'retry', text: '', retry: true }, onRetry }));
      const shown = lane(container);
      expect(shown?.getAttribute('data-ov-kind')).toBe('retry');
      expect(shown?.querySelector('[data-ov-part="message"]')?.textContent).toBe('Couldn’t check');
      expect(shown?.querySelector('[data-ov-part="word"]')?.textContent).toBe('Warning: ');
      expect(shown?.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('status-warning');
      const retry = within(shown!).getByRole('button', { name: 'Retry' });
      expect(retry.getAttribute('type')).toBe('button');
      fireEvent.click(retry);
      expect(onRetry).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('textbox').hasAttribute('aria-invalid')).toBe(false);
    });

    it('offers Retry to a failed apply too (an error that says so), and to nothing else', () => {
      const onRetry = vi.fn();
      const { container, rerender } = render(field({ message: { kind: 'error', text: 'Couldn’t save this change. Retry.', retry: true }, onRetry }));
      expect(within(lane(container)!).getByRole('button', { name: 'Retry' })).toBeTruthy();
      rerender(field({ message: { kind: 'error', text: 'Name is taken.' }, onRetry }));
      expect(within(lane(container)!).queryByRole('button')).toBeNull();
      rerender(field({ message: { kind: 'retry', text: '', retry: true } }));
      expect(within(lane(container)!).queryByRole('button')).toBeNull();
    });

    it('keeps the text of a message that was cut, and says all of it as the tip of the text and the description of the control', () => {
      const { container } = render(field({ message: { kind: 'error', text: 'Not a valid key. Paste 64 hex characters.', detail: 'The key has 12 characters.' } }));
      const text = lane(container)?.querySelector<HTMLElement>('[data-ov-part="message"]');
      expect(text?.getAttribute('data-ov-tip')).toBe('Not a valid key. Paste 64 hex characters.\nThe key has 12 characters.');
      expect(text?.hasAttribute('title')).toBe(false);
      // A tip is not read through `aria-describedby`: the detail is in the lane, which the control names.
      expect(description(screen.getByRole('textbox'))).toBe('Error: Not a valid key. Paste 64 hex characters. The key has 12 characters.');
    });

    it('lets the tooltip host show the text of a message that has no detail while it is cut', () => {
      const { container } = render(field({ message: { kind: 'hint', text: 'Letters and digits.' } }));
      expect(lane(container)?.querySelector('[data-ov-part="message"]')?.hasAttribute('data-ov-clip')).toBe(true);
    });

    it('shows nothing for a message with no text, except the kinds that have a word of their own', () => {
      const { container } = render(field({ message: { kind: 'error', text: '   ' }, lane: true }));
      expect(lane(container)?.textContent).toBe('');
      expect(lane(container)?.hasAttribute('data-ov-kind')).toBe(false);
      expect(screen.getByRole('textbox').hasAttribute('aria-invalid')).toBe(false);
    });
  });

  describe('what the control is told', () => {
    it('describes the unavailable reason itself when a message outranks it in the lane, and leaves it to the lane when the lane says it', () => {
      const reason = 'Start the plugin to change this.';
      const { rerender } = render(field({ disabledReason: reason }));
      expect(description(screen.getByRole('textbox'))).toBe(reason);
      rerender(field({ disabledReason: reason, message: { kind: 'error', text: 'Name is taken.' } }));
      expect(description(screen.getByRole('textbox'))).toBe(`Error: Name is taken. ${reason}`);
      expect(screen.getByRole('textbox').getAttribute('aria-disabled')).toBe('true');
    });

    it('is marked invalid by an error, and only by an error', () => {
      const { rerender } = render(field({ message: { kind: 'error', text: 'Name is taken.' } }));
      expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
      for (const kind of ['hint', 'warning', 'checking', 'retry', 'saved', 'info'] as const) {
        rerender(field({ message: { kind, text: 'Something.' } }));
        expect(screen.getByRole('textbox').hasAttribute('aria-invalid'), kind).toBe(false);
      }
    });

    it('paints a warning on the control without marking it invalid: a warning never blocks', () => {
      render(field({ message: { kind: 'warning', text: 'Name is unusual.' } }));
      const control = screen.getByRole('textbox');
      expect(control.getAttribute('data-ov-validation')).toBe('warning');
      expect(control.hasAttribute('aria-invalid')).toBe(false);
    });

    it('describes the control by the help, then the lane', () => {
      const { container } = render(field({ help: 'The address of the API.', message: { kind: 'hint', text: 'Include https://.' } }));
      const help = container.querySelector<HTMLElement>('[data-ov-part="help"]');
      expect(screen.getByRole('textbox').getAttribute('aria-describedby')).toBe(`${help?.id} ${lane(container)?.id}`);
      expect(description(screen.getByRole('textbox'))).toBe('The address of the API. Include https://.');
    });

    it('makes the control unavailable for a reason and prints that reason in the lane, so it is read where the field is (design DR1)', () => {
      const { container } = render(field({ disabledReason: 'Turn on Send telemetry to change this.' }));
      const control = screen.getByRole<HTMLInputElement>('textbox');
      expect(control.getAttribute('aria-disabled')).toBe('true');
      expect(control.disabled).toBe(false);
      expect(lane(container)?.getAttribute('data-ov-kind')).toBe('info');
      expect(lane(container)?.textContent).toBe('Turn on Send telemetry to change this.');
      expect(description(control)).toBe('Turn on Send telemetry to change this.');
    });

    it('lets a message that matters more than a reason keep the lane: an error outranks it, a hint does not', () => {
      const { container, rerender } = render(field({ disabledReason: 'Turn on Send telemetry to change this.', message: { kind: 'error', text: 'Name is taken.' } }));
      expect(lane(container)?.getAttribute('data-ov-kind')).toBe('error');
      rerender(field({ disabledReason: 'Turn on Send telemetry to change this.', message: { kind: 'hint', text: 'Letters and digits.' } }));
      expect(lane(container)?.getAttribute('data-ov-kind')).toBe('info');
      expect(lane(container)?.textContent).toBe('Turn on Send telemetry to change this.');
    });

    it('says one message once when the model\'s own message is the reason', () => {
      const { container } = render(field({ disabledReason: 'Managed by your organisation.', message: { kind: 'info', text: 'Managed by your organisation.' } }));
      expect(lane(container)?.textContent).toBe('Managed by your organisation.');
      expect(description(screen.getByRole('textbox'))).toBe('Managed by your organisation.');
    });

    it('makes the control read-only, a fact that can be selected and is not dimmed (design F-4)', () => {
      render(field({ readOnly: true }, input({ value: 'https://example.test' })));
      const control = screen.getByRole<HTMLInputElement>('textbox');
      expect(control.readOnly).toBe(true);
      expect(control.hasAttribute('aria-disabled')).toBe(false);
      expect(control.disabled).toBe(false);
    });

    it('does not read an unavailable reason as no reason when it is empty', () => {
      const { container } = render(field({ disabledReason: '  ' }));
      expect(screen.getByRole('textbox').hasAttribute('aria-disabled')).toBe(false);
      expect(lane(container)).toBeNull();
    });
  });

  it('passes data attributes to its root and nothing else', () => {
    render(field({ 'data-testid': 'row' }));
    const root = screen.getByTestId('row');
    expect(root.contains(screen.getByRole('textbox'))).toBe(true);
    expect(root.hasAttribute('class')).toBe(true);
    expect(root.hasAttribute('style')).toBe(false);
  });

  it('draws no title and no inline style', () => {
    const { container } = render(field({ help: 'Help.', required: true, aside: 'optional', message: { kind: 'error', text: 'Bad.' } }));
    expect(container.querySelector('[title], [style]')).toBeNull();
  });

  it('is the few elements it needs: the root, the label, the control and, when asked for, the help and the lane', () => {
    const count = (props: Partial<FieldProps>) => {
      const { container, unmount } = render(field(props));
      const total = container.querySelectorAll('*').length;
      unmount();
      return total;
    };

    const bare = count({});
    // root, label, input, the hidden reason span nobody needs: none
    expect(bare).toBe(3);
    expect(count({ help: 'Help.' })).toBe(bare + 1);
    expect(count({ lane: true })).toBe(bare + 1);
    expect(count({ required: true })).toBe(bare + 1);
  });
});

describe('the examples of Field', () => {
  const entries = Object.entries(examples) as Array<[string, ComponentType]>;

  it('has an example for the label placements, the required mark, the help, every kind of the lane, the unavailable and read-only states and a form column', () => {
    expect(entries.map(([name]) => name).sort()).toEqual(
      [
        'Aligned',
        'Stacked',
        'Required',
        'WithAside',
        'WithHelp',
        'LaneHint',
        'LaneError',
        'LaneWarning',
        'LaneChecking',
        'LaneCouldNotCheck',
        'LaneSaved',
        'LaneInfo',
        'DisabledWithReason',
        'ReadOnlyNotSupported',
        'FormColumn',
      ].sort(),
    );
  });

  for (const [name, Example] of entries) {
    it(`renders ${name} with every control named by its label, and no title or inline style`, () => {
      const { container } = render(<Example />);
      const controls = container.querySelectorAll('input, select, [role="switch"]');
      expect(controls.length).toBeGreaterThan(0);
      for (const control of controls) {
        expect(control.id, `${name}: a control has no id`).not.toBe('');
        expect([...container.querySelectorAll('label')].some((label) => label.htmlFor === control.id), `${name}: no label for ${control.id}`).toBe(true);
      }

      expect(container.querySelector('[title], [style]')).toBeNull();
    });
  }

  it('lines the labels and the controls of the form column up: one label track, one control track', () => {
    const { container } = render(<examples.FormColumn />);
    const roots = [...container.querySelectorAll('[data-ov-layout]')];
    expect(roots.length).toBeGreaterThanOrEqual(3);
    expect(new Set(roots.map((root) => root.getAttribute('data-ov-layout'))).size).toBe(1);
  });
});

const css = await readFile(path.join(import.meta.dirname, 'Field.module.css'), 'utf8');
const rule = (selector: string) => declarationsOf(css, selector);

describe('the Field stylesheet', () => {
  it('sits in the components layer, and only there', () => {
    expect(css.trimStart()).toMatch(/^(?:\/\*[\s\S]*?\*\/\s*)?@layer ov\.components \{/);
    for (const entry of cssRules(css)) {
      expect(entry.context[0], entry.selector).toBe('@layer ov.components');
    }
  });

  it('is the mock\'s field: a label track of 96 to 140 px beside the control, 6 px apart, centred', () => {
    const root = rule('.root');
    expect(root.display).toBe('grid');
    expect(root['grid-template-columns']).toBe('minmax(96px, 140px) minmax(0, 1fr)');
    expect(root.gap).toBe('var(--ov-spacing-6)');
    expect(root['align-items']).toBe('center');
    expect(root['min-width']).toBe('0');
    // In a row of a flex container it takes its share of the width, as a block takes the width of its place.
    expect(root.flex).toBe('1 1 auto');
  });

  it('stacks the label above the control in one track when it is told to', () => {
    expect(rule('.root[data-ov-layout=\'stacked\']')['grid-template-columns']).toBe('minmax(0, 1fr)');
    expect(rule('.root[data-ov-layout=\'stacked\'] > *')['grid-column']).toBe('1');
    expect(rule('.root > :not(.label)')['grid-column']).toBe('2');
  });

  it('sets the label in 13/16 body type and the asterisk in the error role', () => {
    const label = rule('.label');
    expect(label['font-size']).toBe('var(--ov-fs-13)');
    expect(label['line-height']).toBe('var(--ov-lh-16)');
    expect(label['font-weight']).toBe('400');
    expect(label.color).toBe('var(--ov-fg)');
    expect(rule('.required').color).toBe('var(--ov-error-fg)');
    expect(rule('.required')['margin-inline-start']).toBe('var(--ov-spacing-4)');
    const aside = rule('.aside');
    expect(aside.color).toBe('var(--ov-fg-muted)');
    expect(aside['font-size']).toBe('var(--ov-fs-12)');
    expect(aside['margin-inline-start']).toBe('var(--ov-spacing-4)');
  });

  it('keeps a legible label when the field cannot change: the control is the dimmed part, and the reason is the lane (design SP-16)', () => {
    expect(rule('.root[data-ov-unavailable=\'true\'] > .label').color).toBe('var(--ov-fg-muted)');
  });

  it('reserves the lane: one line of 12/16 muted text with a 16 px glyph slot, clipped to one line', () => {
    const laneRule = rule('.lane');
    expect(laneRule.display).toBe('flex');
    expect(laneRule.height).toBe('var(--ov-lh-16)');
    expect(laneRule['align-items']).toBe('center');
    expect(laneRule.gap).toBe('var(--ov-spacing-4)');
    expect(laneRule.color).toBe('var(--ov-fg-muted)');
    expect(laneRule['font-size']).toBe('var(--ov-fs-12)');
    expect(laneRule['line-height']).toBe('var(--ov-lh-16)');
    const text = rule('.message');
    expect(text['white-space']).toBe('nowrap');
    expect(text['text-overflow']).toBe('ellipsis');
    expect(text.overflow).toBe('hidden');
  });

  it('colours the text of an error in the error role and a warning or a retry in the warning role, and no other kind', () => {
    expect(rule('.lane[data-ov-kind=\'error\']').color).toBe('var(--ov-error-fg)');
    expect(rule('.lane[data-ov-kind=\'warning\']').color).toBe('var(--ov-warning-fg)');
    expect(rule('.lane[data-ov-kind=\'retry\']').color).toBe('var(--ov-warning-fg)');
  });

  it('reveals the loader after a second by the stylesheet (nothing is added to the page then), turns it, and holds it still under reduced motion', () => {
    const rules = cssRules(css);
    const busy = rules.find((entry) => entry.selector.includes('[data-ov-busy') && !entry.context.some((context) => context.includes('prefers-reduced-motion')));
    expect(busy?.declarations.opacity).toBe('0');
    expect(busy?.declarations.animation).toBe('reveal 1ms linear 1s forwards, spin 1.2s linear 1s infinite');
    const reduced = rules.filter((entry) => entry.context.some((context) => context.includes('prefers-reduced-motion')));
    expect(reduced.some((entry) => entry.declarations.animation === 'reveal 1ms linear 1s forwards')).toBe(true);
  });

  it('makes Retry a link of the lane: a 24 px target in the link colour, underlined on hover, in the lane\'s own type', () => {
    const retry = rule('.retry');
    expect(retry['min-height']).toBe('24px');
    expect(retry.color).toBe('var(--ov-link)');
    expect(retry.border).toBe('0');
    expect(retry.font).toBe('inherit');
    expect(rule('.retry:hover')['text-decoration']).toBe('underline');
    expect(rule('.retry:focus-visible').outline).toBe('2px solid var(--ov-accent)');
  });

  it('hides the word of a kind from the eye and leaves it to assistive technology', () => {
    const word = rule('.word');
    expect(word.position).toBe('absolute');
    expect(word['clip-path']).toBe('inset(50%)');
    expect(word.overflow).toBe('hidden');
  });

  it('draws the info glyph in the link colour while its text stays quiet, and gives Retry the control radius for its focus ring (the mock: base.css 1521 and the radius of every button)', () => {
    expect(rule('.lane[data-ov-kind=\'info\'] > svg').color).toBe('var(--ov-link)');
    expect(rule('.retry')['border-radius']).toBe('var(--ov-radius-control)');
  });
});
