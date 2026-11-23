import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { opener, restoreFocus, tabStops, wrapTarget } from './focus';

// Where the focus goes when a sheet opens and when it closes, and what Tab does at the two ends of a sheet. The palette's rule (`ui-next/shell/palette/focus.ts`: the element that had the focus is
// remembered and given it back when the focus is lost) is the model, with one difference: the kit cannot know the page, so an element that is gone gets nothing and the caller decides.

// jsdom lays nothing out, so no element has a box and every control would count as hidden. This stand-in gives a box to what a style sheet would draw: an element with no `hidden` attribute and no
// `display: none`, and none of its ancestors with either.
function drawn(element: Element): boolean {
  for (let node: Element | null = element; node !== null; node = node.parentElement) {
    if (node.hasAttribute('hidden') || (node instanceof HTMLElement && node.style.display === 'none')) {
      return false;
    }
  }

  return true;
}

let layoutReads = 0;

beforeEach(() => {
  layoutReads = 0;
  vi.spyOn(Element.prototype, 'getClientRects').mockImplementation(function stub(this: Element) {
    layoutReads += 1;
    return (drawn(this) ? [{ width: 1, height: 1 }] : []) as unknown as DOMRectList;
  });
});

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

/** A document made of `html`, with its `dialog` as the root the stops are read from. */
function world(html: string): { readonly root: HTMLDialogElement; readonly find: <T extends HTMLElement>(selector: string) => T } {
  document.body.innerHTML = `<button type="button" id="page">Page</button><dialog open id="root">${html}</dialog>`;
  const root = document.querySelector<HTMLDialogElement>('#root')!;
  return { root, find: <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)! };
}

const names = (elements: readonly HTMLElement[]): string[] => elements.map((element) => element.getAttribute('aria-label') ?? element.id ?? '');

describe('the element that has the focus when a sheet opens', () => {
  it('is the element that has it', () => {
    document.body.innerHTML = '<button type="button" id="a">A</button>';
    const button = document.querySelector<HTMLButtonElement>('#a')!;
    button.focus();
    expect(opener(document)).toBe(button);
  });

  it('is nothing when the body has the focus, which is where it is when nothing has it', () => {
    document.body.innerHTML = '<button type="button">A</button>';
    expect(document.activeElement).toBe(document.body);
    expect(opener(document)).toBeNull();
  });

  it('is nothing when the document element has it', () => {
    vi.spyOn(document, 'activeElement', 'get').mockReturnValue(document.documentElement);
    expect(opener(document)).toBeNull();
  });
});

describe('giving the focus back', () => {
  it('gives the focus to the element that had it, once the focus is lost: the dialog that leaves takes its own focus with it', () => {
    const { root, find } = world('<button type="button" id="inside">Inside</button>');
    const page = find<HTMLButtonElement>('#page');
    page.focus();
    const remembered = opener(document);
    find<HTMLButtonElement>('#inside').focus();
    root.remove();
    expect(document.activeElement).toBe(document.body);
    restoreFocus(document, remembered);
    expect(document.activeElement).toBe(page);
  });

  it('gives it back without scrolling the page behind', () => {
    const { find } = world('');
    const page = find<HTMLButtonElement>('#page');
    const focus = vi.spyOn(page, 'focus');
    restoreFocus(document, page);
    expect(focus).toHaveBeenCalledExactlyOnceWith({ preventScroll: true });
  });

  it('leaves the focus where it was sent: when something holds it, someone moved it while the sheet closed, and the user is meant to be there', () => {
    const { find } = world('<textarea id="sent"></textarea>');
    const page = find<HTMLButtonElement>('#page');
    page.focus();
    const remembered = opener(document);
    const sent = find<HTMLTextAreaElement>('#sent');
    sent.focus();
    restoreFocus(document, remembered);
    expect(document.activeElement).toBe(sent);
  });

  it('does nothing, and does not throw, when the element is gone: the part cannot know the page, the caller decides', () => {
    const { find } = world('');
    const page = find<HTMLButtonElement>('#page');
    page.focus();
    const remembered = opener(document);
    page.remove();
    expect(() => {
      restoreFocus(document, remembered);
    }).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });

  it('does nothing when nothing was remembered', () => {
    world('');
    restoreFocus(document, null);
    expect(document.activeElement).toBe(document.body);
  });
});

