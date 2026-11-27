import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTabsStore, type TabsStore } from './core/tabs';
import type { ShellRegistration } from './registration';
import { Shell } from './Shell';
import { staticTabs, STATIC_RAIL } from './testing';

// The shell is plugin-agnostic, so the tests are too: an invented plugin, an invented tree, none of a real screen's words.
const registration: ShellRegistration = {
  plugin: { name: 'Acme' },
  rail: STATIC_RAIL,
  sidebar: {
    label: 'Acme items',
    title: 'Items',
    nodes: [
      { id: 'group', label: 'Group', icon: 'layers', children: [{ id: 'widgets', label: 'Widgets', icon: 'box', count: 89 }, { id: 'gadgets', label: 'Gadgets', icon: 'box' }] },
      { id: 'other', label: 'Other', icon: 'server' },
    ],
    open: ['group'],
    current: 'widgets',
    accent: 'blue',
  },
  scope: [
    { label: 'Connection', icon: 'server', text: 'north' },
    { label: 'Scope', icon: 'folder-tree', text: 'Everything' },
  ],
};

// What the tab on screen is called and where it sits (its title, glyph and path) is the tab model's, not the registration's: one tab, Widgets, of the invented plugin.
const widgets = { title: 'Widgets', icon: 'box', path: ['Acme', 'north', 'Widgets'] } as const;
const page = <button type="button">Inside the page</button>;

type Extras = {
  readonly tabs?: TabsStore;
  readonly onChoose?: (id: string, event: unknown) => void;
  readonly onNewTab?: () => void;
  readonly onSelectRail?: (id: string) => void;
  readonly onCloseWindow?: () => void;
};

const shellOf = (value: ShellRegistration, tabs: TabsStore, extras: Extras = {}) => (
  <Shell registration={value} tabs={tabs} renderPage={() => page} empty={null} onChoose={extras.onChoose} onNewTab={extras.onNewTab} onSelectRail={extras.onSelectRail} onCloseWindow={extras.onCloseWindow} />
);

/** The shell over the real tab model; `again` hands it another registration, keeping the tabs and the state under them. */
function renderShell(value: ShellRegistration = registration, extras: Extras = {}) {
  const tabs = extras.tabs ?? staticTabs([widgets]);
  const view = render(shellOf(value, tabs, extras));
  return {
    ...view,
    tabs,
    again: (next: ShellRegistration) => {
      view.rerender(shellOf(next, tabs, extras));
    },
  };
}

/** A shell whose model has no tab and no page to open: the host's own words are in the page region. */
function renderEmpty(extras: Pick<Extras, 'onNewTab' | 'onCloseWindow'> = {}) {
  const tabs = createTabsStore({ contributions: { describe: () => undefined } });
  return render(
    <Shell registration={{ plugin: { name: 'Acme' } }} tabs={tabs} renderPage={() => page} empty={<p>Nothing open</p>} onNewTab={extras.onNewTab} onCloseWindow={extras.onCloseWindow} />,
  );
}

afterEach(() => {
  cleanup();
});

