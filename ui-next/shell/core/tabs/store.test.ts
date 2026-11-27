import { describe, expect, it, vi } from 'vitest';
import { checkInvariants, createTabsStore, STATE_VERSION } from './index';
import { boot, cloudPage, dest, doneId, hostPage, makeWorld, pageTabOf as tab, stackPage, type Harness } from './testing';

// The store: one immutable snapshot, subscribe, and a selector per consumer so that each re-renders for its own slice only (docs/ui-next/optimisations.md HSH-24, MNR-K2).

const sound = (h: Harness) => {
  expect(checkInvariants(h.state())).toEqual([]); 
};

describe('the snapshot', () => {
  it('is plain data with a version, frozen all the way down, and survives JSON', () => {
    const h = boot();
    h.open(cloudPage('instances', { region: 'us-east-1', item: 'i-1' }));
    const state = h.state();
    expect(state.version).toBe(STATE_VERSION);
    expect(JSON.parse(JSON.stringify(state))).toEqual(JSON.parse(JSON.stringify(state)));
    const id = h.current();
    for (const value of [state, state.tabs, state.order, state.mounted, state.closed, tab(h, id), tab(h, id).location, tab(h, id).location.route, tab(h, id).location.route.params, tab(h, id).face, tab(h, id).history, tab(h, id).history.entries, tab(h, id).flags]) {
      expect(Object.isFrozen(value)).toBe(true);
    }

    // A caller that tries to change it fails loudly; it does not corrupt the model.
    const order: string[] = state.order as string[]; // the type is readonly: the cast is the test's attempt to break it.
    expect(() => order.push('x')).toThrow(TypeError);
    sound(h);
  });

  it('is never changed by a later operation: a snapshot taken before is the same after', () => {
    const h = boot();
    h.open(cloudPage('instances'));
    const before = h.state();
    const json = JSON.stringify(before);
    const a = h.open(stackPage('services'));
    h.store.pin(a);
    h.store.navigate(a, stackPage('nodes'));
    h.store.setPageState(a, { x: 1 });
    h.store.close(a);
    expect(JSON.stringify(before)).toBe(json);
    expect(h.state()).not.toBe(before);
  });

  it('copies what a caller hands it, so a route or a payload changed afterwards cannot reach into a tab', () => {
    const h = boot({ home: false });
    const params: { item: string; nested: { n: number } } = { item: 'i-1', nested: { n: 1 } };
    const reveal = { flash: [1, 2] };
    const id = h.open({ route: { plugin: 'cloud', contribution: 'instances', params }, reveal });
    params.item = 'changed';
    params.nested.n = 2;
    reveal.flash.push(3);
    expect(tab(h, id).location.route.params).toEqual({ item: 'i-1', nested: { n: 1 } });
    expect(h.store.selectors.reveal(h.state(), id)?.payload).toEqual({ flash: [1, 2] });
  });
});

