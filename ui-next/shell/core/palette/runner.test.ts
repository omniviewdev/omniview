import { describe, expect, it } from 'vitest';
import type { Owner } from './results';
import { createRunner, type AsyncSource, type Runner } from './runner';
import { after, answer, manualClock, resource, type ManualClock } from './testing';
import type { Candidate, Provider, ProviderAnswer, SearchScope } from './types';

// The asynchronous runner (ch16 S71, S72): providers answer 150 ms after the last keystroke, with a 5 s timeout, at most 20 rows each, at most 4 in flight, and a superseded request is
// aborted and its answer dropped. Rows already shown stay until their source answers. A provider that throws, rejects, never answers or answers nonsense is contained and reported for
// that provider alone. The clock is the test's, so a provider that takes 300 ms costs no time.

const scope: SearchScope = { plugin: null, chips: [], scope: null, kind: 'all' };

type Call = { readonly query: string; readonly signal: AbortSignal; readonly at: number };

function setup(clock: ManualClock) {
  const changes: number[] = [];
  const errors: Array<{ readonly where: string }> = [];
  const runner: Runner = createRunner({
    scheduler: clock.scheduler,
    onChange: () => changes.push(clock.now()),
    onError: (_error, where) => errors.push({ where }),
  });
  return { runner, changes, errors };
}

function source(id: string, search: Provider['search'], extra: Partial<AsyncSource> = {}): AsyncSource {
  const owner: Owner = { provider: id, plugin: id.split(':')[0] ?? id, pluginName: 'Stack', section: `${id}:section` };
  const provider: Provider = { id, plugin: owner.plugin, section: { id: 'section', title: 'Resources' }, search };
  return { id, provider, owner, pluginName: 'Stack', title: id, limit: 20, ...extra };
}

/** A provider that takes `ms` of the clock and answers with `rows(query)`, recording each call. */
function slow(clock: ManualClock, ms: number, rows: (query: string) => readonly Candidate[], calls: Call[] = [], honour = true): Provider['search'] {
  return async (query, _scope, signal) => {
    calls.push({ query, signal, at: clock.now() });
    return after(clock, ms, rows(query), honour ? signal : undefined);
  };
}

const named = (query: string): readonly Candidate[] => [resource(`${query}-1`, `${query}-api`)];

