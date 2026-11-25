import { LinkProvider, MenuHost, type LinkHandler } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { admit } from '../../contract/admit';
import type { ConnectionV1, ConnectionsHostV1, ConnectionsViewV1, CustomPageContextV1 } from '../../contract/v1';
import { contributionV1 as withoutLanding } from './entry-connections';
import { contributionV1 } from './entry-landing';
import { ALL_TITLE, FAILED_WORDS, LANDING_TITLE, NONE_WORDS, PLUGIN_NAME, READING_WORDS } from './landing-pages';

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

// The landing variant of the connections fixture (KL2): the pages it draws from the plugin's connections, and what pressing them asks of the host, with a stand-in for `context.connections` that holds a view the test changes. The seam's own proof that the host opens a
// plugin at its landing is `PluginHost.landing.test.tsx`; this is the fixture holding its end: the bundle is admitted, and the pages say what they are given in the host's words.

const north: ConnectionV1 = { key: 'north-57a082bd74', name: 'north', description: 'Fixture · region one', state: 'connected', word: 'Connected', role: 'healthy', reason: undefined };
const south: ConnectionV1 = { key: 'south-0c3d9e1f42', name: 'south', description: 'Fixture · region two', state: 'unauthorized', word: 'Needs sign-in', role: 'attention', reason: 'The connection needs you to sign in.' };

