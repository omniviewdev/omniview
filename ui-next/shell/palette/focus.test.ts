import { afterEach, describe, expect, it } from 'vitest';
import { rememberFocus, restoreFocus } from './focus';

// Where the focus goes when the palette closes (ch05 "Escape closes command search and restores invoker"; ch16 S144: the focus never ends on the body). The palette takes the keyboard when it opens,
// so what had it is remembered first and given it back after; when that element is gone the page takes it, because an action must never leave the focus on nothing.

afterEach(() => {
  document.body.innerHTML = '';
});

function world(): { readonly opener: HTMLButtonElement; readonly page: HTMLElement } {
  document.body.innerHTML = '<main data-shell-region="island" data-shell-focus tabindex="-1"></main><button type="button" id="opener">Open</button>';
  return { opener: document.querySelector<HTMLButtonElement>('#opener')!, page: document.querySelector<HTMLElement>('main')! };
}

describe('remembering and restoring the focus', () => {
  it('gives the focus back to the element that had it', () => {
    const { opener } = world();
    opener.focus();
    const remembered = rememberFocus();
    document.body.insertAdjacentHTML('beforeend', '<input id="inside" />');
    document.querySelector<HTMLInputElement>('#inside')!.focus();
    // The dialog is gone, and the focus it held with it.
    document.querySelector('#inside')!.remove();
    restoreFocus(remembered);
    expect(document.activeElement).toBe(opener);
  });

  it('gives the page the focus when the element left the document', () => {
    const { opener, page } = world();
    opener.focus();
    const remembered = rememberFocus();
    opener.remove();
    restoreFocus(remembered);
    expect(document.activeElement).toBe(page);
  });

  it('gives the page the focus when nothing had it', () => {
    const { page } = world();
    expect(document.activeElement).toBe(document.body);
    restoreFocus(rememberFocus());
    expect(document.activeElement).toBe(page);
  });

  it('gives the page the focus when the element cannot take it any more', () => {
    const { opener, page } = world();
    opener.focus();
    const remembered = rememberFocus();
    // The palette took the keyboard, and left with it; meanwhile the control that opened it was disabled.
    document.body.insertAdjacentHTML('beforeend', '<input id="inside" />');
    document.querySelector<HTMLInputElement>('#inside')!.focus();
    document.querySelector('#inside')!.remove();
    opener.disabled = true;
    restoreFocus(remembered);
    expect(document.activeElement).toBe(page);
  });

  it('leaves the focus where it was sent while the palette closed: a command that opened a panel put it there, and the user is meant to be there', () => {
    const { opener } = world();
    opener.focus();
    const remembered = rememberFocus();
    document.body.insertAdjacentHTML('beforeend', '<input id="inside" /><textarea id="sent"></textarea>');
    document.querySelector<HTMLInputElement>('#inside')!.focus();
    document.querySelector('#inside')!.remove();
    const sent = document.querySelector<HTMLTextAreaElement>('#sent')!;
    sent.focus();
    restoreFocus(remembered);
    expect(document.activeElement).toBe(sent);
  });

  it('does nothing, and does not throw, in a document with no page', () => {
    document.body.innerHTML = '';
    expect(() => {
      restoreFocus(rememberFocus());
    }).not.toThrow();
    expect(document.activeElement).toBe(document.body);
  });
});
