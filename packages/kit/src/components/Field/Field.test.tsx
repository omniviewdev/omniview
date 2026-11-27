import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cssRules, declarationsOf } from '../../../scripts/cssRules.ts';
import { IconButton } from '../IconButton';
import { TextInput } from '../TextInput';
import { Toggle } from '../Toggle';
import { Field, type FieldProps } from './Field';
import type { FieldMessage } from './message';
import * as examples from './Field.examples';

const noop = () => undefined;
/** The props of the two layouts that existed before the row: the trailing slot is the row's alone. */
type PlainProps = Extract<FieldProps, { readonly layout?: 'aligned' | 'stacked' | undefined }>;
const input = (props: Partial<Parameters<typeof TextInput>[0]> = {}) => <TextInput value="" onValueChange={noop} {...props} />;
const field = (props: Partial<PlainProps> = {}, control = input()) => (
  <Field label="API URL" {...props}>
    {control}
  </Field>
);
const lane = (container: HTMLElement) => container.querySelector<HTMLElement>('[data-ov-part="lane"]');
/** The element of a part of the Field that was drawn, by its `data-ov-part`. */
const part = (container: HTMLElement, name: string) => container.querySelector<HTMLElement>(`[data-ov-part="${name}"]`);

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
    const count = (props: Partial<PlainProps>) => {
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

// ---- the layouts that existed before the row ------------------------------------------------------------------------------------

/** The markup with its ids numbered in the order they appear and its class names reduced to the name in the stylesheet, and the artwork of a glyph left out (the Icon's own). */
const normalise = (html: string) => {
  const ids = new Map<string, string>();
  const numbered = (id: string) => {
    if (!ids.has(id)) {
      ids.set(id, `#${ids.size + 1}`);
    }

    return ids.get(id) ?? id;
  };

  return html
    .replace(/\b(id|for)="([^"]*)"/g, (_all, attribute: string, id: string) => `${attribute}="${numbered(id)}"`)
    .replace(/aria-describedby="([^"]*)"/g, (_all, list: string) => `aria-describedby="${list.split(' ').map(numbered).join(' ')}"`)
    .replace(/<path [^>]*><\/path>/g, '<path></path>')
    .replace(/class="([^"]*)"/g, (_all, list: string) => `class="${list.split(' ').map((name) => name.replace(/^[A-Za-z0-9]*_([A-Za-z0-9]+)_.*$/, '$1')).join(' ')}"`);
};

