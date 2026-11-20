import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createPanelStore, restorePanel, type ToolInput } from '../core/panel';
import type { ShellRegistration } from '../registration';
import { StaticShell } from '../testing';
import { staticPanel, type StaticPanelOptions, type StaticSession } from './testing';

// The bottom panel in the shell, against invented tools (Terminal, Logs) and sessions: the toggle and where the focus goes when the panel opens and closes, the strips' keyboard, the splitter's
// separator and the window it is drawn in. The model is tested in ../core/panel and the controller of the drag in ./splitter.test.ts; what is under test here is the DOM that carries them.

const registration: ShellRegistration = { plugin: { name: 'Acme' } };
const TERMINAL: ToolInput = { id: 'terminal', label: 'Terminal', icon: 'terminal', order: 10 };
const LOGS: ToolInput = { id: 'logs', label: 'Logs', icon: 'file-text', order: 20 };

/** A session that runs: its tab's name is its title and nothing else (a steady state has no word). */
const running = (title: string, extra: Partial<StaticSession> = {}): StaticSession => ({ tool: 'terminal', title, state: 'running', ...extra });

/** The shell with a panel, and the model behind it. */
function mount(options: StaticPanelOptions = {}) {
  const panel = staticPanel({
    tools: [TERMINAL, LOGS],
    start: { terminal: { label: 'New shell', open: () => ({ title: 'zsh', state: 'running' }) } },
    ...options,
  });
  const view = render(
    <StaticShell registration={registration} panel={panel}>
      <button type="button">Inside the page</button>
    </StaticShell>,
  );
  return { ...view, panel, store: panel.store, user: userEvent.setup() };
}

const toggle = () => screen.getByRole('button', { name: 'Panel' });
/** The panel's region, hidden or not: a hidden one is not in the accessibility tree, so it is found by the part the shell names it by. */
const region = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[data-shell-region="panel"]');
  if (found === null) {
    throw new Error('the shell draws no panel region');
  }

  return found;
};

const island = () => screen.getByRole('main');
const tab = (name: string | RegExp) => screen.getByRole('tab', { name });
const focused = (element: HTMLElement) => {
  act(() => {
    element.focus();
  });
};

const originalHeight = window.innerHeight;

beforeEach(() => {
  window.innerHeight = 900;
});

afterEach(() => {
  cleanup();
  window.innerHeight = originalHeight;
});

describe('a shell with no panel', () => {
  it('has no region, no separator and no toggle for one', () => {
    render(<StaticShell registration={registration} />);
    expect(document.querySelector('[data-shell-region="panel"]')).toBeNull();
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Panel' })).not.toBeInTheDocument();
  });
});

