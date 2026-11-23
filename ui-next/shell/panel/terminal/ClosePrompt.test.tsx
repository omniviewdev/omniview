import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, HOST, type PanelStore } from '../../core/panel';
import { focusTab } from '../focus';
import { ClosePrompt } from './ClosePrompt';
import { createCloseGuard, type CloseGuard } from './closeGuard';
import { closeQuestionOf } from './state';
import { TERMINAL_TOOL, TERMINAL_TOOL_ID } from './tool';

// The question a close of a running terminal asks, drawn: a modal dialog with the title, the name of the session, the sentence, and Cancel (which has the keyboard) and Terminate session. The focus goes back
// where it was after a no, and to the neighbouring tab after a yes. What the question is, and when it is asked, is `state.ts` and `closeGuard.ts`'s.

vi.mock('../focus', () => ({ focusTab: vi.fn(), focusPage: vi.fn(), focusPanel: vi.fn() }));

type Rig = { readonly store: PanelStore; readonly guard: CloseGuard; readonly guarded: PanelStore; readonly ids: readonly string[] };

function mount(): Rig {
  const store = createPanelStore({ now: () => 1_000, newId: (() => {
    let n = 0; return () => `s${String(++n)}`; 
  })() });
  store.registerTool(TERMINAL_TOOL);
  const ids = ['one', 'two'].map((title) => {
    const opened = store.openSession({ tool: TERMINAL_TOOL_ID, plugin: HOST, title, scope: '', state: 'running' });
    return opened.status === 'refused' ? '' : opened.id;
  });
  const guard = createCloseGuard({
    questionOf: (id) => (id === ids[0] || id === ids[1] ? closeQuestionOf({ state: 'running' }) : undefined),
    nameOf: (id) => store.getSnapshot().sessions[id]?.title ?? '',
  });
  render(<ClosePrompt guard={guard} />);
  return { store, guard, guarded: guard.guard(store), ids };
}