describe('regions are landmarks with names', () => {
  it('names the window, the sidebar, the page and the status bar from the registration', () => {
    renderShell();

    expect(screen.getByRole('banner', { name: 'Window' })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Acme items' })).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Acme workspace' })).toBeInTheDocument();
    expect(screen.getByRole('contentinfo', { name: 'Status bar' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Acme scope' })).toBeInTheDocument();
  });

  it('draws only the regions the registration declares, and none of the plugin\'s words are the shell\'s', () => {
    const { container } = renderShell({ plugin: { name: 'Other' } });

    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryByRole('group', { name: /scope/i })).toBeNull();
    expect(screen.getByRole('main', { name: 'Other workspace' })).toBeInTheDocument();
    expect(container.querySelector('[data-shell-part="rail"]')).toBeNull();
    expect(container.querySelector('[data-shell-part="frame"]')).not.toHaveAttribute('data-sidebar');
    expect(container.querySelector('[data-shell-part="frame"]')).not.toHaveAttribute('data-rail');
  });

  it('draws the rail in its 40 px track when the registration has one: a named group of entries, each a button named for what it shows', () => {
    const { container } = renderShell();

    const rail = container.querySelector('[data-shell-part="rail"]');
    expect(rail).not.toBeNull();
    expect(rail).not.toHaveAttribute('aria-hidden');
    expect(container.querySelector('[data-shell-part="frame"]')).toHaveAttribute('data-rail');
    const group = within(rail as HTMLElement).getByRole('group', { name: 'Plugins' });
    expect(within(group).getAllByRole('button').map((entry) => entry.getAttribute('aria-label'))).toEqual(['Acme', 'Beta', 'Gamma']);
  });

  it('keeps the track, empty and out of the reading order, when the registration has a rail with no entries', () => {
    const { container } = renderShell({ ...registration, rail: { label: 'Plugins', entries: [] }, pending: true });

    const rail = container.querySelector('[data-shell-part="rail"]');
    expect(rail).toHaveAttribute('aria-hidden', 'true');
    expect(within(rail as HTMLElement).queryAllByRole('button')).toHaveLength(0);
    expect(container.querySelector('[data-shell-part="frame"]')).toHaveAttribute('data-rail');
  });

  it('hosts the page in the tabpanel the tab controls', () => {
    renderShell();
    const tab = screen.getByRole('tab', { name: 'Widgets' });
    const panel = screen.getByRole('tabpanel', { name: 'Widgets' });

    expect(tab).toHaveAttribute('aria-selected', 'true');
    expect(tab).toHaveAttribute('aria-controls', panel.id);
    expect(within(panel).getByRole('button', { name: 'Inside the page' })).toBeInTheDocument();
    expect(screen.getByRole('main')).toContainElement(panel);
  });

  it('puts the scope lane above the page, inside the main landmark', () => {
    renderShell();
    const main = screen.getByRole('main');
    const lane = screen.getByRole('group', { name: 'Acme scope' });

    expect(main).toContainElement(lane);
    expect(lane.compareDocumentPosition(screen.getByRole('tabpanel')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('names no control by a title attribute, and leaves every icon to the text beside it', () => {
    const { container } = renderShell();

    expect(container.querySelector('[title]')).toBeNull();
    for (const icon of container.querySelectorAll('svg')) {
      expect(icon).toHaveAttribute('aria-hidden', 'true');
    }
  });
});

describe('the page region', () => {
  it('is a tab stop of its own, so a page of text can be scrolled from the keyboard (the tabs pattern; axe scrollable-region-focusable)', () => {
    renderShell();
    expect(screen.getByRole('tabpanel')).toHaveProperty('tabIndex', 0);
  });

  it('is the document layout unless the registration says otherwise', () => {
    renderShell();
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('data-layout', 'document');
    expect(panel.firstElementChild).toHaveAttribute('data-layout', 'document');
  });

  it('is a bounded pane when the page owns its scrolling (a collection view): the shell scrolls nothing, so the page has no tab stop of its own', () => {
    renderShell({ ...registration, layout: 'pane' });
    const panel = screen.getByRole('tabpanel');
    expect(panel).toHaveAttribute('data-layout', 'pane');
    expect(panel.firstElementChild).toHaveAttribute('data-layout', 'pane');
    expect(panel).not.toHaveAttribute('tabindex');
  });

  it('lets a split page paint its own islands without changing pane scrolling', () => {
    renderShell({ ...registration, layout: 'split' });
    expect(screen.getByRole('main')).toHaveAttribute('data-split');
    expect(screen.getByRole('tabpanel')).toHaveAttribute('data-layout', 'pane');
    expect(screen.getByRole('tabpanel')).not.toHaveAttribute('tabindex');
  });

  it('still hosts the page, whatever its layout', () => {
    renderShell({ ...registration, layout: 'pane' });
    expect(within(screen.getByRole('tabpanel', { name: 'Widgets' })).getByRole('button', { name: 'Inside the page' })).toBeInTheDocument();
  });
});

describe('the tabs and the top row', () => {
  it('is one selected tab in a named tablist, Back and Forward (its close control is for the pointer and hidden from assistive technology), and no new-tab control until the host gives one', () => {
    renderShell();
    const list = screen.getByRole('tablist', { name: 'Open tabs' });

    expect(within(list).getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveProperty('tabIndex', 0);
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveAttribute('aria-selected', 'true');
    expect(within(screen.getByRole('banner')).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Back', 'Forward']);
    expect(screen.queryByRole('button', { name: 'New tab' })).toBeNull();
  });

  it('draws the new-tab control after the tabs once the host gives one', () => {
    renderShell(registration, { onNewTab: vi.fn() });
    expect(within(screen.getByRole('banner')).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Back', 'Forward', 'New tab']);
  });

  it('draws the tabs the model has, in the order of the strip, with the one on screen selected', () => {
    renderShell(registration, { tabs: staticTabs([widgets, { title: 'Gadgets', icon: 'box', path: ['Acme', 'Gadgets'] }], 1) });

    expect(screen.getAllByRole('tab').map((tab) => [tab.getAttribute('aria-label'), tab.getAttribute('aria-selected')])).toEqual([['Widgets', 'false'], ['Gadgets', 'true']]);
    expect(screen.getByRole('tabpanel', { name: 'Gadgets' })).toBeInTheDocument();
  });
});

describe('the window controls', () => {
  // The native window's web view carries the bridge the Wails runtime talks to the app through, and a browser does not (core/native.ts).
  const bridges = {
    'WKWebView and WebKitGTK': { webkit: { messageHandlers: { external: { postMessage: () => undefined } } } },
    WebView2: { chrome: { webview: { postMessage: () => undefined } } },
  };

  afterEach(() => {
    for (const key of ['webkit', 'chrome']) {
      Reflect.deleteProperty(window, key);
    }
  });

  it('draws three inert stand-in dots in the safe area in a browser, which has no window controls of its own', () => {
    const { container } = renderShell();
    const safeArea = container.querySelector('[data-shell-part="safeArea"]');

    expect(safeArea).toHaveAttribute('aria-hidden', 'true');
    expect(safeArea?.querySelectorAll('[data-shell-part="standIn"] > span')).toHaveLength(3);
  });

  for (const [name, bridge] of Object.entries(bridges)) {
    it(`draws none of them in the native window (${name}) and keeps the safe area the real controls draw in`, () => {
      Object.assign(window, bridge);
      const { container } = renderShell();
      const safeArea = container.querySelector('[data-shell-part="safeArea"]');

      expect(safeArea).toBeEmptyDOMElement();
      expect(container.querySelector('[data-shell-part="standIn"]')).toBeNull();
      expect(screen.getByRole('tab', { name: 'Widgets' })).toBeInTheDocument();
    });
  }
});

describe('the sidebar tree', () => {
  it('lists the open group and its entries as tree items with levels, sets, the count and the current one selected', () => {
    renderShell();
    const tree = screen.getByRole('tree', { name: 'Acme items' });
    const items = within(tree).getAllByRole('treeitem');

    expect(items.map((item) => item.textContent)).toEqual(['Group', 'Widgets 89', 'Gadgets', 'Other']);
    expect(items.filter((item) => item.hasAttribute('aria-label'))).toEqual([]);
    expect(items[0]).toHaveAttribute('aria-level', '1');
    expect(items[0]).toHaveAttribute('aria-expanded', 'true');
    expect(items[1]).toHaveAttribute('aria-level', '2');
    expect(items[1]).toHaveAttribute('aria-setsize', '2');
    expect(items[1]).toHaveAttribute('aria-posinset', '1');
    expect(items[1]).toHaveAttribute('aria-selected', 'true');
    expect(items[2]).toHaveAttribute('aria-selected', 'false');
    expect(items[3]).not.toHaveAttribute('aria-expanded');
    expect(within(items[1]).getByText('89')).toBeInTheDocument();
  });

  it('shows the sidebar\'s title as the heading of the navigation', () => {
    renderShell();
    expect(within(screen.getByRole('navigation', { name: 'Acme items' })).getByRole('heading', { level: 2, name: 'Items' })).toBeInTheDocument();
  });

  it('opens the groups above the current entry even when the registration did not ask', () => {
    renderShell({ ...registration, sidebar: { ...(registration.sidebar!), open: [] } });
    expect(screen.getByRole('treeitem', { name: 'Widgets 89' })).toBeInTheDocument();
  });

  it('has one tab stop, on the current entry, and Tab reaches it after the rail and before the page', async () => {
    const user = userEvent.setup();
    renderShell(registration, { onNewTab: vi.fn() });
    const stops = screen.getAllByRole('treeitem').filter((item) => item.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAccessibleName('Widgets 89');

    // Back, Forward (focusable, though they say there is nowhere to go), the tab, the new-tab control, the rail (one stop), the tree, the page. The close control is not a stop of its own.
    await user.tab();
    expect(screen.getByRole('button', { name: 'Back' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Forward' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'New tab' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Acme' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('treeitem', { name: 'Widgets 89' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('tabpanel', { name: 'Widgets' })).toHaveFocus();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Inside the page' })).toHaveFocus();
  });

  it('moves the stop with the arrow keys, Home and End, and the stop follows the focus', async () => {
    const user = userEvent.setup();
    renderShell();
    act(() => {
      screen.getByRole('treeitem', { name: 'Widgets 89' }).focus();
    });

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('treeitem', { name: 'Gadgets' })).toHaveFocus();
    expect(screen.getByRole('treeitem', { name: 'Gadgets' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('treeitem', { name: 'Widgets 89' })).toHaveAttribute('tabindex', '-1');

    await user.keyboard('{End}');
    expect(screen.getByRole('treeitem', { name: 'Other' })).toHaveFocus();
    await user.keyboard('{Home}');
    expect(screen.getByRole('treeitem', { name: 'Group' })).toHaveFocus();
    await user.keyboard('{ArrowUp}');
    expect(screen.getByRole('treeitem', { name: 'Group' })).toHaveFocus();
  });

  it('closes and opens a group with ArrowLeft and ArrowRight, Enter and Space, and a click', async () => {
    const user = userEvent.setup();
    renderShell();
    const group = () => screen.getByRole('treeitem', { name: 'Group' });
    act(() => {
      group().focus();
    });

    await user.keyboard('{ArrowLeft}');
    expect(group()).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: 'Widgets 89' })).toBeNull();

    await user.keyboard('{ArrowRight}');
    expect(group()).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: 'Widgets 89' })).toBeInTheDocument();

    await user.keyboard('{Enter}');
    expect(group()).toHaveAttribute('aria-expanded', 'false');
    await user.keyboard(' ');
    expect(group()).toHaveAttribute('aria-expanded', 'true');
    await user.click(group());
    expect(group()).toHaveAttribute('aria-expanded', 'false');
    expect(group()).toHaveFocus();
  });

  it('goes from an entry to its parent with ArrowLeft, and into a group with ArrowRight', async () => {
    const user = userEvent.setup();
    renderShell();
    act(() => {
      screen.getByRole('treeitem', { name: 'Widgets 89' }).focus();
    });

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('treeitem', { name: 'Group' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: 'Widgets 89' })).toHaveFocus();
  });

  it('leaves the keys it does not own to the browser, and Enter on an entry changes nothing', async () => {
    const user = userEvent.setup();
    renderShell();
    const entry = screen.getByRole('treeitem', { name: 'Widgets 89' });
    act(() => {
      entry.focus();
    });
    const keydown = vi.fn((event: KeyboardEvent) => event.defaultPrevented);
    document.addEventListener('keydown', keydown);

    await user.keyboard('{Enter}');
    expect(entry).toHaveFocus();
    expect(screen.getAllByRole('treeitem')).toHaveLength(4);
    await user.keyboard('a');
    expect(keydown).toHaveLastReturnedWith(false);
    document.removeEventListener('keydown', keydown);
  });

  it('tells the host which entry was chosen, by a click, Enter or Space, and never for a group', async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    renderShell(registration, { onChoose });

    // A click hands over the click, whose modifiers pick where the page opens; a key opens the plain way.
    await user.click(screen.getByRole('treeitem', { name: 'Gadgets' }));
    expect(onChoose).toHaveBeenLastCalledWith('gadgets', expect.objectContaining({ type: 'click', ctrlKey: false, metaKey: false }));

    act(() => {
      screen.getByRole('treeitem', { name: 'Widgets 89' }).focus();
    });
    await user.keyboard('{Enter}');
    expect(onChoose).toHaveBeenLastCalledWith('widgets', undefined);
    await user.keyboard(' ');
    expect(onChoose).toHaveBeenCalledTimes(3);

    await user.click(screen.getByRole('treeitem', { name: 'Group' }));
    await user.keyboard('{Enter}');
    expect(onChoose).toHaveBeenCalledTimes(3);
  });

  it('leaves the current entry to the host: choosing one selects nothing until the screen registers the page it opened', async () => {
    const user = userEvent.setup();
    const { again } = renderShell(registration, { onChoose: vi.fn() });

    await user.click(screen.getByRole('treeitem', { name: 'Gadgets' }));
    expect(screen.getByRole('treeitem', { name: 'Gadgets' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('treeitem', { name: 'Widgets 89' })).toHaveAttribute('aria-selected', 'true');

    again({ ...registration, sidebar: { ...registration.sidebar!, current: 'gadgets' } });
    expect(screen.getByRole('treeitem', { name: 'Gadgets' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps what the user opened and closed when the screen registers again with a new count', async () => {
    const user = userEvent.setup();
    const { again } = renderShell();
    act(() => {
      screen.getByRole('treeitem', { name: 'Group' }).focus();
    });
    await user.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('treeitem', { name: 'Widgets 89' })).toBeNull();

    const sidebar = registration.sidebar!;
    const nodes = [{ ...sidebar.nodes[0], children: [{ id: 'widgets', label: 'Widgets', icon: 'box' as const, count: 90 }, ...(sidebar.nodes[0].children ?? []).slice(1)] }, ...sidebar.nodes.slice(1)];
    again({ ...registration, sidebar: { ...sidebar, nodes } });
    expect(screen.getByRole('treeitem', { name: 'Group' })).toHaveAttribute('aria-expanded', 'false');

    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: 'Widgets 90' })).toBeInTheDocument();
  });

  it('tints the glyphs with the accent the registration names, and draws none without one', () => {
    renderShell();
    expect(screen.getByRole('tree')).toHaveAttribute('data-accent', 'blue');
    cleanup();
    renderShell({ ...registration, sidebar: { ...registration.sidebar!, accent: undefined } });
    expect(screen.getByRole('tree')).not.toHaveAttribute('data-accent');
  });
});

describe('the scope lane and the path', () => {
  it('shows each scope face as text read with what it is, and makes no control of it', () => {
    renderShell();
    const lane = screen.getByRole('group', { name: 'Acme scope' });

    expect(lane).toHaveTextContent('Connection: north');
    expect(lane).toHaveTextContent('Scope: Everything');
    expect(within(lane).queryAllByRole('button')).toHaveLength(0);
    expect(within(lane).queryAllByRole('menuitem')).toHaveLength(0);
  });

  it('lists the path of the tab on screen, root first, with the last crumb as the current page, as text', () => {
    renderShell();
    const path = screen.getByRole('navigation', { name: 'Current resource' });
    const crumbs = within(path).getAllByRole('listitem');

    expect(crumbs.map((crumb) => crumb.textContent)).toEqual(['Acme', 'north', 'Widgets']);
    expect(crumbs.map((crumb) => crumb.getAttribute('aria-current'))).toEqual([null, null, 'page']);
    expect(within(path).queryAllByRole('link')).toHaveLength(0);
    expect(path.closest('footer')).toBe(screen.getByRole('contentinfo'));
  });

  it('follows the tab on screen: a tab switch shows the path of the other tab', () => {
    const { tabs } = renderShell(registration, { tabs: staticTabs([widgets, { title: 'Gadgets', icon: 'box', path: ['Acme', 'south', 'Gadgets'] }]) });
    const crumbs = () => within(screen.getByRole('navigation', { name: 'Current resource' })).getAllByRole('listitem').map((crumb) => crumb.textContent);
    expect(crumbs()).toEqual(['Acme', 'north', 'Widgets']);

    act(() => {
      tabs.activate(tabs.getSnapshot().order[1]);
    });
    expect(crumbs()).toEqual(['Acme', 'south', 'Gadgets']);
  });

  it('has no crumbs, and no tab to read them from, while the model has none', () => {
    renderEmpty();

    expect(screen.queryAllByRole('listitem')).toHaveLength(0);
    expect(screen.getByRole('navigation', { name: 'Current resource' })).toBeInTheDocument();
  });
});

describe('no tab on screen', () => {
  it('shows what the host says in the page region, which is no tabpanel, with no tablist, and the new-tab control when the host gave one: an empty window has a way forward', () => {
    renderEmpty({ onNewTab: vi.fn() });

    expect(screen.queryByRole('tablist')).toBeNull();
    expect(screen.queryByRole('tab')).toBeNull();
    expect(screen.queryByRole('tabpanel')).toBeNull();
    expect(screen.getByRole('button', { name: 'New tab' })).toBeInTheDocument();
    expect(screen.getByText('Nothing open')).toBeInTheDocument();
    expect(screen.getByRole('main', { name: 'Acme workspace' })).toContainElement(screen.getByText('Nothing open'));
  });

  it('draws no new-tab control when the host gave none', () => {
    renderEmpty();

    expect(screen.queryByRole('button', { name: 'New tab' })).toBeNull();
  });
});

describe('a rail entry with a problem', () => {
  it('is named for it and carries the cause in its tip, so the problem is found from the rail by hover, by focus and by a screen reader', () => {
    const entries = [...STATIC_RAIL.entries, { id: 'broken', label: 'Broken, did not load', icon: 'status-error' as const, problem: 'The interface could not be read.' }];
    renderShell({ ...registration, rail: { ...STATIC_RAIL, entries } });

    const entry = screen.getByRole('button', { name: 'Broken, did not load' });
    expect(entry).toHaveAttribute('data-ov-tip', 'Broken, did not load\nThe interface could not be read.');
    expect(screen.getByRole('button', { name: 'Acme' })).toHaveAttribute('data-ov-tip', 'Acme');
  });
});

describe('the rail', () => {
  const stops = () => screen.getAllByRole('button').filter((button) => button.closest('[data-shell-part="rail"]') !== null && button.getAttribute('tabindex') === '0');

  it('marks the entry whose sidebar is shown as current, and no other', () => {
    renderShell();

    expect(screen.getByRole('button', { name: 'Acme' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Beta' })).not.toHaveAttribute('aria-current');
    expect(screen.getByRole('button', { name: 'Gamma' })).not.toHaveAttribute('aria-current');
  });

  it('is one tab stop, on the current entry; with none current, on the first', () => {
    const first = renderShell();
    expect(stops().map((stop) => stop.getAttribute('aria-label'))).toEqual(['Acme']);
    first.unmount();

    renderShell({ ...registration, rail: { ...STATIC_RAIL, current: 'beta' } });
    expect(stops().map((stop) => stop.getAttribute('aria-label'))).toEqual(['Beta']);
    cleanup();

    renderShell({ ...registration, rail: { ...STATIC_RAIL, current: undefined } });
    expect(stops().map((stop) => stop.getAttribute('aria-label'))).toEqual(['Acme']);
  });

  it('moves the focus with the arrows, Home and End, and selects nothing: choosing is Enter, Space or a click', async () => {
    const user = userEvent.setup();
    const onSelectRail = vi.fn();
    renderShell(registration, { onSelectRail });
    screen.getByRole('button', { name: 'Acme' }).focus();

    await user.keyboard('{ArrowDown}');
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveFocus();
    await user.keyboard('{End}');
    expect(screen.getByRole('button', { name: 'Gamma' })).toHaveFocus();
    await user.keyboard('{ArrowUp}{ArrowUp}');
    expect(screen.getByRole('button', { name: 'Acme' })).toHaveFocus();
    await user.keyboard('{End}{Home}');
    expect(screen.getByRole('button', { name: 'Acme' })).toHaveFocus();
    expect(stops().map((stop) => stop.getAttribute('aria-label'))).toEqual(['Acme']);
    expect(onSelectRail).not.toHaveBeenCalled();

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onSelectRail).toHaveBeenLastCalledWith('beta');
    await user.keyboard('{ArrowDown} ');
    expect(onSelectRail).toHaveBeenLastCalledWith('gamma');
    await user.click(screen.getByRole('button', { name: 'Acme' }));
    expect(onSelectRail).toHaveBeenLastCalledWith('acme');
    expect(onSelectRail).toHaveBeenCalledTimes(3);
  });

  it('leaves the current entry to the host: choosing one selects nothing until the screen registers it as current', async () => {
    const user = userEvent.setup();
    const { again } = renderShell(registration, { onSelectRail: vi.fn() });

    await user.click(screen.getByRole('button', { name: 'Beta' }));
    expect(screen.getByRole('button', { name: 'Acme' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Beta' })).not.toHaveAttribute('aria-current');

    again({ ...registration, rail: { ...STATIC_RAIL, current: 'beta' } });
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-current', 'true');
    expect(screen.getByRole('button', { name: 'Acme' })).not.toHaveAttribute('aria-current');
  });

  it('starts the sidebar of another entry afresh, though the two sidebars share their name and their ids: what was opened in the first stays with the first', async () => {
    const user = userEvent.setup();
    const closed = { ...registration, sidebar: { ...registration.sidebar!, open: [], current: undefined } };
    const { again } = renderShell(closed);

    await user.click(screen.getByRole('treeitem', { name: 'Group' }));
    expect(screen.getByRole('treeitem', { name: /Widgets/ })).toBeInTheDocument();

    again({ ...closed, rail: { ...STATIC_RAIL, current: 'beta' } });
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveAttribute('aria-current', 'true');
    expect(screen.queryByRole('treeitem', { name: /Widgets/ })).toBeNull();
  });

  it('shows the sidebar of an entry as it was left when the rail comes back to it: what was opened in the first stays with the first, for the whole life of the window', async () => {
    const user = userEvent.setup();
    const closed = { ...registration, sidebar: { ...registration.sidebar!, open: [], current: undefined } };
    const { again } = renderShell(closed);

    await user.click(screen.getByRole('treeitem', { name: 'Group' }));
    again({ ...closed, rail: { ...STATIC_RAIL, current: 'beta' } });
    expect(screen.queryByRole('treeitem', { name: /Widgets/ })).toBeNull();

    again(closed);
    expect(screen.getByRole('treeitem', { name: 'Group' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: /Widgets/ })).toBeInTheDocument();
  });

  it('opens the groups of the current entry when the entry arrives with the nodes after the current page did, once: what the user closes stays closed', async () => {
    const user = userEvent.setup();
    // The nodes the plugin's data hook answers come after the skeleton the contribution declares, and the entry the page is on is only in the answer.
    const skeleton = { ...registration, sidebar: { ...registration.sidebar!, nodes: [{ id: 'other', label: 'Other', icon: 'server' as const }], open: [], current: 'widgets' } };
    const arrived = { ...registration, sidebar: { ...registration.sidebar!, open: [], current: 'widgets' } };
    const { again } = renderShell(skeleton);
    expect(screen.queryByRole('treeitem', { name: /Widgets/ })).toBeNull();

    again(arrived);
    expect(screen.getByRole('treeitem', { name: /Widgets/ })).toBeInTheDocument();

    await user.click(screen.getByRole('treeitem', { name: 'Group' }));
    expect(screen.queryByRole('treeitem', { name: /Widgets/ })).toBeNull();
    again({ ...arrived, sidebar: { ...arrived.sidebar, nodes: [...arrived.sidebar.nodes] } });
    expect(screen.queryByRole('treeitem', { name: /Widgets/ })).toBeNull();
  });

  it('names every entry in a tip that opens at once, and sets no title attribute', () => {
    const { container } = renderShell();

    for (const entry of within(container.querySelector('[data-shell-part="rail"]')!).getAllByRole('button')) {
      expect(entry).toHaveAttribute('data-ov-tip', entry.getAttribute('aria-label'));
      expect(entry).toHaveAttribute('data-ov-tip-delay', '0');
      expect(entry).not.toHaveAttribute('title');
    }
  });

  it('is a region of its own for F6, which lands on the current entry, and Escape returns the focus to the page', async () => {
    const user = userEvent.setup();
    renderShell({ ...registration, rail: { ...STATIC_RAIL, current: 'beta' } });
    act(() => {
      screen.getByRole('tab', { name: 'Widgets' }).focus();
    });

    await user.keyboard('{F6}');
    expect(screen.getByRole('button', { name: 'Beta' })).toHaveFocus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('paints no entry current and takes no tab stop when the registration has no rail', () => {
    const { container } = renderShell({ plugin: { name: 'Other' } });

    expect(container.querySelector('[data-shell-part="rail"]')).toBeNull();
  });
});

describe('a frame that is pending', () => {
  it('reserves the rail, the sidebar and the scope lane at their rectangles, empty and out of the reading order', () => {
    const { container } = renderShell({ plugin: { name: 'Acme' }, pending: true });

    expect(container.querySelector('[data-shell-part="rail"]')).toHaveAttribute('aria-hidden', 'true');
    expect(container.querySelector('[data-shell-part="frame"]')).toHaveAttribute('data-rail');
    expect(container.querySelector('[data-shell-part="frame"]')).toHaveAttribute('data-sidebar');
    const sidebar = screen.getByRole('navigation', { name: 'Loading navigation' });
    expect(sidebar).toHaveAttribute('aria-busy', 'true');
    expect(within(sidebar).queryByRole('tree')).toBeNull();
    expect(within(sidebar).queryByRole('heading')).toBeNull();
    const lane = container.querySelector('[data-shell-part="lane"]');
    expect(lane).toHaveAttribute('aria-hidden', 'true');
    expect(lane).not.toHaveAttribute('role');
    expect(lane).toBeEmptyDOMElement();
    expect(screen.queryByRole('group', { name: /scope/i })).toBeNull();
  });

  it('is the same sidebar element the registered one lands in, so nothing moves when the frame registers', () => {
    const { again } = renderShell({ plugin: { name: 'Acme' }, pending: true });
    const sidebar = document.querySelector('[data-shell-region="sidebar"]');
    const lane = document.querySelector('[data-shell-part="lane"]');

    again(registration);

    expect(document.querySelector('[data-shell-region="sidebar"]')).toBe(sidebar);
    expect(document.querySelector('[data-shell-part="lane"]')).toBe(lane);
    expect(screen.getByRole('navigation', { name: 'Acme items' })).not.toHaveAttribute('aria-busy');
    expect(screen.getByRole('tree', { name: 'Acme items' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Acme scope' })).toBeInTheDocument();
  });

  it('draws the regions the registration declares beside the ones it reserves', () => {
    renderShell({ ...registration, pending: true });

    expect(screen.getByRole('tree', { name: 'Acme items' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Acme scope' })).toBeInTheDocument();
  });
});

describe('F6, Shift+F6 and Escape (ch16 S12)', () => {
  it('moves the focus through the regions in reading order, skipping the ones with nothing to focus', async () => {
    const user = userEvent.setup();
    renderShell();
    act(() => {
      screen.getByRole('tab', { name: 'Widgets' }).focus();
    });

    await user.keyboard('{F6}');
    expect(screen.getByRole('button', { name: 'Acme' })).toHaveFocus();
    await user.keyboard('{F6}');
    expect(screen.getByRole('treeitem', { name: 'Widgets 89' })).toHaveFocus();
    await user.keyboard('{F6}');
    expect(screen.getByRole('main')).toHaveFocus();
    await user.keyboard('{F6}');
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveFocus();
  });

  it('goes back with Shift+F6, and lands on the stop the tree kept, not on its first row', async () => {
    const user = userEvent.setup();
    renderShell();
    act(() => {
      screen.getByRole('treeitem', { name: 'Gadgets' }).focus();
    });
    await user.keyboard('{Shift>}{F6}{/Shift}');
    expect(screen.getByRole('button', { name: 'Acme' })).toHaveFocus();
    await user.keyboard('{Shift>}{F6}{/Shift}');
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveFocus();
    await user.keyboard('{Shift>}{F6}{/Shift}');
    expect(screen.getByRole('main')).toHaveFocus();
    await user.keyboard('{Shift>}{F6}{/Shift}');
    expect(screen.getByRole('treeitem', { name: 'Gadgets' })).toHaveFocus();
  });

  it('moves on from the page when the focus is on a control inside it, and enters the first region from outside the shell', async () => {
    const user = userEvent.setup();
    render(
      <>
        <button type="button">Outside</button>
        {shellOf(registration, staticTabs([widgets]))}
      </>,
    );
    screen.getByRole('button', { name: 'Inside the page' }).focus();
    await user.keyboard('{F6}');
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveFocus();

    act(() => {
      screen.getByRole('button', { name: 'Outside' }).focus();
    });
    await user.keyboard('{F6}');
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveFocus();
  });

  it('skips a region that is inert', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    container.querySelector('[data-shell-region="rail"]')?.setAttribute('inert', '');
    container.querySelector('[data-shell-region="sidebar"]')?.setAttribute('inert', '');
    act(() => {
      screen.getByRole('tab', { name: 'Widgets' }).focus();
    });

    await user.keyboard('{F6}');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('returns the focus to the page with Escape from another region, and leaves Escape alone in the page', async () => {
    const user = userEvent.setup();
    renderShell();
    act(() => {
      screen.getByRole('treeitem', { name: 'Widgets 89' }).focus();
    });
    await user.keyboard('{Escape}');
    expect(screen.getByRole('main')).toHaveFocus();

    act(() => {
      screen.getByRole('tab', { name: 'Widgets' }).focus();
    });
    await user.keyboard('{Escape}');
    expect(screen.getByRole('main')).toHaveFocus();

    const inside = screen.getByRole('button', { name: 'Inside the page' });
    inside.focus();
    await user.keyboard('{Escape}');
    expect(inside).toHaveFocus();
  });

  it('does not take an Escape that something else already took', () => {
    renderShell();
    const entry = screen.getByRole('treeitem', { name: 'Widgets 89' });
    act(() => {
      entry.focus();
    });
    entry.addEventListener('keydown', (event) => {
      event.preventDefault();
    });
    const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    act(() => {
      entry.dispatchEvent(event);
    });

    expect(entry).toHaveFocus();
  });

  it('ignores F6 with a modifier, which belongs to the browser or the system', async () => {
    const user = userEvent.setup();
    renderShell();
    act(() => {
      screen.getByRole('tab', { name: 'Widgets' }).focus();
    });

    await user.keyboard('{Control>}{F6}{/Control}');
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveFocus();
  });
});

describe('what the shell never does', () => {
  it('writes no style and no custom property on the document root', () => {
    const root = document.documentElement;
    const before = root.getAttribute('style');
    renderShell();

    expect(root.getAttribute('style')).toBe(before);
    expect([...root.style].filter((property) => property.startsWith('--'))).toEqual([]);
  });

  it('sets no timer and no interval of its own', () => {
    vi.useFakeTimers();
    try {
      renderShell();
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('a plugin whose frame goes away and comes back (it stopped and was loaded again, or its interface was reloaded)', () => {
  const closed: ShellRegistration = { ...registration, sidebar: { ...registration.sidebar!, open: [], current: undefined } };
  /** What the window registers while the plugin is not running: no sidebar, no lane, and the rail and the tabs where they were. */
  const stopped: ShellRegistration = { plugin: { name: 'Acme' }, layout: 'pane', rail: STATIC_RAIL };
  /** And while it loads: the regions it will have, empty. */
  const loading: ShellRegistration = { plugin: { name: 'Acme' }, layout: 'pane', pending: true, rail: STATIC_RAIL };

  it('keeps the groups the user opened open, and tells the host so again: the sidebar is the sidebar it was, and its hook asks for the counts of the rows that are on screen', async () => {
    const user = userEvent.setup();
    const onSidebarOpen = vi.fn();
    const tabs = staticTabs([widgets]);
    const view = render(<Shell registration={closed} tabs={tabs} renderPage={() => page} empty={null} onSidebarOpen={onSidebarOpen} />);
    const hand = (next: ShellRegistration) => {
      view.rerender(<Shell registration={next} tabs={tabs} renderPage={() => page} empty={null} onSidebarOpen={onSidebarOpen} />);
    };

    await user.click(screen.getByRole('treeitem', { name: 'Group' }));
    expect(onSidebarOpen).toHaveBeenLastCalledWith('acme', ['group']);

    hand(stopped);
    expect(screen.queryByRole('navigation', { name: 'Acme items' })).toBeNull();
    expect(onSidebarOpen).toHaveBeenLastCalledWith('acme', []);
    hand(loading);
    expect(screen.getByRole('navigation', { name: 'Loading navigation' })).toHaveAttribute('aria-busy', 'true');
    hand(closed);

    expect(screen.getByRole('treeitem', { name: 'Group' })).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('treeitem', { name: /Widgets/ })).toBeInTheDocument();
    expect(onSidebarOpen).toHaveBeenLastCalledWith('acme', ['group']);
  });

  it('keeps a group the user closed closed, with the current entry inside it: coming back is not a change of page', async () => {
    const user = userEvent.setup();
    const shown: ShellRegistration = { ...registration, sidebar: { ...registration.sidebar!, current: 'widgets' } };
    const { again } = renderShell(shown);
    expect(screen.getByRole('treeitem', { name: /Widgets/ })).toBeInTheDocument();

    await user.click(screen.getByRole('treeitem', { name: 'Group' }));
    expect(screen.queryByRole('treeitem', { name: /Widgets/ })).toBeNull();
    again(stopped);
    again(shown);

    expect(screen.queryByRole('treeitem', { name: /Widgets/ })).toBeNull();
    expect(screen.getByRole('treeitem', { name: 'Group' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('opens the groups of the entry the page is on when it comes back on another one, and keeps the rest as the user left them', async () => {
    const user = userEvent.setup();
    const nodes = [
      { id: 'group', label: 'Group', icon: 'layers' as const, children: [{ id: 'widgets', label: 'Widgets', icon: 'box' as const }] },
      { id: 'second', label: 'Second', icon: 'layers' as const, children: [{ id: 'sprockets', label: 'Sprockets', icon: 'box' as const }] },
      { id: 'other', label: 'Other', icon: 'server' as const },
    ];
    const at = (current: string): ShellRegistration => ({ ...registration, sidebar: { ...registration.sidebar!, nodes, open: [], current } });
    const { again } = renderShell(at('other'));
    await user.click(screen.getByRole('treeitem', { name: 'Group' }));

    again(stopped);
    again(at('sprockets'));

    expect(screen.getByRole('treeitem', { name: 'Sprockets' })).toBeInTheDocument();
    expect(screen.getByRole('treeitem', { name: 'Widgets' })).toBeInTheDocument();
  });
});
