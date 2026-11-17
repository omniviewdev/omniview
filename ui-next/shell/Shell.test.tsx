import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ShellRegistration } from './registration';
import { Shell } from './Shell';

// The shell is plugin-agnostic, so the tests are too: an invented plugin, an invented tree, none of a real screen's words.
const registration: ShellRegistration = {
  plugin: { name: 'Acme' },
  tab: { title: 'Widgets', icon: 'box' },
  path: ['Acme', 'north', 'Widgets'],
  rail: true,
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

const renderShell = (value: ShellRegistration = registration) => render(<Shell registration={value}><button type="button">Inside the page</button></Shell>);

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
    const { container } = renderShell({ plugin: { name: 'Other' }, tab: { title: 'Home', icon: 'box' }, path: ['Home'] });

    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryByRole('group', { name: /scope/i })).toBeNull();
    expect(screen.getByRole('main', { name: 'Other workspace' })).toBeInTheDocument();
    expect(container.querySelector('[data-shell-part="rail"]')).toBeNull();
    expect(container.querySelector('[data-shell-part="frame"]')).not.toHaveAttribute('data-sidebar');
    expect(container.querySelector('[data-shell-part="frame"]')).not.toHaveAttribute('data-rail');
  });

  it('keeps the rail\'s 40 px track when the registration declares a rail, with nothing in it to read or focus', () => {
    const { container } = renderShell();

    const rail = container.querySelector('[data-shell-part="rail"]');
    expect(rail).not.toBeNull();
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

  it('still hosts the page, whatever its layout', () => {
    renderShell({ ...registration, layout: 'pane' });
    expect(within(screen.getByRole('tabpanel', { name: 'Widgets' })).getByRole('button', { name: 'Inside the page' })).toBeInTheDocument();
  });
});