describe('subscribe', () => {
  it('tells each listener once per change, in order, and not at all when nothing changed', () => {
    const h = boot();
    const calls: string[] = [];
    const offA = h.store.subscribe(() => calls.push('a'));
    h.store.subscribe(() => calls.push('b'));
    const a = h.open(cloudPage('instances'));
    expect(calls).toEqual(['a', 'b']);

    calls.length = 0;
    h.store.activate(a);
    h.store.pin(a, false);
    h.store.keep(a);
    h.store.setUnsaved(a, false);
    h.store.refresh();
    expect(calls).toEqual([]);

    offA();
    h.store.pin(a);
    expect(calls).toEqual(['b']);
  });

  it('makes 10 reports of one route cause 0 notifications (MNR-K2)', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances', { item: 'i-1' }));
    const listener = vi.fn();
    h.store.subscribe(listener);
    const before = h.state();
    for (let i = 0; i < 10; i += 1) {
      h.store.replace(a, { plugin: 'cloud', contribution: 'instances', params: { item: 'i-1' } });
    }

    expect(listener).not.toHaveBeenCalled();
    expect(h.state()).toBe(before);
  });

  it('does not write for any operation that changes nothing (S112)', () => {
    const h = boot();
    const home = h.current();
    const a = h.open(cloudPage('instances'));
    const before = h.state();
    const listener = vi.fn();
    h.store.subscribe(listener);
    const index = h.ids().indexOf(a);
    const unchanged = [
      h.store.activate(a),
      h.store.pin(a, false),
      h.store.keep(a),
      h.store.reorder(a, index),
      h.store.back(a),
      h.store.forward(a),
      h.store.navigate(a, cloudPage('instances')),
      h.store.closeMany('right', a),
      h.store.closePlugin('nobody'),
      h.store.markAttention(a, 'error'),
      h.store.markAttention(home, false),
      h.store.setUnsaved(a, false),
      h.store.setPageState(a, null),
      h.store.consumeReveal(a, 7),
      h.store.refresh(),
      h.store.setKeepAlive({}),
    ];
    expect(unchanged.map((result) => (typeof result === 'object' ? result.status : result))).toEqual(['noop', 'noop', 'noop', 'noop', 'noop', 'noop', 'noop', 'noop', 'noop', false, false, false, false, false, false, false]);
    expect(h.state()).toBe(before);
    expect(listener).not.toHaveBeenCalled();
  });

  it('lets a listener unsubscribe, subscribe and operate while it is being called, and still delivers the change to the others', () => {
    const h = boot();
    const seen: number[] = [];
    const off = h.store.subscribe(() => {
      off();
      h.store.subscribe(() => seen.push(3));
      seen.push(1);
    });
    h.store.subscribe(() => seen.push(2));
    h.open(cloudPage('instances'));
    expect(seen).toEqual([1, 2]);
    h.open(stackPage('services'));
    expect(seen).toEqual([1, 2, 2, 3]);
  });

  it('tells a selector\'s listener only when its value changed', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances'));
    const b = h.open(stackPage('services'));
    const { selectors } = h.store;
    const forA = vi.fn();
    const forB = vi.fn();
    const forStrip = vi.fn();
    h.store.subscribeTo((state) => selectors.stripItem(state, a), forA);
    h.store.subscribeTo((state) => selectors.stripItem(state, b), forB);
    h.store.subscribeTo(selectors.strip, forStrip);

    h.store.pin(b);
    expect(forA).not.toHaveBeenCalled();
    expect(forB).toHaveBeenCalledTimes(1);
    expect(forStrip).toHaveBeenCalledTimes(1);

    // A page state is not on the strip at all.
    h.store.setPageState(a, { scroll: 4 });
    expect(forStrip).toHaveBeenCalledTimes(1);
    expect(forA).not.toHaveBeenCalled();
  });
});

