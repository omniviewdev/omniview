import { MenuHost } from '@omniviewdev/kit';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPanelStore, restorePanel, type PanelStore } from '../../core/panel';
import type { ShellRegistration } from '../../registration';
import { StaticShell } from '../../testing';
import { staticPanel } from '../testing';
import { CLOSED_EVENT, CREATED_EVENT } from './api';
import { createPorts, type Ports } from './ports';
import { PORTS_TOOL, PORTS_TOOL_ID, revealPortsTool } from './index';
import { fakePorts, session, settle, type FakePorts } from './testing';

// The Ports tool in the panel of a window: a tool of the host that has no sessions, drawn by the host's `renderTool` while it is on screen with the panel open. What is under test is what the panel does with it (the tab that names it,
// the body that is drawn only then, no strip of sessions, no `+`, no empty state of a tool with none) and what that means for the host: nothing is asked of it, and nothing is listened to, until the tool is shown.

const registration: ShellRegistration = { plugin: { name: 'Acme' } };

type Rig = { readonly fake: FakePorts; readonly ports: Ports; readonly store: PanelStore; readonly user: UserEvent };

function mount(options: { readonly open?: boolean } = {}): Rig {
  const fake = fakePorts();
  const store = createPanelStore();
  const ports = createPorts(store, fake.deps);
  const panel = staticPanel({
    store,
    tools: [
      { id: 'terminal', label: 'Terminal', icon: 'terminal', order: 10 },
      { id: 'logs', label: 'Logs', icon: 'scroll-text', order: 20 },
      PORTS_TOOL,
    ],
    open: options.open,
    renderTool: (tool) => (tool === PORTS_TOOL_ID ? ports.bodyOf() : undefined),
  });
  render(
    <MenuHost>
      <StaticShell registration={registration} panel={panel} />
    </MenuHost>,
  );
  return { fake, ports, store, user: userEvent.setup() };
}

const tab = (name: string): HTMLElement => screen.getByRole('tab', { name });
const body = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-shell-part="portsBody"]');

/** The Stop button of a forward's row. */
const stopOf = (id: string): HTMLElement => {
  const row = document.querySelector<HTMLElement>(`[data-ports-id="${id}"]`);
  if (row === null) {
    throw new Error(`there is no row ${id}`);
  }

  return within(row).getByRole('button', { name: 'Stop' });
};

beforeEach(() => {
  window.innerHeight = 900;
});

afterEach(() => {
  cleanup();
});