describe('the one tab', () => {
  it('is a selected tab in a named tablist, and has no close and no new-tab control yet', () => {
    renderShell();
    const list = screen.getByRole('tablist', { name: 'Open tabs' });

    expect(within(list).getAllByRole('tab')).toHaveLength(1);
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveProperty('tabIndex', 0);
    expect(within(screen.getByRole('banner')).queryAllByRole('button')).toHaveLength(0);
  });
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

  it('has one tab stop, on the current entry, and Tab reaches it after the tab and before the page', async () => {
    const user = userEvent.setup();
    renderShell();
    const stops = screen.getAllByRole('treeitem').filter((item) => item.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
    expect(stops[0]).toHaveAccessibleName('Widgets 89');

    await user.tab();
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveFocus();
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
    screen.getByRole('treeitem', { name: 'Widgets 89' }).focus();

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
    group().focus();

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
    screen.getByRole('treeitem', { name: 'Widgets 89' }).focus();

    await user.keyboard('{ArrowLeft}');
    expect(screen.getByRole('treeitem', { name: 'Group' })).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('treeitem', { name: 'Widgets 89' })).toHaveFocus();
  });

  it('leaves the keys it does not own to the browser, and Enter on an entry changes nothing', async () => {
    const user = userEvent.setup();
    renderShell();
    const entry = screen.getByRole('treeitem', { name: 'Widgets 89' });
    entry.focus();
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
    render(
      <Shell registration={registration} onChoose={onChoose}>
        <button type="button">Inside the page</button>
      </Shell>,
    );

    await user.click(screen.getByRole('treeitem', { name: 'Gadgets' }));
    expect(onChoose).toHaveBeenLastCalledWith('gadgets');

    screen.getByRole('treeitem', { name: 'Widgets 89' }).focus();
    await user.keyboard('{Enter}');
    expect(onChoose).toHaveBeenLastCalledWith('widgets');
    await user.keyboard(' ');
    expect(onChoose).toHaveBeenCalledTimes(3);

    await user.click(screen.getByRole('treeitem', { name: 'Group' }));
    await user.keyboard('{Enter}');
    expect(onChoose).toHaveBeenCalledTimes(3);
  });

  it('leaves the current entry to the host: choosing one selects nothing until the screen registers the page it opened', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <Shell registration={registration} onChoose={vi.fn()}>
        <button type="button">Inside the page</button>
      </Shell>,
    );

    await user.click(screen.getByRole('treeitem', { name: 'Gadgets' }));
    expect(screen.getByRole('treeitem', { name: 'Gadgets' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.getByRole('treeitem', { name: 'Widgets 89' })).toHaveAttribute('aria-selected', 'true');

    rerender(
      <Shell registration={{ ...registration, sidebar: { ...registration.sidebar!, current: 'gadgets' } }} onChoose={vi.fn()}>
        <button type="button">Inside the page</button>
      </Shell>,
    );
    expect(screen.getByRole('treeitem', { name: 'Gadgets' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps what the user opened and closed when the screen registers again with a new count', async () => {
    const user = userEvent.setup();
    const { rerender } = renderShell();
    screen.getByRole('treeitem', { name: 'Group' }).focus();
    await user.keyboard('{ArrowLeft}');
    expect(screen.queryByRole('treeitem', { name: 'Widgets 89' })).toBeNull();

    const sidebar = registration.sidebar!;
    const nodes = [{ ...sidebar.nodes[0], children: [{ id: 'widgets', label: 'Widgets', icon: 'box' as const, count: 90 }, ...(sidebar.nodes[0].children ?? []).slice(1)] }, ...sidebar.nodes.slice(1)];
    rerender(<Shell registration={{ ...registration, sidebar: { ...sidebar, nodes } }}><button type="button">Inside the page</button></Shell>);
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

  it('lists the path root first, with the last crumb as the current page, as text', () => {
    renderShell();
    const path = screen.getByRole('navigation', { name: 'Current resource' });
    const crumbs = within(path).getAllByRole('listitem');

    expect(crumbs.map((crumb) => crumb.textContent)).toEqual(['Acme', 'north', 'Widgets']);
    expect(crumbs.map((crumb) => crumb.getAttribute('aria-current'))).toEqual([null, null, 'page']);
    expect(within(path).queryAllByRole('link')).toHaveLength(0);
    expect(path.closest('footer')).toBe(screen.getByRole('contentinfo'));
  });

  it('shows a different path when the screen registers a different one', () => {
    const { rerender } = renderShell();
    rerender(<Shell registration={{ ...registration, path: ['Acme', 'south'] }}><span>x</span></Shell>);

    expect(within(screen.getByRole('navigation', { name: 'Current resource' })).getAllByRole('listitem').map((crumb) => crumb.textContent)).toEqual(['Acme', 'south']);
  });
});

describe('F6, Shift+F6 and Escape (ch16 S12)', () => {
  it('moves the focus through the regions in reading order, skipping the ones with nothing to focus', async () => {
    const user = userEvent.setup();
    renderShell();
    screen.getByRole('tab', { name: 'Widgets' }).focus();

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
    screen.getByRole('treeitem', { name: 'Gadgets' }).focus();
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
        <Shell registration={registration}><button type="button">Inside the page</button></Shell>
      </>,
    );
    screen.getByRole('button', { name: 'Inside the page' }).focus();
    await user.keyboard('{F6}');
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveFocus();

    screen.getByRole('button', { name: 'Outside' }).focus();
    await user.keyboard('{F6}');
    expect(screen.getByRole('tab', { name: 'Widgets' })).toHaveFocus();
  });

  it('skips a region that is inert', async () => {
    const user = userEvent.setup();
    const { container } = renderShell();
    container.querySelector('[data-shell-region="sidebar"]')?.setAttribute('inert', '');
    screen.getByRole('tab', { name: 'Widgets' }).focus();

    await user.keyboard('{F6}');
    expect(screen.getByRole('main')).toHaveFocus();
  });

  it('returns the focus to the page with Escape from another region, and leaves Escape alone in the page', async () => {
    const user = userEvent.setup();
    renderShell();
    screen.getByRole('treeitem', { name: 'Widgets 89' }).focus();
    await user.keyboard('{Escape}');
    expect(screen.getByRole('main')).toHaveFocus();

    screen.getByRole('tab', { name: 'Widgets' }).focus();
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
    entry.focus();
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
    screen.getByRole('tab', { name: 'Widgets' }).focus();

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