// What the Field drew for `aligned` and for `stacked` before the row layout was added (captured from the code of origin/main 7471b52f, normalised as above; the
// two layouts differ only in `data-ov-layout`, which LAYOUT stands for). Adding a layout may not change a byte of what the other two draw.
const BEFORE_THE_ROW = {
  bare: '<div class="root" data-ov-layout="LAYOUT"><label id="#1" for="#2" class="label" data-ov-part="label">API URL</label><input id="#2" class="face input" autocomplete="off" autocapitalize="off" spellcheck="false" data-ov-width="fill" type="text" value=""></div>',
  full: '<div data-testid="field" class="root" data-ov-layout="LAYOUT"><label id="#1" for="#2" class="label" data-ov-part="label">API URL<span class="required" data-ov-part="required" aria-hidden="true">*</span> <span class="aside" data-ov-part="aside">optional</span></label><input id="#2" class="face input" required="" autocomplete="off" autocapitalize="off" spellcheck="false" data-ov-width="fill" aria-describedby="#3 #4" aria-invalid="true" type="text" value="x"><div id="#3" class="help" data-ov-part="help">The address of the API.</div><div id="#4" class="lane" data-ov-part="lane" data-ov-kind="error" aria-live="off"><svg class="root" data-ov-glyph="status-error" data-ov-size="16" viewBox="0 0 16 16" aria-hidden="true"><path></path><path></path></svg><span class="word" data-ov-part="word">Error: </span><span class="message" data-ov-part="message" data-ov-tip="Not a valid key. Paste 64 hex characters.\nThe key has 12 characters.">Not a valid key. Paste 64 hex characters.</span><span class="word" data-ov-part="detail"> The key has 12 characters.</span><button type="button" class="retry">Retry</button></div></div>',
  locked:
    '<div class="root" data-ov-layout="LAYOUT" data-ov-unavailable="true"><label id="#1" for="#2" class="label" data-ov-part="label">Traces</label><button id="#2" type="button" role="switch" class="root" aria-checked="true" aria-describedby="#3" aria-disabled="true"><span class="track" data-ov-part="track" aria-hidden="true"></span></button><div id="#3" class="lane" data-ov-part="lane" data-ov-kind="info" aria-live="off"><svg class="root" data-ov-glyph="status-info" data-ov-size="16" viewBox="0 0 16 16" aria-hidden="true"><path></path><path></path></svg><span class="message" data-ov-part="message" data-ov-clip="">Turn on Send telemetry to change this.</span></div></div>',
  checking:
    '<div class="root" data-ov-layout="LAYOUT"><label id="#1" for="#2" class="label" data-ov-part="label">API URL</label><input id="#2" class="face input" readonly="" autocomplete="off" autocapitalize="off" spellcheck="false" data-ov-width="fill" aria-describedby="#3" type="text" value="x"><div id="#3" class="lane" data-ov-part="lane" data-ov-kind="checking" aria-live="off"><svg data-ov-busy="true" class="root" data-ov-glyph="loader" data-ov-size="16" viewBox="0 0 24 24" aria-hidden="true"><path></path></svg><span class="message" data-ov-part="message" data-ov-clip="">Checking…</span></div></div>',
} as const;

describe('the aligned and stacked layouts, now that there is a third', () => {
  const drawn = {
    bare: (layout: 'aligned' | 'stacked') => (
      <Field label="API URL" layout={layout}>
        <TextInput value="" onValueChange={noop} />
      </Field>
    ),
    full: (layout: 'aligned' | 'stacked') => (
      <Field
        label="API URL"
        layout={layout}
        required
        aside="optional"
        help="The address of the API."
        message={{ kind: 'error', text: 'Not a valid key. Paste 64 hex characters.', detail: 'The key has 12 characters.', retry: true }}
        onRetry={noop}
        data-testid="field"
      >
        <TextInput value="x" onValueChange={noop} />
      </Field>
    ),
    locked: (layout: 'aligned' | 'stacked') => (
      <Field label="Traces" layout={layout} lane disabledReason="Turn on Send telemetry to change this.">
        <Toggle checked onCheckedChange={noop} />
      </Field>
    ),
    checking: (layout: 'aligned' | 'stacked') => (
      <Field label="API URL" layout={layout} readOnly message={{ kind: 'checking', text: '' }}>
        <TextInput value="x" onValueChange={noop} />
      </Field>
    ),
  };
  for (const layout of ['aligned', 'stacked'] as const) {
    for (const [name, make] of Object.entries(drawn)) {
      it(`draws ${layout} ${name} byte for byte as it did before the row layout`, () => {
        const { container } = render(make(layout));
        expect(normalise(container.innerHTML)).toBe(BEFORE_THE_ROW[name as keyof typeof BEFORE_THE_ROW].replace('LAYOUT', layout));
      });
    }

    it(`gives the description of the ${layout} layout no clip marker and no clamp, and draws no column and no trailing slot`, () => {
      const { container } = render(field({ layout, help: 'The address of the API.', lane: true }));
      expect(part(container, 'help')?.hasAttribute('data-ov-clip')).toBe(false);
      expect(part(container, 'text')).toBeNull();
      expect(part(container, 'control')).toBeNull();
      expect(part(container, 'trailing')).toBeNull();
    });
  }

  it('draws no trailing slot for a caller that passes one anyway (the types refuse it; plain JavaScript and a cast do not)', () => {
    for (const layout of [undefined, 'aligned', 'stacked']) {
      const props = { label: 'API URL', layout, trailing: <button type="button">Reset</button>, children: input() } as unknown as FieldProps;
      const { container, unmount } = render(<Field {...props} />);
      expect(part(container, 'trailing'), String(layout)).toBeNull();
      expect(container.textContent, String(layout)).not.toContain('Reset');
      unmount();
    }
  });
});

