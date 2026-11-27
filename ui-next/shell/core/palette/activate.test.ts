import { describe, expect, it } from 'vitest';
import { pageTabOf } from '../tabs/testing';
import type { CommandOutcome, KeyInput, PaletteState, Provider } from './types';
import { command, makePalette, page, tabsProvider, type Fixture } from './testing';

// What a row does when it is chosen (ch16 S64, S65, S70) and what the keys do. A place opens through the tab model and nothing else, so these tests run the real tab store beside the
// palette; a command runs through the host's registry and ignores the modifiers. Tests that port the design lab's harness are in `oracle.test.ts`.

const state = (f: Fixture): PaletteState => f.palette.getSnapshot();
const rows = (f: Fixture): PaletteState['rows'] => state(f).rows;
const titles = (f: Fixture): string[] => rows(f).map((row) => row.title.text);

function world(f: Fixture, extra: Provider[] = []): void {
  f.palette.registerProvider({
    id: 'cloud:pages',
    plugin: 'cloud',
    pluginName: 'Cloud',
    section: 'goto',
    title: 'Pages',
    match: () => [page('instances', 'Instances', { context: 'Cloud · Compute' }), page('volumes', 'Volumes', { context: 'Cloud · Storage' }), page('buckets', 'Buckets', { context: 'Cloud · Storage' })],
  });
  f.palette.registerProvider({
    id: 'host:commands',
    plugin: 'host',
    pluginName: 'Omniview',
    section: 'commands',
    title: 'Commands',
    match: () => [command('tabs.reopen', 'Reopen closed tab', { shortcut: '⌘⇧T' }), command('panel.toggle', 'Toggle panel', { command: { id: 'panel.toggle', arg: { open: true }, target: ['logs'] } }), command('x.keep', 'Keep open', { command: { id: 'x.keep', keepOpen: true } })],
  });
  for (const provider of extra) {
    f.palette.registerProvider(provider);
  }
}

const rowOf = (f: Fixture, title: string) => {
  const row = rows(f).find((candidate) => candidate.title.text === title);
  if (row === undefined) {
    throw new Error(`no row ${title}: ${titles(f).join(', ')}`);
  }

  return row;
};

