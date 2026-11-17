import { describe, expect, it } from 'vitest';
import { checkInvariants, dispositionOf, restoreTabs, type Json } from './index';
import { boot, cloudPage, dest, doneId, hostPage, makeWorld, stackPage, type Harness } from './testing';

// A function is not JSON and the types forbid one in a route: the cast stands in for a plugin that ignores the types.
const notJson = (() => 1) as unknown as Json;

// The open model: where a destination lands (ch16 S26, S28, S63 to S65). Ported from the design lab's harness
// (tests/shell-model-harness/R2Store/unit.cjs); docs/ui-next/status/S1a.md lists every case and what became of it.

const sound = (h: Harness) => {
  expect(checkInvariants(h.state())).toEqual([]); 
};

const tab = (h: Harness, id: string) => {
  const found = h.state().tabs[id];
  if (!found) {
    throw new Error(`no tab ${id}`);
  }

  return found;
};

describe('the strip at the start', () => {
  it('opens the window with the home page: one tab, and the strip is sound', () => {
    const h = boot();
    expect(h.titles()).toEqual(['Home']);
    const active = h.active();
    expect(active).toBe('t1');
    expect(tab(h, 't1').location.key).toBe('host:home');
    expect(h.state().mounted).toEqual(['t1']);
    sound(h);
  });

  it('is empty, and sound, when no page can be the home page', () => {
    const h = boot({ home: false });
    expect(h.ids()).toEqual([]);
    expect(h.active()).toBeNull();
    sound(h);
  });
});

describe('smart open (ch16 S64: Enter)', () => {
  it('re-activates a tab that shows the key, navigates the tab on screen within a plugin, and opens a new tab for another plugin', () => {
    const h = boot();
    const home = h.current();

    // Home is the host's; the cloud's page is another plugin's: a new tab (step 3).
    const a = h.open(cloudPage('instances'));
    expect(a).not.toBe(home);
    expect(h.active()).toBe(a);
    expect(tab(h, a).location.key).toBe('cloud:instances|');
    expect(tab(h, a).location.route).toEqual({ plugin: 'cloud', contribution: 'instances', params: {} });

    // The same key again: the tab that shows it is activated (step 1), nothing new opens.
    h.store.activate(home);
    expect(h.store.open(cloudPage('instances'))).toMatchObject({ status: 'done', id: a, change: 'activated', focused: true });
    expect(h.active()).toBe(a);
    expect(h.ids()).toHaveLength(2);

    // The same plugin and scope as the tab on screen, another key: that tab navigates (step 2) and pushes history.
    expect(h.store.open(cloudPage('instances', { item: 'i-0abc' }))).toMatchObject({ status: 'done', id: a, change: 'navigated' });
    expect(h.ids()).toHaveLength(2);
    expect(tab(h, a).face.title).toBe('i-0abc');
    expect([tab(h, a).history.index, tab(h, a).history.entries.length]).toEqual([1, 2]);
    expect(tab(h, a).location.route.params).toEqual({ item: 'i-0abc' });

    // Another plugin from the tab on screen: a new foreground tab directly after it.
    const c = h.open(stackPage('services'));
    expect(h.ids()).toEqual([home, a, c]);
    expect(h.active()).toBe(c);
    sound(h);
  });

  it('keeps scope part of the destination: another region is another destination, the same plugin and scope navigates', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances', { region: 'us-east-1' }));
    expect(tab(h, a).location.key).toBe('cloud:acme/us-east-1:instances|');

    // The same plugin and another scope is not step 2: a new tab.
    const b = h.open(cloudPage('instances', { region: 'eu-west-1' }));
    expect(b).not.toBe(a);
    expect(h.ids()).toHaveLength(2);

    // A destination that names no scope takes the one the plugin completes it with (the scope of the tab on screen), so it navigates that tab.
    expect(h.store.open(cloudPage('buckets'))).toMatchObject({ status: 'done', id: b, change: 'navigated' });
    expect(tab(h, b).face.scope?.id).toBe('acme/eu-west-1');
    sound(h);
  });

  it('opens a fresh view (identity none) as a new tab every time, and still lets Here replace the page', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances'));
    const b = h.open(cloudPage('blank'));
    const c = h.open(cloudPage('blank'));
    expect(new Set([a, b, c]).size).toBe(3);
    expect(h.ids()).toHaveLength(3);
    expect(h.store.open(cloudPage('instances'), { how: 'here' })).toMatchObject({ status: 'done', id: c, change: 'navigated' });
    sound(h);
  });

  it('puts a new tab directly after the tab on screen, and never into the pinned zone', () => {
    const h = boot();
    const home = h.current();
    const a = h.open(cloudPage('instances'));
    const b = h.open(cloudPage('buckets'), { how: 'new' });
    h.store.pin(home);
    h.store.activate(home);
    const c = h.open(stackPage('services'));
    expect(h.ids()).toEqual([home, c, a, b]);
    expect(tab(h, home).flags.pinned).toBe(true);

    const d = h.open(cloudPage('volumes'), { how: 'new', after: a });
    expect(h.ids().indexOf(d)).toBe(h.ids().indexOf(a) + 1);
    sound(h);
  });
});

