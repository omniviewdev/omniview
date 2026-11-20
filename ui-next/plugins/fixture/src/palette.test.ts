import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { admitRows, type RowRules } from '../../contract/paletteRows';
import type { PaletteRowV1, PaletteScopeV1, PaletteSearchProviderV1 } from '../../contract/v1';
import { createFixturePalette } from './palette';

// The fixture's providers are what the probes and the seam check measure the host against, so they are held to what they say: quiet until a check asks, each costing what it is told, counting what the host did to it,
// and answering rows the host's own admission reads as valid (and, when told to, one it must leave out).

const palette = createFixturePalette('Fixture', (name) => ({ page: 'item', params: { name } }), { page: 'items', params: {} });
const SCOPE: PaletteScopeV1 = { plugin: null, chips: [], kind: 'all' };
/** The pages of the fixture plugin, as the host's admission knows them. */
const rules: RowRules = { pages: { items: { kind: 'list' }, item: { kind: 'detail', definition: { identity: { name: 'name' } } } }, commands: palette.commands ?? {} };

const provider = (id: string): PaletteSearchProviderV1 => {
  const found = palette.providers?.[id];
  if (found?.kind !== 'search') {
    throw new Error(`no search provider ${id}`);
  }

  return found;
};

/** What a provider answered, as the rows it holds (the fixture answers a list). */
const rowsOf = (answer: Awaited<ReturnType<PaletteSearchProviderV1['search']>>): readonly PaletteRowV1[] => ('rows' in answer ? answer.rows : answer);

const control = (extra: Record<string, unknown> = {}): Record<string, unknown> => {
  const made = { stats: {}, commands: [], ...extra };
  Reflect.set(window, '__fixturePalette', made);
  return made;
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  Reflect.deleteProperty(window, '__fixturePalette');
  vi.useRealTimers();
});

