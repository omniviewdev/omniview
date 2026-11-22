import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, describe, expect, it, vi, type Mock } from 'vitest';
import { ConfirmUninstall, type ConfirmUninstallProps } from './ConfirmUninstall';
import { uninstallWords } from './core/words';

// The Uninstall confirm (ch16 S136): the host's words, a Cancel that has the keyboard first, one destructive confirm and no choice. jsdom has no top layer and does not move the focus when a modal closes, so the dialog's
// own behaviour is stood in for here (and proven in a real engine by the page's probe); what is asserted is what the component asks of the platform and what it calls.

beforeAll(() => {
  // jsdom has no `showModal` or `close`: stand-ins that set and remove the attribute, as the markup would. Local to this file, never in the shared setup.
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };

  proto.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

afterEach(cleanup);

const words = uninstallWords('Fixture Plugin', false, 2);

type Calls = { readonly onConfirm: Mock<() => void>; readonly onCancel: Mock<() => void> };

function mount(over: Partial<ConfirmUninstallProps> = {}): Calls {
  const calls: Calls = { onConfirm: vi.fn(), onCancel: vi.fn() };
  render(<ConfirmUninstall words={words} version="1.2.3" onConfirm={calls.onConfirm} onCancel={calls.onCancel} {...over} />);
  return calls;
}

const dialog = (): HTMLElement => screen.getByRole('dialog', { hidden: true });
const part = (name: string): HTMLElement => {
  const found = dialog().querySelector<HTMLElement>(`[data-pl-part="${name}"]`);
  if (found === null) {
    throw new Error(`no part ${name}`);
  }

  return found;
};

describe('opening', () => {
  it('goes modal on mount, and the dialog is named by its title and described by its intro', () => {
    const showModal = vi.spyOn(HTMLDialogElement.prototype as unknown as { showModal: () => void }, 'showModal');
    mount();
    expect(showModal).toHaveBeenCalledTimes(1);
    const element = dialog();
    expect(element.tagName).toBe('DIALOG');
    expect(element).toHaveAttribute('open');
    expect(element).toHaveAttribute('data-pl-part', 'confirm');
    expect(element).toHaveAccessibleName(words.title);
    expect(element).toHaveAccessibleDescription(words.intro);
    showModal.mockRestore();
  });

  it('draws the host\'s words, verbatim', () => {
    mount();
    expect(part('confirm-title')).toHaveTextContent(words.title);
    expect(part('confirm-title').tagName).toBe('H2');
    expect(part('confirm-body')).toHaveTextContent(words.intro);
    const sections = [...dialog().querySelectorAll<HTMLElement>('[data-pl-part="confirm-section"]')];
    expect(sections).toHaveLength(words.sections.length);
    sections.forEach((section, index) => {
      const heading = words.sections[index]?.heading ?? '';
      const text = words.sections[index]?.text ?? '';
      expect(within(section).getByRole('heading', { name: heading, level: 3, hidden: true })).toBeInTheDocument();
      expect(section).toHaveTextContent(text);
    });

    expect(within(dialog()).getByRole('button', { name: 'Cancel', hidden: true })).toBe(part('confirm-cancel'));
    expect(within(dialog()).getByRole('button', { name: words.confirm, hidden: true })).toBe(part('confirm-confirm'));
  });

  it('says which version is going, under the title', () => {
    mount();
    expect(part('confirm-version')).toHaveTextContent('1.2.3');
  });

  it('puts the focus on Cancel, never on the destructive button', () => {
    mount();
    expect(part('confirm-cancel')).toHaveFocus();
    expect(part('confirm-confirm')).not.toHaveFocus();
  });

  it('draws no checkbox and no other input: the host\'s call has no option', () => {
    mount();
    expect(dialog().querySelector('input, select, textarea, [role="checkbox"], [role="switch"], [role="radio"]')).toBeNull();
  });

  it('says Unlink for a plugin that is linked from a source folder', () => {
    const dev = uninstallWords('Fixture Plugin', true, 0);
    mount({ words: dev });
    expect(screen.getByRole('dialog', { name: 'Unlink Fixture Plugin?', hidden: true })).toBeInTheDocument();
    expect(part('confirm-confirm')).toHaveTextContent('Unlink');
    expect(part('confirm-body')).toHaveTextContent(dev.intro);
  });
});

describe('closing', () => {
  it('calls onCancel once for Escape (the dialog\'s cancel event), and does not close behind the page', () => {
    const calls = mount();
    const event = new Event('cancel', { cancelable: true });
    act(() => {
      dialog().dispatchEvent(event);
    });

    expect(calls.onCancel).toHaveBeenCalledTimes(1);
    expect(calls.onConfirm).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('calls onCancel once for the close X', async () => {
    const calls = mount();
    await userEvent.click(screen.getByRole('button', { name: 'Close', hidden: true }));
    expect(calls.onCancel).toHaveBeenCalledTimes(1);
    expect(calls.onConfirm).not.toHaveBeenCalled();
  });

  it('calls onCancel once for a press on the scrim, and not for a press inside the box', async () => {
    const calls = mount();
    fireEvent.pointerDown(part('confirm-body'));
    expect(calls.onCancel).not.toHaveBeenCalled();
    await userEvent.click(dialog());
    expect(calls.onCancel).toHaveBeenCalledTimes(1);
    expect(calls.onConfirm).not.toHaveBeenCalled();
  });

  it('calls onCancel once for Cancel', async () => {
    const calls = mount();
    await userEvent.click(part('confirm-cancel'));
    expect(calls.onCancel).toHaveBeenCalledTimes(1);
    expect(calls.onConfirm).not.toHaveBeenCalled();
  });

  it('calls onConfirm once for the confirm, and not onCancel', async () => {
    const calls = mount();
    await userEvent.click(part('confirm-confirm'));
    expect(calls.onConfirm).toHaveBeenCalledTimes(1);
    expect(calls.onCancel).not.toHaveBeenCalled();
  });

  it('confirms from the keyboard when the person has moved to the confirm', async () => {
    const calls = mount();
    await userEvent.tab();
    expect(part('confirm-confirm')).toHaveFocus();
    await userEvent.keyboard('{Enter}');
    expect(calls.onConfirm).toHaveBeenCalledTimes(1);
  });
});

describe('leaving', () => {
  it('closes the dialog and gives the focus back to the control that opened it', async () => {
    const opener = document.createElement('button');
    opener.textContent = 'Uninstall';
    document.body.append(opener);
    opener.focus();
    const calls: Calls = { onConfirm: vi.fn(), onCancel: vi.fn() };
    const { unmount } = render(<ConfirmUninstall words={words} version="1.2.3" {...calls} />);
    const element = dialog();
    expect(element).toHaveAttribute('open');
    expect(opener).not.toHaveFocus();
    unmount();
    expect(element).not.toHaveAttribute('open');
    await waitFor(() => {
      expect(opener).toHaveFocus();
    });

    opener.remove();
  });
});
