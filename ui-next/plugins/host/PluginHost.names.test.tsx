import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSession, SESSION_VERSION } from '../../shell/session';
import { memoryStorage } from '../../shell/session/testing';
import type { ContextV1, DetailPageV1, DetailSource, DetailView } from '../contract/v1';
import { acme, answering, startedOn, widgetPage } from '../testing';
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

// The connection a window says (C1g), through the real window: a route carries a connection by a KEY (`north-57a082bd74`) and the plugin's page says the NAME (`north`) in its scope lane. The tab strip's label and
// accessible name, the status bar's path and the scope lane say the name; the key is in no text and no accessible name anywhere in the window, whether the window was opened by a link or
// restored from a session that a build before the names saved, and nothing of it is drawn while the plugin is loading.

const KEY = 'north-57a082bd74';
const NAME = 'north';
const lane = [{ label: 'Connection', icon: 'server' as const, text: NAME }];

const source = (): DetailSource => ({ refreshing: false, refresh: async () => undefined, state: { kind: 'ready' }, view: view() });
const view = (): DetailView => ({
  state: { role: 'running', label: 'Running' },
  facts: [{ text: 'Sprocket' }],
  commands: {},
  counts: {},
  tabs: { overview: { kind: 'overview', summary: [], sections: [] } },
});

/** The page that says the name in its lane, and the key nowhere. */
const sprocketPage: DetailPageV1 = {
  kind: 'detail',
  definition: { kind: 'Sprocket', tile: { icon: 'box' }, identity: { name: 'name' }, list: { page: 'widgets', label: 'Widgets' }, tabs: [{ id: 'overview', label: 'Overview' }] },
  usePage: (_context: ContextV1) => ({ scope: lane, source: source() }),
};

const named = (context: ContextV1) => {
  const listed = answering([], 'Widgets')(context);
  return { ...listed, frame: { ...listed.frame, scope: lane } };
};

const entryReady = (): PluginEntry & { readonly phase: 'ready' } => ({ id: 'acme', name: 'Acme plugin', phase: 'ready', contribution: acme({ pages: { ...acme().pages, widgets: widgetPage('Widgets', named), gadgets: widgetPage('Gadgets', named), sprocket: sprocketPage } }) });
const entryLoading = (): PluginEntry => ({ id: 'acme', name: 'Acme plugin', phase: 'loading' });

/** Everything the window draws that a person or a screen reader reads, and where it is: text, and the attributes that name or describe an element. */
function drawn(): string[] {
  const out: string[] = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    out.push(`text: ${node.textContent ?? ''}`);
  }

  for (const element of document.body.querySelectorAll('*')) {
    for (const attribute of ['aria-label', 'title', 'alt', 'placeholder', 'aria-description', 'aria-valuetext']) {
      const value = element.getAttribute(attribute);
      if (value !== null) {
        out.push(`${attribute}: ${value}`);
      }
    }
  }

  return out;
}

