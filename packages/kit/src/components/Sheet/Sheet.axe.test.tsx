import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import axe from 'axe-core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { examples } from '../../examples';
import { Sheet } from './Sheet';

// An open sheet under axe-core in jsdom: the dialog's name, the heading, the Close control's name, and what a body holds. jsdom has no layout, so colour contrast and the rules that need it are off here;
// the real-engine check looks at the sheet in WebKit and Chromium, in three themes, where they are judged. jsdom has no modal dialog either: a stand-in opens the element, as the attribute does.
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

const RULES = { rules: { 'color-contrast': { enabled: false }, region: { enabled: false } } };

const violations = async (container: Element) => {
  const result = await axe.run(container, RULES);
  return result.violations.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(' ')).join(', ')}`);
};

describe('the open sheet, by axe-core', () => {
  it('has no violation with a body that holds a list of pages and a form', async () => {
    const { container } = render(
      <Sheet title="Example sheet" onClose={() => undefined}>
        <nav aria-label="Pages">
          <button type="button">General</button>
          <button type="button">Appearance</button>
        </nav>
        <form>
          <label>
            Display name
            <input type="text" />
          </label>
        </form>
      </Sheet>,
    );
    expect(screen.getByRole('dialog', { name: 'Example sheet' })).toBeDefined();
    expect(await violations(container)).toEqual([]);
  });

  it('has no violation with nothing in the body', async () => {
    const { container } = render(
      <Sheet title="Example sheet" onClose={() => undefined}>
        {null}
      </Sheet>,
    );
    expect(await violations(container)).toEqual([]);
  });

  for (const [name, Example] of Object.entries(examples.Sheet ?? {})) {
    it(`Sheet/${name} has no violation closed, and none open`, async () => {
      const { container } = render(<Example />);
      expect(await violations(container)).toEqual([]);
      fireEvent.click(screen.getByRole('button', { name: 'Open sheet' }));
      expect(screen.getByRole('dialog')).toBeDefined();
      expect(await violations(container)).toEqual([]);
    });
  }
});
