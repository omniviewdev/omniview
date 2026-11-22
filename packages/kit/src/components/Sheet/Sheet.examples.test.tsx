import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { examples } from '../../examples';

// The example of the Sheet is a consumer: a button that opens a sheet. Because an open modal makes the whole page inert, nothing opens at load, and what the sheet does once it is open is
// what is read here. jsdom has no modal dialog (a stand-in opens the element, as the attribute does) and lays nothing out (a stand-in gives a box to what a style sheet would draw).
const dialogPrototype = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
dialogPrototype.showModal ??= function showModal(this: HTMLDialogElement) {
  this.setAttribute('open', '');
};

dialogPrototype.close ??= function close(this: HTMLDialogElement) {
  this.removeAttribute('open');
};

beforeEach(() => {
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function stub(this: Element) {
    return (this.closest('[hidden]') === null ? [{ width: 1, height: 1 }] : []) as unknown as DOMRectList;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

const set = examples.Sheet ?? {};

/** The name a control has for a person: its label, its text, or the label it is tied to. */
function nameOf(control: Element): string {
  return control.getAttribute('aria-label') ?? (control instanceof HTMLInputElement ? (control.labels?.[0]?.textContent ?? '') : (control.textContent ?? ''));
}

/** What a sheet of the examples reads like to assistive technology, one row for each example (docs/ui-next/AGENTS.md, "The kit"). */
type Row = {
  /** The name of the control that opens the sheet: the only thing on the page at load. */
  readonly opener: string;
  /** The dialog's accessible name. */
  readonly dialog: string;
  /** The headings in the open dialog, in order, as "level name": the outline. */
  readonly headings: readonly string[];
  /** The controls Tab stops on in the open dialog, in order. */
  readonly stops: readonly string[];
};

const MATRIX: Readonly<Record<string, Row>> = {
  OpenedFromTheButton: {
    opener: 'Open sheet',
    dialog: 'Example sheet',
    headings: ['H2 Example sheet', 'H3 General'],
    stops: ['Close', 'General', 'Appearance', 'Keyboard', 'Display name'],
  },
};

describe('the Sheet examples', () => {
  it('are the ones of the matrix: a row for every example, and an example for every row', () => {
    expect(Object.keys(set).sort()).toEqual(Object.keys(MATRIX).sort());
  });

  for (const [name, row] of Object.entries(MATRIX)) {
    const Example = set[name];

    it(`${name}: opens nothing at load, and has one button that says what it does`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      const { container } = render(<Example />);
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(container.querySelectorAll('dialog')).toHaveLength(0);
      const buttons = screen.getAllByRole('button');
      expect(buttons.map((button) => nameOf(button))).toEqual([row.opener]);
      expect(container.querySelector('[title]')).toBeNull();
    });

    it(`${name}: moves no focus when it mounts`, () => {
      // The kit probe walks the parts page by Tab from the top of the document: an example that focused something at mount, and blurred it again, started the next Tab in the middle of the page.
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      const focus = vi.spyOn(HTMLElement.prototype, 'focus');
      const blur = vi.spyOn(HTMLElement.prototype, 'blur');
      render(<Example />);
      expect(focus).not.toHaveBeenCalled();
      expect(blur).not.toHaveBeenCalled();
      expect(document.activeElement).toBe(document.body);
    });

    it(`${name}: opens a dialog when its button is pressed, named ${row.dialog}, and reads as ${row.headings.join(', ')}; Tab stops on ${row.stops.join(', ')}`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      render(<Example />);
      fireEvent.click(screen.getByRole('button', { name: row.opener }));
      const dialog = screen.getByRole('dialog', { name: row.dialog });
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(within(dialog).getAllByRole('heading').map((heading) => `${heading.tagName} ${heading.textContent ?? ''}`)).toEqual(row.headings);
      const stops = [...dialog.querySelectorAll('button, input, select, textarea, a[href]')];
      expect(stops.map((stop) => nameOf(stop))).toEqual(row.stops);
      for (const button of dialog.querySelectorAll('button')) {
        expect(button.getAttribute('type')).toBe('button');
      }

      expect(dialog.querySelector('[title]')).toBeNull();
      for (const svg of dialog.querySelectorAll('svg')) {
        expect(svg.getAttribute('aria-hidden')).toBe('true');
      }
    });

    it(`${name}: has two columns in the body, a list of three buttons at the left and text and an input at the right`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      render(<Example />);
      fireEvent.click(screen.getByRole('button', { name: row.opener }));
      const dialog = screen.getByRole('dialog', { name: row.dialog });
      const body = dialog.querySelector<HTMLElement>('[data-ov-part="body"]')!;
      // The body holds one layout of two columns: the list of pages, then the page.
      expect(body.children).toHaveLength(1);
      const columns = body.firstElementChild as HTMLElement;
      expect(columns.children).toHaveLength(2);
      const list = within(columns).getByRole('navigation', { name: 'Pages' });
      expect(columns.firstElementChild).toBe(list);
      expect(within(list).getAllByRole('button').map((button) => button.textContent)).toEqual(['General', 'Appearance', 'Keyboard']);
      const page = columns.lastElementChild as HTMLElement;
      expect(within(page).getByRole('textbox', { name: 'Display name' })).toBeDefined();
      expect(page.querySelector('p')?.textContent).not.toBe('');
      expect(page.querySelector('p')).not.toBeNull();
    });

    it(`${name}: closes on Escape and on Close, and the focus is back on the button each time, although the button was only pressed: it takes the focus itself, as a Mac browser does not`, async () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      render(<Example />);
      const opens = screen.getByRole('button', { name: row.opener });
      for (const how of ['Escape', 'Close']) {
        fireEvent.click(opens);
        expect(screen.getAllByRole('dialog')).toHaveLength(1);
        if (how === 'Escape') {
          act(() => {
            screen.getByRole('dialog').dispatchEvent(new Event('cancel', { cancelable: true }));
          });
        } else {
          fireEvent.click(screen.getByRole('button', { name: 'Close' }));
        }

        expect(screen.queryByRole('dialog'), how).toBeNull();
        await act(async () => undefined);
        expect(document.activeElement, how).toBe(opens);
      }
    });

    it(`${name}: does not close when a page is chosen, and shows the page that was`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      render(<Example />);
      fireEvent.click(screen.getByRole('button', { name: row.opener }));
      fireEvent.click(screen.getByRole('button', { name: 'Appearance' }));
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
      expect(within(screen.getByRole('dialog')).getByRole('heading', { level: 3 }).textContent).toBe('Appearance');
    });

    it(`${name}: keeps what was typed in its field until Escape puts the applied value back, and the field takes that Escape`, () => {
      expect(Example).toBeDefined();
      if (Example === undefined) {
        return;
      }

      render(<Example />);
      fireEvent.click(screen.getByRole('button', { name: row.opener }));
      const field = screen.getByRole<HTMLInputElement>('textbox', { name: 'Display name' });
      const applied = field.value;
      fireEvent.change(field, { target: { value: `${applied} 2` } });
      expect(field.value).toBe(`${applied} 2`);
      // The key is the field's while it has a draft: the dialog never sees it, and its browser does not send the cancel.
      const unhandled = fireEvent.keyDown(field, { key: 'Escape' });
      expect(unhandled).toBe(false);
      expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Display name' }).value).toBe(applied);
      expect(screen.getAllByRole('dialog')).toHaveLength(1);
    });
  }
});
