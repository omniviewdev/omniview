import { describe, expect, it } from 'vitest';
import type { LoadFailure } from '../loader/failure';
import type { RecentConnection } from './connections';
import { homeConnectionsOf, homeEntriesOf, homeIdOf, RECENT_SHOWN, type HomeModel } from './homeModel';
import { connection, readyEntry } from './homeTesting';
import type { PluginEntry } from './pluginStore';

// What Home says of the connections (homeModel.ts), made from what the window knows: the plugins, the connections the store listed and the ones used last. Nothing here draws or reads a store.

const acme = readyEntry('acme', 'Acme', { order: 1, icon: 'layers', accent: 'green' });
const beta = readyEntry('beta', 'Beta', { order: 2, icon: 'box' });
const used = (plugin: string, key: string): RecentConnection => ({ plugin, key });
const names = (rows: ReadonlyArray<{ readonly name: string }>): string[] => rows.map((row) => row.name);

describe('the rows', () => {
  it('say a connection as a person reads it: its name, the plugin\'s secondary text, its state in the host\'s word and role and the reason it failed, whether a start is under way, and the plugin\'s glyph and colour', () => {
    const { groups } = homeConnectionsOf(
      [acme, beta],
      [
        connection('acme', 'k1', 'staging', 'connected', { detail: 'managed · north-1' }),
        connection('acme', 'k2', 'edge', 'unreachable', { reason: 'The server did not answer' }),
        connection('acme', 'k3', 'sandbox', 'connecting'),
        connection('beta', 'k4', 'other', 'disconnected'),
      ],
      [],
    );

    const [first, second] = groups;
    expect(first?.rows[0]).toMatchObject({ plugin: 'acme', key: 'k1', name: 'staging', detail: 'managed · north-1', icon: 'layers', tone: 'green', role: 'healthy', word: 'Connected', busy: false });
    expect(first?.rows[1]).toMatchObject({ key: 'k2', role: 'error', word: 'Not responding', reason: 'The server did not answer', busy: false });
    expect(first?.rows[2]).toMatchObject({ key: 'k3', role: 'progress', word: 'Connecting…', busy: true });
    // A plugin that declares no colour gets the neutral tile.
    expect(second?.rows[0]).toMatchObject({ plugin: 'beta', icon: 'box', tone: 'neutral', word: 'Disconnected' });
  });

  it('are the connections of the plugins that contribute, in a group for each plugin in the order of the rail; a plugin with none has no group, and one that is not ready draws none', () => {
    const loading: PluginEntry = { id: 'gamma', name: 'Gamma', phase: 'loading' };
    const failure: LoadFailure = { kind: 'missing', message: 'The plugin\'s interface could not be read.' };
    const failed: PluginEntry = { id: 'delta', name: 'Delta', phase: 'failed', failure };
    const { groups } = homeConnectionsOf(
      [beta, loading, failed, acme, readyEntry('quiet', 'Quiet', { order: 3 })],
      [connection('beta', 'b1', 'sandbox'), connection('acme', 'a1', 'staging'), connection('gamma', 'g1', 'elsewhere'), connection('delta', 'd1', 'gone')],
      [],
    );

    expect(groups.map((group) => [group.plugin, group.label, names(group.rows)])).toEqual([
      ['acme', 'Acme', ['staging']],
      ['beta', 'Beta', ['sandbox']],
    ]);
  });

  it('keep the order the store gave a plugin\'s connections in', () => {
    const { groups } = homeConnectionsOf([acme], [connection('acme', 'k2', 'zulu'), connection('acme', 'k1', 'alpha'), connection('acme', 'k3', 'mike')], []);

    expect(names(groups[0]?.rows ?? [])).toEqual(['zulu', 'alpha', 'mike']);
  });

  it('name the groups when more than one plugin has a connection, counted in the whole list, and not when one does', () => {
    expect(homeConnectionsOf([acme, beta], [connection('acme', 'a1', 'staging'), connection('beta', 'b1', 'sandbox')], []).groups.map((group) => group.named)).toEqual([true, true]);
    expect(homeConnectionsOf([acme, beta], [connection('acme', 'a1', 'staging'), connection('acme', 'a2', 'production')], []).groups.map((group) => group.named)).toEqual([false]);
    // A plugin whose connections are all recent has no group left, and the other still has the name over it: the person has two plugins' connections.
    const all = homeConnectionsOf([acme, beta], [connection('acme', 'a1', 'staging'), connection('beta', 'b1', 'sandbox')], [used('acme', 'a1')]);
    expect(all.groups.map((group) => [group.plugin, group.named])).toEqual([['beta', true]]);
  });
});