/** A handle that holds the view it is told, says so to who listens when it is replaced, and records what it was asked. */
function handleOf(first: ConnectionsViewV1) {
  let view = first;
  const listeners = new Set<() => void>();
  const open = vi.fn<ConnectionsHostV1['open']>(async () => Promise.resolve({ ok: true }));
  const refresh = vi.fn<ConnectionsHostV1['refresh']>(async () => Promise.resolve());
  const connections: ConnectionsHostV1 = {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => view,
    open,
    refresh,
  };
  return {
    connections,
    open,
    refresh,
    set: (next: ConnectionsViewV1) => {
      view = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
  };
}

const ready = (...connections: readonly ConnectionV1[]): ConnectionsViewV1 => ({ loaded: true, failed: false, connections });

const context = (connections: ConnectionsHostV1): CustomPageContextV1 => ({ plugin: 'fixture-f-conn', route: { page: 'landing', connection: undefined, params: {} }, connections });

/** The kit's `Link` asks its provider for the address and for what to do: the page names a page of its own plugin and the provider turns it into the host's address. */
const links: LinkHandler = { hrefOf: (target) => `#/fixture-f-conn/${target.page}`, onOpen: vi.fn() };

function mount(page: 'landing' | 'all', view: ConnectionsViewV1) {
  const handle = handleOf(view);
  const { Body } = contributionV1.pages[page];
  render(
    <MenuHost>
      <LinkProvider handler={links}>
        <Body context={context(handle.connections)} />
      </LinkProvider>
    </MenuHost>,
  );
  return { ...handle, user: userEvent.setup() };
}

let shown: HTMLStyleElement;

beforeEach(() => {
  // jsdom has no Popover API: the setup's stand-in marks an element and nothing shows it, and a popover is `display: none` until a rule says otherwise.
  shown = document.createElement('style');
  shown.textContent = '[popover] { display: block !important; }';
  document.head.append(shown);
});

afterEach(() => {
  cleanup();
  shown.remove();
});

describe('the landing the connections fixture draws', () => {
  it('names the plugin in its header and lists each connection as a card: its name, the host\'s word for where it stands, and the line the plugin says of it, or why a start failed in its place', () => {
    mount('landing', ready(north, south));

    expect(screen.getByRole('heading', { level: 1, name: PLUGIN_NAME })).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Connections' });
    const cards = within(list).getAllByRole('listitem');
    expect(cards.map((card) => card.querySelector('[data-ov-part="title"]')?.textContent)).toEqual(['north', 'south']);
    expect(within(cards[0]).getByText('Connected')).toBeInTheDocument();
    expect(within(cards[0]).getByText('Fixture · region one')).toBeInTheDocument();
    expect(within(cards[1]).getByText('Needs sign-in')).toBeInTheDocument();
    expect(within(cards[1]).getByText('The connection needs you to sign in.')).toBeInTheDocument();
    expect(within(cards[1]).queryByText('Fixture · region two')).toBeNull();
    // A connection that needs attention says so by the border and by the word, and the key is drawn nowhere.
    expect(cards[1]?.querySelector('[data-ov-part="resource-card"]')).toHaveAttribute('data-ov-tone', 'warning');
    expect(document.body.textContent).not.toContain(north.key);
  });

  it('opens a connection from its card, and in a new tab from the card\'s other button, by its key and by no other: the host starts it and opens its page', async () => {
    const { user, open } = mount('landing', ready(north, south));
    const card = within(screen.getByRole('list', { name: 'Connections' })).getAllByRole('listitem')[1];

    await user.click(within(card).getByRole('button', { name: 'Open' }));
    await user.click(within(card).getByRole('button', { name: 'Open in new tab' }));

    expect(open.mock.calls).toEqual([[south.key], [south.key, { newTab: true }]]);
  });

  it('opens a connection from the menu a card opens, which the page registers with the kit\'s menu: Open and Open in new tab', async () => {
    const { user, open } = mount('landing', ready(north, south));
    const card = within(screen.getByRole('list', { name: 'Connections' })).getAllByRole('listitem')[0]?.querySelector('[data-ov-part="resource-card"]');
    expect(card).not.toBeNull();

    fireEvent.contextMenu(card!, { button: 2, clientX: 30, clientY: 40 });
    expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual(['Open', 'Open in new tab']);
    await user.click(screen.getByRole('menuitem', { name: 'Open in new tab' }));

    expect(open).toHaveBeenCalledExactlyOnceWith(north.key, { newTab: true });
  });

  it('reads the connections again from the header\'s command, and follows the view: a connection that changed is drawn with its new word', async () => {
    const { user, refresh, set } = mount('landing', ready(north));

    await user.click(screen.getByRole('button', { name: 'Refresh connections' }));
    expect(refresh).toHaveBeenCalledTimes(1);

    act(() => {
      set(ready({ ...north, state: 'connecting', word: 'Connecting…', role: 'progress' }, south));
    });
    const cards = within(screen.getByRole('list', { name: 'Connections' })).getAllByRole('listitem');
    expect(cards).toHaveLength(2);
    expect(within(cards[0]).getByText('Connecting…')).toBeInTheDocument();
  });

  it('says that it is reading, that it could not, and that there are none: each in its own words, and a list that was not read is never drawn as none', () => {
    const view = (over: Partial<ConnectionsViewV1>): ConnectionsViewV1 => ({ loaded: true, failed: false, connections: [], ...over });

    for (const [words, state, others] of [
      [READING_WORDS, view({ loaded: false }), [FAILED_WORDS, NONE_WORDS]],
      [FAILED_WORDS, view({ failed: true }), [READING_WORDS]],
      [NONE_WORDS, view({}), [READING_WORDS, FAILED_WORDS]],
    ] as const) {
      mount('landing', state);
      expect(screen.getByText(words)).toBeInTheDocument();
      for (const other of others) {
        expect(screen.queryByText(other)).toBeNull();
      }

      cleanup();
    }
  });

  it('links to the page of all its connections with the kit\'s Link, by the page id the plugin gave it', () => {
    mount('landing', ready(north));

    expect(screen.getByRole('link', { name: 'All connections' })).toHaveAttribute('href', '#/fixture-f-conn/all');
  });
});

describe('the page of all the connections', () => {
  it('draws the connections as the rows of a table, in a data view that fills the page, and links back to the landing', async () => {
    const { user, open } = mount('all', ready(north, south));

    expect(screen.getByRole('heading', { level: 1, name: ALL_TITLE })).toBeInTheDocument();
    const table = screen.getByRole('region', { name: ALL_TITLE });
    expect(within(table).getByText('Needs sign-in')).toBeInTheDocument();
    expect(within(table).getByText('Fixture · region one')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to the landing' })).toHaveAttribute('href', '#/fixture-f-conn/landing');

    await user.click(within(table).getByRole('button', { name: 'north' }));
    expect(open).toHaveBeenCalledExactlyOnceWith(north.key);
  });

  it('says that it is loading while nothing was read, and that there are none when the plugin has none', () => {
    mount('all', { loaded: false, failed: false, connections: [] });
    expect(screen.getByRole('status', { name: `Loading ${ALL_TITLE}` })).toHaveAttribute('aria-busy', 'true');
    cleanup();

    mount('all', ready());
    expect(screen.getByText(`No ${ALL_TITLE}`)).toBeInTheDocument();
  });
});

describe('the connections fixture\'s bundle with a landing', () => {
  it('declares the landing and a page of all connections, both read in no connection, and is admitted by the host', () => {
    expect(admit({ contributionV1 })).toMatchObject({ ok: true });
    expect(contributionV1.landing).toBe('landing');
    expect(contributionV1.pages.landing).toMatchObject({ kind: 'custom', scope: 'plugin', title: LANDING_TITLE });
    expect(contributionV1.pages.all).toMatchObject({ kind: 'custom', scope: 'plugin', title: ALL_TITLE, layout: 'pane' });
  });

  it('keeps everything the plugin had: its home is still the page a connection lands on, and its pages and sidebar are the connections fixture\'s', () => {
    expect(contributionV1.home).toBe('overview');
    expect(contributionV1.sidebar).toBe(withoutLanding.sidebar);
    expect(contributionV1.pages.overview).toBe(withoutLanding.pages.overview);
    expect(contributionV1.pages.items).toBe(withoutLanding.pages.items);
  });

  it('is a variant written on request: the plugin as the seam\'s other scenarios open it declares none', () => {
    expect(Object.keys(withoutLanding.pages)).toEqual(['overview', 'items']);
    expect(Object.hasOwn(withoutLanding, 'landing')).toBe(false);
  });
});