describe('the runner', () => {
  it('asks a provider 150 ms after the last keystroke, and holds a pending answer for it until then', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    const calls: Call[] = [];
    runner.begin({ query: 'cart', scope }, [source('stack:a', slow(clock, 300, named, calls))], { immediate: false, keep: false });
    expect(runner.answers().map((a) => a.state)).toEqual(['pending']);
    expect(runner.pending()).toBe(1);
    await clock.advance(149);
    expect(calls).toHaveLength(0);
    await clock.advance(1);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ query: 'cart', at: 150 });
    expect(runner.inFlight()).toBe(1);
    await clock.advance(299);
    expect(runner.answers()[0]?.state).toBe('pending');
    await clock.advance(1);
    const [done] = runner.answers();
    expect(done).toMatchObject({ state: 'ready', query: 'cart', ms: 300, attempts: 0 });
    expect(done?.rows.map((row) => row.title)).toEqual(['cart-api']);
    expect(runner.pending()).toBe(0);
    expect(runner.inFlight()).toBe(0);
  });

  it('asks at once when told to (a chip entered, a kind chosen): no debounce', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    const calls: Call[] = [];
    runner.begin({ query: '', scope }, [source('stack:a', slow(clock, 10, named, calls))], { immediate: true, keep: false });
    await clock.advance(0);
    expect(calls).toHaveLength(1);
  });

  it('asks once for fifty keystrokes: each one moves the debounce, and no superseded request is ever made', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    const calls: Call[] = [];
    const a = source('stack:a', slow(clock, 300, named, calls));
    for (let key = 1; key <= 50; key += 1) {
      runner.begin({ query: 'q'.repeat(key), scope }, [a], { immediate: false, keep: true });
      await clock.advance(20);
    }

    expect(calls).toHaveLength(0);
    await clock.advance(150);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.query).toBe('q'.repeat(50));
    await clock.advance(300);
    expect(runner.answers()[0]?.rows.map((row) => row.title)).toEqual([`${'q'.repeat(50)}-api`]);
  });

  it('aborts a request the query supersedes and never delivers its answer, even from a provider that ignores the signal', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    const honoured: Call[] = [];
    const ignored: Call[] = [];
    const sources = [source('stack:honours', slow(clock, 300, named, honoured)), source('stack:ignores', slow(clock, 300, named, ignored, false))];
    runner.begin({ query: 'ca', scope }, sources, { immediate: false, keep: true });
    await clock.advance(150);
    expect(honoured).toHaveLength(1);
    runner.begin({ query: 'car', scope }, sources, { immediate: false, keep: true });
    expect(honoured[0]?.signal.aborted).toBe(true);
    expect(ignored[0]?.signal.aborted).toBe(true);
    // Both old requests are still running as far as the ignoring provider is concerned, and will answer in 150 ms: the answer is for 'ca'.
    await clock.advance(150);
    expect(runner.answers().map((a) => a.rows.length)).toEqual([0, 0]);
    expect(runner.answers().map((a) => a.state)).toEqual(['pending', 'pending']);
    await clock.advance(300);
    expect(runner.answers().map((a) => a.query)).toEqual(['car', 'car']);
    expect(runner.answers().map((a) => a.rows[0]?.title)).toEqual(['car-api', 'car-api']);
    expect(honoured.map((c) => c.query)).toEqual(['ca', 'car']);
  });

  it('keeps the rows a source gave for the last query, pending, until it answers the new one (S71)', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    const a = source('stack:a', slow(clock, 100, named));
    runner.begin({ query: 'car', scope }, [a], { immediate: false, keep: true });
    await clock.advance(250);
    expect(runner.answers()[0]).toMatchObject({ state: 'ready', query: 'car' });
    runner.begin({ query: 'cart', scope }, [a], { immediate: false, keep: true });
    expect(runner.answers()[0]).toMatchObject({ state: 'pending', query: 'car' });
    expect(runner.answers()[0]?.rows.map((row) => row.title)).toEqual(['car-api']);
    await clock.advance(250);
    expect(runner.answers()[0]).toMatchObject({ state: 'ready', query: 'cart' });
    expect(runner.answers()[0]?.rows.map((row) => row.title)).toEqual(['cart-api']);
  });

  it('drops the rows when the scope changed (keep: false), and the sources that are no longer asked', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    const a = source('stack:a', slow(clock, 10, named));
    const b = source('cloud:b', slow(clock, 10, named));
    runner.begin({ query: 'car', scope }, [a, b], { immediate: false, keep: true });
    await clock.advance(200);
    runner.begin({ query: 'car', scope }, [a], { immediate: false, keep: true });
    expect(runner.answers().map((x) => x.id)).toEqual(['stack:a']);
    runner.begin({ query: 'car', scope }, [a], { immediate: false, keep: false });
    expect(runner.answers()[0]?.rows).toEqual([]);
  });

  it('keeps four searches in flight at most; the rest wait their turn', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    const calls: Call[] = [];
    const sources = Array.from({ length: 6 }, (_, index) => source(`p${String(index)}:x`, slow(clock, 100, named, calls)));
    runner.begin({ query: 'car', scope }, sources, { immediate: false, keep: false });
    await clock.advance(150);
    expect(calls).toHaveLength(4);
    expect(runner.inFlight()).toBe(4);
    await clock.advance(100);
    expect(calls).toHaveLength(6);
    expect(runner.inFlight()).toBeLessThanOrEqual(4);
    await clock.advance(100);
    expect(runner.answers().every((a) => a.state === 'ready')).toBe(true);
  });

  it('times a provider out after five seconds, frees its place, and says so (S71)', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    const stuck = (n: number) => source(`stuck${String(n)}:x`, async () => new Promise<never>(() => undefined));
    const calls: Call[] = [];
    runner.begin({ query: 'car', scope }, [stuck(1), stuck(2), stuck(3), stuck(4), source('stack:other', slow(clock, 100, named, calls))], { immediate: false, keep: false });
    await clock.advance(150);
    // Four providers that never answer hold the four places: the fifth waits for one.
    expect(calls).toHaveLength(0);
    expect(runner.inFlight()).toBe(4);
    await clock.advance(4999);
    expect(runner.answers()[0]).toMatchObject({ state: 'pending' });
    expect(calls).toHaveLength(0);
    await clock.advance(1);
    expect(runner.answers()[0]).toMatchObject({ state: 'timeout', word: 'Timed out' });
    expect(runner.answers()[0]?.message).toContain('5 seconds');
    expect(calls).toHaveLength(1);
    await clock.advance(100);
    expect(runner.answers()[4]?.state).toBe('ready');
  });

  it('contains a provider that throws, rejects, or answers nonsense: its answer is an error, the others are not touched', async () => {
    const clock = manualClock();
    const { runner, errors } = setup(clock);
    const sources = [
      source('stack:throws', () => {
        throw new Error('boom');
      }),
      source('stack:rejects', async () => Promise.reject(Object.assign(new Error('Service is starting. Try again.'), { word: 'Starting' }))),
      source('stack:nonsense', async () => Promise.resolve('hello' as never)),
      source('stack:fine', slow(clock, 10, named)),
    ];
    runner.begin({ query: 'car', scope }, sources, { immediate: false, keep: false });
    await clock.advance(200);
    const [throws, rejects, nonsense, fine] = runner.answers();
    expect(throws).toMatchObject({ state: 'error', word: 'Unavailable', message: 'boom' });
    expect(rejects).toMatchObject({ state: 'error', word: 'Starting', message: 'Service is starting. Try again.' });
    expect(nonsense?.state).toBe('error');
    expect(fine).toMatchObject({ state: 'ready' });
    expect(fine?.rows).toHaveLength(1);
    expect(errors.map((e) => e.where)).toEqual(['search() of stack:throws', 'search() of stack:rejects', 'search() of stack:nonsense']);
    expect(runner.pending()).toBe(0);
  });

  it('retries one source at once, and counts the attempt (S72)', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    let calls = 0;
    const flaky = source('stack:flaky', async () => {
      calls += 1;
      return calls === 1 ? Promise.reject(new Error('down')) : Promise.resolve(named('car'));
    });
    runner.begin({ query: 'car', scope }, [flaky], { immediate: false, keep: false });
    await clock.advance(200);
    expect(runner.answers()[0]?.state).toBe('error');
    expect(runner.retry('stack:flaky')).toBe(true);
    expect(runner.answers()[0]).toMatchObject({ state: 'pending', attempts: 1 });
    await clock.advance(0);
    expect(runner.answers()[0]).toMatchObject({ state: 'ready', attempts: 1 });
    expect(runner.retry('stack:unknown')).toBe(false);
  });

  it('retries every source that failed, and only those', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    let calls = 0;
    const down = source('stack:down', async () => {
      calls += 1;
      return Promise.reject(new Error('down'));
    });
    const fine = source('stack:fine', slow(clock, 10, named));
    runner.begin({ query: 'car', scope }, [down, fine], { immediate: false, keep: false });
    await clock.advance(200);
    expect(runner.retryAll()).toBe(1);
    await clock.advance(10);
    expect(calls).toBe(2);
  });

  it('keeps at most the first twenty rows, says how many there were, and drops the invalid and the duplicates (S71)', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    const list: unknown[] = Array.from({ length: 5000 }, (_, index) => resource(`r${String(index)}`, `cart-${String(index)}`));
    list.splice(1, 0, null, { id: 'bad', kind: 'planet', title: 'x' }, resource('r0', 'cart-0'));
    const big = source('stack:big', async () => Promise.resolve(answer(list as Candidate[])));
    runner.begin({ query: 'cart', scope }, [big], { immediate: false, keep: false });
    await clock.advance(200);
    const [done] = runner.answers();
    expect(done?.rows).toHaveLength(17);
    expect(done).toMatchObject({ state: 'limited', limited: 5003, invalid: 2 });
  });

  it('says a provider\'s own words: partial results, a message, no live updates', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    const extra: ProviderAnswer = { rows: named('car'), partial: true, live: false, message: 'One connection did not answer.' };
    runner.begin({ query: 'car', scope }, [source('stack:partial', async () => Promise.resolve(extra))], { immediate: false, keep: false });
    await clock.advance(200);
    expect(runner.answers()[0]).toMatchObject({ state: 'partial', live: false, message: 'One connection did not answer.' });
  });

  it('says a source is slow once it has been pending for a second, and tells the model then (S71: the loader)', async () => {
    const clock = manualClock();
    const { runner, changes } = setup(clock);
    runner.begin({ query: 'car', scope }, [source('stack:slow', slow(clock, 3000, named))], { immediate: false, keep: false });
    await clock.advance(999);
    expect(runner.slow()).toBe(false);
    await clock.advance(1);
    expect(runner.slow()).toBe(true);
    // The model is told 30 ms later, so that the loader never appears a frame early.
    expect(changes).not.toContain(1030);
    await clock.advance(30);
    expect(changes).toContain(1030);
    await clock.advance(3000);
    expect(runner.slow()).toBe(false);
  });

  it('forgets a plugin that left: its requests are aborted, its answers dropped, and a late answer goes nowhere (PO1)', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    const calls: Call[] = [];
    const leaving = source('gone:a', slow(clock, 300, named, calls, false));
    const staying = source('stack:b', slow(clock, 300, named));
    runner.begin({ query: 'car', scope }, [leaving, staying], { immediate: false, keep: false });
    await clock.advance(200);
    expect(runner.forget((s) => s.owner.plugin === 'gone')).toBe(true);
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(runner.answers().map((a) => a.id)).toEqual(['stack:b']);
    await clock.advance(300);
    expect(runner.answers().map((a) => [a.id, a.state])).toEqual([['stack:b', 'ready']]);
    expect(runner.forget((s) => s.owner.plugin === 'gone')).toBe(false);
  });

  it('stops everything: the requests aborted, the timers gone, the answers dropped', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    const calls: Call[] = [];
    runner.begin({ query: 'car', scope }, [source('stack:a', slow(clock, 300, named, calls))], { immediate: false, keep: false });
    await clock.advance(200);
    runner.stop();
    expect(calls[0]?.signal.aborted).toBe(true);
    expect(runner.answers()).toEqual([]);
    expect(clock.pending()).toBe(0);
    await clock.advance(1000);
    expect(runner.answers()).toEqual([]);
  });

  it('a request that ends and a request that is superseded each free their place at once', async () => {
    const clock = manualClock();
    const { runner } = setup(clock);
    const calls: Call[] = [];
    const sources = Array.from({ length: 5 }, (_, index) => source(`p${String(index)}:x`, slow(clock, 1000, named, calls)));
    runner.begin({ query: 'a', scope }, sources, { immediate: true, keep: false });
    await clock.advance(1);
    expect(runner.inFlight()).toBe(4);
    runner.begin({ query: 'ab', scope }, sources, { immediate: true, keep: false });
    expect(runner.inFlight()).toBe(0);
    await clock.advance(1);
    expect(runner.inFlight()).toBe(4);
  });
});
