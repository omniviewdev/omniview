import { Link } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ContextV1, DetailPageV1, DetailSource, DetailView, ListPageV1 } from '../contract/v1';
import { acme, answering, widgetPage, WIDGETS, type Widget } from '../testing';
import { describeDetail } from './contributions';
import { PluginHost, type PluginHostProps } from './PluginHost';
import type { PluginEntry } from './pluginStore';
import { NO_ROUTE, type HostRoute } from './route';

// jsdom lays nothing out: the table's region gets the size a browser would give it, so rows are in view.
Object.defineProperty(HTMLElement.prototype, 'clientHeight', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 600 : 0;
} });
Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: function get(this: HTMLElement) {
  return this.getAttribute('role') === 'region' ? 1117 : 0;
} });

// The detail page through the host, against an invented plugin (Acme): widgets listed, each opening a sprocket's page. What is under test is what the host does with a detail contribution: the tab
// it opens (its title from the route, smart open, the dispositions of a click), the page it draws in every state of the data, and the face it describes before a hook has run.

const retry = vi.fn<() => void>();
const scale = vi.fn<() => void>();

const view = (): DetailView => ({
  state: { role: 'running', label: 'Running' },
  facts: [{ text: 'Sprocket' }, { text: 'east' }],
  commands: { primary: { id: 'scale', label: 'Scale', onSelect: scale } },
  counts: { notes: 2 },
  tabs: {
    overview: {
      kind: 'overview',
      summary: [{ status: { role: 'running', label: 'Running' } }, { value: '2/2', label: 'ready' }],
      sections: [
        { id: 'details', kind: 'kv', title: 'Details', rows: [{ label: 'Bay', value: 'east' }] },
        { id: 'empty', kind: 'kv', title: 'Nothing here', rows: [] },
        { id: 'labels', kind: 'tags', title: 'Labels', placement: 'aside', items: [{ key: 'app', value: 'sprocket' }] },
      ],
    },
    notes: { kind: 'custom', content: 'the notes' },
  },
});

const sourceOf = (name: string): DetailSource => {
  const base = { refreshing: false, refresh: async () => undefined };
  switch (name) {
    case 'gone':
      return { ...base, state: { kind: 'not-found' }, view: undefined };
    case 'locked':
      return { ...base, state: { kind: 'denied' }, view: undefined };
    case 'broken':
      return { ...base, state: { kind: 'failed', message: 'The read timed out.', retry }, view: undefined };
    case 'slow':
      return { ...base, state: { kind: 'loading' }, view: undefined };
    default:
      return { ...base, state: { kind: 'ready' }, view: view() };
  }
};

const sprocketPage: DetailPageV1 = {
  kind: 'detail',
  definition: {
    kind: 'Sprocket',
    tile: { icon: 'box' },
    identity: { name: 'name', facets: ['bay'] },
    list: { page: 'widgets', label: 'Widgets' },
    tabs: [
      { id: 'overview', label: 'Overview' },
      { id: 'notes', label: 'Notes' },
    ],
  },
  usePage: (context: ContextV1) => ({ scope: [{ label: 'Connection', icon: 'server', text: context.route.connection ?? 'none' }], source: sourceOf(context.route.params.name ?? '') }),
};

/** The widgets list with the name cell a link to the widget's sprocket, as a plugin writes it. */
const listed = (): ListPageV1<Widget> => {
  const base = widgetPage('Widgets', answering(WIDGETS));
  return {
    ...base,
    definition: {
      ...base.definition,
      columns: [{ id: 'name', header: 'Name', fit: 'flex', width: 160, text: (row) => row.name, cell: (row) => <Link to={{ page: 'sprocket', params: { name: row.name, bay: 'east' } }}>{row.name}</Link> }],
    },
  };
};

const ready = (): PluginEntry => ({ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme({ pages: { ...acme().pages, widgets: listed(), sprocket: sprocketPage } }) });
const deep = (name: string, bay = 'east'): HostRoute => ({ plugin: 'acme', page: 'sprocket', connection: 'north', params: { name, bay } });

// One snapshot for every read, as a store gives: a new array on each read would never settle.
const entries: readonly PluginEntry[] = [ready()];
const plugins = { getSnapshot: () => entries, subscribe: () => () => undefined };

function mount(over: Partial<PluginHostProps> = {}) {
  const props: PluginHostProps = { plugins, inventory: 'ready', link: NO_ROUTE, onRetry: vi.fn(), onRetryInventory: vi.fn(), ...over };
  return { ...render(<PluginHost {...props} />), user: userEvent.setup() };
}

const tabs = () => screen.queryAllByRole('tab', { name: /./ }).filter((tab) => tab.closest('[aria-label="Open tabs"]') !== null);
const selectedTab = () => tabs().find((tab) => tab.getAttribute('aria-selected') === 'true');
const labels = () => tabs().map((tab) => tab.textContent);

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.location.hash = '';
});

