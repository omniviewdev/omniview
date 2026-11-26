import { LinkProvider, MenuHost, type LinkHandler } from '@omniviewdev/kit';
import { cleanup, fireEvent, render, renderHook, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { admit, openable } from '../../contract/admit';
import type { ConnectionV1, ConnectionVerbResultV1, ConnectionsHostV1, ConnectionsViewV1, CustomPageContextV1 } from '../../contract/v1';
import { contributionV1 as withoutLanding } from './entry-connections';
import { contributionV1 } from './entry-landing';

// The build writes the rail entry into the bundle (`define`, build.mjs) and the bundle's module reads it when it is evaluated: a test says what the build would, before the imports above are.
vi.hoisted(() => {
  Reflect.set(globalThis, 'FIXTURE_RAIL', { label: 'Seam Connections', order: 30 });
});

Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

// The landing variant of the connections fixture (KL2): what its two pages draw from `context.connections` and what pressing them asks of the host, with a stand-in for the host's handle. That the host opens a plugin at its landing is `PluginHost.landing.test.tsx`.

const north: ConnectionV1 = { key: 'north-57a082bd74', name: 'north', description: 'Fixture · region one', labels: { env: 'fixture', tier: 'one' }, state: 'connected', word: 'Connected', role: 'healthy', reason: undefined };
const south: ConnectionV1 = { key: 'south-0c3d9e1f42', name: 'south', description: 'Fixture · region two', labels: {}, state: 'unauthorized', word: 'Needs sign-in', role: 'attention', reason: 'The connection needs you to sign in.' };

const links: LinkHandler = { hrefOf: (target) => `#/fixture-f-conn/${target.page}`, onOpen: vi.fn() };

function mount(page: 'landing' | 'all', connectionsOver: Partial<ConnectionsHostV1> = {}, params: Readonly<Record<string, string>> = {}) {
  const view: ConnectionsViewV1 = { loaded: true, failed: false, connections: [north, south] };
  const open = vi.fn<ConnectionsHostV1['open']>(async () => Promise.resolve({ ok: true }));
  const worked = async (): Promise<ConnectionVerbResultV1> => Promise.resolve({ ok: true });
  const connections: ConnectionsHostV1 = {
    subscribe: () => () => undefined,
    getSnapshot: () => view,
    open,
    connect: vi.fn<ConnectionsHostV1['connect']>(worked),
    check: vi.fn<ConnectionsHostV1['check']>(worked),
    disconnect: vi.fn<ConnectionsHostV1['disconnect']>(worked),
    remove: vi.fn<ConnectionsHostV1['remove']>(worked),
    refresh: async () => Promise.resolve(),
    ...connectionsOver,
  };
  const { Body } = contributionV1.pages[page];
  // The host's call that changes the parameters of the page's own route (KL7): a stand-in that records what the page asks.
  const setParams = vi.fn<CustomPageContextV1['setParams']>();
  render(
    <MenuHost>
      <LinkProvider handler={links}>
        <Body context={{ plugin: 'fixture-f-conn', route: { page, connection: undefined, params }, connections, setParams }} />
      </LinkProvider>
    </MenuHost>,
  );
  return { open, connections, setParams, user: userEvent.setup() };
}

let shown: HTMLStyleElement;

beforeEach(() => {
  // jsdom has no Popover API: the setup's stand-in marks an element and nothing shows it, and a popover is `display: none` until a rule says otherwise, which makes it inaccessible to the queries (Home's menu tests do the same).
  shown = document.createElement('style');
  shown.textContent = '[popover] { display: block !important; }';
  document.head.append(shown);
});

afterEach(() => {
  cleanup();
  shown.remove();
});

describe('the connections fixture with a landing', () => {
  it('draws each connection as a card in the host\'s words, with the reason a start failed in place of the description, and opens it by its key, in a new tab from the card\'s other button', async () => {
    const { user, open } = mount('landing');
    const cards = within(screen.getByRole('list', { name: 'Connections' })).getAllByRole('listitem');

    expect(cards.map((card) => card.querySelector('[data-ov-part="title"]')?.textContent)).toEqual(['north', 'south']);
    expect(within(cards[0]).getByText('Fixture · region one')).toBeInTheDocument();
    expect(within(cards[0]).getByText('env=fixture, tier=one')).toBeInTheDocument();
    expect(within(cards[1]).queryByText('Labels')).toBeNull();
    expect(within(cards[1]).getByText('Needs sign-in')).toBeInTheDocument();
    expect(within(cards[1]).getByText('The connection needs you to sign in.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All connections' })).toHaveAttribute('href', '#/fixture-f-conn/all');

    await user.click(within(cards[1]).getByRole('button', { name: 'Open' }));
    await user.click(within(cards[1]).getByRole('button', { name: 'Open in new tab' }));
    expect(open.mock.calls).toEqual([[south.key], [south.key, { newTab: true }]]);
  });

  it('offers the host\'s verbs in a card\'s menu, calls each with the connection\'s key, and says what the host answered: done, a no from the person, and a sentence of refusal', async () => {
    const disconnect = vi.fn<ConnectionsHostV1['disconnect']>(async () => Promise.resolve({ ok: false, reason: 'Cancelled.', cancelled: true }));
    const remove = vi.fn<ConnectionsHostV1['remove']>(async () => Promise.resolve({ ok: false, reason: 'south is connecting. Try again when it has finished.' }));
    const { user, connections } = mount('landing', { disconnect, remove });
    const card = within(within(screen.getByRole('list', { name: 'Connections' })).getAllByRole('listitem')[1]).getByText('south');
    const choose = async (name: string) => {
      fireEvent.contextMenu(card, { button: 2, clientX: 30, clientY: 40 });
      await user.click(await screen.findByRole('menuitem', { name }));
    };

    await choose('Connect');
    await waitFor(() => {
      expect(screen.getByText('connect: done.')).toBeInTheDocument();
    });
    await choose('Check');
    await choose('Disconnect…');
    await waitFor(() => {
      expect(screen.getByText('disconnect: cancelled.')).toBeInTheDocument();
    });
    await choose('Remove…');
    await waitFor(() => {
      expect(screen.getByText('remove: south is connecting. Try again when it has finished.')).toBeInTheDocument();
    });

    for (const verb of ['connect', 'check', 'disconnect', 'remove'] as const) {
      expect(connections[verb], verb).toHaveBeenCalledExactlyOnceWith(south.key);
    }
  });

  it('draws the page of all of them as the rows of a table in a data view, and links back to the landing', async () => {
    const { user, open } = mount('all');
    const table = screen.getByRole('region', { name: 'Connections' });

    expect(within(table).getByText('Needs sign-in')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the landing' })).toHaveAttribute('href', '#/fixture-f-conn/landing');

    await user.click(within(table).getByRole('button', { name: 'north' }));
    expect(open).toHaveBeenCalledExactlyOnceWith(north.key);
  });

  it('is a bundle the host admits, with a landing and a page that owns its scrolling, that keeps what the connections plugin had and leaves the plugin written without it as it was', () => {
    expect(admit({ contributionV1 })).toMatchObject({ ok: true });
    expect(contributionV1.landing).toBe('landing');
    expect(contributionV1.pages.all).toMatchObject({ kind: 'custom', scope: 'plugin', layout: 'pane' });
    expect(contributionV1.home).toBe('overview');
    expect(contributionV1.pages.overview).toBe(withoutLanding.pages.overview);
    expect(Object.hasOwn(withoutLanding, 'landing')).toBe(false);
    expect(contributionV1.sidebar.pluginScope).toEqual({ title: 'Plugin', label: 'Seam Connections plugin navigation' });
  });

  it('changes its own parameters with the host\'s call, keeping the other: the strip of filters pushes an entry in the tab\'s history, the order takes the tab\'s own, and no parameter is written for what is the default', async () => {
    const { user, setParams } = mount('landing', {}, { filter: 'connected' });

    await user.click(within(screen.getByRole('radiogroup', { name: 'Sort connections' })).getByRole('radio', { name: 'State' }));
    expect(setParams).toHaveBeenLastCalledWith({ filter: 'connected', sort: 'state' });
    await user.click(within(screen.getByRole('group', { name: 'Connection state' })).getByRole('button', { name: /^Needs attention/ }));
    expect(setParams).toHaveBeenLastCalledWith({ filter: 'attention' }, { history: 'push' });
    await user.click(within(screen.getByRole('group', { name: 'Connection state' })).getByRole('button', { name: /^All/ }));
    expect(setParams).toHaveBeenLastCalledWith({}, { history: 'push' });
  });

  it('reads the filter and the order from the route, and narrows what it lists by what is typed in its search, which is the page\'s own state and no parameter', async () => {
    const { user, setParams } = mount('landing', {}, { filter: 'attention', sort: 'state' });
    const cards = () => screen.queryAllByRole('listitem').map((card) => card.querySelector('[data-ov-part="title"]')?.textContent);

    expect(cards()).toEqual(['south']);
    expect(screen.getByText('Showing: Needs attention')).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'State' })).toBeChecked();
    await user.type(screen.getByRole('searchbox', { name: 'Search connections' }), 'nor');

    expect(cards()).toEqual([]);
    expect(setParams).not.toHaveBeenCalled();
  });

  it('answers a navigator on the pages that are read in no connection, which the host keeps whole, and nothing on a page of a connection: the filters with their counts, and the connections, in a group that starts open, with a colour and, on the one that needs a look, a badge (KL5, KL7); the filters carry the order the page is in', () => {
    const view: ConnectionsViewV1 = { loaded: true, failed: false, connections: [north, south] };
    const worked = async (): Promise<ConnectionVerbResultV1> => Promise.resolve({ ok: true });
    const connections: ConnectionsHostV1 = { subscribe: () => () => undefined, getSnapshot: () => view, open: async () => Promise.resolve({ ok: true }), connect: worked, check: worked, disconnect: worked, remove: worked, refresh: async () => Promise.resolve() };
    const answer = (page: string, params: Readonly<Record<string, string>> = {}) => renderHook(() => contributionV1.sidebar.useNodes({ plugin: 'fixture-f-conn', route: { page, connection: undefined, params }, open: [], connections })).result.current;
    const nodes = answer('landing') ?? [];

    expect(openable(nodes, contributionV1.pages)).toEqual(nodes);
    expect(nodes.map((node) => [node.label, node.count])).toEqual([['All', 2], ['Connected', 1], ['Needs attention', 1], ['Connections', undefined]]);
    expect(nodes[2]).toMatchObject({ page: 'landing', params: { filter: 'attention' } });
    expect(nodes[3]).toMatchObject({ expanded: true });
    expect((answer('landing', { filter: 'connected', sort: 'state' }) ?? []).slice(1, 3).map((node) => node.params)).toEqual([{ filter: 'connected', sort: 'state' }, { filter: 'attention', sort: 'state' }]);
    expect(nodes[3].children).toEqual([
      { id: `connection-${north.key}`, label: 'north', icon: 'server', tone: 'green', connection: north.key },
      { id: `connection-${south.key}`, label: 'south', icon: 'server', tone: 'amber', connection: south.key, status: { role: 'attention', label: 'Needs sign-in' } },
    ]);
    expect(answer('overview')).toBeUndefined();
  });
});