describe('the toggle and the focus (ch16 S105, S116)', () => {
  it('is pressed while the panel is open: the region is hidden, and there is no separator, until it is opened', async () => {
    const { user } = mount();
    expect(toggle()).toHaveAttribute('aria-pressed', 'false');
    expect(region()).toHaveAttribute('hidden');
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    await user.click(toggle());
    expect(toggle()).toHaveAttribute('aria-pressed', 'true');
    expect(region()).not.toHaveAttribute('hidden');
    expect(screen.getByRole('separator', { name: 'Resize panel' })).toBeInTheDocument();
  });

  it('puts the focus on the tool on screen when it opens, and back on the page when it closes from inside', async () => {
    const { user } = mount();
    await user.click(toggle());
    await waitFor(() => {
      expect(tab('Terminal')).toHaveFocus();
    });
    await user.click(screen.getByRole('button', { name: 'Hide panel' }));
    expect(region()).toHaveAttribute('hidden');
    await waitFor(() => {
      expect(island()).toHaveFocus();
    });
  });

  it('opens and closes with Control J from anywhere, and with Control Option J', async () => {
    const { user, store } = mount();
    await user.keyboard('{Control>}j{/Control}');
    expect(store.getSnapshot().open).toBe(true);
    await user.keyboard('{Control>}j{/Control}');
    expect(store.getSnapshot().open).toBe(false);
    await user.keyboard('{Control>}{Alt>}j{/Alt}{/Control}');
    expect(store.getSnapshot().open).toBe(true);
  });

  // The separator is a sibling of the panel's region, not inside it: a focus on it that is not handed to the page is lost with it, and the keyboard user starts again from the top of the
  // document (CodeRabbit, focus.ts:13).
  it('hands the focus to the page when the panel closes while the focus is on the separator', async () => {
    const { user, store } = mount({ open: true });
    const separator = screen.getByRole('separator', { name: 'Resize panel' });
    focused(separator);
    expect(separator).toHaveFocus();
    await user.keyboard('{Control>}j{/Control}');
    expect(store.getSnapshot().open).toBe(false);
    expect(screen.queryByRole('separator')).not.toBeInTheDocument();
    await waitFor(() => {
      expect(island()).toHaveFocus();
    });
  });

  it('hands it to the page too when a drag released below the threshold hides the panel, which is the splitter\'s own way of hiding it', async () => {
    const { store } = mount({ open: true });
    const separator = screen.getByRole('separator', { name: 'Resize panel' });
    focused(separator);
    fireEvent.pointerDown(separator, { button: 0, isPrimary: true, pointerId: 1, clientY: 600 });
    fireEvent.pointerUp(separator, { pointerId: 1, clientY: 900 });
    expect(store.getSnapshot().open).toBe(false);
    await waitFor(() => {
      expect(island()).toHaveFocus();
    });
  });

  it('keeps it on the separator when a drag only resizes the panel', () => {
    const { store } = mount({ open: true });
    const separator = screen.getByRole('separator', { name: 'Resize panel' });
    focused(separator);
    fireEvent.pointerDown(separator, { button: 0, isPrimary: true, pointerId: 1, clientY: 600 });
    fireEvent.pointerUp(separator, { pointerId: 1, clientY: 500 });
    expect(store.getSnapshot()).toMatchObject({ open: true, height: 370 });
    expect(separator).toHaveFocus();
  });

  it('leaves the focus alone when the panel closes while the focus is on the page', async () => {
    const { user, store } = mount({ open: true });
    const inPage = screen.getByRole('button', { name: 'Inside the page' });
    focused(inPage);
    await user.keyboard('{Control>}j{/Control}');
    expect(store.getSnapshot().open).toBe(false);
    expect(inPage).toHaveFocus();
  });
});

describe('the session strip', () => {
  const SESSIONS = [running('zsh'), running('bash')];

  it('hands the focus to the neighbour when Delete closes a session', async () => {
    const { user, store } = mount({ open: true, sessions: SESSIONS });
    focused(tab('zsh'));
    await user.keyboard('{Delete}');
    expect(Object.values(store.getSnapshot().sessions).map((one) => one.title)).toEqual(['bash']);
    await waitFor(() => {
      expect(tab('bash')).toHaveFocus();
    });
  });

  // Closing the last session leaves the strip with no neighbour to take the focus; the tab that had it is gone, and the focus would fall to the document (CodeRabbit, SessionTabs.tsx:123).
  it('hands the focus to the tool\'s own tab when Delete closes the last session', async () => {
    const { user, store } = mount({ open: true, sessions: [running('zsh')] });
    focused(tab('zsh'));
    await user.keyboard('{Delete}');
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
    await waitFor(() => {
      expect(tab('Terminal')).toHaveFocus();
    });
  });

  it('does the same for the close chord, which is the same decision', async () => {
    const { user, store } = mount({ open: true, sessions: [running('zsh')] });
    focused(tab('zsh'));
    await user.keyboard('{Control>}{Shift>}w{/Shift}{/Control}');
    expect(Object.keys(store.getSnapshot().sessions)).toEqual([]);
    await waitFor(() => {
      expect(tab('Terminal')).toHaveFocus();
    });
  });
});

/**
 * Whether a tab's accessible name holds the text the tab draws (WCAG 2.5.3; axe's `label-content-name-mismatch`, which the panel probe runs in a real engine, and ACT rule "visible label is part of accessible name"). Both
 * are read as those rules read them: lower case, a parenthesis and what is in it left out, anything that is not a letter or a number a space, then the words; the drawn words must be a run of the name's. The
 * drawn text is the tab's own, its parts joined as the DOM joins them: a muted scope that touches the name in the DOM is one word with it.
 */