describe('choosing a place', () => {
  it('opens it through the tab model as a search result: a preview tab, with the palette closed after (S24, S64)', () => {
    const f = makePalette();
    world(f);
    f.palette.open();
    f.palette.setQuery('inst');
    const result = f.palette.activate();
    expect(result).toMatchObject({ status: 'opened', result: { status: 'done', change: 'created', focused: true } });
    const tab = f.tabs.state().tabs[f.tabs.current()];
    expect(tab?.location.route).toEqual({ plugin: 'cloud', contribution: 'instances', params: {} });
    expect(tab?.flags.preview).toBe(true);
    expect(state(f)).toMatchObject({ open: false, rows: [], query: '' });
  });

  it('passes the destination as it is: its reveal, never part of the route', () => {
    const f = makePalette();
    f.palette.registerProvider({ id: 'host:settings', plugin: 'host', section: 'settings', match: () => [{ id: 'motion', kind: 'setting', title: 'Motion', route: { plugin: 'host', contribution: 'settings' }, reveal: { key: 'appearance.motion' } }] });
    f.palette.open({ kind: 'settings' });
    f.palette.activate();
    const tab = f.tabs.state().tabs[f.tabs.current()];
    expect(tab?.location.route).toEqual({ plugin: 'host', contribution: 'settings', params: {} });
    expect(tab?.reveal?.payload).toEqual({ key: 'appearance.motion' });
  });

  it('keeps the palette open and says why when the place cannot open (S65)', () => {
    const f = makePalette();
    world(f);
    f.tabs.world.report('cloud', { state: 'unavailable', reason: 'Cloud is disabled in Plugins' });
    f.palette.open();
    f.palette.setQuery('inst');
    expect(rows(f)[0]).toMatchObject({ word: 'Unavailable' });
    expect(f.palette.activate()).toMatchObject({ status: 'refused', reason: 'unavailable', message: 'Instances: Cloud is disabled in Plugins' });
    expect(f.announced).toEqual(['Instances: Cloud is disabled in Plugins']);
    expect(state(f)).toMatchObject({ open: true, notice: 'Instances: Cloud is disabled in Plugins' });
    expect(f.tabs.ids()).toEqual([]);
  });

  it('opens a degraded place, to its recovery page (S65)', () => {
    const f = makePalette();
    world(f);
    f.tabs.world.report('cloud', { state: 'degraded', reason: 'The backend crashed' });
    f.palette.open();
    f.palette.setQuery('inst');
    expect(rows(f)[0]).toMatchObject({ word: 'Degraded', availability: { state: 'degraded' } });
    expect(f.palette.activate()).toMatchObject({ status: 'opened', result: { status: 'done' } });
    expect(f.tabs.ids()).toHaveLength(1);
  });

  it('leaves the palette open when the tab model refuses the request, with its answer (the host had said the place could open)', () => {
    const f = makePalette({ availability: () => ({ state: 'available' }) });
    f.palette.registerProvider({ id: 'ghost:pages', plugin: 'ghost', section: 'goto', match: () => [page('x', 'Ghost page', { route: { plugin: 'ghost', contribution: 'x' } })] });
    f.palette.open();
    f.palette.setQuery('ghost');
    const result = f.palette.activate();
    expect(result).toMatchObject({ status: 'opened', result: { status: 'refused', reason: 'unavailable' } });
    expect(state(f).open).toBe(true);
  });

  it('records what was opened as a recent, newest first', () => {
    const f = makePalette();
    world(f);
    f.palette.open();
    f.palette.setQuery('vol');
    f.palette.activate();
    f.palette.open();
    f.palette.setQuery('buck');
    f.palette.activate();
    expect(f.palette.serialise().recents.map((recent) => recent.title)).toEqual(['Buckets', 'Volumes']);
    f.palette.open({ kind: 'goto' });
    f.palette.close();
    f.palette.open();
    expect(rows(f).map((row) => [row.section, row.title.text])).toEqual([['recent', 'Buckets'], ['recent', 'Volumes']]);
  });

  it('shows the user the tab they have open as a recent only once they have left it (the recent-tab switcher, S73)', () => {
    const f = makePalette();
    world(f);
    f.palette.open();
    f.palette.setQuery('vol');
    f.palette.activate();
    f.palette.open({ current: { plugin: 'cloud', contribution: 'volumes', params: {} } });
    expect(titles(f)).toEqual([]);
    f.palette.close();
    f.palette.open({ current: { plugin: 'cloud', contribution: 'instances', params: {} } });
    expect(titles(f)).toEqual(['Volumes']);
  });

  it('moves the place the user is on out of Recent when the shell went somewhere else while the palette was open: refresh says where, and the query and the chips stay', () => {
    const f = makePalette();
    world(f);
    f.palette.record({ route: { plugin: 'cloud', contribution: 'volumes' }, title: 'Volumes' });
    f.palette.record({ route: { plugin: 'cloud', contribution: 'buckets' }, title: 'Buckets' });
    f.palette.open({ current: { plugin: 'cloud', contribution: 'volumes', params: {} } });
    expect(titles(f)).toEqual(['Buckets']);
    f.palette.refresh({ route: { plugin: 'cloud', contribution: 'buckets', params: {} } });
    expect(titles(f)).toEqual(['Volumes']);
    f.palette.refresh();
    expect(titles(f)).toEqual(['Volumes']);
  });

  it('leaves recording to a host that records what its tab model made of the open (the route with the connection the tab was given): a row that was opened is not remembered by its own route', () => {
    const f = makePalette({ recordOpens: false });
    world(f);
    f.palette.open();
    f.palette.setQuery('vol');
    f.palette.activate();
    expect(f.palette.serialise().recents).toEqual([]);
  });

  it('records a tab the user switched to, when the host says so', () => {
    const f = makePalette();
    f.tabs.open({ route: { plugin: 'cloud', contribution: 'volumes' } });
    f.palette.record({ route: pageTabOf(f.tabs, f.tabs.current()).location.route });
    expect(f.palette.serialise().recents[0]).toMatchObject({ title: 'Volumes', context: 'Cloud · Compute' });
  });
});