beforeAll(() => {
  // jsdom has the element and not its modal: the browser's `showModal` makes the dialog open and puts it in the top layer.
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };

  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

beforeEach(() => {
  vi.mocked(focusTab).mockClear();
});

afterEach(() => {
  cleanup();
});

const flush = async () => {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

describe('the dialog of the close question', () => {
  it('draws nothing while nothing is asked', () => {
    mount();
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(document.querySelector('dialog')).toBeNull();
  });

  it('opens as a modal when a close of a running terminal asks, with the question, the name of the session and the sentence', () => {
    const { guarded, ids } = mount();
    act(() => {
      guarded.closeSession(ids[0] ?? '');
    });
    const dialog = screen.getByRole('alertdialog', { name: 'Terminate session?' });
    expect(dialog).toHaveAttribute('open');
    expect(dialog).toHaveAccessibleDescription('This ends the terminal session. Programs it left running in the background may keep running.');
    expect(screen.getByText('one')).toBeInTheDocument();
    // Nothing was closed yet.
    expect(Object.keys(guardedSessions(guarded))).toHaveLength(2);
  });

  it('gives the keyboard to Cancel: a key pressed twice by mistake ends nothing', () => {
    const { guarded, ids } = mount();
    act(() => {
      guarded.closeSession(ids[0] ?? '');
    });
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  it('says no on Cancel, on Escape and on a press outside it: the session stays and the question is gone', async () => {
    const { guarded, guard, ids } = mount();
    const user = userEvent.setup();
    for (const no of [
      async () => user.click(screen.getByRole('button', { name: 'Cancel' })),
      async () => {
        screen.getByRole('alertdialog').dispatchEvent(new Event('cancel', { cancelable: true }));
      },
      async () => user.click(screen.getByRole('alertdialog')),
    ]) {
      act(() => {
        guarded.closeSession(ids[0] ?? '');
      });
      expect(guard.getSnapshot()).not.toBeNull();
      await act(no);
      await flush();
      expect(guard.getSnapshot()).toBeNull();
      expect(screen.queryByRole('alertdialog')).toBeNull();
      expect(Object.keys(guardedSessions(guarded))).toHaveLength(2);
    }
  });

  it('gives the focus back to where it was after a no', async () => {
    const { guarded, ids } = mount();
    const field = document.createElement('button');
    document.body.append(field);
    field.focus();
    act(() => {
      guarded.closeSession(ids[0] ?? '');
    });
    await act(async () => userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' })));
    await flush();
    expect(field).toHaveFocus();
    field.remove();
  });

  describe('after a no, the focus lands on a real control', () => {
    /** The session tab as the panel draws it (a tab in the session strip, found by its id), and its close button, which is a pointer-only aid: out of the tab order and hidden from the accessibility tree. */
    function drawStrip(id: string) {
      const strip = document.createElement('div');
      strip.dataset.shellPart = 'sessionTabs';
      strip.innerHTML = `<div><button type="button" role="tab" data-tab-id="${id}" aria-label="one"></button><button type="button" tabindex="-1" aria-hidden="true" data-shell-part="sessionClose"></button></div>`;
      document.body.append(strip);
      const tab = strip.querySelector<HTMLElement>('[role="tab"]');
      const close = strip.querySelector<HTMLElement>('[data-shell-part="sessionClose"]');
      // The real `focusTab` focuses the tab once React has drawn the strip.
      vi.mocked(focusTab).mockImplementation((_strip, wanted) => {
        queueMicrotask(() => {
          if (wanted === id) {
            tab?.focus();
          }
        });
      });
      return { strip, tab, close };
    }

    const asks = (rig: Rig) => {
      act(() => {
        rig.guarded.closeSession(rig.ids[0] ?? '');
      });
    };

    const nos = {
      Cancel: async () => userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' })),
      Escape: async () => {
        screen.getByRole('alertdialog').dispatchEvent(new Event('cancel', { cancelable: true }));
      },
      'a press on the scrim': async () => userEvent.setup().click(screen.getByRole('alertdialog')),
    } as const;

    afterEach(() => {
      document.querySelector('[data-shell-part="sessionTabs"]')?.remove();
      vi.mocked(focusTab).mockReset();
    });

    it.each(Object.entries(nos))('goes to the session\'s tab, and not to the close button the mouse pressed, on %s', async (_name, no) => {
      const rig = mount();
      const { tab, close } = drawStrip(rig.ids[0] ?? '');
      close?.focus();
      expect(close).toHaveFocus();
      asks(rig);
      await act(no);
      await flush();
      expect(focusTab).toHaveBeenCalledWith('sessionTabs', rig.ids[0]);
      expect(tab).toHaveFocus();
      expect(document.activeElement?.closest('[aria-hidden="true"]')).toBeNull();
    });

    it('goes to the session\'s tab when what had the focus sits inside a subtree that is hidden from the accessibility tree', async () => {
      const rig = mount();
      const { tab } = drawStrip(rig.ids[0] ?? '');
      const hidden = document.createElement('div');
      hidden.setAttribute('aria-hidden', 'true');
      const inner = document.createElement('button');
      hidden.append(inner);
      document.body.append(hidden);
      inner.focus();
      asks(rig);
      await act(nos.Cancel);
      await flush();
      expect(focusTab).toHaveBeenCalledWith('sessionTabs', rig.ids[0]);
      expect(tab).toHaveFocus();
      hidden.remove();
    });

    it('goes to the session\'s tab when what had the focus is gone from the document', async () => {
      const rig = mount();
      const { tab } = drawStrip(rig.ids[0] ?? '');
      const gone = document.createElement('button');
      document.body.append(gone);
      gone.focus();
      asks(rig);
      gone.remove();
      await act(nos.Escape);
      await flush();
      expect(focusTab).toHaveBeenCalledWith('sessionTabs', rig.ids[0]);
      expect(tab).toHaveFocus();
    });

    it('goes to the tool\'s own tab when the session\'s tab is gone too', async () => {
      const rig = mount();
      const close = document.createElement('button');
      close.setAttribute('aria-hidden', 'true');
      document.body.append(close);
      close.focus();
      asks(rig);
      await act(nos.Cancel);
      await flush();
      expect(focusTab).toHaveBeenCalledTimes(1);
      expect(focusTab).toHaveBeenCalledWith('panelTools', TERMINAL_TOOL_ID);
      close.remove();
    });

    it('goes to the tab when nothing had the focus', async () => {
      const rig = mount();
      drawStrip(rig.ids[0] ?? '');
      (document.activeElement as HTMLElement | null)?.blur();
      asks(rig);
      await act(nos.Cancel);
      await flush();
      expect(focusTab).toHaveBeenCalledWith('sessionTabs', rig.ids[0]);
    });

    it.each(Object.entries(nos))('gives the focus back to a real control, the emulator\'s input and the tab a keyboard close was pressed on, on %s', async (_name, no) => {
      const rig = mount();
      const { tab } = drawStrip(rig.ids[0] ?? '');
      const input = document.createElement('textarea');
      document.body.append(input);
      for (const real of [input, tab]) {
        real?.focus();
        asks(rig);
        await act(no);
        await flush();
        expect(real).toHaveFocus();
        expect(document.activeElement?.closest('[aria-hidden="true"]')).toBeNull();
      }

      expect(focusTab).not.toHaveBeenCalled();
      input.remove();
    });

    it('does not take a focus that was sent elsewhere while the question closed', async () => {
      const rig = mount();
      drawStrip(rig.ids[0] ?? '');
      const close = document.createElement('button');
      close.setAttribute('aria-hidden', 'true');
      document.body.append(close);
      close.focus();
      asks(rig);
      const elsewhere = document.createElement('button');
      document.body.append(elsewhere);
      await act(async () => {
        elsewhere.focus();
        rig.guard.cancel();
      });
      await flush();
      expect(elsewhere).toHaveFocus();
      expect(focusTab).not.toHaveBeenCalled();
      close.remove();
      elsewhere.remove();
    });
  });

  it('asks about a second session only when the first is answered: the question on screen stays the first, and what the person then answers is for the session the dialog names', async () => {
    const { guarded, guard, ids } = mount();
    act(() => {
      guarded.closeSession(ids[0] ?? '');
      guarded.closeSession(ids[1] ?? '');
    });
    expect(screen.getByText('one')).toBeInTheDocument();
    expect(screen.queryByText('two')).toBeNull();
    await act(async () => userEvent.setup().click(screen.getByRole('button', { name: 'Cancel' })));
    await flush();
    expect(screen.getByText('two')).toBeInTheDocument();
    expect(screen.getByRole('alertdialog')).toHaveAttribute('open');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await act(async () => userEvent.setup().click(screen.getByRole('button', { name: 'Terminate session' })));
    await flush();
    expect(Object.keys(guardedSessions(guarded))).toEqual([ids[0]]);
    expect(guard.getSnapshot()).toBeNull();
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('closes the session on Terminate session, and sends the focus to the neighbouring tab', async () => {
    const { guarded, ids } = mount();
    act(() => {
      guarded.closeSession(ids[0] ?? '');
    });
    await act(async () => userEvent.setup().click(screen.getByRole('button', { name: 'Terminate session' })));
    await flush();
    expect(Object.keys(guardedSessions(guarded))).toEqual([ids[1]]);
    expect(focusTab).toHaveBeenCalledWith('sessionTabs', ids[1]);
    expect(screen.queryByRole('alertdialog')).toBeNull();
  });

  it('sends the focus to the tool\'s own tab when the last session closed: the tab that had it is gone', async () => {
    const { guarded, ids } = mount();
    // The first goes at once (nothing asked for a session that is not there), then the last asks.
    act(() => {
      guarded.closeSession(ids[0] ?? '');
    });
    await act(async () => userEvent.setup().click(screen.getByRole('button', { name: 'Terminate session' })));
    await flush();
    act(() => {
      guarded.closeSession(ids[1] ?? '');
    });
    await act(async () => userEvent.setup().click(screen.getByRole('button', { name: 'Terminate session' })));
    await flush();
    expect(focusTab).toHaveBeenLastCalledWith('panelTools', TERMINAL_TOOL_ID);
  });
});

const guardedSessions = (store: PanelStore) => store.getSnapshot().sessions;