const keysDrawn = (): string[] => drawn().filter((text) => text.includes(KEY));
const tabs = () => screen.queryAllByRole('tab').filter((tab) => tab.closest('[aria-label="Open tabs"]') !== null);
const path = () => screen.getByRole('navigation', { name: 'Current resource' });

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function mount(initial: readonly PluginEntry[], over: Partial<PluginHostProps> = {}) {
  let entries = initial;
  const listeners = new Set<() => void>();
  const plugins = {
    getSnapshot: () => entries,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
  const props: PluginHostProps = { plugins, inventory: 'ready', link: NO_ROUTE, onRetry: vi.fn(), onRetryInventory: vi.fn(), ...over };
  return {
    ...render(<PluginHost {...props} />),
    set: (next: readonly PluginEntry[]) => {
      act(() => {
        entries = next;
        for (const listener of [...listeners]) {
          listener();
        }
      });
    },
  };
}

describe('a window opened at a page of a connection by a link', () => {
  const link = (page: string, params: Record<string, string> = {}): HostRoute => ({ plugin: 'acme', page, connection: KEY, params });
  const entries = [entryReady()];

  it('says the name in the strip, the status bar and the scope controls, and the key in none of what the window draws', () => {
    mount(entries, { link: link('sprocket', { name: 'alpha' }) });

    expect(within(path()).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Acme', NAME, 'Widgets', 'alpha']);
    expect(tabs()[0]?.getAttribute('aria-label')).toContain(NAME);
    expect(screen.getByRole('group', { name: 'Acme scope' })).toHaveTextContent(NAME);
    expect(within(path()).getByRole('button', { name: 'Widgets' })).toBeInTheDocument();
    expect(keysDrawn()).toEqual([]);
  });

  it('says it for a list page too, by the tab\'s accessible name: the path of a list page is the plugin\'s own, and the key is the tab\'s place and is never drawn', () => {
    mount(entries, { link: link('widgets') });

    expect(within(path()).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Acme', 'Widgets']);
    expect(tabs().some((tab) => (tab.getAttribute('aria-label') ?? '').includes(NAME))).toBe(true);
    expect(keysDrawn()).toEqual([]);
  });

  it('draws the key nowhere before the page has said its name either: a plugin that publishes no lane has no name, and its tab and path say no connection', () => {
    const quiet: PluginEntry = { ...entryReady(), contribution: acme({ pages: { ...acme().pages, widgets: widgetPage('Widgets', (context) => ({ ...answering([], 'Widgets')(context), frame: { tab: { title: 'Widgets', icon: 'box' }, path: ['Acme', KEY, 'Widgets'] } })) } }) };
    mount([quiet], { link: link('widgets') });

    expect(within(path()).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Acme', 'Widgets']);
    expect(keysDrawn()).toEqual([]);
  });
});

describe('a window restored from a session that holds connection keys', () => {
  /** A tab as a build before the names saved it: the key is the scope's label, a crumb of the path and a facet. */
  const keyedTab = (id: string, page: string, title: string, extra: Record<string, string> = {}) => {
    const route = { plugin: 'acme', contribution: page, params: { connection: KEY, ...extra } };
    return {
      id,
      route,
      key: `acme:${KEY}:${page}`,
      face: { title, icon: 'box', scope: { id: KEY, label: KEY }, path: [{ label: 'Acme' }, { label: KEY }, { label: title }], facets: [KEY], pluginName: 'Acme', singleton: false, identity: 'key' },
      pinned: false,
      preview: false,
      history: { entries: [route], index: 0 },
    };
  };

  const saved = (): string => JSON.stringify({ version: SESSION_VERSION, tabs: { version: 1, active: 't1', tabs: [keyedTab('t1', 'widgets', 'Widgets'), keyedTab('t2', 'gadgets', 'Gadgets')] }, rail: null, panel: { version: 1 } });
  const restoredFrom = (text: string) => openSession(memoryStorage(text).storage, text, { log: vi.fn(), now: () => 1_700_000_000_000 });

  it('draws no key while the plugin is loading: the tabs are drawn as they were left, without the key a build before the names saved in them', () => {
    mount([entryLoading()], { session: restoredFrom(saved()) });

    expect(tabs().map((tab) => tab.textContent)).toEqual(['Widgets', 'Gadgets']);
    expect(keysDrawn()).toEqual([]);
  });

  it('says the names once the plugin has loaded and the page on screen has said its own: the tab on screen, and the tab of the same connection that was never drawn', () => {
    const world = mount([entryLoading()], { session: restoredFrom(saved()) });
    expect(keysDrawn()).toEqual([]);

    world.set([entryReady()]);

    expect(keysDrawn()).toEqual([]);
    expect(within(path()).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Acme', 'Widgets']);
    expect(tabs().map((tab) => tab.getAttribute('aria-label') ?? '')).toEqual(expect.arrayContaining([expect.stringContaining(NAME)]));
    // The background tab was never drawn in this window: it has the name the window learned for the connection.
    expect(tabs()[1]?.getAttribute('aria-label') ?? '').toContain(NAME);
  });

  it('keeps the name a session saved with the names: drawn while the plugin loads, with no page drawn yet', () => {
    const route = { plugin: 'acme', contribution: 'widgets', params: { connection: KEY } };
    const tab = { ...keyedTab('t1', 'widgets', 'Widgets'), face: { title: 'Widgets', icon: 'box', scope: { id: KEY, label: NAME }, path: [{ label: 'Acme' }, { label: NAME }, { label: 'Widgets' }], facets: [NAME], pluginName: 'Acme', singleton: false, identity: 'key' }, route, history: { entries: [route], index: 0 } };
    const text = JSON.stringify({ version: SESSION_VERSION, tabs: { version: 1, active: 't1', tabs: [tab] }, rail: null, panel: { version: 1 } });
    mount([entryLoading()], { session: restoredFrom(text) });

    expect(tabs()[0]?.getAttribute('aria-label') ?? '').toContain(NAME);
    expect(keysDrawn()).toEqual([]);
  });

  it('is the window it was: a session that holds no key is opened as before (nothing here is the first plugin\'s page by a name)', () => {
    mount([entryReady()], { session: startedOn([entryReady()]) });

    expect(keysDrawn()).toEqual([]);
  });

  it('says the learned connection name in the footer when switching to a detail tab whose own lane has said nothing', async () => {
    const quiet: DetailPageV1 = { ...sprocketPage, usePage: () => ({ scope: [], source: source() }) };
    const entry = { ...entryReady(), contribution: acme({ pages: { ...acme().pages, widgets: widgetPage('Widgets', named), sprocket: quiet } }) };
    const text = JSON.stringify({
      version: SESSION_VERSION,
      tabs: { version: 1, active: 't1', tabs: [keyedTab('t1', 'widgets', 'Widgets'), keyedTab('t2', 'sprocket', 'alpha · Sprocket', { name: 'alpha' })] },
      rail: null,
      panel: { version: 1 },
    });
    mount([entry], { session: restoredFrom(text) });

    // The list page on screen has said the name; the detail page is in a tab that was never drawn, and its own lane is empty.
    const second = tabs().at(1);
    if (second === undefined) {
      throw new Error('the session has two tabs');
    }

    await userEvent.click(second);

    expect(path()).toHaveTextContent(NAME);
    expect(keysDrawn()).toEqual([]);
  });
});