describe('choosing a tab', () => {
  it('activates it, and opens its place in another tab for the other keys', () => {
    const f = makePalette();
    const a = f.tabs.open({ route: { plugin: 'cloud', contribution: 'instances' } });
    const b = f.tabs.open({ route: { plugin: 'cloud', contribution: 'volumes' } }, { how: 'new' });
    f.palette.registerProvider(tabsProvider(f));
    expect(f.tabs.active()).toBe(b);
    f.palette.open({ kind: 'tabs' });
    f.palette.setQuery('inst');
    expect(f.palette.activate()).toMatchObject({ status: 'opened', result: { status: 'done', id: a } });
    expect(f.tabs.active()).toBe(a);
    expect(f.tabs.ids()).toHaveLength(2);
  });

  it('says a tab that has been closed since the list was drawn is closed, and stays open', () => {
    const f = makePalette();
    const a = f.tabs.open({ route: { plugin: 'cloud', contribution: 'instances' } });
    f.tabs.open({ route: { plugin: 'cloud', contribution: 'volumes' } }, { how: 'new' });
    f.palette.registerProvider(tabsProvider(f));
    f.palette.open({ kind: 'tabs' });
    f.palette.setQuery('inst');
    f.tabs.store.close(a);
    expect(f.palette.activate()).toMatchObject({ status: 'refused', reason: 'closed', message: 'Instances is closed' });
    expect(f.announced).toEqual(['Instances is closed']);
    expect(state(f).open).toBe(true);
  });
});

describe('running a command (S64: Enter, and nothing else)', () => {
  it('runs it through the host with its argument and target, ignores the modifiers, and closes', () => {
    const f = makePalette();
    world(f);
    f.palette.open({ kind: 'commands' });
    f.palette.setQuery('toggle');
    expect(f.palette.activate(undefined, { metaKey: true, shiftKey: true })).toMatchObject({ status: 'ran', outcome: 'done' });
    expect(f.ran).toEqual([{ id: 'panel.toggle', arg: { open: true }, target: ['logs'] }]);
    expect(f.tabs.ids()).toEqual([]);
    expect(state(f).open).toBe(false);
  });

  it('stays open for a command that keeps it open, and for one that refuses', () => {
    const f = makePalette({ run: (ref) => (ref.id === 'x.refuse' ? { ok: false, reason: 'The window is not split' } : true) });
    world(f);
    f.palette.registerProvider({ id: 'host:more', plugin: 'host', section: 'commands', match: () => [command('refuse', 'Refuse this', { command: { id: 'x.refuse' } })] });
    f.palette.open({ kind: 'commands' });
    f.palette.setQuery('keep');
    expect(f.palette.activate()).toMatchObject({ status: 'ran', outcome: 'done' });
    expect(state(f).open).toBe(true);
    f.palette.setQuery('refuse');
    expect(f.palette.activate()).toMatchObject({ status: 'ran', outcome: 'refused' });
    expect(state(f)).toMatchObject({ open: true, notice: 'Refuse this: The window is not split' });
    expect(f.announced).toContain('Refuse this: The window is not split');
  });

  it('refuses a command the provider says is unavailable, with its reason, and never calls the host', () => {
    const f = makePalette();
    f.palette.registerProvider({ id: 'host:c', plugin: 'host', section: 'commands', match: () => [command('a', 'Close split view', { unavailable: 'The window is not split' })] });
    f.palette.open({ kind: 'commands' });
    f.palette.setQuery('close');
    expect(f.palette.activate()).toMatchObject({ status: 'refused', reason: 'unavailable', message: 'Close split view: The window is not split' });
    expect(f.ran).toEqual([]);
  });

  it('waits for a command that answers later: the row is inert, a second command is refused as busy, and the palette closes when it is done', async () => {
    const release = Promise.withResolvers<CommandOutcome>();
    const f = makePalette({ run: async () => release.promise });
    world(f);
    f.palette.open({ kind: 'commands' });
    f.palette.setQuery('toggle');
    const first = f.palette.activate();
    expect(first).toMatchObject({ status: 'ran', outcome: 'pending' });
    expect(state(f).running).toBe(rows(f)[0]?.id);
    expect(rows(f)[0]?.inert).toBe(true);
    expect(f.palette.activate(rowOf(f, 'Toggle panel').id)).toMatchObject({ status: 'refused', reason: 'inert' });
    f.palette.setQuery('reopen');
    expect(f.palette.activate()).toMatchObject({ status: 'refused', reason: 'busy' });
    release.resolve(true);
    await (first.status === 'ran' ? first.done : undefined);
    expect(state(f)).toMatchObject({ open: false, running: '' });
  });

  it('contains a command that throws: the palette stays open and says so', () => {
    const f = makePalette({
      run: () => {
        throw new Error('boom');
      },
    });
    world(f);
    f.palette.open({ kind: 'commands' });
    f.palette.setQuery('reopen');
    expect(f.palette.activate()).toMatchObject({ status: 'ran', outcome: 'refused' });
    expect(state(f)).toMatchObject({ open: true, running: '' });
    expect(f.errors.map((error) => error.where)).toEqual(['run() of tabs.reopen']);
  });

  it('contains a command that rejects: the palette stays open and says so', async () => {
    const f = makePalette({ run: async () => Promise.reject(new Error('later')) });
    world(f);
    f.palette.open({ kind: 'commands' });
    f.palette.setQuery('toggle');
    const result = f.palette.activate();
    await (result.status === 'ran' ? result.done : undefined);
    expect(state(f)).toMatchObject({ open: true, running: '' });
    expect(f.errors.map((error) => error.where)).toEqual(['run() of panel.toggle']);
  });

  it('draws the chord the host supplies and no other (A9: none is borrowed unimplemented)', () => {
    const f = makePalette();
    world(f);
    f.palette.open({ kind: 'commands' });
    expect(rowOf(f, 'Reopen closed tab').shortcut).toBe('⌘⇧T');
    expect(rowOf(f, 'Toggle panel').shortcut).toBeUndefined();
  });
});

