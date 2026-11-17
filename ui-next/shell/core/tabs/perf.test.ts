import { describe, expect, it, vi } from 'vitest';
import { checkInvariants } from './index';
import { boot, cloudPage, doneId, stackPage, type Harness } from './testing';

// Every operation is O(1) or O(tabs), and asks the plugins a fixed number of questions (docs/ui-next/optimisations.md HSH-24: a router event at one path made the
// old shell re-render the strip, the panes and the persistence). 500 open tabs is far past anything a person keeps and must still be cheap.

const TABS = 500;

/**
 * The bound on the whole scenario below: about 1,770 operations, 1,270 of which change the strip that is subscribed. It costs about 120 ms on the machine this was written on (45 ms
 * for the operations alone) and the continuous-integration runner needs about five times that while the whole suite runs at once. The bound guards against a quadratic loop or a
 * constant of another order, which cost seconds; the measured numbers are in docs/ui-next/status/S1a.md. The first version of this test failed on the runner at 2.3 s against this
 * same bound: the scenario then cost 460 ms here, because the strip made every tab's identity again at every change. That is fixed in the model; the bound did not move.
 */
const BUDGET_MS = 2000;
/** A run that a busy machine slowed down says nothing about the model, and a model that is slow is slow in every run: the fastest of a few runs is what is compared with the bound. */
const RUNS = 3;
const TIMEOUT_MS = 30_000;

/** The time of the fastest run, stopping at the first one inside the bound. */
function fastest(run: () => number): number {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < RUNS && best >= BUDGET_MS; attempt += 1) {
    best = Math.min(best, run());
  }

  return best;
}

const openAll = (h: Harness, count: number) =>
  Array.from({ length: count }, (_, i) => h.open(i % 2 === 0 ? cloudPage('instances', { item: `i-${i}` }) : stackPage('service', { name: `n-${i}`, group: `g-${i % 7}`, connection: `c-${i % 3}` }), { how: 'new' }));

/** One run: 500 tabs opened, shown, pinned, navigated and closed, with a strip, a page host and a breadcrumb subscribed. Its answer is the time the operations took. */
function scenario(): number {
  const h = boot({ home: false });
  const { selectors } = h.store;
  const seen = { strip: 0, mounted: 0, breadcrumb: 0 };
  h.store.subscribeTo(selectors.strip, () => {
    seen.strip += 1;
  });
  h.store.subscribeTo(selectors.mounted, () => {
    seen.mounted += 1;
  });
  h.store.subscribeTo(selectors.breadcrumb, () => {
    seen.breadcrumb += 1;
  });

  const started = performance.now();
  const ids = openAll(h, TABS);
  expect(h.ids()).toHaveLength(TABS);

  // Showing every tab, with the strip's items read after each, as a mounted strip would.
  for (const id of ids) {
    h.store.activate(id);
    selectors.strip(h.state());
  }

  for (let i = 0; i < TABS; i += 5) {
    h.store.pin(ids[i] ?? '');
  }

  for (let i = 0; i < TABS; i += 3) {
    h.store.navigate(ids[i] ?? '', cloudPage('buckets', { item: `b-${i}` }));
  }

  for (const id of ids) {
    h.store.close(id);
  }

  const elapsed = performance.now() - started;
  expect(h.ids()).toHaveLength(0);
  expect(checkInvariants(h.state())).toEqual([]);
  expect(seen.strip).toBeGreaterThan(TABS);
  return elapsed;
}

