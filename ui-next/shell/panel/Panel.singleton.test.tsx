import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolInput } from '../core/panel';
import type { ShellRegistration } from '../registration';
import { StaticShell } from '../testing';
import type { ToolBadge, ToolBadges } from './badge';
import { staticPanel, type StaticPanelOptions } from './testing';

// The singleton tools of the panel (ch16 S114: Problems and Operations): a tool that has no sessions, so no strip of session tabs, no `+` and no empty state of a tool with none. The host says which tool draws that way
// (`PanelBindings.renderTool`) and what each tool tab carries (`PanelBindings.badges`: a count, or a dot, with the words that name it). The model of the panel is untouched: these are the host's tools, registered as any are.

const registration: ShellRegistration = { plugin: { name: 'Acme' } };
const TERMINAL: ToolInput = { id: 'terminal', label: 'Terminal', icon: 'terminal', order: 10 };
const PROBLEMS: ToolInput = { id: 'problems', label: 'Problems', icon: 'status-warning', order: 30 };
const OPERATIONS: ToolInput = { id: 'operations', label: 'Operations', icon: 'activity', order: 40 };

/** A badge source a test drives: the one the host builds from its models, in a few lines. */
function badges(initial: Readonly<Record<string, ToolBadge | undefined>> = {}) {
  let held = { ...initial };
  const listeners = new Set<() => void>();
  const source: ToolBadges = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    of: (tool) => held[tool],
  };
  return {
    source,
    set: (next: Readonly<Record<string, ToolBadge | undefined>>) => {
      held = { ...next };
      act(() => {
        for (const listener of listeners) {
          listener();
        }
      });
    },
    listeners: () => listeners.size,
  };
}

function mount(options: StaticPanelOptions = {}) {
  const panel = staticPanel({ tools: [TERMINAL, PROBLEMS, OPERATIONS], open: true, ...options });
  const view = render(<StaticShell registration={registration} panel={panel} />);
  return { ...view, panel, store: panel.store, user: userEvent.setup() };
}

const tab = (name: string | RegExp) => screen.getByRole('tab', { name });

beforeEach(() => {
  window.innerHeight = 900;
});

afterEach(() => {
  cleanup();
});

describe('a tool that has no sessions', () => {
  it('draws what the host renders for it, and no strip of sessions, no + and no empty state', async () => {
    const renderTool = vi.fn((tool: string) => (tool === 'problems' ? <div data-fixture="problems-body">The conditions</div> : undefined));
    const { user, store } = mount({ renderTool });
    await user.click(tab('Problems'));
    expect(store.getSnapshot().tool).toBe('problems');
    expect(screen.getByText('The conditions')).toBeVisible();
    expect(document.querySelector('[data-shell-part="panelSessions"]')).toBeNull();
    expect(screen.queryByRole('button', { name: /New/ })).not.toBeInTheDocument();
    expect(screen.queryByText('No sessions')).not.toBeInTheDocument();
    expect(renderTool).toHaveBeenCalledWith('problems');
  });

  it('is the tabpanel its tab names, so the body and the tab say one thing to a screen reader', async () => {
    const { user } = mount({ renderTool: (tool) => (tool === 'problems' ? <div>The conditions</div> : undefined) });
    await user.click(tab('Problems'));
    const deck = document.querySelector<HTMLElement>('[data-shell-part="panelDeck"]');
    expect(deck).toHaveAttribute('role', 'tabpanel');
    expect(deck).toHaveAttribute('aria-labelledby', tab('Problems').id);
    expect(within(deck!).getByText('The conditions')).toBeInTheDocument();
  });

  it('is not drawn while the panel is hidden, and is drawn again from scratch when it is shown: it holds no stream, so nothing of it is kept mounted', () => {
    const renderTool = vi.fn((tool: string) => (tool === 'problems' ? <div data-fixture="problems-body">The conditions</div> : undefined));
    const { store } = mount({ renderTool });
    act(() => {
      store.activateTool('problems');
    });
    expect(document.querySelector('[data-fixture="problems-body"]')).not.toBeNull();
    act(() => {
      store.hide();
    });
    expect(document.querySelector('[data-fixture="problems-body"]')).toBeNull();
    act(() => {
      store.show();
    });
    expect(document.querySelector('[data-fixture="problems-body"]')).not.toBeNull();
  });

  it('is not asked for while another tool is on screen: the host does no work for a tool nobody is looking at', async () => {
    const renderTool = vi.fn((tool: string) => (tool === 'problems' ? <div>The conditions</div> : undefined));
    const { user } = mount({ renderTool });
    expect(renderTool).not.toHaveBeenCalledWith('problems');
    await user.click(tab('Problems'));
    renderTool.mockClear();
    await user.click(tab('Terminal'));
    expect(renderTool).toHaveBeenCalledWith('terminal');
    expect(renderTool).not.toHaveBeenCalledWith('problems');
  });

  it('says what a tool with no session says when the host renders nothing for it: the host that has no model for a tool still has a tool', async () => {
    const { user } = mount({ renderTool: () => undefined });
    await user.click(tab('Problems'));
    expect(screen.getByText('No sessions')).toBeInTheDocument();
  });
});

describe('the badge of a tool tab (ch16 S114: a count on a tab is allowed)', () => {
  it('is a count with its words in the tab name, the visible text whole inside it: "Problems 2 errors"', () => {
    const source = badges({ problems: { kind: 'count', count: 2, label: '2 errors' } });
    mount({ badges: source.source });
    const found = tab('Problems 2 errors');
    expect(within(found).getByText('2')).toBeInTheDocument();
    expect(tab('Operations')).toBeInTheDocument();
  });

  it('is a dot with its words in the tab name: "Operations, 1 unread failure"; the dot says its tone and draws no number', () => {
    const source = badges({ operations: { kind: 'dot', tone: 'error', label: '1 unread failure' } });
    mount({ badges: source.source });
    const found = tab('Operations, 1 unread failure');
    expect(found.querySelector('[data-shell-part="toolBadge"]')).toHaveAttribute('data-tone', 'error');
    expect(found.querySelector('[data-shell-part="toolBadge"]')).toHaveAttribute('data-kind', 'dot');
    expect(within(found).queryByText(/\d/)).toBeNull();
  });

  it('follows the host while the panel is on screen: it appears, changes and goes, and a tab that has none is named by its words alone', () => {
    const source = badges();
    mount({ badges: source.source });
    expect(tab('Problems')).toBeInTheDocument();
    source.set({ problems: { kind: 'count', count: 1, label: '1 error' } });
    expect(tab('Problems 1 error')).toBeInTheDocument();
    source.set({ problems: { kind: 'dot', tone: 'warning', label: '3 warnings' } });
    expect(tab('Problems, 3 warnings').querySelector('[data-shell-part="toolBadge"]')).toHaveAttribute('data-tone', 'warning');
    source.set({});
    expect(tab('Problems')).toBeInTheDocument();
    expect(document.querySelector('[data-shell-part="toolBadge"]')).toBeNull();
  });

  it('is subscribed once for each tab that is drawn and let go of with the shell', () => {
    const source = badges();
    const { unmount } = mount({ badges: source.source });
    expect(source.listeners()).toBe(3);
    unmount();
    expect(source.listeners()).toBe(0);
  });
});