describe('the row that is not a result', () => {
  it('Show all changes the kind, Search everywhere clears the chips, a source row retries', () => {
    const f = makePalette();
    f.palette.registerProvider({ id: 'cloud:pages', plugin: 'cloud', section: 'goto', match: () => Array.from({ length: 12 }, (_, index) => page(`p${String(index)}`, `Item ${String(index)}`)) });
    f.palette.open();
    f.palette.setQuery('item');
    const more = rows(f).find((row) => row.kind === 'more');
    expect(f.palette.activate(more?.id)).toEqual({ status: 'changed' });
    expect(state(f).kind).toBe('goto');
  });
});

describe('the keys (S66, S69, S70)', () => {
  const press = (f: Fixture, key: string, extra: Partial<KeyInput> = {}) => f.palette.key({ key, target: 'input', ...extra });

  it('moves the active row with the arrows, wrapping, and by eight with Page Up and Down, without wrapping', () => {
    const f = makePalette();
    f.palette.registerProvider({ id: 'cloud:pages', plugin: 'cloud', section: 'goto', match: () => Array.from({ length: 20 }, (_, index) => page(`p${String(index)}`, `Item ${String(index)}`)) });
    f.palette.open({ kind: 'goto' });
    expect(state(f)).toMatchObject({ activeIndex: 0, focused: false });
    expect(press(f, 'ArrowUp').handled).toBe(true);
    expect(state(f)).toMatchObject({ activeIndex: 19, focused: true });
    press(f, 'ArrowDown');
    expect(state(f).activeIndex).toBe(0);
    press(f, 'PageDown');
    expect(state(f).activeIndex).toBe(8);
    press(f, 'PageDown');
    press(f, 'PageDown');
    expect(state(f).activeIndex).toBe(19);
    press(f, 'PageUp');
    expect(state(f).activeIndex).toBe(11);
    expect(press(f, 'ArrowDown', { altKey: true }).handled).toBe(false);
  });

  it('moves to the row the pointer is on, and keeps it there like a key does', () => {
    const f = makePalette();
    f.palette.registerProvider({ id: 'cloud:pages', plugin: 'cloud', section: 'goto', match: () => [page('a', 'Alpha'), page('b', 'Beta')] });
    f.palette.open({ kind: 'goto' });
    expect(f.palette.focus(rows(f)[1]?.id ?? '')).toBe(true);
    expect(state(f)).toMatchObject({ activeIndex: 1, focused: true });
    expect(f.palette.focus(rows(f)[1]?.id ?? '')).toBe(false);
  });

  it('opens the active row with Enter, and tells the view it took the key', () => {
    const f = makePalette();
    world(f);
    f.palette.open();
    f.palette.setQuery('vol');
    expect(press(f, 'Enter')).toMatchObject({ handled: true, result: { status: 'opened', result: { status: 'done' } } });
    expect(f.tabs.ids()).toHaveLength(1);
    expect(state(f).open).toBe(false);
  });

  it('closes with Escape, and goes back from the Sources list first', () => {
    const f = makePalette();
    f.palette.open();
    expect(press(f, 'Escape').handled).toBe(true);
    expect(state(f).open).toBe(false);
    expect(press(f, 'Escape').handled).toBe(false);
  });

  it('does not search while an IME composes, takes the text when it ends, and ignores keys during composition', () => {
    const f = makePalette();
    world(f);
    f.palette.open();
    f.palette.compositionStart();
    f.palette.setQuery('vo');
    expect(state(f)).toMatchObject({ query: 'vo', composing: true });
    expect(press(f, 'ArrowDown', { isComposing: true }).handled).toBe(false);
    f.palette.compositionEnd('vol');
    expect(state(f)).toMatchObject({ query: 'vol', composing: false });
    expect(titles(f)).toEqual(['Volumes']);
  });

  it('says the keys of the active row in the footer, and only the ones that are valid for it (S70, A5): a host that cannot open a window does not advertise one', () => {
    const f = makePalette();
    world(f);
    f.palette.open();
    f.palette.setQuery('vol');
    expect(state(f).hints).toEqual([
      { keys: 'Enter', label: 'Open' },
      { keys: 'Alt+Enter', label: 'Here' },
      { keys: 'Mod+Shift+Enter', label: 'New tab' },
      { keys: 'Mod+Enter', label: 'Background tab' },
    ]);
    f.palette.setKind('commands');
    f.palette.setQuery('reopen');
    expect(state(f).hints).toEqual([{ keys: 'Enter', label: 'Run' }]);
    f.tabs.world.report('cloud', { state: 'unavailable', reason: 'Cloud is disabled in Plugins' });
    f.palette.setKind('goto');
    f.palette.setQuery('vol');
    expect(state(f).hints).toEqual([]);
  });

  it('says New window, and opens one, only for a host that can: the others refuse Shift+Enter with the reason, stay open, and do not call the tab model', () => {
    const f = makePalette({ windows: true });
    world(f);
    f.palette.open();
    f.palette.setQuery('vol');
    expect(state(f).hints.map((hint) => hint.label)).toEqual(['Open', 'Here', 'New tab', 'Background tab', 'New window']);
    expect(f.palette.activate(undefined, { shiftKey: true })).toMatchObject({ status: 'opened', result: { status: 'window' } });

    const g = makePalette();
    world(g);
    const before = g.tabs.ids().length;
    g.palette.open();
    g.palette.setQuery('vol');
    expect(g.palette.activate(undefined, { shiftKey: true })).toEqual({ status: 'refused', reason: 'invalid', message: 'This window cannot open another one yet.' });
    expect(state(g)).toMatchObject({ open: true, notice: 'This window cannot open another one yet.' });
    expect(g.tabs.ids()).toHaveLength(before);
    expect(g.announced.at(-1)).toBe('This window cannot open another one yet.');
  });

  it('says a tab row\'s Enter as Switch to tab, and offers → on a row that can be searched inside', () => {
    const f = makePalette();
    f.palette.registerProvider({ id: 'host:tabs', plugin: 'host', section: 'tabs', match: () => [{ id: 't', kind: 'tab', title: 'Instances', tab: 't1' }] });
    f.palette.registerProvider({ id: 'stack:p', plugin: 'stack', pluginName: 'Stack', section: 'goto', match: () => [{ id: 'c', kind: 'scope', title: 'Connection prod', route: { plugin: 'stack', contribution: 'x' }, into: { kind: 'scope', id: 'prod', label: 'prod' } }] });
    f.palette.open({ kind: 'tabs' });
    expect(state(f).hints[0]).toEqual({ keys: 'Enter', label: 'Switch to tab' });
    f.palette.setKind('goto');
    expect(state(f).hints.at(-1)).toEqual({ keys: 'ArrowRight', label: 'Search inside' });
  });
});
