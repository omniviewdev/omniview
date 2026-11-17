import { describe, expect, it, vi } from 'vitest';
import { checkInvariants } from './index';
import { boot, cloudPage, doneId, stackPage } from './testing';

// Every operation is O(1) or O(tabs), and asks the plugins a fixed number of questions (docs/ui-next/optimisations.md HSH-24: a router event at one path made the
// old shell re-render the strip, the panes and the persistence). 500 open tabs is far past anything a person keeps and must still be cheap.

const TABS = 500;
/** Generous on purpose: this guards against a quadratic loop (seconds), not against a slow machine. The run measured is in docs/ui-next/status/S1a.md. */
const BUDGET_MS = 2000;

describe('500 open tabs', () => {
  it('open, show, pin, navigate and close within a small time bound, with a strip, a page host and a breadcrumb subscribed', () => {
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
    const ids = Array.from({ length: TABS }, (_, i) => h.open(i % 2 === 0 ? cloudPage('instances', { item: `i-${i}` }) : stackPage('service', { name: `n-${i}`, group: `g-${i % 7}`, connection: `c-${i % 3}` }), { how: 'new' }));
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
    expect(elapsed).toBeLessThan(BUDGET_MS);
  });

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
    const h = boot({ home: false });
    const first = h.open(cloudPage('instances', { item: 'i-0' }), { how: 'new' });
    for (let i = 1; i < TABS; i += 1) {
      h.open(cloudPage('instances', { item: `i-${i}` }), { how: 'new' });
    }

    const started = performance.now();
    for (let i = 0; i < TABS; i += 1) {
      expect(doneId(h.store.open(cloudPage('instances', { item: 'i-0' })))).toBe(first);
    }

    expect(performance.now() - started).toBeLessThan(BUDGET_MS);
  });
});