describe('the other dispositions (ch16 S64)', () => {
  it('Here navigates the tab on screen, New opens a second tab on one key, Background opens after the tab on screen and leaves the focus', () => {
    const h = boot();
    const home = h.current();
    const a = h.open(cloudPage('instances'));

    // New: a second tab on the same key.
    const b = h.open(cloudPage('instances'), { how: 'new' });
    expect(b).not.toBe(a);
    expect(tab(h, a).location.key).toBe(tab(h, b).location.key);
    expect(h.ids()).toEqual([home, a, b]);

    // Background: after the tab on screen, the focus stays, and nothing is deduplicated.
    h.store.activate(a);
    const before = h.ids().length;
    const result = h.store.open(cloudPage('buckets'), { how: 'background' });
    expect(result).toMatchObject({ status: 'done', change: 'created', focused: false });
    const g = doneId(result);
    expect(h.active()).toBe(a);
    expect(h.ids()).toHaveLength(before + 1);
    expect(h.ids()[h.ids().indexOf(a) + 1]).toBe(g);
    expect(h.state().mounted).not.toContain(g);
    const again = h.store.open(cloudPage('buckets'), { how: 'background' });
    expect(again).toMatchObject({ status: 'done', change: 'created' });
    expect(doneId(again)).not.toBe(g);

    // Here: replaces the page of the tab on screen and pushes history, even to a key another tab shows.
    expect(h.store.open(cloudPage('buckets'), { how: 'here' })).toMatchObject({ status: 'done', id: a, change: 'navigated' });
    expect([tab(h, a).face.title, tab(h, a).history.index]).toEqual(['Buckets', 1]);
    sound(h);
  });

  it('asks the caller for a window, and changes nothing, because the model has none', () => {
    const h = boot();
    const before = h.state();
    expect(h.store.open(stackPage('services'), { how: 'window' })).toEqual({ status: 'window', route: { plugin: 'stack', contribution: 'services', params: {} } });
    expect(h.state()).toBe(before);
  });

  it('opens a tab at the end of the strip when none is on screen, and a Here with no tab on screen opens one', () => {
    const h = boot({ home: false });
    expect(h.store.open(cloudPage('instances'), { how: 'here' })).toMatchObject({ status: 'done', change: 'created' });
    expect(h.ids()).toHaveLength(1);
    sound(h);
  });
});

