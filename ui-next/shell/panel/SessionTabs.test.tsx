import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MenuHost } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeNotices } from '../core/notices/testing';
import { createPanelStore, type PanelStore } from '../core/panel';
import { createNoticesAnnouncer } from '../notices/host';
import { installPopover, teardown } from '../notices/testing';
import type { ShellRegistration } from '../registration';
import { StaticShell } from '../testing';
import type { SessionMarks } from './host';
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
  beforeEach(installPopover);
  afterEach(teardown);

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

  it('puts the focus on the session that is on screen next after Close session, not on the page\'s body', async () => {
    mountMenu(['a', 'b', 'c']);
    fireEvent.click(tab('b'));
    const focused = tab('b');
    focused.focus();
    fireEvent.keyDown(focused, { key: 'F10', shiftKey: true });
    fireEvent.click(within(screen.getByRole('menu', { name: 'Actions for b' })).getByRole('menuitem', { name: 'Close session' }));

    expect(names()).toEqual(['a', 'c']);
    await waitFor(() => {
      expect(tab('c')).toHaveFocus();
    });
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

  it('does not stop a session that failed while the menu was open: the failure stays', () => {
    const stop = vi.fn();
    const store = createPanelStore();
    mountMenu(['a', 'b'], store, () => stop);
    const menu = openOn('b');
    const id = Object.keys(store.getSnapshot().sessions)[1] ?? '';
    store.setSessionState(id, { state: 'failed' });
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Stop session' }));
    expect(stop).not.toHaveBeenCalled();
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

  it('pins the name the person gave, so that the session\'s owner no longer names it, and does not pin a name they left as it was', () => {
    const store = createPanelStore();
    mountMenu(['a', 'b'], store);
    const edit = (): HTMLInputElement => screen.getByRole<HTMLInputElement>('textbox', { name: 'Session name' });
    fireEvent.click(within(openOn('a')).getByRole('menuitem', { name: 'Rename session…' }));
    fireEvent.change(edit(), { target: { value: 'build' } });
    fireEvent.keyDown(edit(), { key: 'Enter' });
    const [first, second] = Object.keys(store.getSnapshot().sessions);
    expect(store.getSnapshot().sessions[first ?? '']).toMatchObject({ title: 'build', titlePinned: true });
    expect(store.retitleSession(first ?? '', 'zsh')).toMatchObject({ status: 'refused', reason: 'pinned' });

    // Opening the field and leaving it as it was (Enter, or the focus going elsewhere) names nothing.
    fireEvent.click(within(openOn('b')).getByRole('menuitem', { name: 'Rename session…' }));
    fireEvent.keyDown(edit(), { key: 'Enter' });
    expect(store.getSnapshot().sessions[second ?? '']).not.toHaveProperty('titlePinned');
    fireEvent.click(within(openOn('b')).getByRole('menuitem', { name: 'Rename session…' }));
    fireEvent.blur(edit());
    expect(store.getSnapshot().sessions[second ?? '']).not.toHaveProperty('titlePinned');
  });

  it('undoes a name: clearing the field of a tab the person named unpins it, so that the session\'s owner names it again', () => {
    const store = createPanelStore();
    mountMenu(['a'], store);
    const edit = (): HTMLInputElement => screen.getByRole<HTMLInputElement>('textbox', { name: 'Session name' });
    fireEvent.click(within(openOn('a')).getByRole('menuitem', { name: 'Rename session…' }));
    fireEvent.change(edit(), { target: { value: 'build' } });
    fireEvent.keyDown(edit(), { key: 'Enter' });
    const id = Object.keys(store.getSnapshot().sessions)[0] ?? '';
    expect(store.getSnapshot().sessions[id]).toMatchObject({ titlePinned: true });
    fireEvent.click(within(openOn('build')).getByRole('menuitem', { name: 'Rename session…' }));
    fireEvent.change(edit(), { target: { value: '' } });
    fireEvent.keyDown(edit(), { key: 'Enter' });
    expect(store.getSnapshot().sessions[id]).not.toHaveProperty('titlePinned');
    expect(store.retitleSession(id, 'zsh')).toEqual({ status: 'done' });
  });

  it('does not pin the title an unedited field started with when the feed has retitled the session meanwhile, and pins a name typed to the live title', () => {
    const store = createPanelStore();
    mountMenu(['a'], store);
    const edit = (): HTMLInputElement => screen.getByRole<HTMLInputElement>('textbox', { name: 'Session name' });
    const id = Object.keys(store.getSnapshot().sessions)[0] ?? '';
    fireEvent.click(within(openOn('a')).getByRole('menuitem', { name: 'Rename session…' }));
    act(() => {
      store.retitleSession(id, 'vim: notes');
    });
    fireEvent.keyDown(edit(), { key: 'Enter' });
    expect(store.getSnapshot().sessions[id]).not.toHaveProperty('titlePinned');
    expect(store.getSnapshot().sessions[id]?.title).toBe('vim: notes');
    fireEvent.click(within(openOn('vim: notes')).getByRole('menuitem', { name: 'Rename session…' }));
    act(() => {
      store.retitleSession(id, 'less');
    });
    fireEvent.change(edit(), { target: { value: 'less' } });
    fireEvent.keyDown(edit(), { key: 'Enter' });
    expect(store.getSnapshot().sessions[id]).toMatchObject({ title: 'less', titlePinned: true });
  });

  it('starts the rename on a double click of the tab and on F2, and draws the tab\'s keys in its description', () => {
    mountMenu(['a', 'b']);
    expect(tab('a').getAttribute('aria-keyshortcuts')).toBe('F2 Delete');
    fireEvent.doubleClick(tab('a'));
    expect(screen.getByRole('textbox', { name: 'Session name' })).toHaveFocus();
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'Session name' }), { key: 'Escape' });
    tab('b').focus();
    fireEvent.keyDown(tab('b'), { key: 'F2' });
    expect(screen.getByRole<HTMLInputElement>('textbox', { name: 'Session name' }).value).toBe('b');
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

describe('moving a session tab', () => {
  // jsdom lays nothing out: three tabs 100 px wide at x = 0, 104 and 208 in a strip 400 px wide.
  const rect = (left: number, right: number) => () => ({ left, right, width: right - left, top: 6, bottom: 34, height: 28, x: left, y: 6, toJSON: () => ({}) });
  const pointer = (x: number) => ({ pointerId: 1, isPrimary: true, pointerType: 'mouse', button: 0, clientX: x, clientY: 20 });

  function mountStrip() {
    const announcer = createNoticesAnnouncer();
    const panel = staticPanel({ tools: [{ id: 'terminal', label: 'Terminal', icon: 'terminal', order: 10 }], open: true, sessions: ['a', 'b', 'c'].map((title) => session(title)) });
    render(<StaticShell registration={registration} panel={panel} notices={{ store: makeNotices().store, announcer }} />);
    const strip = screen.getByRole('tablist', { name: 'Terminal sessions' });
    strip.getBoundingClientRect = rect(0, 400);
    [0, 104, 208].forEach((left, at) => {
      (strip.children[at] as HTMLElement).getBoundingClientRect = rect(left, left + 100);
    });

    return { strip, told: () => announcer.polite.getSnapshot().text };
  }

  const names = (): string[] => within(screen.getByRole('tablist', { name: 'Terminal sessions' })).getAllByRole('tab').map((one) => one.getAttribute('aria-label') ?? '');

  it('moves with Alt+Shift and an arrow, Home or End, keeps the focus on it and says where it went', () => {
    const { told } = mountStrip();
    screen.getByRole('tab', { name: 'a' }).focus();
    fireEvent.keyDown(screen.getByRole('tab', { name: 'a' }), { key: 'ArrowRight', altKey: true, shiftKey: true });
    expect(names()).toEqual(['b', 'a', 'c']);
    expect(screen.getByRole('tab', { name: 'a' })).toHaveFocus();
    expect(told()).toBe('a moved to position 2 of 3');
    fireEvent.keyDown(screen.getByRole('tab', { name: 'a' }), { key: 'End', altKey: true, shiftKey: true });
    expect(names()).toEqual(['b', 'c', 'a']);
    fireEvent.keyDown(screen.getByRole('tab', { name: 'a' }), { key: 'Home', altKey: true, shiftKey: true });
    expect(names()).toEqual(['a', 'b', 'c']);
  });

  it('moves where the pointer drops it, and nowhere for a drop where it was', async () => {
    const { strip, told } = mountStrip();
    const drag = async (title: string, from: number, to: number) => {
      fireEvent.pointerDown(screen.getByRole('tab', { name: title }), pointer(from));
      fireEvent.pointerMove(strip, pointer(to));
      await act(async () => {
        const { promise, resolve } = Promise.withResolvers<void>();
        requestAnimationFrame(() => {
          resolve();
        });
        await promise;
      });
      fireEvent.pointerUp(strip, pointer(to));
    };

    await drag('b', 150, 150);
    expect(names()).toEqual(['a', 'b', 'c']);
    expect(told()).toBe('');
    await drag('a', 50, 300);
    expect(names()).toEqual(['b', 'c', 'a']);
    expect(told()).toBe('a moved to position 3 of 3');
  });
});

describe('the `+` of the real header', () => {
  it('draws the arrow of the choice the tool offers, beside the `+` (the header passes the tool\'s menu on)', () => {
    const items = [{ kind: 'action' as const, id: 'bash', label: 'bash', onSelect: () => undefined }];
    const panel = staticPanel({
      tools: [{ id: 'terminal', label: 'Terminal', icon: 'terminal', order: 10 }],
      open: true,
      start: { terminal: { label: 'New terminal', open: () => ({ title: 'zsh', state: 'running' }), menu: { label: 'Choose a shell', subscribe: () => () => undefined, getSnapshot: () => items } } },
    });
    render(<StaticShell registration={registration} panel={panel} />);
    expect(document.querySelector('[data-shell-part="sessionAddChoice"]')?.getAttribute('aria-haspopup')).toBe('menu');
  });
});

describe('the mark a tool puts on a session tab (a bell rang in a terminal that is not shown, #697 step 3)', () => {
  const source = (marked_: ReadonlySet<string>): SessionMarks => ({
    subscribe: () => () => undefined,
    of: (id) => (marked_.has(id) ? { label: 'bell rang' } : undefined),
  });

  it('draws a mark in the tab that has one and in no other, and says it in the tab\'s name: nobody hears a bell, so the name is how a person who cannot see the mark knows', () => {
    const store = createPanelStore();
    store.registerTool({ id: 'terminal', label: 'Terminal', icon: 'terminal', order: 10 });
    store.show();
    const first = store.openSession({ tool: 'terminal', title: 'zsh', state: 'running', plugin: 'host' }, { reveal: false });
    const second = store.openSession({ tool: 'terminal', title: 'bash', state: 'running', plugin: 'host' }, { reveal: false });
    const ids = [first, second].map((opened) => (opened.status === 'refused' ? '' : opened.id));
    const panel = staticPanel({ store, marks: source(new Set([ids[1] ?? ''])) });
    render(<StaticShell registration={registration} panel={panel} />);
    const tabs = screen.getAllByRole('tab', { name: /zsh|bash/ });
    const [zsh, bash] = [tabs.find((tab) => /zsh/.test(tab.getAttribute('aria-label') ?? '')), tabs.find((tab) => /bash/.test(tab.getAttribute('aria-label') ?? ''))];
    expect(zsh?.getAttribute('aria-label')).toBe('zsh');
    expect(bash?.getAttribute('aria-label')).toBe('bash, bell rang');
    expect(zsh?.querySelector('[data-shell-part="sessionMark"]')).toBeNull();
    expect(bash?.querySelector('[data-shell-part="sessionMark"]')).not.toBeNull();
  });

  it('is drawn without a sound or a motion of its own: a plain dot in the stylesheet that animates nothing', () => {
    const dot = rule('.sessionMark');
    expect(dot.position).toBe('absolute');
    expect(dot['background-color']).toBe('var(--ov-warning-fg)');
    expect(Object.keys(dot).filter((property) => /animation|transition/.test(property))).toEqual([]);
  });

  it('draws nothing when the host gives no marks', () => {
    mount([session('zsh')]);
    expect(document.querySelector('[data-shell-part="sessionMark"]')).toBeNull();
  });
});