// ---- the row layout (design 16 S126, S127) ---------------------------------------------------------------------------------------

type RowOptions = {
  readonly required?: boolean;
  readonly aside?: string;
  readonly help?: string;
  readonly message?: FieldMessage;
  readonly lane?: boolean;
  readonly onRetry?: () => void;
  readonly disabledReason?: string;
  readonly readOnly?: boolean;
  readonly trailing?: ReactNode;
};
const row = (props: RowOptions = {}, control = input()) => (
  <Field label="Font size" layout="row" {...props}>
    {control}
  </Field>
);
/** The children of an element, each by the part it is: its own part name, else its tag. */
const partsOf = (element: Element | null) => [...(element?.children ?? [])].map((child) => child.getAttribute('data-ov-part') ?? child.tagName.toLowerCase());
const resetButton = <IconButton icon="undo" label="Reset Font size to default" variant="ghost" size="row" onClick={noop} />;

describe('Field layout="row": a title, a description and the message lane on one side, the control and a trailing slot on the other', () => {
  it('is a root that says it is a row, holding the text column and then the control column', () => {
    const { container } = render(row({ help: 'The size of the text.', lane: true }));
    const root = container.firstElementChild;
    expect(root?.getAttribute('data-ov-layout')).toBe('row');
    expect(partsOf(root)).toEqual(['text', 'control']);
  });

  it('keeps the title, the description and the lane in the text column, in that order, and the control and then the slot in the control column', () => {
    const { container } = render(row({ help: 'The size of the text.', message: { kind: 'hint', text: 'Whole numbers.' } }));
    expect(partsOf(part(container, 'text'))).toEqual(['label', 'help', 'lane']);
    expect(partsOf(part(container, 'control'))).toEqual(['input', 'trailing']);
  });

  it('draws only what it has: no description and no lane when there are none, and the slot all the same', () => {
    const { container } = render(row());
    expect(partsOf(part(container, 'text'))).toEqual(['label']);
    expect(partsOf(part(container, 'control'))).toEqual(['input', 'trailing']);
  });

  it('is the few elements it needs: the root, the two columns, the title, the control and the slot', () => {
    const count = (props: RowOptions) => {
      const { container, unmount } = render(row(props));
      const total = container.querySelectorAll('*').length;
      unmount();
      return total;
    };

    const bare = count({});
    // root, text column, label, control column, input, trailing slot
    expect(bare).toBe(6);
    expect(count({ help: 'Help.' })).toBe(bare + 1);
    expect(count({ lane: true })).toBe(bare + 1);
    expect(count({ required: true })).toBe(bare + 1);
  });

  it('makes the title a real label for the control: it names it, and a click on it goes to the control', () => {
    const { container } = render(row());
    const control = screen.getByRole('textbox', { name: 'Font size' });
    const label = part(container, 'label');
    expect(label?.tagName).toBe('LABEL');
    expect(label?.getAttribute('for')).toBe(control.id);
    expect(control.id).not.toBe('');
    expect(control.hasAttribute('aria-label')).toBe(false);
    const clicked = vi.fn();
    control.addEventListener('click', clicked);
    fireEvent.click(label!);
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('names a switch in the row by its title, as the other layouts do', () => {
    render(row({}, <Toggle checked onCheckedChange={noop} />));
    expect(screen.getByRole('switch', { name: 'Font size' })).toBeTruthy();
  });

  it('describes the control by the description and then by the lane, in that order', () => {
    const { container } = render(row({ help: 'The size of the text.', message: { kind: 'hint', text: 'Whole numbers.' } }));
    const control = screen.getByRole('textbox');
    expect(control.getAttribute('aria-describedby')).toBe(`${part(container, 'help')?.id} ${lane(container)?.id}`);
    expect(description(control)).toBe('The size of the text. Whole numbers.');
  });

  it('keeps the marks of the title: the asterisk that no assistive technology reads, and the aside', () => {
    const { container } = render(row({ required: true, aside: 'optional' }));
    const label = part(container, 'label');
    expect(label?.querySelector('[data-ov-part="required"]')?.getAttribute('aria-hidden')).toBe('true');
    expect(label?.querySelector('[data-ov-part="aside"]')?.textContent).toBe('optional');
    expect(screen.getByRole('textbox', { name: 'Font size optional' })).toBeTruthy();
  });

  it('makes the description a clipping element, so that the tooltip host shows all of it while it is cut', () => {
    const { container } = render(row({ help: 'The size of the text.' }));
    expect(part(container, 'help')?.hasAttribute('data-ov-clip')).toBe(true);
    expect(part(container, 'help')?.hasAttribute('data-ov-tip')).toBe(false);
    expect(part(container, 'help')?.hasAttribute('title')).toBe(false);
  });

  describe('the lane', () => {
    it('is not there for a row with nothing to say, and is there, empty, for a row that can say something: its height is reserved by `lane` and by a message', () => {
      const { container, rerender } = render(row());
      expect(lane(container)).toBeNull();
      rerender(row({ lane: true }));
      expect(lane(container)).not.toBeNull();
      expect(lane(container)?.textContent).toBe('');
      expect(lane(container)?.hasAttribute('data-ov-kind')).toBe(false);
      rerender(row({ message: { kind: 'hint', text: 'Whole numbers.' } }));
      expect(lane(container)?.textContent).toBe('Whole numbers.');
    });

    it('is in the text column, under the description, and is never a live region', () => {
      const { container } = render(row({ help: 'The size of the text.', message: { kind: 'error', text: 'Not a number. Use digits.' } }));
      expect(lane(container)?.parentElement).toBe(part(container, 'text'));
      expect(lane(container)?.previousElementSibling).toBe(part(container, 'help'));
      expect(lane(container)?.getAttribute('aria-live')).toBe('off');
    });

    it('says each kind of the model as the other layouts do: its kind, and the control invalid for an error and for nothing else', () => {
      const { container, rerender } = render(row({ message: { kind: 'error', text: 'Not a number. Use digits.' } }));
      expect(lane(container)?.getAttribute('data-ov-kind')).toBe('error');
      expect(screen.getByRole('textbox').getAttribute('aria-invalid')).toBe('true');
      for (const kind of ['hint', 'warning', 'checking', 'retry', 'saved', 'info'] as const) {
        rerender(row({ message: { kind, text: 'Something.' } }));
        expect(lane(container)?.getAttribute('data-ov-kind'), kind).toBe(kind);
        expect(screen.getByRole('textbox').hasAttribute('aria-invalid'), kind).toBe(false);
      }
    });

    it('offers Retry for a check that could not be made and for an apply that failed', () => {
      const onRetry = vi.fn();
      const { container, rerender } = render(row({ message: { kind: 'retry', text: '', retry: true }, onRetry }));
      fireEvent.click(within(lane(container)!).getByRole('button', { name: 'Retry' }));
      expect(onRetry).toHaveBeenCalledTimes(1);
      rerender(row({ message: { kind: 'error', text: 'Couldn’t save this change. Retry.', retry: true }, onRetry }));
      expect(within(lane(container)!).getByRole('button', { name: 'Retry' })).toBeTruthy();
    });
  });

  describe('the trailing slot', () => {
    it('is in the control column after the control, and empty unless it is given something', () => {
      const { container } = render(row());
      const slot = part(container, 'trailing');
      expect(slot?.parentElement).toBe(part(container, 'control'));
      expect(slot?.previousElementSibling).toBe(screen.getByRole('textbox'));
      expect(slot?.childNodes.length).toBe(0);
    });

    it('holds what it is given, and the control is the same element and in the same place with it and without it', () => {
      const { container, rerender } = render(row());
      const control = screen.getByRole('textbox');
      rerender(row({ trailing: resetButton }));
      const slot = part(container, 'trailing');
      expect(within(slot!).getByRole('button', { name: 'Reset Font size to default' })).toBeTruthy();
      expect(partsOf(part(container, 'control'))).toEqual(['input', 'trailing']);
      expect(screen.getByRole('textbox')).toBe(control);
      rerender(row());
      expect(part(container, 'trailing')?.childNodes.length).toBe(0);
      expect(screen.getByRole('textbox')).toBe(control);
    });

    it('is a slot and not a reset: it holds any node, and says nothing of what it holds', () => {
      const { container } = render(row({ trailing: <span data-testid="held">Pro</span> }));
      expect(part(container, 'trailing')?.textContent).toBe('Pro');
      expect(part(container, 'trailing')?.hasAttribute('role')).toBe(false);
      expect(part(container, 'trailing')?.hasAttribute('aria-label')).toBe(false);
    });
  });

  describe('a row that cannot change', () => {
    it('says why in its lane, keeps the control focusable and described by the reason, and keeps the title legible', () => {
      const { container } = render(row({ disabledReason: 'Turn on Send telemetry to change this.' }, <Toggle checked onCheckedChange={noop} />));
      expect(container.firstElementChild?.getAttribute('data-ov-unavailable')).toBe('true');
      expect(lane(container)?.getAttribute('data-ov-kind')).toBe('info');
      expect(lane(container)?.textContent).toBe('Turn on Send telemetry to change this.');
      const control = screen.getByRole('switch');
      expect(control.getAttribute('aria-disabled')).toBe('true');
      expect(control.tabIndex).not.toBe(-1);
      expect(description(control)).toBe('Turn on Send telemetry to change this.');
      expect(part(container, 'label')?.textContent).toBe('Font size');
    });

    it('is a fact when it is read-only: the control is read-only and the row is not marked unavailable', () => {
      const { container } = render(row({ readOnly: true, message: { kind: 'info', text: 'Managed by your organisation.' } }, input({ value: '14' })));
      expect(screen.getByRole<HTMLInputElement>('textbox').readOnly).toBe(true);
      expect(container.firstElementChild?.hasAttribute('data-ov-unavailable')).toBe(false);
      expect(lane(container)?.textContent).toBe('Managed by your organisation.');
    });
  });

  it('passes data attributes to its root, takes no class and no style from a caller, and draws no title', () => {
    const { container } = render(
      // @ts-expect-error className and style are not props of a kit part
      <Field label="Font size" layout="row" className="caller" style={{ color: 'red' }} data-testid="row" help="Help.">
        {input()}
      </Field>,
    );
    const root = screen.getByTestId('row');
    expect(root).toBe(container.firstElementChild);
    expect(root.className).not.toContain('caller');
    expect(root.hasAttribute('style')).toBe(false);
    expect(container.querySelector('[title], [style]')).toBeNull();
    expect(part(container, 'text')?.hasAttribute('data-testid')).toBe(false);
    expect(part(container, 'control')?.hasAttribute('data-testid')).toBe(false);
  });

  it('has closed props: the trailing slot is the row\'s alone, and a layout is one of three', () => {
    // Types only: these are never rendered.
    const slot = <button type="button">Reset</button>;
    const accepted: FieldProps[] = [
      { label: 'Font size', children: null },
      { label: 'Font size', children: null, layout: 'aligned' },
      { label: 'Font size', children: null, layout: 'stacked', trailing: undefined },
      { label: 'Font size', children: null, layout: 'row' },
      { label: 'Font size', children: null, layout: 'row', trailing: slot },
      { label: 'Font size', children: null, layout: 'row', trailing: undefined, help: 'Help.', lane: true },
    ];
    // @ts-expect-error a trailing slot belongs to the row layout: the default layout (aligned) has none
    const slotInTheDefault: FieldProps = { label: 'Font size', children: null, trailing: slot };
    // @ts-expect-error a trailing slot belongs to the row layout, not to aligned
    const slotInAligned: FieldProps = { label: 'Font size', children: null, layout: 'aligned', trailing: slot };
    // @ts-expect-error a trailing slot belongs to the row layout, not to stacked
    const slotInStacked: FieldProps = { label: 'Font size', children: null, layout: 'stacked', trailing: slot };
    // @ts-expect-error a layout outside the closed set
    const unknownLayout: FieldProps = { label: 'Font size', children: null, layout: 'inline' };
    // @ts-expect-error className is not a prop of a kit part
    const withClass: FieldProps = { label: 'Font size', children: null, layout: 'row', className: 'x' };
    // @ts-expect-error style is not a prop of a kit part
    const withStyle: FieldProps = { label: 'Font size', children: null, layout: 'row', style: { color: 'red' } };
    expect([accepted, slotInTheDefault, slotInAligned, slotInStacked, unknownLayout, withClass, withStyle]).toHaveLength(7);
  });
});

describe('the examples of Field', () => {
  const entries = Object.entries(examples) as Array<[string, ComponentType]>;

  it('has an example for the label placements, the required mark, the help, every kind of the lane, the unavailable and read-only states, a form column, and the row in every state of the model and with each control', () => {
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
        'RowDefault',
        'RowHint',
        'RowModified',
        'RowInvalid',
        'RowWarning',
        'RowChecking',
        'RowCouldNotCheck',
        'RowSaved',
        'RowApplyFailed',
        'RowRestartRequired',
        'RowUnavailable',
        'RowReadOnly',
        'RowLongDescription',
        'RowWithToggle',
        'RowWithTextInput',
        'RowWithSelect',
        'RowWithNumberInput',
      ].sort(),
    );
  });

  describe('the row examples', () => {
    const rows = entries.filter(([name]) => name.startsWith('Row'));
    const drawn = (name: string) => {
      const Example = entries.find(([entry]) => entry === name)?.[1];
      if (Example === undefined) {
        throw new Error(`no example named ${name}`);
      }

      return render(<Example />);
    };

    it('are rows with a trailing slot each, a title that is a label, and a description', () => {
      expect(rows.length).toBe(17);
      for (const [name, Example] of rows) {
        const { container, unmount } = render(<Example />);
        expect(container.querySelector('[data-ov-layout="row"]'), name).not.toBeNull();
        expect(part(container, 'trailing'), name).not.toBeNull();
        expect(part(container, 'text')?.querySelector('label'), name).not.toBeNull();
        expect(part(container, 'help'), name).not.toBeNull();
        unmount();
      }
    });

    it('show every state of the model in the lane: each kind, an apply that failed, a restart, a reason and a read-only fact', () => {
      const kinds: Record<string, string> = {
        RowHint: 'hint',
        RowInvalid: 'error',
        RowWarning: 'warning',
        RowChecking: 'checking',
        RowCouldNotCheck: 'retry',
        RowSaved: 'saved',
        RowApplyFailed: 'error',
        RowRestartRequired: 'info',
        RowUnavailable: 'info',
        RowReadOnly: 'info',
      };
      for (const [name, kind] of Object.entries(kinds)) {
        const { container, unmount } = drawn(name);
        expect(lane(container)?.getAttribute('data-ov-kind'), name).toBe(kind);
        unmount();
      }

      const { container } = drawn('RowRestartRequired');
      expect(lane(container)?.textContent).toBe('Restart required to apply.');
    });

    it('reserve the lane for the rows that can say something and leave it out of the plain ones', () => {
      for (const [name, reserved] of [['RowDefault', false], ['RowModified', true], ['RowLongDescription', true], ['RowWithToggle', false]] as const) {
        const { container, unmount } = drawn(name);
        expect(lane(container) !== null, name).toBe(reserved);
        unmount();
      }
    });

    it('hold a Reset button in the slot of the modified row only, named for the row, and the consumer decides when it shows', () => {
      const { container, unmount } = drawn('RowModified');
      const slot = part(container, 'trailing')!;
      const button = within(slot).getByRole('button', { name: /^Reset .+ to default$/ });
      expect(button.getAttribute('data-ov-shape')).toBe('icon');
      expect(button.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('undo');
      fireEvent.click(button);
      expect(within(part(container, 'trailing')!).queryByRole('button')).toBeNull();
      expect(part(container, 'trailing')).toBe(slot);
      unmount();
      for (const [name] of rows.filter(([entry]) => entry !== 'RowModified')) {
        const other = drawn(name);
        expect(part(other.container, 'trailing')?.querySelector('button'), name).toBeNull();
        other.unmount();
      }
    });

    it('ask again when Retry is pressed, and the apply that failed offers it too', () => {
      const { container, unmount } = drawn('RowCouldNotCheck');
      fireEvent.click(within(lane(container)!).getByRole('button', { name: 'Retry' }));
      expect(lane(container)?.getAttribute('data-ov-kind')).not.toBe('retry');
      unmount();
      const failed = drawn('RowApplyFailed');
      expect(within(lane(failed.container)!).getByRole('button', { name: 'Retry' })).toBeTruthy();
    });

    it('say why a row cannot change, in the lane and on the control, and keep the control a stop of the keyboard', () => {
      const { container } = drawn('RowUnavailable');
      expect(container.firstElementChild?.getAttribute('data-ov-unavailable')).toBe('true');
      const control = screen.getByRole('switch');
      expect(control.getAttribute('aria-disabled')).toBe('true');
      expect(control.tabIndex).not.toBe(-1);
      // The description of the row, and then the reason in the lane: the reason is said once, by the lane.
      expect(description(control)).toBe(`${part(container, 'help')?.textContent} ${lane(container)?.textContent}`);
    });

    it('hold a description of more than two lines in the long one, which the row clamps', () => {
      const { container } = drawn('RowLongDescription');
      // At 12 px a line of the 70-character measure of design 04 holds about that many characters: a third line starts past twice that.
      expect((part(container, 'help')?.textContent ?? '').length).toBeGreaterThan(220);
    });

    it('use the four controls of the form parts, each named by the title of its row', () => {
      const roles: Record<string, string> = { RowWithToggle: 'switch', RowWithTextInput: 'textbox', RowWithSelect: 'combobox', RowWithNumberInput: 'spinbutton' };
      for (const [name, role] of Object.entries(roles)) {
        const { container, unmount } = drawn(name);
        const title = part(container, 'label')?.textContent ?? '';
        expect(screen.getByRole(role, { name: title }), name).toBeTruthy();
        unmount();
      }
    });
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
    const loader = '.lane > svg[data-ov-busy=\'true\']';
    expect(rule(loader)).toMatchObject({ opacity: '0', animation: 'reveal 1ms linear 1s forwards, spin 1.2s linear 1s infinite' });
    expect(rule(`:where(:root[data-ov-motion='reduced']) ${loader}`)['animation-name']).toBe('reveal');
    expect(declarationsOf(css, `:where(:root:not([data-ov-motion='normal'])) ${loader}`, 'prefers-reduced-motion: reduce')['animation-name']).toBe('reveal');
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