describe('singleton pages (ch16 S9, S26): one tab in the whole app, whatever the disposition', () => {
  it('activates the existing tab for every disposition, announces nothing to move for Background, and hands Window back as a request', () => {
    const h = boot();
    const home = h.current();
    const s = h.open(hostPage('settings'), { how: 'new' });
    expect(tab(h, s).location.key).toBe('host:settings');

    h.store.activate(home);
    expect(h.store.open(hostPage('settings'), { how: 'new' })).toMatchObject({ status: 'done', id: s, change: 'activated', focused: true });
    expect(h.active()).toBe(s);

    h.store.activate(home);
    expect(h.store.open(hostPage('settings'), { how: 'background' })).toMatchObject({ status: 'done', id: s, change: 'activated', focused: false });
    expect(h.active()).toBe(home);

    expect(h.store.open(hostPage('settings'), { how: 'here' })).toMatchObject({ status: 'done', id: s, change: 'activated' });
    expect(h.ids().filter((id) => tab(h, id).location.key === 'host:settings')).toHaveLength(1);
    expect(tab(h, home).history.entries).toHaveLength(1);

    // Window: the existing tab is what would move; the model has no window to move it to.
    h.store.activate(home);
    const before = h.state();
    expect(h.store.open(hostPage('settings'), { how: 'window' })).toMatchObject({ status: 'window', existing: s });
    expect(h.state()).toBe(before);

    expect(h.store.duplicate(s)).toMatchObject({ status: 'refused', reason: 'singleton' });
    sound(h);
  });
});

describe('preview tabs (ch16 S24)', () => {
  it('opens a search result as a preview, replaces it in place by the next preview, and makes it permanent on keep, pin and a second navigation', () => {
    const h = boot({ home: false });
    h.open(cloudPage('instances'));
    const p1 = h.open(stackPage('services'), { source: 'search' });
    expect(tab(h, p1).flags.preview).toBe(true);

    // The same plugin as the tab on screen: step 2 navigates the preview in place, which is a second navigation inside the page and keeps it.
    const p2 = h.open(stackPage('nodes'), { source: 'search' });
    expect(p2).toBe(p1);
    expect(tab(h, p1).flags.preview).toBe(false);

    const p3 = h.open(hostPage('home'), { source: 'search' });
    expect(tab(h, p3).flags.preview).toBe(true);
    const p3Index = h.ids().indexOf(p3);
    const p4 = h.open(cloudPage('buckets'), { source: 'search' });
    expect(h.state().tabs[p3]).toBeUndefined();
    expect(tab(h, p4).flags.preview).toBe(true);
    expect(h.ids().filter((id) => tab(h, id).flags.preview)).toEqual([p4]);
    expect(h.ids().indexOf(p4)).toBe(p3Index);
    expect(h.state().closed).toHaveLength(0);

    h.store.keep(p4);
    expect(tab(h, p4).flags.preview).toBe(false);
    const p5 = h.open(stackPage('services'), { source: 'search' });
    expect(p5).not.toBe(p4);
    expect(h.state().tabs[p4]).toBeDefined();

    h.store.pin(p5);
    expect(tab(h, p5).flags.preview).toBe(false);
    sound(h);
  });

  it('follows the settings: always a new tab, always the current tab, and no reuse', () => {
    const h = boot({ home: false });
    h.open(cloudPage('instances'));
    h.preferences.openResults = 'new-tab';
    const n1 = h.open(stackPage('services'), { source: 'search' });
    expect(tab(h, n1).flags.preview).toBe(false);

    h.preferences.openResults = 'current-tab';
    const current = h.active();
    expect(h.open(cloudPage('volumes'), { source: 'search' })).toBe(current);

    h.preferences.openResults = 'smart';
    h.preferences.reusePreview = false;
    const n2 = h.open(hostPage('plugins'), { source: 'search' });
    expect(tab(h, n2).flags.preview).toBe(false);
    sound(h);
  });
});