const words = (text: string): string[] =>
  text
    .toLowerCase()
    .normalize('NFKD')
    .replace(/\([^()]*\)/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((word) => word !== '');
const holdsDrawnText = (name: string, drawn: string): boolean => {
  const have = words(name);
  const want = words(drawn);
  return want.length === 0 || have.some((_, at) => want.every((word, offset) => have[at + offset] === word));
};

describe('what a session tab draws, and is named by (SCT1, TI1, WCAG 2.5.3)', () => {
  const session = (title: string, scope: string, extra: Partial<StaticSession> = {}): StaticSession => ({ tool: 'terminal', title, scope, state: 'running', ...extra });
  const tabs = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-shell-part="sessionTab"] [role="tab"]')];
  const scopes = (): string[] => [...document.querySelectorAll('[data-shell-part="sessionScope"]')].map((one) => one.textContent ?? '');

  it('draws no scope on a session that has no twin: its tab is its title, and its name is its title', () => {
    mount({ open: true, sessions: [session('orders-api/app', 'north-yard')] });
    expect(scopes()).toEqual([]);
    expect(tabs().map((one) => [one.textContent, one.getAttribute('aria-label')])).toEqual([['orders-api/app', 'orders-api/app']]);
  });

  it('draws the scope of each of two sessions that share a title and not a scope, after the name, and names each by the words it draws', () => {
    mount({ open: true, sessions: [session('orders-api/app', 'north-yard'), session('orders-api/app', 'south-yard')] });
    expect(scopes()).toEqual(['north-yard', 'south-yard']);
    expect(tabs().map((one) => one.getAttribute('aria-label'))).toEqual(['orders-api/app · north-yard', 'orders-api/app · south-yard']);
    // The DOM keeps the name and the scope apart with a space the layout does not draw, so the words a tab draws are the words its name says.
    expect(tabs().map((one) => one.textContent)).toEqual(['orders-api/app north-yard', 'orders-api/app south-yard']);
  });

  it('draws an ordinal, and no scope, on the second of two sessions of one title and one scope', () => {
    mount({ open: true, sessions: [session('zsh', 'dev'), session('zsh', 'dev')] });
    expect(scopes()).toEqual([]);
    expect(tabs().map((one) => [one.textContent, one.getAttribute('aria-label')])).toEqual([
      ['zsh', 'zsh'],
      ['zsh (2)', 'zsh (2)'],
    ]);
  });

  it('takes the scope off the tab that is left when its twin closes', async () => {
    const { user, store } = mount({ open: true, sessions: [session('orders-api/app', 'north-yard'), session('orders-api/app', 'south-yard')] });
    focused(tab('orders-api/app · south-yard'));
    await user.keyboard('{Delete}');
    expect(Object.values(store.getSnapshot().sessions).map((one) => one.scope)).toEqual(['north-yard']);
    expect(scopes()).toEqual([]);
    expect(tabs().map((one) => one.getAttribute('aria-label'))).toEqual(['orders-api/app']);
  });

  it('names every tab by a run of the words it draws, whatever its scope, its ordinal and its state (WCAG 2.5.3: the visible text is part of the accessible name)', () => {
    mount({
      open: true,
      sessions: [
        session('orders-api/app', 'north-yard'),
        session('orders-api/app', 'south-yard', { state: 'ended' }),
        session('orders-api/app', 'north-yard', { state: 'failed' }),
        session('cart-api-7d8c6f49b-f8q4m', 'north-yard'),
        session('zsh', ''),
      ],
    });
    expect(tabs()).toHaveLength(5);
    for (const one of tabs()) {
      const name = one.getAttribute('aria-label') ?? '';
      expect(holdsDrawnText(name, one.textContent ?? ''), `the tab draws ${JSON.stringify(one.textContent)} and is named ${JSON.stringify(name)}`).toBe(true);
    }
  });

  it('has a name of its own for every tab: two tabs are never named alike', () => {
    mount({ open: true, sessions: [session('a', 'x'), session('a', 'x'), session('a', 'y'), session('a (2)', 'x'), session('b', 'x')] });
    const names = tabs().map((one) => one.getAttribute('aria-label'));
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('the empty state of a tool', () => {
  it('says the generic words, and offers the button that starts a session, when the owner of the tool has a way to start one', () => {
    mount({ open: true });
    expect(screen.getByText('No sessions')).toBeInTheDocument();
    expect(screen.getByText('A session of this tool appears here when you start one.')).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'New shell' }).length).toBeGreaterThan(0);
  });

  // Owner decision A20: sessions of the Logs tool start from a resource, never from the panel. Its owner words the empty state itself, says how a session arrives, and has no way to start one:
  // no button in the body and no `+` in the strip.
  it('says the words its owner gave it, and has no button and no `+` when the owner offers no way to start a session', async () => {
    const { user } = mount({ open: true, emptyOf: (tool) => (tool === 'logs' ? { title: 'No log sessions', hint: 'Open logs from a resource to follow them here.' } : undefined) });
    await user.click(tab('Logs'));
    expect(screen.getByText('No log sessions')).toBeInTheDocument();
    expect(screen.getByText('Open logs from a resource to follow them here.')).toBeInTheDocument();
    expect(screen.queryByText('No sessions')).not.toBeInTheDocument();
    const deck = region().querySelector<HTMLElement>('[data-shell-part="panelDeck"]');
    expect(deck).not.toBeNull();
    expect(within(deck ?? region()).queryAllByRole('button')).toEqual([]);
    expect(screen.queryByRole('button', { name: /^New / })).not.toBeInTheDocument();
  });

  it('keeps the generic words for a tool whose owner says nothing', async () => {
    const { user } = mount({ open: true, emptyOf: (tool) => (tool === 'logs' ? { title: 'No log sessions', hint: 'x' } : undefined) });
    await user.click(tab('Terminal'));
    expect(screen.getByText('No sessions')).toBeInTheDocument();
  });
});

describe('ids that name nothing but themselves (CodeRabbit, words.ts:18)', () => {
  // `:b` and the Greek capital upsilon with a diaeresis both used to become `_3ab`: two sessions with different ids, one id in the DOM, and the tabs and the bodies pointing at each other.
  it('keep two sessions whose ids once collided apart: their tabs, their bodies and what points at them', () => {
    const { store } = mount({ open: true, sessions: [running('first', { id: ':b' }), running('second', { id: '\u03AB' })] });
    act(() => {
      store.activateSession('\u03AB');
    });
    act(() => {
      store.activateSession(':b');
    });
    // Both bodies are mounted now, and every id of the document is its own.
    expect(document.querySelectorAll('[data-shell-part="panelBody"]')).toHaveLength(2);
    const ids = [...document.querySelectorAll('[id]')].map((element) => element.id);
    expect(new Set(ids).size).toBe(ids.length);
    // The panel's tabpanel (the page has one of its own) is labelled by the tab of the session on screen, and by no other.
    const deck = screen.getByRole('tabpanel', { name: 'first' });
    expect(deck).toHaveAttribute('aria-labelledby', tab('first').id);
    expect(tab('first').id).not.toBe(tab('second').id);
    expect(within(deck).getByText(/first/)).toBeInTheDocument();
  });
});

describe('the window the panel is drawn in (the mock re-clamps on load and on resize, S103)', () => {
  const resized = (height: number) => {
    act(() => {
      window.innerHeight = height;
      window.dispatchEvent(new Event('resize'));
    });
  };

  it('brings a size that no longer fits within the window when the window shrinks, and keeps it so when the window grows', () => {
    const { store } = mount({ open: true });
    act(() => {
      store.resize({ size: 500 });
    });
    expect(store.getSnapshot().height).toBe(500);
    resized(620);
    expect(store.getSnapshot().height).toBe(308);
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '308');
    resized(1400);
    expect(store.getSnapshot().height).toBe(308);
  });

  it('brings a size it was loaded with within the window it is drawn in', () => {
    const restored = restorePanel({ version: 1, open: false, height: 5000, tool: null, active: {}, sessions: [] }, { now: 1 });
    if (!restored.ok) {
      throw new Error('the document is readable');
    }

    const store = createPanelStore({ initial: restored.state });
    expect(store.getSnapshot().height).toBe(5000);
    mount({ store, open: true });
    expect(store.getSnapshot().height).toBe(588);
  });

  it('leaves the default alone: it follows the window by itself', () => {
    const { store } = mount({ open: true });
    resized(500);
    expect(store.getSnapshot().height).toBeNull();
    expect(screen.getByRole('separator')).toHaveAttribute('aria-valuenow', '188');
  });
});
