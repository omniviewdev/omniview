import { describe, expect, it } from 'vitest';
import { checkInvariants, LIMITS } from './index';
import { boot, cloudPage, stackPage, tabOf, type Harness } from './testing';

// Each tab's own back and forward stack (ch16 S60, S50), and Reload (S44).
// Ported from the design lab's harness (tests/shell-model-harness/R2Store/unit.cjs).

const sound = (h: Harness) => {
  expect(checkInvariants(h.state())).toEqual([]); 
};

const tab = tabOf;

describe('history (ch16 S60)', () => {
  it('pushes on a navigation, replaces on an in-page change and a scope change, walks with Back and Forward, and is the same after tabs switch', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances', { region: 'r1' }));
    h.store.navigate(a, cloudPage('instances', { region: 'r1', item: 'i-1' }));
    h.store.navigate(a, cloudPage('instances', { region: 'r1', item: 'i-2' }));
    expect([tab(h, a).history.index, tab(h, a).history.entries.length, tab(h, a).face.title]).toEqual([2, 3, 'i-2']);
    expect(h.store.canBack(a)).toBe(true);
    expect(h.store.canForward(a)).toBe(false);

    // A change inside the page (a sub-tab) replaces the current entry and is not identity: the key stays.
    const keyBefore = tab(h, a).location.key;
    expect(h.store.replace(a, { plugin: 'cloud', contribution: 'instances', params: { region: 'r1', item: 'i-2', tab: 'monitoring' } })).toMatchObject({ status: 'done' });
    expect([tab(h, a).history.index, tab(h, a).history.entries.length, tab(h, a).location.route.params.tab]).toEqual([2, 3, 'monitoring']);
    expect(tab(h, a).location.key).toBe(keyBefore);

    // A scope change replaces too, and changes the key.
    h.store.replace(a, { plugin: 'cloud', contribution: 'instances', params: { region: 'r2', item: 'i-2', tab: 'monitoring' } });
    expect([tab(h, a).history.index, tab(h, a).history.entries.length, tab(h, a).face.scope?.label]).toEqual([2, 3, 'r2']);
    expect(tab(h, a).location.key).not.toBe(keyBefore);

    // Switching to another tab and back leaves the history alone.
    h.open(stackPage('services'));
    h.store.activate(a);
    expect(tab(h, a).history.index).toBe(2);
    expect(h.store.historyList(a, 'back').map((item) => item.title)).toEqual(['i-1', 'Instances']);

    // Back and Forward: the entry carries its own scope.
    expect(h.store.back(a)).toMatchObject({ status: 'done', id: a });
    expect(tab(h, a).location.route.params).toEqual({ region: 'r1', item: 'i-1' });
    expect(tab(h, a).history.index).toBe(1);
    expect(tab(h, a).face.scope?.label).toBe('r1');
    expect(tab(h, a).face.title).toBe('i-1');
    h.store.back(a);
    expect(h.store.back(a)).toEqual({ status: 'noop' });
    expect(h.store.canBack(a)).toBe(false);
    h.store.forward(a);
    h.store.forward(a);
    expect(tab(h, a).history.index).toBe(2);
    expect(h.store.forward(a)).toEqual({ status: 'noop' });
    expect(h.store.historyList(a, 'back').map((item) => item.title)).toEqual(['i-1', 'Instances']);
    expect(h.store.historyList(a, 'forward')).toEqual([]);

    // A navigation after Back drops the forward entries.
    h.store.back(a);
    h.store.navigate(a, cloudPage('volumes'));
    expect([tab(h, a).history.index, tab(h, a).history.entries.length]).toEqual([2, 3]);
    expect(h.store.canForward(a)).toBe(false);
    sound(h);
  });

  it('lists the titles ahead, nearest first, with the index each step goes to', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances'));
    for (const item of ['i-1', 'i-2', 'i-3']) {
      h.store.navigate(a, cloudPage('instances', { item }));
    }

    h.store.back(a);
    h.store.back(a);
    h.store.back(a);
    expect(h.store.historyList(a, 'forward').map((entry) => [entry.index, entry.title])).toEqual([[1, 'i-1'], [2, 'i-2'], [3, 'i-3']]);
    expect(h.store.historyList(a, 'back')).toEqual([]);
    expect(h.store.historyList('nope', 'back')).toEqual([]);
  });

  it('keeps 50 entries and lists 10', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances'));
    for (let i = 0; i < 70; i += 1) {
      h.store.navigate(a, cloudPage('instances', { item: `i-${i}` }));
    }

    const history = tab(h, a).history;
    expect([history.entries.length, history.index]).toEqual([LIMITS.history, 49]);
    expect(history.entries[49]?.params.item).toBe('i-69');
    expect(history.entries[0]?.params.item).toBe('i-20');
    expect(h.store.historyList(a, 'back')).toHaveLength(LIMITS.historyList);
    sound(h);
  });

  it('pushes nothing for a navigation to the route the tab already shows', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances', { item: 'i-1' }));
    const before = h.state();
    expect(h.store.navigate(a, cloudPage('instances', { item: 'i-1' }))).toEqual({ status: 'noop' });
    expect(h.store.replace(a, { plugin: 'cloud', contribution: 'instances', params: { item: 'i-1' } })).toEqual({ status: 'noop' });
    expect(h.state()).toBe(before);
  });

  it('lets a scope change replace the entry instead of pushing one, drop the page state and make a preview permanent, after a guard', () => {
    const h = boot({ home: false });
    const a = h.open(stackPage('services', { connection: 'one' }), { source: 'search' });
    expect(tab(h, a).flags.preview).toBe(true);
    h.store.setPageState(a, { selected: 3 });
    h.store.setUnsaved(a, true);

    const target = stackPage('services', { connection: 'two' });
    expect(h.store.navigate(a, target, { history: 'replace' })).toEqual({ status: 'confirm', action: 'navigate', tabs: [a] });
    expect(h.store.navigate(a, target, { history: 'replace', confirmed: true })).toMatchObject({ status: 'done', id: a });
    expect(tab(h, a).history.entries).toHaveLength(1);
    expect(tab(h, a).face.scope?.label).toBe('two');
    expect(tab(h, a).pageState).toBeNull();
    expect(tab(h, a).flags).toMatchObject({ preview: false, unsaved: false });
    sound(h);
  });

  it('gives the page it steps to what that page kept when it was left, and a clean page when it kept nothing (the rest of the rule is in historyState.test.ts)', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances'));
    h.store.navigate(a, cloudPage('instances', { item: 'i-1' }));
    h.store.setPageState(a, { x: 1 });
    h.store.back(a);
    expect(tab(h, a).pageState).toBeNull();
    h.store.forward(a);
    expect(tab(h, a).pageState).toEqual({ x: 1 });
  });

  it('refuses a step for a tab that is not there', () => {
    const h = boot();
    expect(h.store.back('nope')).toMatchObject({ status: 'refused', reason: 'missing' });
    expect(h.store.forward('nope')).toMatchObject({ status: 'refused', reason: 'missing' });
    expect(h.store.canBack('nope')).toBe(false);
  });
});

describe('reload (ch16 S44)', () => {
  it('draws the page again without changing the route, the history or the page state', () => {
    const h = boot({ home: false });
    const a = h.open(cloudPage('instances'));
    h.store.setPageState(a, { scroll: 40 });
    const before = tab(h, a);
    expect(h.store.reload(a)).toMatchObject({ status: 'done', id: a });
    expect(tab(h, a).location.generation).toBe(before.location.generation + 1);
    expect(tab(h, a).location.route).toBe(before.location.route);
    expect(tab(h, a).history).toBe(before.history);
    expect(tab(h, a).pageState).toEqual({ scroll: 40 });
    expect(h.store.reload('nope')).toMatchObject({ status: 'refused', reason: 'missing' });
    sound(h);
  });
});
