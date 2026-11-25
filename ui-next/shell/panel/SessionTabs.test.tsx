import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MenuHost } from '@omniviewdev/kit';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPanelStore, type PanelStore } from '../core/panel';
import type { ShellRegistration } from '../registration';
import { StaticShell } from '../testing';
import { staticPanel, type StaticSession } from './testing';

// The face of a session tab. jsdom lays nothing out, so what is asserted here is what the markup and the stylesheet carry: the tail of a name (a twin's ordinal) is an element of its own that never
// shrinks, the head is the part that gives way, and no rule gives the head a width its text does not have. The measured layout is the panel probe's (ui-next/shell/probes/panel-probe.mjs).

const registration: ShellRegistration = { plugin: { name: 'Acme' } };
const sheet = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), 'Header.module.css'), 'utf8');

/** The declarations of the rule whose selector is exactly `selector`, as property to value. */
function rule(selector: string): Readonly<Record<string, string>> {
  const escaped = selector.replaceAll('.', '\\.');
  const found = new RegExp(`(?:^|\\})\\s*${escaped}\\s*\\{([^}]*)\\}`, 'm').exec(sheet);
  if (found?.[1] === undefined) {
    throw new Error(`Header.module.css has no rule for ${selector}`);
  }

  const declarations: Record<string, string> = {};
  for (const line of found[1].split(';')) {
    const colon = line.indexOf(':');
    if (colon > 0) {
      declarations[line.slice(0, colon).replace(/\/\*.*?\*\//gs, '').trim()] = line.slice(colon + 1).trim();
    }
  }

  return declarations;
}

const session = (title: string, extra: Partial<StaticSession> = {}): StaticSession => ({ tool: 'terminal', title, state: 'running', ...extra });

function mount(sessions: readonly StaticSession[]) {
  const panel = staticPanel({ tools: [{ id: 'terminal', label: 'Terminal', icon: 'terminal', order: 10 }], open: true, sessions });
  return render(<StaticShell registration={registration} panel={panel} />);
}

const part = (root: ParentNode, name: string): HTMLElement | null => root.querySelector<HTMLElement>(`[data-shell-part="${name}"]`);

afterEach(cleanup);

describe('the name of a session tab: the head gives way, the tail stays whole', () => {
  it('draws the ordinal of a twin in an element of its own, after the head, in the title that holds both', () => {
    mount([session('zsh'), session('zsh')]);
    const [, twin] = [...document.querySelectorAll<HTMLElement>('[data-shell-part="sessionTab"]')];
    const head = part(twin, 'sessionHead');
    const tail = part(twin, 'sessionTail');
    expect(head?.textContent).toBe('zsh');
    expect(tail?.textContent).toBe(' (2)');
    expect(head?.parentElement).toBe(tail?.parentElement);
    expect(head?.nextElementSibling).toBe(tail);
  });

  it('draws no tail on a name that has none', () => {
    mount([session('zsh')]);
    expect(part(document, 'sessionTail')).toBeNull();
  });

  it('keeps a long name apart from its generated suffix and its ordinal: the head is the part that is cut', () => {
    mount([session('build-runner-7d8c6f49b-f8q4m'), session('build-runner-7d8c6f49b-f8q4m')]);
    const [, twin] = [...document.querySelectorAll<HTMLElement>('[data-shell-part="sessionTab"]')];
    expect(part(twin, 'sessionHead')?.textContent).toBe('build-runner-7d8c6f49b');
    expect(part(twin, 'sessionTail')?.textContent).toBe('-f8q4m (2)');
  });

  it('never shrinks the tail, and gives way with an ellipsis in the head', () => {
    expect(rule('.sessionTail')).toMatchObject({ flex: '0 0 auto' });
    expect(rule('.sessionHead')).toMatchObject({ overflow: 'hidden', 'text-overflow': 'ellipsis' });
    expect(rule('.sessionHead').flex).toBe('0 1 auto');
  });

  it('gives the head no width its text does not have: a floor in the width of characters made a short head wider than its text, which the tab did not count, so the tab cut the end of the tail', () => {
    const floor = rule('.sessionHead')['min-inline-size'];
    expect(floor === undefined || floor === '0' || floor === '0px').toBe(true);
    expect(rule('.sessionTitle')).toMatchObject({ 'min-inline-size': '0', overflow: 'hidden' });
  });
});

describe('the close control of a session tab', () => {
  it('keeps its slot laid out whether it is shown or not, as the mock does, so a tab never moves when the control appears; the pointer reveals it', () => {
    expect(rule('.sessionClose')).toMatchObject({ flex: '0 0 24px', opacity: '0' });
    expect(sheet).toMatch(/\.sessionItem:is\(\[data-selected\], :hover, :focus-within\) > \.sessionClose\s*\{\s*opacity: 1;/);
  });
});

describe('the menu of a session tab', () => {
  // jsdom has no Popover API, so a popover stays `display: none` and its items are not in the accessibility tree (the ports table's tests do the same).
  let shown: HTMLStyleElement;
  beforeEach(() => {
    shown = document.createElement('style');
    shown.textContent = '[popover] { display: block !important; }';
    document.head.append(shown);
  });
  afterEach(() => {
    shown.remove();
  });

  const tab = (name: string): HTMLElement => screen.getByRole('tab', { name });
  const itemsOf = (menu: HTMLElement): string[] => within(menu).getAllByRole('menuitem').map((item) => item.getAttribute('aria-label') ?? '');
  const names = (): string[] => [...document.querySelectorAll('[data-shell-part="sessionTab"]')].map((one) => one.querySelector('[role="tab"]')?.getAttribute('aria-label') ?? '');

  function mountMenu(titles: readonly string[], store: PanelStore = createPanelStore(), stopOf?: (id: string) => (() => void) | undefined) {
    const panel = { ...staticPanel({ store, tools: [{ id: 'terminal', label: 'Terminal', icon: 'terminal', order: 10 }], open: true, sessions: titles.map((title) => session(title)) }), stopOf };
    return render(
      <MenuHost>
        <StaticShell registration={registration} panel={panel} />
      </MenuHost>,
    );
  }

  const openOn = (name: string): HTMLElement => {
    fireEvent.contextMenu(tab(name), { button: 2 });
    return screen.getByRole('menu', { name: `Actions for ${name}` });
  };

  it('lists the actions in order, with the close chord on Close session', () => {
    mountMenu(['a', 'b', 'c']);
    const menu = openOn('b');
    expect(itemsOf(menu)).toEqual(['Rename session…', 'Close session', 'Close other sessions', 'Close sessions to the right', 'Close sessions to the left']);
    expect(within(menu).getByRole('menuitem', { name: 'Close session' }).getAttribute('aria-description')).toMatch(/⌘W|Ctrl\+Shift\+W/);
  });

  it.each([
    ['a', 'Close sessions to the left', 'There are no sessions to the left'],
    ['c', 'Close sessions to the right', 'There are no sessions to the right'],
  ])('disables what has nothing to close at the end of the strip, and says why: %s, %s', (name, label, reason) => {
    mountMenu(['a', 'b', 'c']);
    const item = within(openOn(name)).getByRole('menuitem', { name: label });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item.getAttribute('aria-description')).toBe(reason);
  });

  it('disables every close of a set for the only session, and leaves Close session and Rename', () => {
    mountMenu(['a']);
    const menu = openOn('a');
    const disabled = within(menu).getAllByRole('menuitem').filter((item) => item.getAttribute('aria-disabled') === 'true').map((item) => item.getAttribute('aria-label'));
    expect(disabled).toEqual(['Close other sessions', 'Close sessions to the right', 'Close sessions to the left']);
    expect(within(menu).getByRole('menuitem', { name: 'Close other sessions' }).getAttribute('aria-description')).toBe('There are no other sessions');
  });

  it.each([
    ['Close session', ['a', 'c', 'd']],
    ['Close other sessions', ['b']],
    ['Close sessions to the right', ['a', 'b']],
    ['Close sessions to the left', ['b', 'c', 'd']],
  ])('%s closes the sessions it names and no others', (label, remaining) => {
    mountMenu(['a', 'b', 'c', 'd']);
    fireEvent.click(within(openOn('b')).getByRole('menuitem', { name: label }));
    expect(names()).toEqual(remaining);
  });

  it('offers Stop session after Rename when the host can stop sessions, and stops the session it opened on', () => {
    const stop = vi.fn();
    const store = createPanelStore();
    const stopOf = vi.fn((id: string) => () => {
      stop(id);
    });
    mountMenu(['a', 'b'], store, stopOf);
    const menu = openOn('b');
    expect(itemsOf(menu).slice(0, 3)).toEqual(['Rename session…', 'Stop session', 'Close session']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Stop session' }));
    expect(stop).toHaveBeenCalledWith(Object.keys(store.getSnapshot().sessions)[1]);
  });

  it.each([
    ['a session that is not running', true],
    ['a session the host holds nothing of', false],
  ])('disables Stop session for %s, and says why', (_name, ended) => {
    const store = createPanelStore();
    mountMenu(['a', 'b'], store, () => (ended ? () => undefined : undefined));
    if (ended) {
      store.setSessionState(Object.keys(store.getSnapshot().sessions)[0] ?? '', { state: 'ended' });
    }

    const item = within(openOn('a')).getByRole('menuitem', { name: 'Stop session' });
    expect(item).toHaveAttribute('aria-disabled', 'true');
    expect(item.getAttribute('aria-description')).toBe('The session isn\'t running.');
  });

  it.each([
    ['Shift F10', { key: 'F10', shiftKey: true }],
    ['the Menu key', { key: 'ContextMenu' }],
  ])('opens on %s with the focus on the tab', (_name, init) => {
    mountMenu(['a', 'b']);
    const focused = tab('b');
    focused.focus();
    fireEvent.keyDown(focused, init);
    expect(screen.getByRole('menu', { name: 'Actions for b' })).toBeInTheDocument();
  });

  it('closes through the panel\'s own close: a session whose close the panel refuses (a terminal that asks first) stays, and the others go', () => {
    const store = createPanelStore();
    const closeSession = store.closeSession.bind(store);
    mountMenu(['a', 'b', 'c'], { ...store, closeSession: (id) => (store.getSnapshot().sessions[id]?.title === 'c' ? { status: 'refused', reason: 'invalid', message: 'asks first' } : closeSession(id)) });
    fireEvent.click(within(openOn('a')).getByRole('menuitem', { name: 'Close other sessions' }));
    expect(names()).toEqual(['a', 'c']);
  });

  it('renames in place: Enter commits and the tab keeps the focus, Escape and an empty name leave the name as it was', () => {
    mountMenu(['a', 'b']);
    const edit = (): HTMLInputElement => screen.getByRole<HTMLInputElement>('textbox', { name: 'Session name' });
    fireEvent.click(within(openOn('a')).getByRole('menuitem', { name: 'Rename session…' }));
    expect(edit()).toHaveFocus();
    expect(edit().value).toBe('a');
    fireEvent.change(edit(), { target: { value: 'build' } });
    fireEvent.keyDown(edit(), { key: 'Escape' });
    expect(names()).toEqual(['a', 'b']);
    fireEvent.click(within(openOn('a')).getByRole('menuitem', { name: 'Rename session…' }));
    fireEvent.change(edit(), { target: { value: '  ' } });
    fireEvent.keyDown(edit(), { key: 'Enter' });
    expect(names()).toEqual(['a', 'b']);
    fireEvent.click(within(openOn('a')).getByRole('menuitem', { name: 'Rename session…' }));
    fireEvent.change(edit(), { target: { value: 'build' } });
    fireEvent.keyDown(edit(), { key: 'Enter' });
    expect(names()).toEqual(['build', 'b']);
  });

  it('cannot rename a session its plugin left behind', () => {
    const store = createPanelStore();
    store.syncPlugins([{ id: 'acme', tools: [] }]);
    const panel = staticPanel({ store, tools: [{ id: 'terminal', label: 'Terminal', icon: 'terminal' }], open: true });
    store.openSession({ tool: 'terminal', plugin: 'acme', title: 'm', state: 'running' });
    store.syncPlugins([]);
    render(
      <MenuHost>
        <StaticShell registration={registration} panel={panel} />
      </MenuHost>,
    );
    fireEvent.contextMenu(screen.getByRole('tab', { name: /^m/ }), { button: 2 });
    expect(within(screen.getByRole('menu')).getByRole('menuitem', { name: 'Rename session…' })).toHaveAttribute('aria-disabled', 'true');
  });
});
