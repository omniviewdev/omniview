import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPanelStore, HOST } from '../../core/panel';
import type { ShellRegistration } from '../../registration';
import { StaticShell } from '../../testing';
import { staticPanel } from '../testing';
import { createTerminals } from './terminals';
import { fakeEngineLoader, fakeTerminalFeed } from './testing';
import { TERMINAL_TOOL } from './tool';

// Where the focus goes after a close that had to wait for the host (a terminal at its prompt closes with no question, a moment after the press), against the REAL markup of the shell's panel and the REAL `focusTab`: the
// rule in `terminals.ts` reads the strip of session tabs, the close button beside each tab and the body on screen by their parts and ids, and a test over a markup of its own could pass while the shell draws another.
// What the focus belongs to when the close is pressed decides it: the session's own tab or close button, or its body while it is on screen, and nothing else.

const registration: ShellRegistration = { plugin: { name: 'Acme' } };

const originalHeight = window.innerHeight;

/** What listens to a panel store, to stop when the test is over. */
const stops: Array<() => void> = [];

beforeEach(() => {
  window.innerHeight = 900;
});

afterEach(() => {
  cleanup();
  for (const stop of stops.splice(0)) {
    stop();
  }

  window.innerHeight = originalHeight;
});

/** The shell with its panel open on two terminals at their prompts, `two` on screen, over the real model and the real close guard. */
function mount() {
  const base = createPanelStore();
  const terminals = createTerminals(base, { load: fakeEngineLoader().load });
  stops.push(terminals.sessions.attach());
  const panel = staticPanel({ store: terminals.store, tools: [TERMINAL_TOOL], renderBody: terminals.bodyOf, open: true });
  render(
    <StaticShell registration={registration} panel={panel}>
      <button type="button">Inside the page</button>
    </StaticShell>,
  );
  const open = (title: string): string => terminals.sessions.open({ plugin: HOST, id: title, title, open: () => fakeTerminalFeed({ busy: async () => Promise.resolve({ state: 'idle' }) }) })?.id ?? '';
  let one = '';
  let two = '';
  act(() => {
    one = open('one');
    two = open('two');
    base.activateSession(two);
  });
  return { base, terminals, one, two, user: userEvent.setup() };
}

const tab = (name: string): HTMLElement => screen.getByRole('tab', { name });

/** The pointer's close button of a session's tab: hidden from the accessibility tree and out of the tab order, so it is found by its part. */
const closeButton = (id: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-shell-part="sessionTab"][data-tab-id="${id}"] [data-shell-part="sessionClose"]`);
  if (found === null) {
    throw new Error(`the strip draws no close button for ${id}`);
  }

  return found;
};

/** A control of the body on screen (its toolbar): the slot of a session that is not on screen is hidden, and takes no focus. */
const bodyControl = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[data-shell-part="panelBody"]:not([hidden]) [data-shell-part="terminalBody"] button');
  if (found === null) {
    throw new Error('the panel draws no body on screen');
  }

  return found;
};

const focused = (element: HTMLElement) => {
  act(() => {
    element.focus();
  });
  expect(element).toHaveFocus();
};

describe('the focus after a terminal at its prompt closes a moment after the press, in the real panel', () => {
  it('goes to the neighbour tab after Delete on the session\'s own tab', async () => {
    const { base, two, user } = mount();
    focused(tab('two'));
    await user.keyboard('{Delete}');
    await waitFor(() => {
      expect(tab('one')).toHaveFocus();
    });
    expect(base.getSnapshot().sessions[two]).toBeUndefined();
  });

  it('goes to the neighbour tab after a press on the session\'s own close button, where the mouse leaves the focus (the button goes with the tab)', async () => {
    const { base, two, user } = mount();
    await user.click(closeButton(two));
    await waitFor(() => {
      expect(base.getSnapshot().sessions[two]).toBeUndefined();
    });
    await waitFor(() => {
      expect(tab('one')).toHaveFocus();
    });
  });

  it('goes to the neighbour tab when the focus was in the body of the session on screen (the close chord from the terminal)', async () => {
    const { base, terminals, two } = mount();
    focused(bodyControl());
    act(() => {
      terminals.store.closeSession(two);
    });
    await waitFor(() => {
      expect(base.getSnapshot().sessions[two]).toBeUndefined();
    });
    await waitFor(() => {
      expect(tab('one')).toHaveFocus();
    });
  });

  it('leaves it on the tab of the other session when a close is made from elsewhere (the middle button does not move the focus): it was not the closing session\'s', async () => {
    const { base, terminals, two } = mount();
    focused(tab('one'));
    act(() => {
      terminals.store.closeSession(two);
    });
    await waitFor(() => {
      expect(base.getSnapshot().sessions[two]).toBeUndefined();
    });
    expect(tab('one')).toHaveFocus();
  });

  it('leaves it on the close button of the other session\'s tab when the first is closed from elsewhere', async () => {
    const { base, terminals, one, two } = mount();
    focused(closeButton(two));
    act(() => {
      terminals.store.closeSession(one);
    });
    await waitFor(() => {
      expect(base.getSnapshot().sessions[one]).toBeUndefined();
    });
    expect(closeButton(two)).toHaveFocus();
  });

  it('leaves it on the splitter, which is beside the panel and not in it, when the person went there while the host was asked', async () => {
    const { base, terminals, two } = mount();
    focused(tab('two'));
    act(() => {
      terminals.store.closeSession(two);
    });
    const separator = screen.getByRole('separator', { name: 'Resize panel' });
    focused(separator);
    await waitFor(() => {
      expect(base.getSnapshot().sessions[two]).toBeUndefined();
    });
    expect(separator).toHaveFocus();
  });
});
