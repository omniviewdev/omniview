import { LinkProvider, MenuHost, type LinkHandler } from '@omniviewdev/kit';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { admit } from '../../contract/admit';
import type { ConnectionV1, ConnectionsHostV1, ConnectionsViewV1 } from '../../contract/v1';
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

const north: ConnectionV1 = { key: 'north-57a082bd74', name: 'north', description: 'Fixture · region one', state: 'connected', word: 'Connected', role: 'healthy', reason: undefined };
const south: ConnectionV1 = { key: 'south-0c3d9e1f42', name: 'south', description: 'Fixture · region two', state: 'unauthorized', word: 'Needs sign-in', role: 'attention', reason: 'The connection needs you to sign in.' };

const links: LinkHandler = { hrefOf: (target) => `#/fixture-f-conn/${target.page}`, onOpen: vi.fn() };

function mount(page: 'landing' | 'all') {
  const view: ConnectionsViewV1 = { loaded: true, failed: false, connections: [north, south] };
  const open = vi.fn<ConnectionsHostV1['open']>(async () => Promise.resolve({ ok: true }));
  const connections: ConnectionsHostV1 = { subscribe: () => () => undefined, getSnapshot: () => view, open, refresh: async () => Promise.resolve() };
  const { Body } = contributionV1.pages[page];
  render(
    <MenuHost>
      <LinkProvider handler={links}>
        <Body context={{ plugin: 'fixture-f-conn', route: { page, connection: undefined, params: {} }, connections }} />
      </LinkProvider>
    </MenuHost>,
  );
  return { open, user: userEvent.setup() };
}

afterEach(cleanup);

describe('the connections fixture with a landing', () => {
  it('draws each connection as a card in the host\'s words, with the reason a start failed in place of the description, and opens it by its key, in a new tab from the card\'s other button', async () => {
    const { user, open } = mount('landing');
    const cards = within(screen.getByRole('list', { name: 'Connections' })).getAllByRole('listitem');

    expect(cards.map((card) => card.querySelector('[data-ov-part="title"]')?.textContent)).toEqual(['north', 'south']);
    expect(within(cards[0]).getByText('Fixture · region one')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Needs sign-in')).toBeInTheDocument();
    expect(within(cards[1]).getByText('The connection needs you to sign in.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'All connections' })).toHaveAttribute('href', '#/fixture-f-conn/all');

    await user.click(within(cards[1]).getByRole('button', { name: 'Open' }));
    await user.click(within(cards[1]).getByRole('button', { name: 'Open in new tab' }));
    expect(open.mock.calls).toEqual([[south.key], [south.key, { newTab: true }]]);
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
  });
});
