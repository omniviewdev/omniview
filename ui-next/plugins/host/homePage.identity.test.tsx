import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { HomeProps } from './Home';
import { homePage } from './homePage';
import { connection, connectionStore, hostConnections, pluginSource, readyEntry, type FakeHost, type FakePlugins } from './homeTesting';

// What the host hands Home from one render to the next (HM2). `Home` draws a row again only when the row is another object or one of the handlers it was given is another function (`Home.test.tsx`, "what the page costs"), so the
// other half of "a store that changes one connection draws that row and no other" is held here, at the host: what it gives is the same object, function and text for everything that did not change. `Home` is replaced by a stand-in
// that records its props, which is the one thing it is replaced for.

const seen = vi.hoisted(() => [] as unknown[]);
vi.mock('./Home', () => ({
  Home: (props: unknown) => {
    seen.push(props);
    return null;
  },
}));

const acme = readyEntry('acme', 'Acme', { order: 1, accent: 'green' });
const beta = readyEntry('beta', 'Beta', { order: 2 });
const STARTING = [connection('acme', 'a1', 'staging'), connection('acme', 'a2', 'production'), connection('beta', 'b1', 'sandbox')];

/** What Home was last given. */
const last = (): HomeProps => seen.at(-1) as HomeProps;

let plugins: FakePlugins;
let host: FakeHost;

beforeEach(() => {
  seen.length = 0;
  plugins = pluginSource([acme, beta]);
  host = hostConnections(connectionStore(STARTING));
  const { Page } = homePage;
  render(<Page tabs={undefined as never} tabId="tab-1" plugins={plugins} onRetry={vi.fn()} openPlugin={vi.fn()} connections={host} />);
});

afterEach(cleanup);

describe('what the host hands Home again', () => {
  it('gives the same handlers, menu and plugins, and the same row for every connection that did not change, when the store changes one connection', () => {
    const before = last();
    const unchanged = before.groups.flatMap((group) => group.rows);
    expect(unchanged).toHaveLength(3);

    act(() => {
      host.store.set({ connections: [STARTING[0], connection('acme', 'a2', 'production', 'unreachable', { reason: 'The server did not answer' }), STARTING[2]] as typeof STARTING });
    });

    const after = last();
    expect(after).not.toBe(before);
    expect(after.onOpenConnection).toBe(before.onOpenConnection);
    expect(after.onOpenPlugin).toBe(before.onOpenPlugin);
    expect(after.onRetry).toBe(before.onRetry);
    expect(after.menu).toBe(before.menu);
    expect(after.entries).toBe(before.entries);
    const rows = after.groups.flatMap((group) => group.rows);
    expect(rows[0]).toBe(unchanged[0]);
    expect(rows[1]).not.toBe(unchanged[1]);
    expect(rows[1]).toMatchObject({ key: 'a2', word: 'Not responding', reason: 'The server did not answer' });
    expect(rows[2]).toBe(unchanged[2]);
  });

  it('gives the same handlers and the same rows when only the connections used last change: the rows move to Recent as they are', () => {
    const before = last();
    const unchanged = before.groups.flatMap((group) => group.rows);

    act(() => {
      host.recents.touch('beta', 'b1');
    });

    const after = last();
    expect(after.onOpenConnection).toBe(before.onOpenConnection);
    expect(after.onRetry).toBe(before.onRetry);
    expect(after.menu).toBe(before.menu);
    expect(after.recent).toEqual([unchanged[2]]);
    expect(after.recent[0]).toBe(unchanged[2]);
    expect(after.groups.flatMap((group) => group.rows)).toEqual([unchanged[0], unchanged[1]]);
    expect(after.groups.flatMap((group) => group.rows)[0]).toBe(unchanged[0]);
  });

  it('gives the same rows when the plugins are listed again with nothing different, and the same list of plugins when only the connections change', () => {
    const before = last();

    act(() => {
      plugins.set([acme, beta]);
    });

    expect(last().groups.flatMap((group) => group.rows)).toEqual(before.groups.flatMap((group) => group.rows));
    last().groups.flatMap((group) => group.rows).forEach((row, at) => {
      expect(row).toBe(before.groups.flatMap((group) => group.rows)[at]);
    });
  });

  it('gives the same plugin list while only the connections change, and a new one when a plugin does', () => {
    const before = last();

    act(() => {
      host.store.set({ connections: [...STARTING, connection('beta', 'b2', 'garden')] });
    });
    expect(last().entries).toBe(before.entries);

    act(() => {
      plugins.set([acme, beta, readyEntry('gamma', 'Gamma', { order: 3 })]);
    });
    expect(last().entries).not.toBe(before.entries);
    expect(last().entries.map((entry) => entry.id)).toEqual(['acme', 'beta', 'gamma']);
  });
});
