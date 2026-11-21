import { describe, expect, it } from 'vitest';
import { checkInvariants, LIMITS, restoreTabs, type CloseScope, type Destination, type OpenHow } from './index';
import { boot, cloudPage, dest, hostPage, stackPage, type Harness } from './testing';

// Random operations keep every invariant (the harness's 4000-operation fuzz and its CO-20 fuzz of 3000 over singletons): after each one the strip is sound, one
// tab is on screen, and what the session would save comes back whole.

/** A small deterministic generator: the same run every time. */
function generator(seed: number) {
  let state = seed;
  const next = (n: number) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };

  const pick = <T>(list: readonly T[]): T => list[next(list.length)];
  return { next, pick };
}

const SINGLETONS = ['host:settings', 'host:plugins', 'host:devtools'];
const hows: readonly OpenHow[] = ['smart', 'here', 'new', 'background', 'window'];
const scopes: readonly CloseScope[] = ['others', 'right', 'left', 'unpinned'];

function problems(h: Harness): string[] {
  const state = h.state();
  const bad = checkInvariants(state);
  const counts = new Map<string, number>();
  for (const id of state.order) {
    const key = state.tabs[id]?.location.key ?? '';
    if (SINGLETONS.includes(key)) {
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
  }

  for (const [key, count] of counts) {
    if (count > 1) {
      bad.push(`${key} is open ${count} times`);
    }
  }

  if (state.active !== null && state.mounted[0] !== state.active) {
    bad.push('the tab on screen is not the first of the mounted tabs');
  }

  return bad;
}

describe('4000 random operations', () => {
  it('keep every invariant, and the saved session comes back whole', () => {
    const { next, pick } = generator(12345);
    const h = boot();
    const destinations: readonly Destination[] = [
      cloudPage('instances'),
      cloudPage('buckets'),
      cloudPage('volumes', { item: 'i-1' }),
      cloudPage('instances', { region: 'r1' }),
      cloudPage('instances', { region: 'r2', item: 'i-2' }),
      cloudPage('blank'),
      stackPage('services', { connection: 'one' }),
      stackPage('service', { name: 'api', group: 'shop', connection: 'one' }),
      stackPage('service', { name: 'api', group: 'cart', connection: 'two' }),
      hostPage('settings'),
      hostPage('settings', { section: 'developer' }, { flash: true }),
      hostPage('plugins'),
      hostPage('home'),
      dest('compute', 'instances'),
      dest('database', 'instances'),
      dest('broken', 'page'),
    ];
    const ids = () => h.ids();
    const any = () => pick(ids().length === 0 ? ['none'] : ids());
    const operations: ReadonlyArray<() => unknown> = [
      () => h.store.open(pick(destinations), { how: pick(hows), source: next(2) === 0 ? undefined : 'search', confirmed: next(3) === 0 }),
      () => h.store.close(any(), { confirmed: next(2) === 0 }),
      () => h.store.activate(any()),
      () => h.store.reopen(),
      () => h.store.duplicate(any()),
      () => h.store.pin(any()),
      () => h.store.reorder(any(), next(8), next(3) === 0 ? { pinned: next(2) === 0 } : undefined),
      () => h.store.closeMany(pick(scopes), any(), { confirmed: next(2) === 0 }),
      () => h.store.closePlugin(pick(['cloud', 'stack', 'host', 'compute']), { confirmed: true }),
      () => h.store.next(),
      () => h.store.previous(),
      () => h.store.goto(next(9)),
      () => h.store.last(),
      () => h.store.back(any(), { confirmed: next(2) === 0 }),
      () => h.store.forward(any(), { confirmed: true }),
      () => h.store.keep(any()),
      () => h.store.navigate(any(), pick(destinations), { history: next(4) === 0 ? 'replace' : 'push', confirmed: next(2) === 0 }),
      () => h.store.replace(any(), pick(destinations).route),
      () => h.store.reload(any(), { confirmed: true }),
      () => h.store.setUnsaved(any(), next(3) === 0),
      // What a page keeps (a small state, one with where it was scrolled, one that is only that, none, one that is over the limit and is refused): the saved states of the history stay in step with its entries whatever comes.
      () => h.store.setPageState(any(), pick<unknown>([{ n: next(5) }, { n: next(5), scroll: { top: next(900), left: 0 } }, { scroll: { top: next(900) } }, null, { pad: 'x'.repeat(LIMITS.pageStateBytes) }])),
      () => h.store.markAttention(any(), pick(['warning', 'error', false] as const)),
      () => h.store.consumeReveal(any(), next(40)),
      () => h.store.setKeepAlive({ cap: pick([1, 2, 3, 5, null]) }),
      () => {
        h.world.changed(); 
      },
    ];

    let emptied = 0;
    for (let i = 0; i < 4000; i += 1) {
      const k = next(operations.length);
      try {
        operations[k]?.();
      } catch (error) {
        throw new Error(`operation ${k} threw at step ${i}: ${String(error)}`, { cause: error });
      }

      const bad = problems(h);
      if (bad.length > 0) {
        throw new Error(`step ${i}, operation ${k}: ${bad.join('; ')}\n${JSON.stringify(h.state().order)}`);
      }

      expect(h.state().active === null).toBe(h.ids().length === 0);
      if (h.ids().length === 0) {
        emptied += 1;
      }

      if (i % 50 === 0) {
        const again = restoreTabs(JSON.parse(JSON.stringify(h.store.serialise())), { contributions: h.world.contributions, onError: () => undefined });
        if (h.ids().length === 0) {
          // A strip the user emptied is saved as nothing, and a window restored from nothing starts as a new one.
          expect(again).toMatchObject({ ok: false, reason: 'empty' });
          continue;
        }

        if (!again.ok) {
          throw new Error(`step ${i}: the saved session did not come back: ${again.reason}`);
        }

        expect(again.repaired).toBe(false);
        expect(again.state.order).toEqual(h.ids());
        expect(again.state.active).toBe(h.active());
      }
    }

    expect(emptied).toBeGreaterThan(0);
  });
});

describe('3000 random operations over singletons and ordinary pages (CO-20)', () => {
  it('leave one tab per singleton key in the whole app, and a tab on screen whenever there is a tab', () => {
    const { next, pick } = generator(7);
    const h = boot();
    const destinations: readonly Destination[] = [
      hostPage('settings'),
      hostPage('settings', { section: 'developer', row: 'enabled' }),
      hostPage('plugins'),
      hostPage('plugins', { section: 'updates' }, { x: 1 }),
      hostPage('devtools', { section: 'profiling' }),
      cloudPage('instances'),
      cloudPage('instances', { item: 'i-1' }),
      cloudPage('buckets'),
      stackPage('services'),
    ];
    for (let i = 0; i < 3000; i += 1) {
      const ids = h.ids();
      const any = () => pick(ids);
      const op = next(11);
      if (op < 5) {
        h.store.open(pick(destinations), { how: pick(hows), source: pick(['link', 'menu', 'search', 'api']) });
      } else if (op === 5 && ids.length > 1) {
        h.store.close(any(), { confirmed: true });
      } else if (op === 6) {
        h.store.reopen();
      } else if (op === 7) {
        h.store.duplicate(any());
      } else if (op === 8) {
        h.store.pin(any());
      } else if (op === 9) {
        h.store.closeMany(pick(scopes), any(), { confirmed: true });
      } else {
        h.store.activate(any());
      }

      const bad = problems(h);
      if (bad.length > 0) {
        throw new Error(`operation ${i} (${op}): ${bad.join('; ')}`);
      }

      expect(h.active() === null).toBe(h.ids().length === 0);
    }
  });
});