describe('the identity of a record', () => {
  it('is its plugin and its key together: two plugins\' connections with the same key are two records, and keys that run into the plugin\'s id are not mistaken for it', () => {
    expect(homeIdOf('acme', 'north')).not.toBe(homeIdOf('beta', 'north'));
    expect(homeIdOf('a', 'b/c')).not.toBe(homeIdOf('a/b', 'c'));
    expect(homeIdOf('a', 'b\u0000c')).not.toBe(homeIdOf('a\u0000b', 'c'));
    expect(homeIdOf('acme', 'north')).toBe(homeIdOf('acme', 'north'));
  });

  it('is on the row, and finds the row wherever the page draws it: in Recent or in its plugin\'s list', () => {
    const model = homeConnectionsOf([acme, beta], [connection('acme', 'same', 'north'), connection('beta', 'same', 'north'), connection('acme', 'other', 'south')], [used('beta', 'same')]);

    const [inRecent] = model.recent;
    const [firstGroup] = model.groups;
    expect(inRecent?.id).toBe(homeIdOf('beta', 'same'));
    expect(firstGroup?.rows.map((row) => row.id)).toEqual([homeIdOf('acme', 'same'), homeIdOf('acme', 'other')]);
    for (const row of [...model.recent, ...model.groups.flatMap((group) => group.rows)]) {
      expect(model.rows.get(row.id)).toBe(row);
    }

    expect(model.rows.size).toBe(3);
  });
});

describe('Recent', () => {
  const all = [connection('acme', 'a1', 'one'), connection('acme', 'a2', 'two'), connection('acme', 'a3', 'three'), connection('acme', 'a4', 'four'), connection('acme', 'a5', 'five'), connection('acme', 'a6', 'six'), connection('beta', 'b1', 'seven')];

  it('is the first five of the connections used last, most recent first, from every plugin', () => {
    const { recent } = homeConnectionsOf([acme, beta], all, [used('beta', 'b1'), used('acme', 'a3'), used('acme', 'a1')]);

    expect(RECENT_SHOWN).toBe(5);
    expect(names(recent)).toEqual(['seven', 'three', 'one']);
    expect(recent.map((row) => row.plugin)).toEqual(['beta', 'acme', 'acme']);
  });

  it('is five at the most, and the sixth and the later ones stay in their plugin\'s list', () => {
    const { recent, groups } = homeConnectionsOf([acme, beta], all, [used('acme', 'a1'), used('acme', 'a2'), used('acme', 'a3'), used('acme', 'a4'), used('acme', 'a5'), used('acme', 'a6'), used('beta', 'b1')]);

    expect(names(recent)).toEqual(['one', 'two', 'three', 'four', 'five']);
    expect(groups.map((group) => names(group.rows))).toEqual([['six'], ['seven']]);
  });

  it('skips a recent connection that is gone, and one of a plugin that has no group, and goes on to the next that exists', () => {
    const loading: PluginEntry = { id: 'gamma', name: 'Gamma', phase: 'loading' };
    const { recent } = homeConnectionsOf(
      [acme, loading],
      [connection('acme', 'a1', 'one'), connection('acme', 'a2', 'two'), connection('gamma', 'g1', 'elsewhere')],
      [used('acme', 'gone'), used('gamma', 'g1'), used('nobody', 'n1'), used('acme', 'a2'), used('acme', 'a1')],
    );

    expect(names(recent)).toEqual(['two', 'one']);
  });

  it('is none when nothing was used, and none of the connections is drawn twice when something was: every connection is in Recent or in its plugin\'s list, never both', () => {
    expect(homeConnectionsOf([acme, beta], all, []).recent).toEqual([]);

    const { recent, groups } = homeConnectionsOf([acme, beta], all, [used('acme', 'a2'), used('beta', 'b1')]);
    const drawn = [...recent, ...groups.flatMap((group) => group.rows)].map((row) => row.id);
    expect(new Set(drawn).size).toBe(drawn.length);
    expect(drawn).toHaveLength(all.length);
    expect(groups.map((group) => names(group.rows))).toEqual([['one', 'three', 'four', 'five', 'six']]);
  });
});