describe('selectors: a tab strip, a page host and a breadcrumb each see their slice only', () => {
  it('keeps every selector\'s answer for another tab the same object when one tab\'s title changes', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances'));
    const b = h.open(stackPage('services'));
    const { selectors } = h.store;
    const before = h.state();

    h.world.retitle('cloud', (_route, original) => `${original} (renamed)`);
    h.world.changed();
    const after = h.state();

    expect(after).not.toBe(before);
    expect(tab(h, a).face.title).toBe('Instances (renamed)');
    // What a consumer of the other tab sees is the same object, so it does not render.
    expect(selectors.tab(after, b)).toBe(selectors.tab(before, b));
    expect(selectors.location(after, b)).toBe(selectors.location(before, b));
    expect(selectors.face(after, b)).toBe(selectors.face(before, b));
    expect(selectors.flags(after, b)).toBe(selectors.flags(before, b));
    expect(selectors.identity(after, b)).toBe(selectors.identity(before, b));
    expect(selectors.stripItem(after, b)).toBe(selectors.stripItem(before, b));
    expect(selectors.reveal(after, b)).toBe(selectors.reveal(before, b));
    // The tab that was renamed changed its face and nothing a page host reads.
    expect(selectors.face(after, a)).not.toBe(selectors.face(before, a));
    expect(selectors.stripItem(after, a)).not.toBe(selectors.stripItem(before, a));
    expect(selectors.location(after, a)).toBe(selectors.location(before, a));
    // The page host's list and the breadcrumb of the tab on screen (b) are untouched.
    expect(selectors.mounted(after)).toBe(selectors.mounted(before));
    expect(selectors.breadcrumb(after)).toBe(selectors.breadcrumb(before));
    // The strip is a new list that holds the same object for the tab that did not change.
    expect(selectors.strip(after)).not.toBe(selectors.strip(before));
    expect(selectors.strip(after)[1]).toBe(selectors.strip(before)[1]);
    sound(h);
  });

  it('does not notify the breadcrumb of the tab on screen when another tab changes, and does when its own path does', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances', { region: 'r1' }));
    const b = h.open(stackPage('services', { connection: 'one' }));
    const crumbs = vi.fn();
    h.store.subscribeTo(h.store.selectors.breadcrumb, crumbs);

    h.store.pin(a);
    h.store.setPageState(a, { x: 1 });
    h.store.markAttention(a, 'warning');
    expect(crumbs).not.toHaveBeenCalled();

    h.store.navigate(b, stackPage('nodes', { connection: 'one' }));
    expect(crumbs).toHaveBeenCalledTimes(1);
    expect(h.store.selectors.breadcrumb(h.state())?.crumbs.map((crumb) => crumb.label)).toEqual(['Stack', 'one', 'Services']);
    expect(h.store.selectors.breadcrumb(h.state())?.tab).toBe(b);
  });

  it('answers the same list for the same snapshot, and keeps the strip\'s items when only the order changed', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances'));
    const b = h.open(stackPage('services'));
    const { selectors } = h.store;
    expect(selectors.strip(h.state())).toBe(selectors.strip(h.state()));
    const [first, second] = selectors.strip(h.state());
    h.store.pin(b);
    const strip = selectors.strip(h.state());
    expect(strip.map((entry) => entry.id)).toEqual([b, a]);
    expect(strip[1]).toBe(first);
    expect(strip[0]).not.toBe(second);
    expect(strip[0]?.pinned).toBe(true);
  });

  it('has no answer for a tab that is not there', () => {
    const h = boot();
    const { selectors } = h.store;
    for (const answer of [selectors.tab, selectors.location, selectors.face, selectors.flags, selectors.reveal, selectors.identity, selectors.stripItem]) {
      expect(answer(h.state(), 'nope')).toBeUndefined();
    }
  });

  it('gives a breadcrumb only while a tab is on screen', () => {
    const h = boot({ home: false });
    expect(h.store.selectors.breadcrumb(h.state())).toBeUndefined();
    expect(h.store.selectors.strip(h.state())).toEqual([]);
    const a = h.open(hostPage('settings'));
    expect(h.store.selectors.breadcrumb(h.state())).toEqual({ tab: a, crumbs: [] });
  });
});