describe('a link of a list row to a detail page', () => {
  it('is a real anchor that carries the destination\'s address', () => {
    mount();

    expect(screen.getByRole('link', { name: 'alpha' })).toHaveAttribute('href', '#/acme/sprocket?name=alpha&bay=east');
  });

  it('opens the object in the tab on screen on a plain click (smart open), titled {name} · {Kind}, with the list still current in the sidebar', async () => {
    const { user } = mount();
    await user.click(screen.getByRole('link', { name: 'alpha' }));

    expect(labels()).toHaveLength(1);
    expect(selectedTab()).toHaveAccessibleName(/alpha · Sprocket/);
    expect(screen.getByRole('heading', { level: 1, name: 'alpha' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Sprocket sections' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Widgets', selected: true })).toBeInTheDocument();
  });

  it('opens it in a background tab on Control-click and on a middle click, and the tab on screen stays the list', () => {
    mount();
    fireEvent.click(screen.getByRole('link', { name: 'alpha' }), { ctrlKey: true });
    fireEvent(screen.getByRole('link', { name: 'beta' }), new MouseEvent('auxclick', { button: 1, bubbles: true, cancelable: true }));

    expect(labels()).toHaveLength(3);
    expect(selectedTab()).toHaveAccessibleName(/Widgets/);
    expect(labels().join(' | ')).toMatch(/alpha · Sprocket/);
    expect(labels().join(' | ')).toMatch(/beta · Sprocket/);
  });

  it('opens it on Enter from the focused link', async () => {
    const { user } = mount();
    screen.getByRole('link', { name: 'beta' }).focus();
    await user.keyboard('{Enter}');

    expect(selectedTab()).toHaveAccessibleName(/beta · Sprocket/);
  });

  it('shows the tab that already shows the object when the same link is chosen again: smart open re-activates, it never makes a twin', () => {
    mount();
    fireEvent.click(screen.getByRole('link', { name: 'alpha' }), { ctrlKey: true });
    expect(labels()).toHaveLength(2);
    expect(selectedTab()).toHaveAccessibleName(/Widgets/);

    fireEvent.click(screen.getByRole('link', { name: 'alpha' }));

    expect(labels()).toHaveLength(2);
    expect(selectedTab()).toHaveAccessibleName(/alpha · Sprocket/);
  });
});

describe('the detail page of a route', () => {
  it('draws the header, the strip and the Overview from the object: the state, the facts, the commands, the summary, the sections with something to say, the aside and the tab count', () => {
    mount({ link: deep('alpha') });

    expect(selectedTab()).toHaveAccessibleName(/alpha · Sprocket/);
    expect(screen.getByRole('heading', { level: 1, name: 'alpha' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Scale' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'alpha status' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Details' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Nothing here' })).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Labels' })).getByText('app')).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /Notes\s*2/ })).toBeInTheDocument();
    expect(document.querySelector('[data-page-slot]')).toHaveAttribute('data-layout', 'document');
  });

  it('reports a command to the plugin\'s callback', async () => {
    const { user } = mount({ link: deep('alpha') });
    await user.click(screen.getByRole('button', { name: 'Scale' }));

    expect(scale).toHaveBeenCalledTimes(1);
  });

  it('switches the in-page tab with the arrow keys and shows the plugin\'s own content', async () => {
    const { user } = mount({ link: deep('alpha') });
    screen.getByRole('tab', { name: 'Overview' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('tab', { name: /Notes/ })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tabpanel', { name: /Notes/ })).toHaveTextContent('the notes');
  });

  it.each([
    ['slow', /Loading slow/],
    ['gone', /slow|gone was not found/],
    ['locked', /Access to locked is denied/],
    ['broken', /Couldn't load broken/],
  ])('says %s in its own words, with the header and the strip where they were', (name, words) => {
    mount({ link: deep(name) });

    expect(screen.getByRole('heading', { level: 1, name })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Sprocket sections' })).toBeInTheDocument();
    expect(document.body).toHaveTextContent(name === 'slow' ? /Loading/ : words);
  });

  it('offers the plugin\'s Retry for a failed read, and no Retry for a denied one', async () => {
    const { user } = mount({ link: deep('broken') });
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(retry).toHaveBeenCalledTimes(1);
    cleanup();
    mount({ link: deep('locked') });
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('draws the back path above the heading, its list crumb a link that goes back to the list', async () => {
    const { user } = mount({ link: deep('alpha') });
    const path = within(screen.getByRole('navigation', { name: 'Breadcrumb' }));
    await user.click(path.getByRole('button', { name: 'Widgets' }));

    expect(screen.getByRole('heading', { level: 1, name: 'Widgets' })).toBeInTheDocument();
    expect(labels()).toHaveLength(1);
  });
});

describe('describeDetail: the face of a detail route is the route\'s and the definition\'s alone', () => {
  const route = { plugin: 'acme', contribution: 'sprocket', params: { connection: 'north', name: 'alpha', bay: 'east' } };

  it('is the title, the glyph, the path with its list crumb, the scope and the qualifiers (group first, then the connection)', () => {
    expect(describeDetail('Acme', route, sprocketPage.definition)).toEqual({
      title: 'alpha · Sprocket',
      icon: 'box',
      pluginName: 'Acme',
      path: ['Acme', 'north', { label: 'Widgets', route: { plugin: 'acme', contribution: 'widgets', params: { connection: 'north' } } }, 'alpha'],
      scope: { id: 'north', label: 'north' },
      facets: ['east', 'north'],
    });
  });

  it('is the kind alone, with no connection and no list, for a route that names nothing', () => {
    const face = describeDetail('Acme', { plugin: 'acme', contribution: 'sprocket', params: {} }, { ...sprocketPage.definition, list: undefined });

    expect(face.title).toBe('Sprocket');
    expect(face.path).toEqual(['Acme', 'Sprocket']);
    expect(face.scope).toBeUndefined();
    expect(face.facets).toEqual([]);
  });
});