describe('the stops of Tab', () => {
  it('are the controls the keyboard reaches, in document order: links, buttons, fields, summaries, editable text and whatever has a tabindex', () => {
    const { root } = world(`
      <a href="#x" aria-label="link">link</a>
      <button type="button" aria-label="button">button</button>
      <input aria-label="input" />
      <select aria-label="select"><option>one</option></select>
      <textarea aria-label="textarea"></textarea>
      <details><summary aria-label="summary">summary</summary></details>
      <div contenteditable="true" aria-label="editable"></div>
      <div tabindex="0" aria-label="div">div</div>
      <span tabindex="3" aria-label="span">span</span>
    `);
    expect(names(tabStops(root))).toEqual(['link', 'button', 'input', 'select', 'textarea', 'summary', 'editable', 'div', 'span']);
  });

  it('leave out what the keyboard does not reach: a link with no address, text that is not focusable, a field that is not editable text', () => {
    const { root } = world(`
      <a aria-label="anchor">no address</a>
      <p aria-label="paragraph">text</p>
      <div aria-label="plain">plain</div>
      <input type="hidden" aria-label="hidden input" />
      <div contenteditable="false" aria-label="not editable">no</div>
      <button type="button" aria-label="button">button</button>
    `);
    expect(names(tabStops(root))).toEqual(['button']);
  });

  it('leave out a control that is disabled, alone or by its fieldset, and one whose tabindex is negative', () => {
    const { root } = world(`
      <button type="button" disabled aria-label="disabled">a</button>
      <fieldset disabled><button type="button" aria-label="in a disabled fieldset">b</button></fieldset>
      <button type="button" tabindex="-1" aria-label="minus one">c</button>
      <div tabindex="-5" aria-label="minus five">d</div>
      <button type="button" aria-label="kept">e</button>
    `);
    expect(names(tabStops(root))).toEqual(['kept']);
  });

  it('keep a control that is unavailable for a reason: it stays focusable (`aria-disabled`, never the native attribute)', () => {
    const { root } = world(`
      <button type="button" aria-disabled="true" aria-label="unavailable">a</button>
      <input aria-disabled="true" aria-label="unavailable field" />
    `);
    expect(names(tabStops(root))).toEqual(['unavailable', 'unavailable field']);
  });

  it('leave out what is not drawn: hidden, `display: none` here or above, `visibility: hidden` here or above, and what is inert', () => {
    const { root } = world(`
      <button type="button" hidden aria-label="hidden">a</button>
      <div hidden><button type="button" aria-label="in a hidden box">b</button></div>
      <div style="display: none"><button type="button" aria-label="under display none">c</button></div>
      <button type="button" style="visibility: hidden" aria-label="invisible">d</button>
      <div style="visibility: hidden"><button type="button" aria-label="under invisible">e</button></div>
      <div inert><button type="button" aria-label="inert">f</button></div>
      <button type="button" aria-label="kept">g</button>
    `);
    expect(names(tabStops(root))).toEqual(['kept']);
  });

  it('keep a control that is drawn under an ancestor that makes only itself invisible: a child may be visible again', () => {
    const { root } = world(`
      <div style="visibility: hidden"><button type="button" style="visibility: visible" aria-label="visible again">a</button></div>
    `);
    expect(names(tabStops(root))).toEqual(['visible again']);
  });

  it('are read when asked, never kept: what the page does in between is seen', () => {
    const { root, find } = world('<button type="button" aria-label="one">1</button><button type="button" id="two" aria-label="two">2</button>');
    expect(names(tabStops(root))).toEqual(['one', 'two']);
    find<HTMLButtonElement>('#two').hidden = true;
    root.insertAdjacentHTML('beforeend', '<button type="button" aria-label="three">3</button>');
    expect(names(tabStops(root))).toEqual(['one', 'three']);
    expect(layoutReads).toBeGreaterThan(0);
  });

  it('are the root\'s own: the page behind it is not read', () => {
    const { root } = world('<button type="button" aria-label="inside">a</button>');
    expect(names(tabStops(root))).toEqual(['inside']);
  });
});

