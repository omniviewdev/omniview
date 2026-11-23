import type { Connection } from '@omniviewdev/runtime/ui/v1';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LogTargetV1, PanelHostV1 } from '../../contract/v1';
import { chooseConnection, connectionFace } from './connection';
import { itemsFrame, itemsOf } from './connection-pages';

/* eslint-disable @typescript-eslint/consistent-type-assertions -- a test names only the id and the name of a connection */
const north = { id: 'north-57a082bd74', name: 'north' } as Connection;
const south = { id: 'south-0c3d9e1f42', name: 'south' } as Connection;
/* eslint-enable @typescript-eslint/consistent-type-assertions */

describe('the connections fixture', () => {
  it('chooses the connection the route names, and the first one for a route that names none or an unknown one', () => {
    expect(chooseConnection([north, south], 'south-0c3d9e1f42')).toBe(south);
    expect(chooseConnection([north, south], undefined)).toBe(north);
    expect(chooseConnection([north, south], 'gone-0000000000')).toBe(north);
    expect(chooseConnection([], 'south-0c3d9e1f42')).toBeUndefined();
  });

  it('says the connection by its name in the marked face, a word while the connections load, and None when there are none', () => {
    expect(connectionFace({ named: 'south', pending: false })).toEqual({ label: 'Connection', icon: 'server', text: 'south', role: 'connection' });
    expect(connectionFace({ named: undefined, pending: true }).text).toBe('Loading…');
    expect(connectionFace({ named: undefined, pending: false }).text).toBe('None');
  });

  it('lists three rows that depend on the connection', () => {
    expect(itemsOf('north').map((row) => row.name)).toEqual(['orders-api', 'ledger-sync', 'billing-sync']);
    expect(itemsOf('south').map((row) => row.name)).toEqual(['harbor-gate', 'tide-table', 'keel-check']);
    expect(itemsOf('south').every((row) => row.connection === 'south')).toBe(true);
    expect(itemsOf(undefined)).toEqual([]);
  });

  it('titles the tab Items and puts the connection in the path', () => {
    expect(itemsFrame({ named: 'south', pending: false })).toMatchObject({ tab: { title: 'Items' }, path: ['Seam Connections', 'south', 'Items'] });
    expect(itemsFrame({ named: undefined, pending: true }).path).toEqual(['Seam Connections', 'Items']);
  });

  describe('Logs sessions of the rows', () => {
    beforeEach(() => {
      Reflect.deleteProperty(window, '__fixtureLogs');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date'] });
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    /** A panel handle that keeps what the page asked it to open. */
    const panelOf = (opened: LogTargetV1[]): PanelHostV1 => ({
      logs: {
        open: (target) => {
          opened.push(target);
          return undefined;
        },
      },
    });

    it('are opened by the name of a row through the panel handle the host gave the page, one target for each connection and item', () => {
      const opened: LogTargetV1[] = [];
      const [orders] = itemsOf('north', panelOf(opened));
      const [harbor] = itemsOf('south', panelOf(opened));
      orders?.logs?.();
      harbor?.logs?.();
      expect(opened.map(({ id, title, scope }) => ({ id, title, scope }))).toEqual([
        { id: 'connection/north/orders-api/app', title: 'orders-api/app', scope: 'north' },
        { id: 'connection/south/harbor-gate/app', title: 'harbor-gate/app', scope: 'south' },
      ]);
      expect(opened[0]?.resource).toEqual({ label: 'Item orders-api', kind: 'Item' });
    });

    it('are not offered by a host that gave the page no panel handle: its rows have no opener and the name is text', () => {
      expect(itemsOf('north').every((row) => row.logs === undefined)).toBe(true);
      expect(itemsOf('north', undefined)).toEqual(itemsOf('north'));
    });

    it('stream lines that go on, each stream counted by the fixture, and a close frees it', () => {
      const opened: LogTargetV1[] = [];
      itemsOf('north', panelOf(opened))[0]?.logs?.();
      const feed = opened[0]?.open();
      vi.advanceTimersByTime(1_000);
      expect(feed?.getSnapshot().state).toBe('streaming');
      const first = feed?.read(1_000).lines.length ?? 0;
      expect(first).toBeGreaterThan(10);
      vi.advanceTimersByTime(1_000);
      expect(feed?.read(1_000).lines.length ?? 0).toBeGreaterThan(10);
      expect({ ...Reflect.get(window, '__fixtureLogs') }).toEqual({ opened: 1, closed: 0, listeners: 0 });
      void feed?.close();
      expect({ ...Reflect.get(window, '__fixtureLogs') }).toEqual({ opened: 1, closed: 1, listeners: 0 });
    });
  });
});