describe('the Ports tool in the strip', () => {
  it('is a tab named Ports, after Terminal and Logs, and chooses nothing the person did not choose', () => {
    const { store } = mount({ open: true });
    expect(within(screen.getByRole('tablist', { name: 'Panel tools' })).getAllByRole('tab').map((entry) => entry.textContent)).toEqual(['Terminal', 'Logs', 'Ports']);
    expect(store.selectors.activeTool(store.getSnapshot())).toBe('terminal');
  });

  it('has no strip of sessions, no `+` and no empty state of a tool with none: it is one list, and it starts nothing', async () => {
    const { user } = mount({ open: true });
    await user.click(tab('Ports'));
    expect(document.querySelector('[data-shell-part="panelSessions"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /^New/ })).toBeNull();
    expect(screen.queryByText('No sessions')).toBeNull();
  });

  it('is the tabpanel its tab names, so that the body and the tab say one thing to a screen reader', async () => {
    const { user } = mount({ open: true });
    await user.click(tab('Ports'));
    const deck = document.querySelector<HTMLElement>('[data-shell-part="panelDeck"]');
    expect(deck).toHaveAttribute('role', 'tabpanel');
    expect(deck).toHaveAttribute('aria-labelledby', tab('Ports').id);
    expect(body()).not.toBeNull();
  });
});

describe('what it costs while it is not shown', () => {
  it('asks the host nothing and listens to nothing while the panel is hidden', () => {
    const { fake } = mount();
    expect(body()).toBeNull();
    expect(fake.listed()).toBe(0);
    expect(fake.on()).toBe(0);
  });

  it('asks the host nothing and listens to nothing while another tool is on screen, though the panel is open', () => {
    const { fake } = mount({ open: true });
    expect(body()).toBeNull();
    expect(fake.listed()).toBe(0);
    expect(fake.on()).toBe(0);
  });

  it('asks and listens from the moment it is shown, and lets go of both when it is not: five events on, five off, for each time', async () => {
    const { fake, user } = mount({ open: true });
    await user.click(tab('Ports'));
    expect(body()).not.toBeNull();
    expect(fake.listed()).toBe(1);
    expect(fake.handlers()).toBe(5);
    await user.click(tab('Terminal'));
    expect(body()).toBeNull();
    expect(fake.handlers()).toBe(0);
    expect(fake.off()).toBe(5);
    await user.click(tab('Ports'));
    expect(fake.listed()).toBe(2);
    expect(fake.handlers()).toBe(5);
  });

  it('lets go when the panel is hidden, and asks again when it is shown: what it held is not known to be true after a while away', async () => {
    const { fake, store } = mount({ open: true });
    act(() => {
      revealPortsTool(store);
    });
    await act(async () => {
      await fake.answer([session('a')]);
    });
    expect(screen.getByRole('table', { name: 'Forwarded ports' })).toBeInTheDocument();
    act(() => {
      store.hide();
    });
    expect(body()).toBeNull();
    expect(fake.handlers()).toBe(0);
    act(() => {
      store.show();
    });
    expect(fake.listed()).toBe(2);
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading forwarded ports' })).toBeInTheDocument();
  });
});

describe('showing it', () => {
  it('opens the hidden panel on the Ports tool and draws its body, which asks the host for the list', () => {
    const { fake, store } = mount();
    act(() => {
      revealPortsTool(store);
    });
    expect(store.getSnapshot().open).toBe(true);
    expect(body()).not.toBeNull();
    expect(fake.listed()).toBe(1);
  });

  it('brings it from another tool, and starts no session', () => {
    const { store } = mount({ open: true });
    act(() => {
      revealPortsTool(store);
    });
    expect(store.selectors.activeTool(store.getSnapshot())).toBe(PORTS_TOOL_ID);
    expect(tab('Ports')).toHaveAttribute('aria-selected', 'true');
    expect(store.getSnapshot().order).toEqual([]);
  });

  it('is what a saved window comes back to: a panel that was left on the Ports tool shows it once the tool is registered', () => {
    const saved = createPanelStore();
    saved.registerTool(PORTS_TOOL);
    saved.show({ tool: PORTS_TOOL_ID });
    const restored = restorePanel(saved.serialise(), { now: 1 });
    if (!restored.ok) {
      throw new Error('the saved panel is read back');
    }

    const store = createPanelStore({ initial: restored.state });
    const fake = fakePorts();
    const ports = createPorts(store, fake.deps);
    const panel = staticPanel({ store, tools: [PORTS_TOOL], renderTool: (tool) => (tool === PORTS_TOOL_ID ? ports.bodyOf() : undefined) });
    render(
      <MenuHost>
        <StaticShell registration={registration} panel={panel} />
      </MenuHost>,
    );
    expect(store.getSnapshot().open).toBe(true);
    expect(body()).not.toBeNull();
    expect(fake.listed()).toBe(1);
  });
});

describe('the body in the panel', () => {
  it('follows the host while it is shown: a forward that is created is a row, one that is closed is gone, and the tool says so aloud when a Stop ends one', async () => {
    const { fake, store, user } = mount({ open: true });
    act(() => {
      revealPortsTool(store);
    });
    await act(async () => {
      await fake.answer([session('a'), session('b')]);
    });
    act(() => {
      fake.emit(CREATED_EVENT, session('c'));
    });
    expect(screen.getAllByRole('row')).toHaveLength(4);
    await user.click(stopOf('a'));
    act(() => {
      fake.emit(CLOSED_EVENT, session('a'));
    });
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(document.querySelector('[data-ports-part="live"]')?.textContent).toBe('Stopped port 8081 → :8080/TCP');
  });

  it('puts the keyboard on the Ports tab when the last forward goes, the one stop that is left in the tool: it is not lost on the page', async () => {
    const { fake, store, user } = mount({ open: true });
    act(() => {
      revealPortsTool(store);
    });
    await act(async () => {
      await fake.answer([session('a')]);
    });
    const stop = stopOf('a');
    stop.focus();
    await user.keyboard('{Enter}');
    act(() => {
      fake.emit(CLOSED_EVENT, session('a'));
    });
    await act(async () => {
      await settle();
    });
    await waitFor(() => {
      expect(tab('Ports')).toHaveFocus();
    });
    expect(screen.getByText('No forwarded ports')).toBeInTheDocument();
  });
});
