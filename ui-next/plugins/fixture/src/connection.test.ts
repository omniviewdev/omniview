import { readFileSync } from 'node:fs';
import path from 'node:path';
import type { Connection } from '@omniviewdev/runtime/ui/v1';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { admit } from '../../contract/admit';
import type { LogTargetV1, PanelHostV1 } from '../../contract/v1';
import { chooseConnection, connectionFace } from './connection';
import { itemsFrame, itemsOf, overviewViewOf } from './connection-pages';
import { contributionV1 } from './entry-connections';

// The build writes the rail entry into the bundle (`define`, build.mjs) and the bundle's module reads it when it is evaluated: a test says what the build would, before the imports above are.
vi.hoisted(() => {
  Reflect.set(globalThis, 'FIXTURE_RAIL', { label: 'Seam Connections', order: 30 });
});

/**
 * What the connections process (`../connections-process/main.go`) says of its two connections: the page's copy of each fact, which the process is held to below and which the seam check asserts (`checkConnectionsAndHome`): the
 * plugin's id for the connection, the line it says under its name (the SDK's `Description`, which the host passes through) and the three records it lists.
 */
const FACTS = {
  north: { id: 'north-57a082bd74', description: 'Fixture · region one', items: ['orders-api', 'ledger-sync', 'billing-sync'] },
  south: { id: 'south-0c3d9e1f42', description: 'Fixture · region two', items: ['harbor-gate', 'tide-table', 'keel-check'] },
} as const;

/* eslint-disable @typescript-eslint/consistent-type-assertions -- a test names only the id, the name and the description of a connection */
const north = { id: FACTS.north.id, name: 'north', description: FACTS.north.description } as Connection;
const south = { id: FACTS.south.id, name: 'south', description: FACTS.south.description } as Connection;
/* eslint-enable @typescript-eslint/consistent-type-assertions */

describe('the connections fixture', () => {
  it('chooses the connection the route names, and the first one for a route that names none or an unknown one', () => {
    expect(chooseConnection([north, south], 'south-0c3d9e1f42')).toBe(south);
    expect(chooseConnection([north, south], 'south-0c3d9e1f42')?.description).toBe(FACTS.south.description);
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

  it('says the overview of a connection from its name and the line its process gives it: the header\'s state and fact, and a list, a table and key-value pairs, with the connection\'s own items', () => {
    for (const name of ['north', 'south'] as const) {
      const view = overviewViewOf(name, FACTS[name].description);
      const content = view.tabs.overview;
      const sections = content?.kind === 'overview' ? content.sections : [];
      const table = sections.find((section) => section.kind === 'table');

      expect(view.state).toEqual({ role: 'healthy', label: 'Connected' });
      expect(view.facts).toEqual([{ text: FACTS[name].description }]);
      expect(sections.map((section) => [section.id, section.kind])).toEqual([['attention', 'list'], ['items', 'table'], ['connection', 'kv']]);
      expect(table?.kind === 'table' ? table.rows.map((row: { readonly name: string }) => row.name) : []).toEqual(FACTS[name].items);
      expect(sections.find((section) => section.kind === 'kv')).toMatchObject({ rows: [{ label: 'Name', value: name }, { label: 'Description', value: FACTS[name].description }, { label: 'Items', value: '3' }] });
    }
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

describe('the connections fixture\'s bundle', () => {
  it('lands a connection on its overview (HM3): the overview is the plugin\'s home and the first entry of its sidebar, the Items list is the page after it, and the host admits the bundle', () => {
    expect(admit({ contributionV1 })).toMatchObject({ ok: true });
    expect(contributionV1.home).toBe('overview');
    expect(contributionV1.sidebar.nodes.map((node) => node.id)).toEqual(['overview', 'things']);
    expect(Object.keys(contributionV1.pages)).toEqual(['overview', 'items']);
    expect(contributionV1.pages.overview.kind).toBe('overview');
    expect(contributionV1.pages.items.kind).toBe('list');
  });
});

/** The text of a string constant of the process (`northDescription = "…"`); undefined when the source declares none. */
function constantOf(source: string, name: string): string | undefined {
  return new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`).exec(source)?.[1];
}

/** Whether the process lists the connection as `{ID: <name>ID, Name: "<name>", Description: <name>Description}`, with `, Labels: <name>Labels()` after the description for a connection that has labels: its id, its name and its description are the constants and the literal the page holds. */
function listsConnection(source: string, name: string): boolean {
  return new RegExp(`\\{ID: ${name}ID, Name: "${name}", Description: ${name}Description(?:, Labels: ${name}Labels\\(\\))?\\}`).test(source);
}

/** The names of the records a connection lists: the `case <name>ID:` of the process's `itemsOf`. */
function itemsIn(source: string, name: string): string[] {
  const body = new RegExp(`case ${name}ID:\\s*return \\[\\]string\\{([^}]*)\\}`).exec(source)?.[1] ?? '';
  return [...body.matchAll(/"([^"]*)"/g)].map((match) => match[1] ?? '');
}

describe('the connections process', () => {
  const source = readFileSync(path.join(__dirname, '../connections-process/main.go'), 'utf8');

  it('lists each connection with its id, its name and its description, as the page and the seam check hold them', () => {
    for (const name of ['north', 'south'] as const) {
      expect(listsConnection(source, name), `${name} is listed with its id, its name and its description`).toBe(true);
      expect(constantOf(source, `${name}ID`), `${name}'s id`).toBe(FACTS[name].id);
      expect(constantOf(source, `${name}Description`), `${name}'s description`).toBe(FACTS[name].description);
    }
  });

  it('lists the records the page lists, for each connection', () => {
    for (const name of ['north', 'south'] as const) {
      expect(itemsIn(source, name), `the records ${name} lists`).toEqual(FACTS[name].items);
      expect(itemsOf(name).map((row) => row.name), `the rows the page draws for ${name}`).toEqual(itemsIn(source, name));
    }
  });

  it('NEGATIVE: a process that says another description, lists a connection with none, or lists another record is not the one the page holds', () => {
    expect(constantOf(source.replace(FACTS.north.description, 'Fixture · region 1'), 'northDescription')).not.toBe(FACTS.north.description);
    expect(listsConnection(source.replace('Description: northDescription', ''), 'north')).toBe(false);
    expect(itemsIn(source.replace('"orders-api"', '"orders-web"'), 'north')).not.toEqual(FACTS.north.items);
    expect(constantOf('', 'northDescription')).toBeUndefined();
  });
});
