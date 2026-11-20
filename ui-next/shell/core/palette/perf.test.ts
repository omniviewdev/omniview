import { describe, expect, it } from 'vitest';
import { wordsOf } from './match';
import { rank } from './rank';
import { commands, makePalette, resource } from './testing';
import type { Candidate, Provider } from './types';

// Performance: ranking is local only for what is small and static, and it must not be felt. Ten thousand commands ranked for a 1-, 3- and 8-character query (the pure ranking, and the
// whole path of a keystroke through the store), a provider that returns five thousand rows, and a provider that takes 300 ms of REAL time while the user keeps typing. The bounds are
// generous (a laptop measures a tenth of them): a shared runner is several times slower, and the fastest of three runs is compared with the bound, as the tab model's `perf.test.ts` does.

const BOUND = 100;
const QUERIES: ReadonlyArray<readonly [number, string]> = [
  [1, 't'],
  [3, 'tog'],
  [8, 'toggle p'],
];

const fastest = (run: () => void, tries = 3): number => {
  let best = Number.POSITIVE_INFINITY;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const start = performance.now();
    run();
    best = Math.min(best, performance.now() - start);
  }

  return best;
};

describe('ten thousand static commands', () => {
  const all = commands(10_000);

  for (const [length, query] of QUERIES) {
    it(`rank a ${String(length)}-character query (${JSON.stringify(query)}) in under ${String(BOUND)} ms`, () => {
      const words = wordsOf(query);
      const found = rank([{ owner: 'host:commands', candidates: all }], words, 6);
      expect(found.total).toBeGreaterThan(0);
      expect(found.hits).toHaveLength(6);
      expect(fastest(() => rank([{ owner: 'host:commands', candidates: all }], words, 6))).toBeLessThan(BOUND);
    });

    it(`answer a keystroke of ${String(length)} characters through the store in under ${String(BOUND)} ms, with the rows ready`, () => {
      const provider: Provider = { id: 'host:commands', plugin: 'host', section: 'commands', match: () => all };
      const times: number[] = [];
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const f = makePalette();
        f.palette.registerProvider(provider);
        f.palette.open();
        const start = performance.now();
        f.palette.setQuery(query);
        times.push(performance.now() - start);
        expect(f.palette.getSnapshot().rows.length).toBeGreaterThan(0);
      }

      expect(Math.min(...times)).toBeLessThan(BOUND);
    });
  }

  it('rank fifty keystrokes in a row, each of them a new query, without a keystroke over the bound', () => {
    const f = makePalette();
    f.palette.registerProvider({ id: 'host:commands', plugin: 'host', section: 'commands', match: () => all });
    f.palette.open();
    const typed = 'toggle panel sidebar terminal log session view editor task';
    const slowest = Math.max(
      ...Array.from({ length: 50 }, (_, index) => {
        const start = performance.now();
        f.palette.setQuery(typed.slice(0, index + 1));
        return performance.now() - start;
      }),
    );
    expect(slowest).toBeLessThan(BOUND * 2);
  });
});

describe('a provider that returns five thousand rows', () => {
  it('is cut to twenty and checked for those twenty alone: the answer costs next to nothing', async () => {
    const f = makePalette();
    const big: Candidate[] = Array.from({ length: 5000 }, (_, index) => resource(`r${String(index)}`, `cart-${String(index)}`));
    f.palette.registerProvider({ id: 'stack:big', plugin: 'stack', section: { id: 'big', title: 'Big' }, search: async () => Promise.resolve(big) });
    f.palette.open({ kind: 'goto' });
    f.palette.setQuery('cart');
    const start = performance.now();
    await f.clock.advance(300);
    expect(performance.now() - start).toBeLessThan(BOUND);
    const snapshot = f.palette.getSnapshot();
    expect(snapshot.rows).toHaveLength(20);
    expect(snapshot.sources[0]).toMatchObject({ rows: 20, limited: 5000, state: 'limited' });
  });
});

describe('a provider that takes 300 ms of real time', () => {
  it('never blocks a keystroke: every keystroke returns at once and the rows come when the provider answers', async () => {
    const f = makePalette({ scheduler: undefined });
    let calls = 0;
    f.palette.registerProvider({ id: 'host:commands', plugin: 'host', section: 'commands', match: () => commands(10_000) });
    f.palette.registerProvider({
      id: 'stack:slow',
      plugin: 'stack',
      section: { id: 'slow', title: 'Slow' },
      search: async (query, _scope, signal) =>
        new Promise<Candidate[]>((resolve, reject) => {
          calls += 1;
          const timer = setTimeout(() => {
            resolve([resource(`${query}-api`, `${query}-api`)]);
          }, 300);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(Object.assign(new Error('Aborted'), { name: 'AbortError' }));
            },
            { once: true },
          );
        }),
    });
    f.palette.open();
    const slowest: number[] = [];
    let typed = '';
    for (const character of 'toggle panel') {
      typed += character;
      const start = performance.now();
      f.palette.setQuery(typed);
      slowest.push(performance.now() - start);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
      });
    }

    expect(Math.max(...slowest)).toBeLessThan(BOUND);
    // Typed quickly (10 ms apart, under the 150 ms debounce): one request, for the last query, and none of the rows are its yet.
    expect(f.palette.getSnapshot().sections.some((section) => section.id === 'stack:slow' && section.rows.some((row) => !row.inert))).toBe(false);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 600);
    });
    expect(calls).toBe(1);
    expect(f.palette.getSnapshot().rows.some((row) => row.title.text === 'toggle panel-api')).toBe(true);
    f.palette.dispose();
  });
});