describe('the fixture\'s palette', () => {
  it('has one match provider and three search providers, and one command', () => {
    expect(Object.fromEntries(Object.entries(palette.providers ?? {}).map(([id, found]) => [id, found.kind]))).toEqual({ pages: 'match', quick: 'search', slow: 'search', big: 'search' });
    expect(Object.keys(palette.commands ?? {})).toEqual(['reset']);
  });

  it('is quiet until a check makes its control: no provider has anything to say, and a search that is asked anyway answers nothing', async () => {
    for (const found of Object.values(palette.providers ?? {})) {
      expect(found.supports?.(SCOPE)).toBe(false);
    }

    expect(await provider('quick').search('orders', SCOPE, new AbortController().signal)).toEqual([]);

    control();

    for (const found of Object.values(palette.providers ?? {})) {
      expect(found.supports?.(SCOPE)).toBe(true);
    }
  });

  it('offers a page and a command the host admits as valid', () => {
    control();
    const found = palette.providers?.pages;
    const rows = found?.kind === 'match' ? found.match('', SCOPE) : [];
    const read = admitRows(rows, rules, { keep: 20, scan: 100 });

    expect(read.problems).toEqual([]);
    expect(read.rows.map((row) => [row.label, row.route?.page ?? row.command?.id])).toEqual([['Fixture list', 'items'], ['Reset fixture counters', 'reset']]);
  });

  it('answers the items whose name holds the query, at once for `quick`, after 300 ms for `slow`', async () => {
    control();
    const quick = provider('quick').search('orders', SCOPE, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(0);
    expect(admitRows(rowsOf(await quick), rules, { keep: 20, scan: 100 }).rows.map((row) => row.label)).toEqual(['orders-api']);

    let slow: readonly unknown[] | undefined;
    void provider('slow').search('orders', SCOPE, new AbortController().signal).then((answer) => {
      slow = rowsOf(answer);
    });
    await vi.advanceTimersByTimeAsync(299);
    expect(slow).toBeUndefined();
    await vi.advanceTimersByTimeAsync(2);
    expect(slow).toHaveLength(1);
  });

  it('returns five thousand rows from `big` when it is given the size, and none until it is', async () => {
    const made = control();
    expect(await provider('big').search('alpha', SCOPE, new AbortController().signal)).toEqual([]);
    made.big = { size: 5000 };
    const rows = rowsOf(await provider('big').search('alpha', SCOPE, new AbortController().signal));

    expect(rows).toHaveLength(5000);
    expect(admitRows(rows, rules, { keep: 20, scan: 100 })).toMatchObject({ read: 20, problems: [] });
  });

  it('counts what was done to it: the calls, the requests it was told to stop before it answered, the answers, and the ones in flight', async () => {
    const made = control();
    const stop = new AbortController();
    const told = provider('slow').search('orders', SCOPE, stop.signal);
    void told.catch(() => undefined);
    await vi.advanceTimersByTimeAsync(100);
    expect(made.stats).toEqual({ 'Fixture/slow': { calls: 1, aborted: 0, answered: 0, active: 1 } });

    stop.abort();
    await expect(told).rejects.toThrow('told to stop');
    expect(made.stats).toEqual({ 'Fixture/slow': { calls: 1, aborted: 1, answered: 0, active: 0 } });

    await provider('quick').search('orders', SCOPE, new AbortController().signal);
    expect(made.stats).toMatchObject({ 'Fixture/quick': { calls: 1, aborted: 0, answered: 1, active: 0 } });
  });

  it('does not count a stop that came after it had answered: the palette lets go of a request when the answer is in', async () => {
    const made = control();
    const done = new AbortController();
    await provider('quick').search('orders', SCOPE, done.signal);
    done.abort();

    expect(made.stats).toMatchObject({ 'Fixture/quick': { aborted: 0, answered: 1 } });
  });

  it('answers after it was told to stop when it does not listen, and counts both', async () => {
    const made = control({ slow: { listen: false } });
    const stop = new AbortController();
    const late = provider('slow').search('orders', SCOPE, stop.signal);
    await vi.advanceTimersByTimeAsync(100);
    stop.abort();
    await vi.advanceTimersByTimeAsync(300);

    expect(rowsOf(await late)).toHaveLength(1);
    expect(made.stats).toMatchObject({ 'Fixture/slow': { calls: 1, aborted: 1, answered: 1, active: 0 } });
  });

  it.each([
    ['throw', 'failed on purpose'],
    ['reject', 'rejected on purpose'],
  ])('fails as it is told to: %s', async (fail, message) => {
    control({ quick: { fail } });

    const answered = provider('quick').search('orders', SCOPE, new AbortController().signal);
    const caught = expect(answered).rejects.toThrow(message);
    await vi.advanceTimersByTimeAsync(0);
    await caught;
  });

  it('never answers when it is told to hang, and answers what is not a list when it is told to', async () => {
    control({ quick: { fail: 'hang' }, slow: { fail: 'garbage', delay: 0 } });
    let settled = false;
    void provider('quick').search('orders', SCOPE, new AbortController().signal).then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(60_000);

    expect(settled).toBe(false);
    expect(await provider('slow').search('orders', SCOPE, new AbortController().signal)).toBe(7);
  });

  it('adds a row the host must leave out when it is told to: a glyph the kit does not have', async () => {
    control({ quick: { fail: 'rows' } });
    const rows = rowsOf(await provider('quick').search('orders', SCOPE, new AbortController().signal));
    const read = admitRows(rows, rules, { keep: 20, scan: 100 });

    expect(read.rows.map((row) => row.label)).toEqual(['orders-api']);
    expect(read.problems).toEqual(['row "bad": the glyph "no-such-glyph" is not one the kit has']);
  });

  it('holds the thread for its delay when it is told to spin: nothing else runs meanwhile', async () => {
    vi.useRealTimers();
    control({ quick: { spin: true, delay: 40 } });
    const before = performance.now();
    await provider('quick').search('orders', SCOPE, new AbortController().signal);

    expect(performance.now() - before).toBeGreaterThanOrEqual(39);
  });

  it('runs its command with what the host gave it and records it for the check to read', () => {
    const made = control();
    const panel = { logs: { open: vi.fn() } };
    void palette.commands?.reset?.run({ owner: 'Fixture' }, { plugin: 'fixture-a-ok', panel });

    expect(made.commands).toEqual([{ arg: { owner: 'Fixture' }, plugin: 'fixture-a-ok', panel: true }]);
  });
});
