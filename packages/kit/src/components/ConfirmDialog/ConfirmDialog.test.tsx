import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ConfirmDialog, type ConfirmSubject } from './ConfirmDialog';

// The dialog is a `Sheet`, a modal that is open while it is mounted. jsdom has no modal dialog (a stand-in opens the element, as the attribute does) and lays nothing out (a stand-in gives a box to what a style sheet
// would draw, so that the Sheet finds Close as its first stop and the dialog's own choice of the focus has something to win over). What a modal does in a real engine is checked in WebKit and Chromium.
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
  vi.restoreAllMocks();
});

const subject: ConfirmSubject = { name: 'Connection A', kind: 'Connection', meta: 'Region 1', status: { role: 'healthy', label: 'Connected' } };
const MESSAGE = 'Removes Connection A from your list.';

type Options = {
  readonly tone?: 'neutral' | 'danger';
  readonly busy?: boolean;
  readonly error?: string;
  readonly destructive?: boolean;
};

/** A confirmation as a caller renders it, open: it is mounted. */
function open({ destructive = false, ...options }: Options = {}) {
  const onConfirm = vi.fn();
  const onCancel = vi.fn();
  const common = { title: 'Remove connection', message: MESSAGE, confirmLabel: 'Remove', onConfirm, onCancel, ...options };
  const view = render(destructive ? <ConfirmDialog {...common} tier="destructive" subject={subject} /> : <ConfirmDialog {...common} subject={subject} />);
  return { onConfirm, onCancel, view };
}

const dialog = () => screen.getByRole('dialog');
const verb = () => screen.getByRole('button', { name: 'Remove' });
const cancelButton = () => screen.getByRole('button', { name: 'Cancel' });

describe('ConfirmDialog', () => {
  it('is a dialog named by its title and described by its message, and shows who it is about before what happens', () => {
    open();
    const root = screen.getByRole('dialog', { name: 'Remove connection', description: MESSAGE });
    expect(within(root).getByText('Connection A').tagName).toBe('STRONG');
    expect(within(root).getByText('Connection · Region 1')).toBeDefined();
    expect(within(root).getByText('Connected')).toBeDefined();
    expect(within(root).getByText(MESSAGE).tagName).toBe('P');
    // Close, then Cancel and the verb: each a Tab stop, with the verb last.
    expect(within(root).getAllByRole('button').map((button) => button.getAttribute('aria-label') ?? button.textContent)).toEqual(['Close', 'Cancel', 'Remove']);
  });

  it('confirms once when the verb is pressed, asks to leave on Cancel, Close and Escape, and never closes itself', () => {
    const { onConfirm, onCancel } = open();
    fireEvent.click(verb());
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    fireEvent.click(cancelButton());
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    act(() => {
      dialog().dispatchEvent(new Event('cancel', { cancelable: true }));
    });
    expect(onCancel).toHaveBeenCalledTimes(3);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(dialog().hasAttribute('open')).toBe(true);
  });

  it('starts the focus on the verb, on Cancel for a danger tone, and on the name field for the destructive tier', () => {
    const plain = open();
    expect(document.activeElement).toBe(verb());
    plain.view.unmount();
    const danger = open({ tone: 'danger' });
    expect(document.activeElement).toBe(cancelButton());
    danger.view.unmount();
    open({ tone: 'danger', destructive: true });
    expect(document.activeElement).toBe(screen.getByRole('textbox', { name: 'Type Connection A to confirm' }));
  });

  it('keeps the verb off until the name is typed and says why, and confirms on Enter in the field once the name matches', () => {
    const { onConfirm } = open({ destructive: true, tone: 'danger' });
    const hint = 'Remove stays off until the name matches.';
    const off = screen.getByRole('button', { name: 'Remove', description: 'Type Connection A to enable Remove' });
    expect(off.getAttribute('aria-disabled')).toBe('true');
    expect(screen.getByText(hint)).toBeDefined();
    const field = screen.getByRole('textbox', { name: 'Type Connection A to confirm' });
    fireEvent.click(off);
    fireEvent.keyDown(field, { key: 'Enter' });
    fireEvent.change(field, { target: { value: 'Connection B' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.change(field, { target: { value: 'Connection A' } });
    expect(verb().hasAttribute('aria-disabled')).toBe(false);
    expect(screen.queryByText(hint)).toBeNull();
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('does nothing on the verb while the operation is busy, and still lets the person leave', () => {
    const { onConfirm, onCancel } = open({ busy: true, tone: 'danger' });
    expect(verb().getAttribute('aria-busy')).toBe('true');
    fireEvent.click(verb());
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(cancelButton());
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('says a failure in an alert at the start of the footer, and stays open', () => {
    const { onCancel } = open({ error: 'Could not remove the connection. Try again.' });
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe('Could not remove the connection. Try again.');
    expect(dialog().querySelector('[data-ov-part="footer"]')?.contains(alert)).toBe(true);
    expect(dialog().hasAttribute('open')).toBe(true);
    expect(onCancel).not.toHaveBeenCalled();
  });
});