describe('500 open tabs', () => {
  it('open, show, pin, navigate and close within a small time bound, with a strip, a page host and a breadcrumb subscribed', () => {
    expect(fastest(scenario)).toBeLessThan(BUDGET_MS);
  }, TIMEOUT_MS);

  it('keeps the work of each operation the same however many tabs there are: the same questions to the plugins, and nothing for a switch', () => {
    const questions = (tabs: number) => {
      const h = boot({ home: false });
      for (let i = 0; i < tabs; i += 1) {
        h.open(cloudPage('instances', { item: `i-${i}` }), { how: 'new' });
      }

      const asked = (run: () => void) => {
        const before = { ...h.world.calls };
        run();
        const after = h.world.calls;
        return { describe: after.describe - before.describe, availability: after.availability - before.availability, complete: after.complete - before.complete, home: after.home - before.home };
      };

      const last = h.ids()[tabs - 1] ?? '';
      const first = h.ids()[0] ?? '';
      return {
        open: asked(() => h.store.open(stackPage('services'), { how: 'new' })),
        navigate: asked(() => h.store.navigate(first, cloudPage('buckets'))),
        activate: asked(() => h.store.activate(last)),
        pin: asked(() => h.store.pin(first)),
        closeFirst: asked(() => h.store.close(first)),
        back: asked(() => h.store.back(last)),
      };
    };

    const small = questions(5);
    const large = questions(TABS);
    expect(large).toEqual(small);
    expect(small.open.describe).toBeLessThanOrEqual(1);
    expect(small.activate).toEqual({ describe: 0, availability: 0, complete: 0, home: 0 });
    expect(small.pin).toEqual({ describe: 0, availability: 0, complete: 0, home: 0 });
    expect(small.closeFirst).toEqual({ describe: 0, availability: 0, complete: 0, home: 0 });
  });

  it('describes the 500 tabs once when the plugins change, not once per consumer', () => {
    const h = boot({ home: false });
    for (let i = 0; i < TABS; i += 1) {
      h.open(cloudPage('instances', { item: `i-${i}` }), { how: 'new' });
    }

    const before = h.world.calls.describe;
    h.world.retitle('cloud', (_route, original) => `${original}!`);
    const listener = vi.fn();
    h.store.subscribe(listener);
    h.world.changed();
    expect(h.world.calls.describe - before).toBe(TABS);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('opens 500 tabs of one key quickly too: a deduplicated open finds its tab and changes nothing but the tab on screen', () => {
    const run = () => {
      const h = boot({ home: false });
      const first = h.open(cloudPage('instances', { item: 'i-0' }), { how: 'new' });
      for (let i = 1; i < TABS; i += 1) {
        h.open(cloudPage('instances', { item: `i-${i}` }), { how: 'new' });
      }

      const found: string[] = [];
      const started = performance.now();
      for (let i = 0; i < TABS; i += 1) {
        found.push(doneId(h.store.open(cloudPage('instances', { item: 'i-0' }))));
      }

      const elapsed = performance.now() - started;
      expect(found.every((id) => id === first)).toBe(true);
      return elapsed;
    };

    expect(fastest(run)).toBeLessThan(BUDGET_MS);
  }, TIMEOUT_MS);
});

describe('a change at 500 open tabs touches the answer of the tabs it touches', () => {
  // What a strip made of 500 components needs from a change is that it shows only in the tabs it touched: every other tab's item and identity is the same object, so none of them
  // renders again. This is that property at 500 tabs, counted in objects instead of milliseconds, so it holds on a machine of any speed.
  it('leaves the strip item and the identity of every other tab the same object after a pin, a navigation and a close', () => {
    const h = boot({ home: false });
    const { selectors } = h.store;
    const ids = openAll(h, TABS);
    const changedBy = (change: () => void): string[] => {
      const before = selectors.strip(h.state());
      const was = new Map(before.map((item) => [item.id, item]));
      change();
      return selectors.strip(h.state()).filter((item) => was.get(item.id) !== item).map((item) => item.id);
    };

    const pinned = ids[250] ?? '';
    expect(changedBy(() => h.store.pin(pinned))).toEqual([pinned]);

    const navigated = ids[10] ?? '';
    expect(changedBy(() => h.store.navigate(navigated, cloudPage('buckets', { item: 'b-10' })))).toEqual([navigated]);

    expect(changedBy(() => h.store.close(ids[400] ?? ''))).toEqual([]);

    // The same for what a page host reads: only the tab that moved has a new location.
    const open = h.ids();
    const locations = new Map(open.map((id) => [id, selectors.location(h.state(), id)]));
    h.store.navigate(ids[20] ?? '', cloudPage('buckets', { item: 'b-20' }));
    expect(open.filter((id) => selectors.location(h.state(), id) !== locations.get(id))).toEqual([ids[20]]);
  });

  it('keeps one tab\'s identity when only its face is described again with the same words (a change inside the page)', () => {
    const h = boot({ home: false });
    const { selectors } = h.store;
    const a = h.open(cloudPage('instances', { item: 'i-1' }), { how: 'new' });
    h.open(stackPage('services'), { how: 'new' });
    const identity = selectors.identity(h.state(), a);
    const item = selectors.stripItem(h.state(), a);
    expect(h.store.replace(a, { plugin: 'cloud', contribution: 'instances', params: { item: 'i-1', tab: 'storage' } }).status).toBe('done');
    expect(selectors.identity(h.state(), a)).toBe(identity);
    expect(selectors.stripItem(h.state(), a)).toBe(item);
  });
});