describe('what a change keeps', () => {
  const connections = [connection('acme', 'a1', 'staging'), connection('acme', 'a2', 'production'), connection('beta', 'b1', 'sandbox')];
  const rowsOf = (model: HomeModel) => [...model.recent, ...model.groups.flatMap((group) => group.rows)];

  it('gives the same row for the same connection: the page draws a row again only when it is another object', () => {
    const before = homeConnectionsOf([acme, beta], connections, []);
    const after = homeConnectionsOf([acme, beta], connections, []);

    expect(rowsOf(after)).toHaveLength(3);
    rowsOf(after).forEach((row, at) => {
      expect(row).toBe(rowsOf(before)[at]);
    });
  });

  it('makes a new row for the connection that changed and no other: the rest of the list is the objects it was', () => {
    const before = homeConnectionsOf([acme, beta], connections, []);
    const [first, second, third] = connections;
    const changed = { ...second, state: 'unreachable' as const, reason: 'The server did not answer' };
    const after = homeConnectionsOf([acme, beta], [first, changed, third] as typeof connections, []);

    const [kept, renewed, other] = rowsOf(after);
    expect(kept).toBe(rowsOf(before)[0]);
    expect(other).toBe(rowsOf(before)[2]);
    expect(renewed).not.toBe(rowsOf(before)[1]);
    expect(renewed).toMatchObject({ key: 'a2', word: 'Not responding', reason: 'The server did not answer' });
  });

  it('keeps the rows when only the connections used last change: the same objects, in Recent now', () => {
    const before = homeConnectionsOf([acme, beta], connections, []);
    const after = homeConnectionsOf([acme, beta], connections, [used('beta', 'b1'), used('acme', 'a1')]);

    expect(after.recent[0]).toBe(rowsOf(before)[2]);
    expect(after.recent[1]).toBe(rowsOf(before)[0]);
    expect(after.groups[0]?.rows[0]).toBe(rowsOf(before)[1]);
  });

  it('makes the rows again when the plugin\'s glyph or colour changed: the row wears them', () => {
    const staging = connection('acme', 'a1', 'staging');
    const before = homeConnectionsOf([acme], [staging], []);
    const after = homeConnectionsOf([readyEntry('acme', 'Acme', { order: 1, icon: 'box', accent: 'blue' })], [staging], []);

    expect(after.groups[0]?.rows[0]).not.toBe(before.groups[0]?.rows[0]);
    expect(after.groups[0]?.rows[0]).toMatchObject({ icon: 'box', tone: 'blue' });
  });
});

describe('the plugins Home offers', () => {
  it('lists the plugins that contribute first, in the order of the rail, and the others after them by name, with the word that says why they cannot open to their page', () => {
    const loading: PluginEntry = { id: 'zeta', name: 'Zeta', phase: 'loading' };
    const failure: LoadFailure = { kind: 'missing', message: 'The plugin\'s interface could not be read.' };
    const failed: PluginEntry = { id: 'delta', name: 'Delta', phase: 'failed', failure };

    expect(homeEntriesOf([loading, beta, failed, acme]).map((entry) => [entry.id, entry.label, entry.state])).toEqual([
      ['acme', 'Acme', undefined],
      ['beta', 'Beta', undefined],
      ['delta', 'Delta', 'Did not load'],
      ['zeta', 'Zeta', 'Loading'],
    ]);
  });

  it('gives a plugin that contributes its own glyph and colour, and the others the host\'s glyph and none', () => {
    const [first, second] = homeEntriesOf([acme, { id: 'zeta', name: 'Zeta', phase: 'loading' }]);

    expect(first).toMatchObject({ icon: 'layers', tone: 'green' });
    expect(second).toMatchObject({ icon: 'package', tone: 'neutral' });
  });
});