describe('the disposition of a click or key (ch16 S64)', () => {
  const key = (modifiers: Parameters<typeof dispositionOf>[0], plain?: Parameters<typeof dispositionOf>[1]) => dispositionOf({ metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers }, plain);

  it('maps the modifiers on macOS: Command, Shift, Option and the middle button', () => {
    const mac = { platform: 'mac' } as const;
    expect(key({}, mac)).toBe('smart');
    expect(key({}, { platform: 'mac', plain: 'new' })).toBe('new');
    expect(key({ altKey: true }, mac)).toBe('here');
    expect(key({ metaKey: true }, mac)).toBe('background');
    expect(key({ metaKey: true, shiftKey: true }, mac)).toBe('new');
    expect(key({ shiftKey: true }, mac)).toBe('window');
    expect(key({ button: 1 }, mac)).toBe('background');
    expect(key({ type: 'auxclick' }, mac)).toBe('background');
    expect(key({ ctrlKey: true }, mac)).toBe('smart');
    expect(dispositionOf(undefined, mac)).toBe('smart');
  });

  it('maps Control to the command key elsewhere', () => {
    const other = { platform: 'other' } as const;
    expect(key({ ctrlKey: true }, other)).toBe('background');
    expect(key({ ctrlKey: true, shiftKey: true }, other)).toBe('new');
    expect(key({ metaKey: true }, other)).toBe('smart');
  });
});

describe('availability (ch16 S65)', () => {
  it('refuses an unavailable destination with its reason, and opens a degraded one', () => {
    const h = boot();
    h.world.report('stack', { state: 'unavailable', reason: 'Stack needs an update: it was built for an older version of Omniview' });
    const before = h.state();
    expect(h.store.open(stackPage('services'))).toEqual({ status: 'refused', reason: 'unavailable', message: 'Stack needs an update: it was built for an older version of Omniview' });
    expect(h.state()).toBe(before);

    h.world.report('stack', { state: 'degraded', reason: 'exit 1' });
    expect(h.store.open(stackPage('services'))).toMatchObject({ status: 'done', change: 'created' });
    sound(h);
  });

  it('refuses a plugin nobody has installed, by name', () => {
    const h = boot();
    expect(h.store.open(dest('ghost', 'page'))).toMatchObject({ status: 'refused', reason: 'unavailable', message: 'ghost is not installed' });
  });

  it('refuses a route that is not valid data, and a destination the plugin will not complete', () => {
    const h = boot();
    expect(h.store.open({ route: { plugin: '', contribution: 'x' } })).toMatchObject({ status: 'refused', reason: 'invalid' });
    expect(h.store.open({ route: { plugin: 'cloud', contribution: 'x', params: { f: notJson } } })).toMatchObject({ status: 'refused', reason: 'invalid' });
    h.world.report('cloud', undefined);
    const strict = makeWorld();
    const s = boot({ world: strict });
    strict.install({ id: 'strict', name: 'Strict', describe: () => ({ title: 'Strict' }), complete: () => undefined });
    expect(s.store.open(dest('strict', 'x'))).toMatchObject({ status: 'refused', reason: 'unavailable' });
  });
});

describe('a plugin that throws never breaks the model (ch16 S89)', () => {
  it('opens a page whose plugin throws with the title the route gives it, and reports the failure once per call', () => {
    const h = boot({ home: false });
    const a = h.open(dest('broken', 'my-page'));
    expect(tab(h, a).face.title).toBe('My page');
    expect(tab(h, a).location.key.startsWith('broken:')).toBe(true);
    expect(h.errors.length).toBeGreaterThan(0);
    expect(h.errors.every((e) => e.where.length > 0)).toBe(true);
    h.store.activate(a);
    sound(h);
  });

  it('leaves the strip empty, not broken, when the window home throws', () => {
    const world = makeWorld();
    world.install({ id: 'host', name: 'Omniview', describe: () => ({ title: 'Home' }), home: () => {
      throw new Error('home'); 
    } });
    const h = boot({ world });
    expect(h.ids()).toEqual([]);
    expect(h.errors.length).toBeGreaterThan(0);
    sound(h);
  });
});