describe('where Tab wraps', () => {
  const buttons = '<button type="button" id="one">1</button><button type="button" id="two">2</button><button type="button" id="three">3</button>';

  it('sends Tab on the last stop to the first', () => {
    const { root, find } = world(buttons);
    find<HTMLButtonElement>('#three').focus();
    expect(wrapTarget(root, false)).toBe(find('#one'));
  });

  it('sends Shift+Tab on the first stop to the last', () => {
    const { root, find } = world(buttons);
    find<HTMLButtonElement>('#one').focus();
    expect(wrapTarget(root, true)).toBe(find('#three'));
  });

  it('leaves every other press to the browser: its own move stays inside', () => {
    const { root, find } = world(buttons);
    find<HTMLButtonElement>('#two').focus();
    expect(wrapTarget(root, false)).toBeNull();
    expect(wrapTarget(root, true)).toBeNull();
    find<HTMLButtonElement>('#one').focus();
    expect(wrapTarget(root, false)).toBeNull();
    find<HTMLButtonElement>('#three').focus();
    expect(wrapTarget(root, true)).toBeNull();
  });

  it('counts the ends among the stops, not among the elements: what Tab skips is not an end', () => {
    const { root, find } = world(`
      <button type="button" disabled id="skipped-first">0</button>
      ${buttons}
      <button type="button" tabindex="-1" id="skipped-last">4</button>
      <button type="button" hidden id="hidden-last">5</button>
    `);
    find<HTMLButtonElement>('#three').focus();
    expect(wrapTarget(root, false)).toBe(find('#one'));
    find<HTMLButtonElement>('#one').focus();
    expect(wrapTarget(root, true)).toBe(find('#three'));
  });

  it('counts a control that is unavailable for a reason as an end: Tab stops on it', () => {
    const { root, find } = world('<button type="button" id="one">1</button><button type="button" id="two" aria-disabled="true">2</button>');
    find<HTMLButtonElement>('#two').focus();
    expect(wrapTarget(root, false)).toBe(find('#one'));
  });

  it('sends Shift+Tab on the root itself to the last stop: the dialog holds the focus when nothing in it could take it, and the browser would leave', () => {
    const { root, find } = world(`${buttons}`);
    root.tabIndex = -1;
    root.focus();
    expect(document.activeElement).toBe(root);
    expect(wrapTarget(root, true)).toBe(find('#three'));
    expect(wrapTarget(root, false)).toBeNull();
  });

  it('leaves a press to the browser when the focus is not in the root: nothing here is Tab\'s to take', () => {
    const { root, find } = world(buttons);
    find<HTMLButtonElement>('#page').focus();
    expect(wrapTarget(root, false)).toBeNull();
    expect(wrapTarget(root, true)).toBeNull();
  });

  it('has no end to wrap at when there is no stop', () => {
    const { root } = world('<p>text</p>');
    expect(wrapTarget(root, false)).toBeNull();
    expect(wrapTarget(root, true)).toBeNull();
  });

  it('wraps at a single stop onto itself', () => {
    const { root, find } = world('<button type="button" id="only">1</button>');
    find<HTMLButtonElement>('#only').focus();
    expect(wrapTarget(root, false)).toBe(find('#only'));
    expect(wrapTarget(root, true)).toBe(find('#only'));
  });
});