describe('the plugins changed (the host subscribes the model to them)', () => {
  it('describes the tabs again when a plugin says it changed, and tells nobody when nothing it says is different', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances'));
    const listener = vi.fn();
    h.store.subscribe(listener);
    h.world.changed();
    expect(listener).not.toHaveBeenCalled();

    h.world.retitle('cloud', () => 'Machines');
    h.world.changed();
    expect(tab(h, a).face.title).toBe('Machines');
    expect(listener).toHaveBeenCalledTimes(1);
    expect(h.store.refresh('cloud')).toBe(false);
  });

  it('keeps a tab, its route and its page state when its plugin becomes unavailable and again when it recovers (S89)', () => {
    const h = boot();
    const a = h.open(cloudPage('instances'));
    const k = h.open(stackPage('services'));
    h.store.setPageState(a, { x: 1 });
    const route = tab(h, a).location.route;
    h.world.report('cloud', { state: 'unavailable', reason: 'Cloud failed' });
    h.world.changed();
    h.world.report('cloud', undefined);
    h.world.changed();
    expect(tab(h, a).location.route).toBe(route);
    expect(tab(h, a).pageState).toEqual({ x: 1 });
    expect(tab(h, k).face.title).toBe('Services');
    sound(h);
  });

  it('opens the home page when the first plugin that can serve it arrives, once: the window has started then, and stops listening on dispose', () => {
    const world = makeWorld();
    world.setHome(false);
    const h = boot({ home: false, world });
    expect(h.ids()).toEqual([]);
    expect(h.state().started).toBe(false);
    world.setHome(true);
    world.changed();
    expect(h.titles()).toEqual(['Home']);
    expect(h.state().started).toBe(true);
    h.store.dispose();
    world.retitle('host', () => 'Elsewhere');
    world.changed();
    expect(h.titles()).toEqual(['Home']);
  });

  it('names a tab opened at a plugin that is loading by its stand-in, and a stand-in never takes the face of a tab that has one', () => {
    const world = makeWorld();
    let phase: 'loading' | 'ready' = 'loading';
    world.install({
      id: 'later',
      name: 'Later',
      describe: (route) => (phase === 'ready' ? { title: `Real ${route.contribution}`, icon: 'clock' } : { title: 'Later', icon: 'box', provisional: true }),
    });
    const h = boot({ home: false, world });
    const a = h.open(dest('later', 'one'));
    expect(tab(h, a).face).toMatchObject({ title: 'Later', icon: 'box' });
    phase = 'ready';
    world.changed();
    expect(tab(h, a).face).toMatchObject({ title: 'Real one', icon: 'clock' });
    // The plugin loads again (a retry, an upgrade): the stand-in leaves the face the tab has, and still names a tab that has none.
    phase = 'loading';
    world.changed();
    expect(tab(h, a).face).toMatchObject({ title: 'Real one', icon: 'clock' });
    const b = h.open(dest('later', 'two'), { how: 'new' });
    expect(tab(h, b).face).toMatchObject({ title: 'Later', icon: 'box' });
    sound(h);
  });

  it('does not open it again for a strip the user emptied, however the plugins change afterwards (decision A17)', () => {
    const world = makeWorld();
    const h = boot({ world });
    expect(h.titles()).toEqual(['Home']);
    h.store.close(h.current());
    expect(h.ids()).toEqual([]);

    world.changed();
    world.retitle('host', () => 'Elsewhere');
    world.changed();

    expect(h.ids()).toEqual([]);
    expect(h.state().started).toBe(true);
  });
});

describe('ids and independent stores', () => {
  it('never gives a tab an id that is live or closed, even from a generator that repeats', () => {
    const world = makeWorld();
    const ids = ['x', 'x', 'x', 'y', 'y', 'z'];
    const store = createTabsStore({ contributions: world.contributions, newId: () => ids.shift() ?? 'last' });
    expect(store.getSnapshot().order).toEqual(['x']);
    expect(doneId(store.open(cloudPage('instances')))).toBe('y');
    store.close('y');
    expect(doneId(store.open(stackPage('services')))).toBe('z');
    expect(checkInvariants(store.getSnapshot())).toEqual([]);
  });

  it('shares nothing between two stores', () => {
    const one = boot();
    const two = boot();
    one.open(cloudPage('instances'));
    expect(one.ids()).toHaveLength(2);
    expect(two.ids()).toHaveLength(1);
    expect(two.store.selectors).not.toBe(one.store.selectors);
  });

  it('refuses a destination of a plugin that is not installed, and keeps the tabs it already has when the plugin goes', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances'));
    h.world.uninstall('cloud');
    h.world.changed();
    expect(tab(h, a).face.title).toBe('Instances');
    expect(h.store.open(cloudPage('buckets'), { how: 'new' })).toMatchObject({ status: 'refused', reason: 'unavailable' });
    expect(h.ids()).toEqual([a]);
    sound(h);
  });
});