describe('reveal requests (ch16 K1): what an open asks the page to show', () => {
  const settingsFirst = () => {
    const h = boot({ home: false });
    const s = h.open(hostPage('settings'));
    const a = h.open(cloudPage('instances'));
    h.store.activate(a);
    return { h, s, a };
  };

  const revealOf = (h: Harness, id: string) => h.store.selectors.reveal(h.state(), id);

  it('points an open singleton at the route and asks the page, in one transaction with the activation', () => {
    const { h, s } = settingsFirst();
    const notified: number[] = [];
    h.store.subscribe(() => notified.push(1));
    const result = h.store.open(hostPage('settings', { section: 'developer', row: 'enabled' }, { flash: true }));
    expect(result).toMatchObject({ status: 'done', id: s, change: 'navigated', focused: true });
    expect(notified).toHaveLength(1);
    expect(h.active()).toBe(s);
    expect(tab(h, s).location.route.params).toEqual({ section: 'developer', row: 'enabled' });
    expect(tab(h, s).history.index).toBe(1);
    expect(tab(h, s).pageState).toBeNull();
    expect(revealOf(h, s)).toMatchObject({ route: { params: { section: 'developer', row: 'enabled' } }, payload: { flash: true }, fresh: false, navigated: true, how: 'smart', source: 'api' });
    sound(h);

    // Another row: navigated again.
    h.store.open(hostPage('settings', { section: 'developer', row: 'pprof' }));
    expect(tab(h, s).history.index).toBe(2);
    expect(revealOf(h, s)?.navigated).toBe(true);

    // The same route again: no navigation and no history, and the page is still asked.
    const first = revealOf(h, s);
    h.store.consumeReveal(s, first?.seq ?? -1);
    expect(revealOf(h, s)).toBeUndefined();
    h.store.open(hostPage('settings', { section: 'developer', row: 'pprof' }));
    expect(tab(h, s).history.index).toBe(2);
    expect(revealOf(h, s)).toMatchObject({ navigated: false, fresh: false });

    // A bare open says nothing: the page the user is on stays, and nobody is asked.
    h.store.consumeReveal(s, revealOf(h, s)?.seq ?? -1);
    h.store.open(hostPage('settings'));
    expect(tab(h, s).location.route.params).toEqual({ section: 'developer', row: 'pprof' });
    expect(revealOf(h, s)).toBeUndefined();

    // A request the tab already satisfies is not a navigation.
    h.store.open(hostPage('settings', { section: 'developer' }));
    expect(tab(h, s).history.index).toBe(2);
    sound(h);
  });

  it('asks for a tab it just made (fresh), and leaves a plain open of a page alone', () => {
    const h = boot({ home: false });
    h.open(cloudPage('instances'));
    const id = h.open(hostPage('plugins', { section: 'updates' }, { filter: 'updates' }));
    expect(tab(h, id).location.key).toBe('host:plugins');
    expect(revealOf(h, id)).toMatchObject({ payload: { filter: 'updates' }, fresh: true, navigated: false });

    const bare = h.open(cloudPage('buckets'), { how: 'new' });
    expect(revealOf(h, bare)).toBeUndefined();

    // An empty member of a route says nothing.
    const result = h.store.open(hostPage('settings', { section: 'developer', row: '' }, { a: 1 }));
    expect(result.status).toBe('done');
    const settings = doneId(result);
    expect(tab(h, settings).location.route.params).toEqual({ section: 'developer' });
    expect(revealOf(h, settings)?.payload).toEqual({ a: 1 });
    sound(h);
  });

  it('applies the route to a clean singleton from Background without taking the focus, and keeps the request until the tab is shown', () => {
    const { h, s, a } = settingsFirst();
    expect(h.store.open(hostPage('settings', { section: 'telemetry' }), { how: 'background' })).toMatchObject({ status: 'done', id: s, change: 'navigated', focused: false });
    expect(h.active()).toBe(a);
    expect(tab(h, s).location.route.params).toEqual({ section: 'telemetry' });
    expect(revealOf(h, s)).toMatchObject({ how: 'background', navigated: true });

    // Back drops what was never delivered.
    h.store.open(hostPage('settings', { section: 'about' }), { how: 'background' });
    h.store.back(s);
    expect(revealOf(h, s)).toBeUndefined();

    // Closing the tab drops it too.
    h.store.open(hostPage('settings', { section: 'about' }), { how: 'background' });
    expect(revealOf(h, s)).toBeDefined();
    h.store.close(s);
    expect(h.state().tabs[s]).toBeUndefined();
    sound(h);
  });

  it('activates a singleton with unsaved changes first and then asks to discard them; Background leaves it alone', () => {
    const { h, s, a } = settingsFirst();
    h.store.setUnsaved(s, true);
    const before = tab(h, s).location.route;
    expect(h.store.open(hostPage('settings', { section: 'telemetry' }), { how: 'background' })).toMatchObject({ status: 'done', id: s, focused: false });
    expect(tab(h, s).location.route).toBe(before);
    expect(h.active()).toBe(a);

    const asked = h.store.open(hostPage('settings', { section: 'telemetry', row: 'endpoint' }, { x: 1 }));
    expect(asked).toEqual({ status: 'confirm', action: 'navigate', tabs: [s] });
    expect(h.active()).toBe(s);
    expect(tab(h, s).location.route).toBe(before);
    expect(revealOf(h, s)).toBeUndefined();

    // The user chose to discard: the same open, confirmed.
    expect(h.store.open(hostPage('settings', { section: 'telemetry', row: 'endpoint' }, { x: 1 }), { confirmed: true })).toMatchObject({ status: 'done', id: s, change: 'navigated' });
    expect(tab(h, s).location.route.params).toEqual({ section: 'telemetry', row: 'endpoint' });
    expect(tab(h, s).flags.unsaved).toBe(false);
    expect(revealOf(h, s)?.payload).toEqual({ x: 1 });
    sound(h);
  });

  it('keeps "go where it already is" for an ordinary page and still passes the request on', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances', { item: 'i-1' }));
    h.open(hostPage('settings'));
    const before = tab(h, a).history.index;
    const result = h.store.open(cloudPage('instances', { item: 'i-1', tab: 'Storage' }));
    expect(result).toMatchObject({ status: 'done', id: a, change: 'activated' });
    expect(tab(h, a).history.index).toBe(before);
    expect(revealOf(h, a)).toMatchObject({ route: { params: { item: 'i-1', tab: 'Storage' } }, navigated: false });
    sound(h);
  });

  it('restores a singleton from the last session and asks its page once for a link that names a row', () => {
    const first = boot({ home: false });
    first.open(hostPage('settings'));
    first.open(cloudPage('instances'));
    const restored = restoreTabs(first.store.serialise(), { contributions: first.world.contributions });
    if (!restored.ok) {
      throw new Error(`the session was not restored: ${restored.reason}`);
    }

    const second = boot({ home: false, initial: restored.state, world: first.world });
    const s = second.ids().find((id) => tab(second, id).location.key === 'host:settings');
    if (s === undefined) {
      throw new Error('the singleton did not come back');
    }

    const { selectors } = second.store;
    expect(selectors.reveal(second.state(), s)).toBeUndefined();

    // A link at start-up names a row of the page that is already open: that tab is adopted and its page asked, once.
    expect(second.store.open(hostPage('settings', { section: 'terminal' }), { source: 'link' })).toMatchObject({ status: 'done', id: s, change: 'navigated' });
    expect(selectors.reveal(second.state(), s)).toMatchObject({ navigated: true, source: 'link' });
    second.store.consumeReveal(s, selectors.reveal(second.state(), s)?.seq ?? -1);
    expect(selectors.reveal(second.state(), s)).toBeUndefined();
    expect(second.ids()).toHaveLength(2);

    // A bare link and a start with no link ask nobody.
    second.store.open(hostPage('settings'));
    expect(selectors.reveal(second.state(), s)).toBeUndefined();
    sound(second);
  });
});
