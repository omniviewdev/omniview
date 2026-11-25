import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Profiler } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Home, type HomeConnectionGroup, type HomeConnectionRow, type HomeEntry, type HomeProps } from './Home';

// The Home page on its own (HM1, HM2): plain data in, what was chosen out. jsdom lays nothing out, so the two columns, the ellipsis and the focus ring are the screen's; the things of the layout that are numbers the page is held to are read
// from the stylesheet as text, at the end. The rows are made by the host (`homeModel.ts`) and the menu, the Retry and the announcements are the host's (`homePage.tsx`, `homePage.test.tsx`); here they are invented, and so are the plugins.

const css = await readFile(path.join(import.meta.dirname, 'Home.module.css'), 'utf8');

const entry = (id: string, label: string, state?: string): HomeEntry => ({ id, label, icon: 'box', tone: 'blue', state });
/** A connection of the plugin `acme` unless `over` says another. Its id is the plugin and the key: all Home needs of an id is that it is one string for one record. */
const connection = (key: string, name: string, over: Partial<HomeConnectionRow> = {}): HomeConnectionRow => {
  const plugin = over.plugin ?? 'acme';
  return { id: `${plugin}/${key}`, plugin, key, name, icon: 'layers', tone: 'green', role: 'healthy', word: 'Connected', ...over };
};

/** The rows are the plugin's: the group says which, and `named` whether its name stands over them. */
const group = (plugin: string, label: string, rows: readonly HomeConnectionRow[], named = false): HomeConnectionGroup => ({
  plugin,
  label,
  named,
  rows: rows.map((row) => ({ ...row, plugin, id: `${plugin}/${row.key}` })),
});
/** One connected connection for each name, its key the name. */
const named = (...names: readonly string[]): HomeConnectionRow[] => names.map((name) => connection(name, name));

const propsOf = (over: Partial<HomeProps> = {}): HomeProps => ({
  entries: [entry('acme', 'Acme'), entry('beta', 'Beta')],
  recent: [],
  groups: [],
  connections: 'ready',
  empty: false,
  onOpenPlugin: vi.fn(),
  onOpenConnection: vi.fn(),
  onRetry: vi.fn(),
  ...over,
});

function mount(over: Partial<HomeProps> = {}) {
  const onOpenPlugin = vi.fn<HomeProps['onOpenPlugin']>();
  const onOpenConnection = vi.fn<HomeProps['onOpenConnection']>();
  const onRetry = vi.fn<HomeProps['onRetry']>();
  const props = propsOf({ onOpenPlugin, onOpenConnection, onRetry, ...over });
  const view = render(<Home {...props} />);
  return {
    onOpenPlugin,
    onOpenConnection,
    onRetry,
    user: userEvent.setup(),
    again: (next: Partial<HomeProps>) => {
      view.rerender(<Home {...props} {...next} />);
    },
  };
}

const plugins = () => within(screen.getByRole('region', { name: 'Plugins you can open' }));
const connections = () => screen.getByRole('region', { name: 'Connections' });
const recent = () => screen.getByRole('region', { name: 'Recent' });
const part = (name: string): HTMLElement => {
  const found = document.querySelector<HTMLElement>(`[data-home-part="${name}"]`);
  if (found === null) {
    throw new Error(`the page draws no ${name}`);
  }

  return found;
};

const rowsOf = (region: HTMLElement): HTMLElement[] => [...region.querySelectorAll<HTMLElement>('[data-home-part="connection"]')];
/** The name a connection row draws: the first of its lines. */
const nameOf = (row: HTMLElement): string | null | undefined => row.querySelector('[data-ov-clip]')?.textContent;
const listOf = (label: string) => within(within(connections()).getByRole('group', { name: `${label} connections` }));
const tabindexes = (rows: readonly HTMLElement[]): Array<string | null> => rows.map((row) => row.getAttribute('tabindex'));
const search = () => screen.getByRole('searchbox', { name: 'Search connections' });
const focus = (element: HTMLElement) => {
  act(() => {
    element.focus();
  });
};

/** Whether `next` comes after `first` in the document. */
const follows = (first: Element, next: Element): boolean => (first.compareDocumentPosition(next) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
/** The rule of a selector in the page's stylesheet, read as text: from the first `selector {` at or after `from` to its closing brace. */
const block = (selector: string, from = 0): string => {
  const start = css.indexOf(`${selector} {`, from);
  expect(start, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
  return css.slice(start, css.indexOf('}', start));
};

afterEach(cleanup);

describe('the page', () => {
  it('has its title, and says nothing of an empty window in a tab of its own', () => {
    mount();

    expect(screen.getByRole('heading', { level: 1, name: 'Home' })).toBeInTheDocument();
    expect(screen.queryByText('No tabs are open.')).toBeNull();
  });

  it('says that no tab is open in a muted line between the title and the sections when the window has none', () => {
    mount({ empty: true });

    const title = screen.getByRole('heading', { level: 1, name: 'Home' });
    const line = screen.getByText('No tabs are open.');
    expect(line).toHaveAttribute('data-ov-tone', 'muted');
    expect(follows(title, line)).toBe(true);
    expect(follows(line, screen.getByRole('region', { name: 'Plugins you can open' }))).toBe(true);
  });

  it('draws the plugins you can open before the connections, in the one column the narrow page has', () => {
    mount({ groups: [group('acme', 'Acme', named('staging'))] });

    expect(follows(screen.getByRole('region', { name: 'Plugins you can open' }), connections())).toBe(true);
  });

  // The mock's grid (shell-page-home.js:194-200): "<div class="home__grid"><div class="home__main">${pluginsSection(list)}</div><div class="home__side">${side}</div></div>", with `side` = `${recentSection()}${connectionsSection()}`.
  // The field that narrows both lists stands at the top of the side column.
  it('puts the plugins in the main column and, in the side column, the field, then Recent, then Connections', () => {
    mount({ recent: [connection('r1', 'orchard'), connection('r2', 'river')], groups: [group('acme', 'Acme', named('harbour', 'meadow', 'summit', 'valley', 'north', 'south'))] });

    const main = part('main');
    const side = part('side');
    expect(main).toContainElement(screen.getByRole('region', { name: 'Plugins you can open' }));
    expect(main).not.toContainElement(connections());
    expect(main).not.toContainElement(recent());
    expect(side).toContainElement(search());
    expect(side).toContainElement(recent());
    expect(side).toContainElement(connections());
    expect(side).not.toContainElement(screen.getByRole('region', { name: 'Plugins you can open' }));
    expect(follows(search(), recent())).toBe(true);
    expect(follows(recent(), connections())).toBe(true);
    expect(side.firstElementChild).toContainElement(search());
  });
});

describe('the plugins you can open', () => {
  it('is a region under a level 2 heading, one button for each plugin, and a plugin that cannot open to its page says why straight after its name', () => {
    mount({ entries: [entry('acme', 'Acme'), entry('beta', 'Beta'), entry('gone', 'Gone', 'Did not load')] });

    const region = screen.getByRole('region', { name: 'Plugins you can open' });
    expect(within(region).getByRole('heading', { level: 2, name: 'Plugins you can open' })).toBeInTheDocument();
    // The text of each button is what the seam's check and the host's tests read: the name, and the word straight after it with nothing between.
    expect(within(region).getAllByRole('button').map((button) => button.textContent)).toEqual(['Acme', 'Beta', 'GoneDid not load']);
  });

  it('is not drawn when there is no plugin: no heading stands over nothing', () => {
    mount({ entries: [] });

    expect(screen.queryByRole('region', { name: 'Plugins you can open' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Plugins you can open' })).toBeNull();
  });

  it('opens a plugin with its id and the event that chose it: the modifiers are the open model\'s to read', async () => {
    const { onOpenPlugin, user } = mount();

    await user.click(plugins().getByRole('button', { name: 'Beta' }));
    expect(onOpenPlugin).toHaveBeenCalledTimes(1);
    expect(onOpenPlugin).toHaveBeenLastCalledWith('beta', expect.objectContaining({ type: 'click', metaKey: false, shiftKey: false }));

    fireEvent.click(plugins().getByRole('button', { name: 'Acme' }), { metaKey: true });
    expect(onOpenPlugin).toHaveBeenLastCalledWith('acme', expect.objectContaining({ type: 'click', metaKey: true, shiftKey: false }));

    fireEvent.click(plugins().getByRole('button', { name: 'Acme' }), { shiftKey: true });
    expect(onOpenPlugin).toHaveBeenLastCalledWith('acme', expect.objectContaining({ type: 'click', metaKey: false, shiftKey: true }));
    expect(onOpenPlugin).toHaveBeenCalledTimes(3);
  });

  it('is one Tab stop: the arrows, Home and End move the focus, and Enter opens the plugin the focus is on', async () => {
    const { onOpenPlugin, user } = mount({ entries: [entry('acme', 'Acme'), entry('beta', 'Beta'), entry('gamma', 'Gamma')] });
    const rows = plugins().getAllByRole('button');
    expect(tabindexes(rows)).toEqual(['0', '-1', '-1']);

    await user.tab();
    expect(rows[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(rows[1]).toHaveFocus();
    expect(tabindexes(rows)).toEqual(['-1', '0', '-1']);
    await user.keyboard('{End}');
    expect(rows[2]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(rows[0]).toHaveFocus();

    await user.keyboard('{ArrowDown}{Enter}');
    expect(onOpenPlugin).toHaveBeenCalledTimes(1);
    expect(onOpenPlugin).toHaveBeenCalledWith('beta', expect.objectContaining({ type: 'click' }));
  });
});

describe('the connections', () => {
  const acme = group('acme', 'Acme', [connection('a1', 'staging'), connection('a2', 'production', { role: 'attention', word: 'Needs sign-in' })], true);
  const beta = group('beta', 'Beta', [connection('b1', 'sandbox', { role: 'stopped', word: 'Disconnected' })], true);

  it('draws a list for each plugin, a row for each connection by its name with its state beside it, and the plugin\'s name over each list when the host says to name them', () => {
    mount({ groups: [acme, beta] });

    const region = connections();
    expect(within(region).getByRole('heading', { level: 2, name: 'Connections' })).toBeInTheDocument();
    expect(within(region).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Acme', 'Beta']);

    const first = listOf('Acme');
    expect(first.getAllByRole('button').map((row) => row.textContent)).toEqual(['staging Connected', 'production Needs sign-in']);
    expect(first.getByText('Connected')).toHaveAttribute('data-ov-role', 'healthy');
    expect(first.getByText('Needs sign-in')).toHaveAttribute('data-ov-role', 'attention');
    const second = listOf('Beta');
    expect(second.getAllByRole('button').map((row) => row.textContent)).toEqual(['sandbox Disconnected']);
    expect(second.getByText('Disconnected')).toHaveAttribute('data-ov-role', 'stopped');
  });

  it('does not name the list when the host does not: the title says what they are', () => {
    mount({ groups: [group('acme', 'Acme', named('staging', 'production'))] });

    expect(within(connections()).queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    expect(listOf('Acme').getAllByRole('button')).toHaveLength(2);
  });

  it('puts the reason the last start failed on the second muted line, which is whole to the pointer when it is cut, and no second line where there is none', () => {
    const failed = connection('a1', 'prod', { role: 'error', word: 'Not reachable', reason: 'The server did not answer' });
    mount({ groups: [group('acme', 'Acme', [failed, connection('a2', 'staging'), connection('a3', 'sandbox', { reason: '' })])] });

    const row = within(connections()).getByRole('button', { name: 'prod The server did not answer Not reachable' });
    expect([...row.querySelectorAll('[data-ov-clip]')].map((line) => line.textContent)).toEqual(['prod', 'The server did not answer']);
    expect(within(row).getByText('The server did not answer')).toHaveAttribute('data-ov-tone', 'muted');
    expect(within(row).getByText('The server did not answer').closest('[data-ov-clip]')).not.toBeNull();
    // A row with no reason has one line, and an empty reason is none.
    expect(within(connections()).getByRole('button', { name: 'staging Connected' }).querySelectorAll('[data-ov-clip]')).toHaveLength(1);
    expect(within(connections()).getByRole('button', { name: 'sandbox Connected' }).querySelectorAll('[data-ov-clip]')).toHaveLength(1);
  });

  it('marks a row that is busy, says its state as the host words it, and does not open it again by click or by Enter, while the others open', async () => {
    const connecting = connection('a1', 'staging', { role: 'progress', word: 'Connecting…', busy: true });
    const { onOpenConnection, user } = mount({ groups: [group('acme', 'Acme', [connecting, connection('a2', 'production')])] });

    const busy = within(connections()).getByRole('button', { name: 'staging Connecting…' });
    const idle = within(connections()).getByRole('button', { name: 'production Connected' });
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(idle).not.toHaveAttribute('aria-busy');
    expect(within(busy).getByText('Connecting…')).toHaveAttribute('data-ov-role', 'progress');

    await user.click(busy);
    focus(busy);
    await user.keyboard('{Enter}');
    expect(onOpenConnection).not.toHaveBeenCalled();

    await user.click(idle);
    expect(onOpenConnection).toHaveBeenCalledTimes(1);
    expect(onOpenConnection).toHaveBeenCalledWith('acme', 'a2', expect.objectContaining({ type: 'click' }));
  });

  it('opens a connection with its plugin, its key and the event that chose it, by click and by Enter; a failed one is opened again the same way, with no button of its own for it', async () => {
    const failed = connection('b2', 'edge', { role: 'error', word: 'Not reachable', reason: 'The server did not answer' });
    const { onOpenConnection, user } = mount({ groups: [acme, group('beta', 'Beta', [connection('b1', 'sandbox'), failed], true)] });
    const region = connections();

    await user.click(within(region).getByRole('button', { name: 'staging Connected' }));
    expect(onOpenConnection).toHaveBeenLastCalledWith('acme', 'a1', expect.objectContaining({ type: 'click', metaKey: false }));

    fireEvent.click(within(region).getByRole('button', { name: 'staging Connected' }), { metaKey: true });
    expect(onOpenConnection).toHaveBeenLastCalledWith('acme', 'a1', expect.objectContaining({ type: 'click', metaKey: true }));

    focus(within(region).getByRole('button', { name: 'sandbox Connected' }));
    await user.keyboard('{Enter}');
    expect(onOpenConnection).toHaveBeenLastCalledWith('beta', 'b1', expect.objectContaining({ type: 'click' }));

    await user.click(within(region).getByRole('button', { name: /^edge / }));
    expect(onOpenConnection).toHaveBeenLastCalledWith('beta', 'b2', expect.objectContaining({ type: 'click' }));
    expect(onOpenConnection).toHaveBeenCalledTimes(4);
    expect(within(region).queryByRole('button', { name: /retry/i })).toBeNull();
  });

  it('keeps the rows of a plugin in one Tab stop that the arrows move in and Tab leaves, and each plugin\'s list is a stop of its own', async () => {
    const { onOpenConnection, user } = mount({ entries: [], groups: [acme, beta] });
    const first = listOf('Acme').getAllByRole('button');
    const second = listOf('Beta').getAllByRole('button');
    expect(tabindexes(first)).toEqual(['0', '-1']);
    expect(tabindexes(second)).toEqual(['0']);

    await user.tab();
    expect(first[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(first[1]).toHaveFocus();
    expect(tabindexes(first)).toEqual(['-1', '0']);
    // The arrow stops at the end of the list: it does not carry the focus into the next plugin's.
    await user.keyboard('{ArrowDown}');
    expect(first[1]).toHaveFocus();

    await user.tab();
    expect(second[0]).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onOpenConnection).toHaveBeenCalledTimes(1);
    expect(onOpenConnection).toHaveBeenCalledWith('beta', 'b1', expect.objectContaining({ type: 'click' }));
  });
});

// The row (core.js:1092-1098): "The shared clickable row of a list: one real element per row, never an interactive element inside another. label is html or [label, secondary] (the secondary is the muted second line, .cell2); icon an icon name or html
// (a tile, an avatar), meta the trailing muted html (a status, a count, a chip, a chevron)". The mock's connection row is `H.listrow([name, [plugin, detail].join(' · ')], { icon, meta: state word })` (shell-page-home.js:144).
describe('a connection row', () => {
  const staging = connection('k1', 'staging', { detail: 'managed · north-1' });
  const rowOf = (name: string): HTMLElement => within(connections()).getByRole('button', { name });

  it('is one native button with nothing interactive inside it, and says which plugin it is of', () => {
    mount({ groups: [group('acme', 'Acme', [staging])] });

    const row = rowOf('staging managed · north-1 Connected');
    expect(row.tagName).toBe('BUTTON');
    expect(row).toHaveAttribute('type', 'button');
    expect(row).toHaveAttribute('data-home-part', 'connection');
    expect(row).toHaveAttribute('data-home-plugin', 'acme');
    expect(row.querySelectorAll('button, a, input, select, textarea, summary, [role="button"], [tabindex]')).toHaveLength(0);
  });

  it('wears the plugin\'s tile, then the name in the title weight, the plugin\'s secondary text under it in the muted caption, and the state at the end', () => {
    mount({ groups: [group('acme', 'Acme', [staging])] });

    const row = rowOf('staging managed · north-1 Connected');
    // 16 px, as the mock's row icon is (`icon(glyph, 16)`): the row stays at the row height (24 px) when it has one line.
    const tile = row.firstElementChild;
    expect(tile).toHaveAttribute('aria-hidden', 'true');
    expect(tile).toHaveAttribute('data-ov-size', '16');
    expect(tile).toHaveAttribute('data-ov-tone', 'green');
    expect(tile?.querySelector('[data-ov-glyph]')).toHaveAttribute('data-ov-glyph', 'layers');

    const [first, second] = [...row.querySelectorAll('[data-ov-clip]')];
    expect(first?.textContent).toBe('staging');
    expect(first?.querySelector('[data-ov-variant="title"]')).not.toBeNull();
    expect(second?.textContent).toBe('managed · north-1');
    expect(second?.querySelector('[data-ov-variant="caption"][data-ov-tone="muted"]')).not.toBeNull();
    expect(row.querySelectorAll('[data-ov-clip]')).toHaveLength(2);

    expect(row.lastElementChild).toHaveAttribute('data-ov-role', 'healthy');
    expect(row.lastElementChild).toHaveTextContent('Connected');
  });

  it('says the host\'s reason on the second line when the last start failed: the reason takes the line and the plugin\'s text waits', () => {
    const failed = connection('k1', 'staging', { detail: 'managed · north-1', role: 'error', word: 'Not reachable', reason: 'The server did not answer' });
    mount({ groups: [group('acme', 'Acme', [failed])] });

    const row = rowOf('staging The server did not answer Not reachable');
    expect([...row.querySelectorAll('[data-ov-clip]')].map((line) => line.textContent)).toEqual(['staging', 'The server did not answer']);
    expect(row).not.toHaveTextContent('managed');
  });

  it('has one line when the plugin gives no secondary text, and an empty one is none', () => {
    mount({ groups: [group('acme', 'Acme', [connection('k1', 'staging'), connection('k2', 'production', { detail: '' })])] });

    expect(rowOf('staging Connected').querySelectorAll('[data-ov-clip]')).toHaveLength(1);
    expect(rowOf('production Connected').querySelectorAll('[data-ov-clip]')).toHaveLength(1);
  });

  it('is named by its text: the name, the secondary line and the state, with a space between them', () => {
    mount({ groups: [group('acme', 'Acme', [staging, connection('k2', 'production', { role: 'attention', word: 'Needs sign-in' })])] });

    expect(rowOf('staging managed · north-1 Connected')).toBeInTheDocument();
    expect(rowOf('production Needs sign-in')).toBeInTheDocument();
  });

  it('keeps the state whole at the end of a row whose name is a hundred characters: the name is in the row in full, in a clipping line, and the line is what gives way', () => {
    const long = `connection-${'abcdefghij'.repeat(10)}`;
    mount({ groups: [group('acme', 'Acme', [connection('k1', long, { detail: `managed · ${'north-1 '.repeat(12)}` })])] });

    const [row] = rowsOf(connections());
    expect(nameOf(row)).toBe(long);
    expect(row?.querySelectorAll('[data-ov-clip]')).toHaveLength(2);
    expect(row?.lastElementChild).toHaveAttribute('data-ov-role', 'healthy');
    // The lines clip with an ellipsis and may shrink to nothing; the text that holds them takes what the tile and the state leave; the state never shrinks (the kit's `Status`).
    const line = block('.line');
    expect(line).toContain('min-inline-size: 0;');
    expect(line).toContain('overflow: hidden;');
    expect(line).toContain('text-overflow: ellipsis;');
    expect(line).toContain('white-space: nowrap;');
    const text = block('.text');
    expect(text).toContain('flex: 1 1 auto;');
    expect(text).toContain('min-inline-size: 0;');
  });
});

describe('Recent', () => {
  const north = connection('n1', 'north', { plugin: 'acme', icon: 'layers', tone: 'green' });
  const orchard = connection('o1', 'orchard', { plugin: 'beta', icon: 'box', tone: 'blue' });

  it('is a region under a level 2 heading above the connections, with the rows of the recent connections, each wearing its own plugin\'s tile', () => {
    mount({ recent: [north, orchard], groups: [group('acme', 'Acme', named('staging'), true)] });

    const region = recent();
    expect(within(region).getByRole('heading', { level: 2, name: 'Recent' })).toBeInTheDocument();
    expect(follows(region, connections())).toBe(true);
    expect(rowsOf(region).map(nameOf)).toEqual(['north', 'orchard']);
    expect(rowsOf(region).map((row) => row.getAttribute('data-home-plugin'))).toEqual(['acme', 'beta']);
    expect(rowsOf(region).map((row) => row.querySelector('[data-ov-glyph]')?.getAttribute('data-ov-glyph'))).toEqual(['layers', 'box']);
    expect(rowsOf(region).map((row) => row.firstElementChild?.getAttribute('data-ov-tone'))).toEqual(['green', 'blue']);
    // The same row as any other: the plugin's tile, the name, the state.
    expect(within(region).getByRole('button', { name: 'north Connected' })).toHaveAttribute('data-home-part', 'connection');
  });

  it('is not drawn when there is no recent connection: no heading stands over nothing', () => {
    mount({ recent: [], groups: [group('acme', 'Acme', named('staging'))] });

    expect(screen.queryByRole('region', { name: 'Recent' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Recent' })).toBeNull();
  });

  it('is the only section when every connection is recent: no heading stands over a list with no row', () => {
    mount({ recent: [north], groups: [] });

    expect(rowsOf(recent())).toHaveLength(1);
    expect(screen.queryByRole('region', { name: 'Connections' })).toBeNull();
  });

  it('is one list and one Tab stop, named by what it holds, that the arrows, Home and End move in', async () => {
    const { user } = mount({ entries: [], recent: [north, orchard, connection('p1', 'pasture')] });
    const rows = within(recent()).getByRole('group', { name: 'Recent connections' });
    const items = within(rows).getAllByRole('button');
    expect(tabindexes(items)).toEqual(['0', '-1', '-1']);

    await user.tab();
    expect(items[0]).toHaveFocus();
    await user.keyboard('{ArrowDown}');
    expect(items[1]).toHaveFocus();
    await user.keyboard('{End}');
    expect(items[2]).toHaveFocus();
    await user.keyboard('{Home}');
    expect(items[0]).toHaveFocus();
  });

  it('opens a recent connection as any other: by its plugin, its key and the event that chose it', async () => {
    const { onOpenConnection, user } = mount({ recent: [north, orchard] });

    await user.click(within(recent()).getByRole('button', { name: 'orchard Connected' }));

    expect(onOpenConnection).toHaveBeenCalledTimes(1);
    expect(onOpenConnection).toHaveBeenCalledWith('beta', 'o1', expect.objectContaining({ type: 'click' }));
  });
});

describe('the keyboard on a connection', () => {
  const rows = [connection('a1', 'staging'), connection('a2', 'production')];

  it('opens the row the focus is on with Enter and with Space, and the modifiers held choose the disposition', async () => {
    const { onOpenConnection, user } = mount({ groups: [group('acme', 'Acme', rows)] });
    focus(rowsOf(connections())[0]);

    await user.keyboard('{Enter}');
    expect(onOpenConnection).toHaveBeenLastCalledWith('acme', 'a1', expect.objectContaining({ type: 'click', metaKey: false, shiftKey: false }));
    await user.keyboard(' ');
    expect(onOpenConnection).toHaveBeenLastCalledWith('acme', 'a1', expect.objectContaining({ type: 'click', metaKey: false, shiftKey: false }));
    await user.keyboard('{Meta>}{Enter}{/Meta}');
    expect(onOpenConnection).toHaveBeenLastCalledWith('acme', 'a1', expect.objectContaining({ type: 'click', metaKey: true }));
    await user.keyboard('{Shift>}{Enter}{/Shift}');
    expect(onOpenConnection).toHaveBeenLastCalledWith('acme', 'a1', expect.objectContaining({ type: 'click', shiftKey: true }));
    expect(onOpenConnection).toHaveBeenCalledTimes(4);
  });
});

describe('the menu of a row', () => {
  it('makes each connection row a context trigger of the menu it is given, keyed by the record it is of: its plugin and its key, and no element', () => {
    mount({
      menu: 'row-menu',
      recent: [connection('same', 'north', { plugin: 'beta' })],
      groups: [group('acme', 'Acme', [connection('same', 'north'), connection('other', 'south')])],
    });

    const rows = rowsOf(document.body);
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toHaveAttribute('data-ov-menu', 'row-menu');
      expect(row).toHaveAttribute('data-ov-menu-mode', 'context');
    }

    // Two records that share a key are two records: the key is the id the model made of the plugin and the key.
    expect(rows.map((row) => row.getAttribute('data-ov-menu-key'))).toEqual(['beta/same', 'acme/same', 'acme/other']);
  });

  it('keeps a record\'s key when its row moves from one list to another: it names the record and not where the row stands', () => {
    const north = connection('n1', 'north');
    const { again } = mount({ menu: 'row-menu', recent: [], groups: [group('acme', 'Acme', [north])] });
    const before = rowsOf(document.body)[0]?.getAttribute('data-ov-menu-key');

    again({ recent: [north], groups: [] });

    expect(rowsOf(recent())[0]?.getAttribute('data-ov-menu-key')).toBe(before);
    expect(before).toBe('acme/n1');
  });

  it('names the menu after the connection it is of', () => {
    mount({ menu: 'row-menu', groups: [group('acme', 'Acme', named('staging'))] });

    expect(rowsOf(document.body)[0]).toHaveAttribute('data-ov-menu-label', 'staging actions');
  });

  it('puts no trigger on a row when it is given no menu, and none on a plugin\'s row', () => {
    mount({ groups: [group('acme', 'Acme', named('staging'))] });
    expect(document.querySelectorAll('[data-ov-menu], [data-ov-menu-key], [data-ov-menu-mode]')).toHaveLength(0);
    cleanup();

    mount({ menu: 'row-menu', groups: [group('acme', 'Acme', named('staging'))] });
    expect(plugins().getAllByRole('button').every((button) => !button.hasAttribute('data-ov-menu'))).toBe(true);
  });
});

describe('while the connections are not known', () => {
  it('says that they are being read, under the title, marks the section busy, and draws no row', () => {
    mount({ groups: [], connections: 'loading' });

    const region = connections();
    expect(within(region).getByRole('heading', { level: 2, name: 'Connections' })).toBeInTheDocument();
    expect(within(region).getByText('Reading connections…')).toHaveAttribute('data-ov-tone', 'muted');
    expect(region).toHaveAttribute('aria-busy', 'true');
    expect(within(region).queryByText('Connections could not be read.')).toBeNull();
    expect(within(region).queryAllByRole('button')).toHaveLength(0);
  });

  it('says that they could not be read, offers a Retry that asks again, and keeps the rows it has', async () => {
    const { onRetry, user } = mount({ groups: [group('acme', 'Acme', named('staging'))], connections: 'failed' });

    const region = connections();
    expect(within(region).getByText('Connections could not be read.')).toHaveAttribute('data-ov-tone', 'muted');
    expect(within(region).queryByText('Reading connections…')).toBeNull();
    expect(region).not.toHaveAttribute('aria-busy');
    expect(within(region).getByRole('button', { name: 'staging Connected' })).toBeInTheDocument();

    await user.click(within(region).getByRole('button', { name: 'Retry' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('says that they could not be read when there is no row to keep, with the Retry the keyboard reaches', async () => {
    const { onRetry, user } = mount({ entries: [], groups: [], connections: 'failed' });

    expect(within(connections()).getByText('Connections could not be read.')).toBeInTheDocument();
    await user.tab();
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus();
    await user.keyboard('{Enter}');
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('draws no Retry for connections that were read', () => {
    mount({ groups: [group('acme', 'Acme', named('staging'))], connections: 'ready' });

    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull();
  });

  it('draws no section for connections that are read and that there are none of: no heading stands over nothing', () => {
    mount({ groups: [], connections: 'ready' });

    expect(screen.queryByRole('region', { name: 'Connections' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Connections' })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByText('Reading connections…')).toBeNull();
  });
});

describe('the field that narrows the connections by name', () => {
  const eight = [group('acme', 'Acme', named('harbour', 'meadow', 'summit', 'valley'), true), group('beta', 'Beta', named('harvest', 'north', 'orchard', 'river'), true)];

  it('is not there for six rows in all, Recent and Connections together, and is there for seven, named by what it searches', () => {
    const { again } = mount({ recent: [connection('r1', 'orchard')], groups: [group('acme', 'Acme', named('north', 'south', 'east')), group('beta', 'Beta', named('west', 'harbour'))] });
    expect(screen.queryByRole('searchbox')).toBeNull();

    again({ recent: [connection('r1', 'orchard'), connection('r2', 'river')], groups: [group('acme', 'Acme', named('north', 'south', 'east')), group('beta', 'Beta', named('west', 'harbour'))] });
    expect(search()).toBeInTheDocument();
    expect(part('side')).toContainElement(search());
  });

  it('narrows the rows of both lists to the names that match, keeps the plugin\'s name over what is left and takes away a list that has nothing left', async () => {
    const { user } = mount({ recent: [connection('r1', 'harvest-moon', { plugin: 'beta' })], groups: eight });
    expect(rowsOf(part('side'))).toHaveLength(9);

    await user.type(search(), 'har');
    expect(rowsOf(recent()).map(nameOf)).toEqual(['harvest-moon']);
    // `har` is a prefix of two names and inside a third: the prefixes lead, in the order the host gave them.
    expect(rowsOf(connections()).map(nameOf)).toEqual(['harbour', 'harvest', 'orchard']);

    await user.clear(search());
    await user.type(search(), 'val');
    expect(rowsOf(connections()).map(nameOf)).toEqual(['valley']);
    // Whether the lists are named is the host's list of plugins, not what is left of it: a name that came and went with each key would move the rows.
    expect(within(connections()).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Acme']);
    expect(within(connections()).queryByRole('group', { name: 'Beta connections' })).toBeNull();
    // Recent has nothing that matches: it goes, heading and all.
    expect(screen.queryByRole('region', { name: 'Recent' })).toBeNull();
  });

  it('ranks what it finds as the palette does, a whole name above one that starts with the query above one that has it inside, and keeps the order of rows that match alike', async () => {
    const { user } = mount({ groups: [group('acme', 'Acme', named('main-staging', 'staging-b', 'staging', 'staging-a', 'north', 'south', 'east'))] });

    await user.type(search(), 'staging');

    expect(rowsOf(connections()).map(nameOf)).toEqual(['staging', 'staging-b', 'staging-a', 'main-staging']);
  });

  it('matches the name first and the plugin\'s secondary text after it, so a region finds the connections of that region and a name that says it ranks above one that only has it under it', async () => {
    const rows = [
      connection('d1', 'north', { detail: 'managed · eu-west-1' }),
      connection('d2', 'eu-west-staging'),
      connection('d3', 'south', { detail: 'managed · us-east-1' }),
      ...named('east', 'west', 'harbour', 'meadow', 'summit'),
    ];
    const { user } = mount({ groups: [group('acme', 'Acme', rows)] });

    await user.type(search(), 'eu-west');

    expect(rowsOf(connections()).map(nameOf)).toEqual(['eu-west-staging', 'north']);
  });

  it('matches the name and the secondary text alone: not the state, nor the reason', async () => {
    const failed = connection('a1', 'prod', { role: 'error', word: 'Not reachable', reason: 'The server did not answer' });
    const { user } = mount({ groups: [group('acme', 'Acme', [failed, ...named('north', 'south', 'east', 'west', 'harbour', 'meadow')])] });

    await user.type(search(), 'reachable');
    expect(rowsOf(document.body)).toHaveLength(0);

    await user.clear(search());
    await user.type(search(), 'answer');
    expect(rowsOf(document.body)).toHaveLength(0);

    await user.clear(search());
    await user.type(search(), 'connected');
    expect(rowsOf(document.body)).toHaveLength(0);
  });

  it('says Nothing matches "<query>" when nothing does, in a status that is there while the field is, and gives the rows back when the text is cleared', async () => {
    const { user } = mount({ groups: eight });
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();
    expect(part('side')).toContainElement(status);

    await user.type(search(), ' zzz ');
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('Nothing matches "zzz"');
    expect(rowsOf(document.body).filter((row) => row.getAttribute('data-home-plugin') !== null)).toHaveLength(0);
    expect(screen.queryByRole('group', { name: /connections$/ })).toBeNull();
    expect(search()).toHaveValue(' zzz ');

    await user.keyboard('{Escape}');
    expect(search()).toHaveValue('');
    expect(status).toBeEmptyDOMElement();
    expect(rowsOf(connections())).toHaveLength(8);
  });

  it('narrows nothing for a query of white space', async () => {
    const { user } = mount({ groups: eight });

    await user.type(search(), '   ');

    expect(rowsOf(connections())).toHaveLength(8);
    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  it('is gone with its rows when the list falls to six, and the query it held narrows nothing', async () => {
    const { user, again } = mount({ groups: eight });
    await user.type(search(), 'zzz');
    expect(rowsOf(document.body)).toHaveLength(0);

    again({ groups: [group('acme', 'Acme', named('harbour', 'meadow', 'summit', 'valley', 'north', 'south'))] });

    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(rowsOf(connections())).toHaveLength(6);
  });
});

describe('typing on a connection', () => {
  const eight = [group('acme', 'Acme', named('harbour', 'meadow', 'summit', 'valley'), true), group('beta', 'Beta', named('harvest', 'north', 'orchard', 'river'), true)];

  it('moves the focus to the field and enters the character there, and the rows narrow to it', async () => {
    const { user } = mount({ groups: eight });
    focus(within(connections()).getByRole('button', { name: 'summit Connected' }));

    await user.keyboard('v');

    expect(search()).toHaveFocus();
    expect(search()).toHaveValue('v');
    expect(rowsOf(connections()).map(nameOf)).toEqual(['valley', 'harvest', 'river']);
  });

  it('adds the character to what the field holds already', async () => {
    const { user } = mount({ groups: eight });
    await user.type(search(), 'ha');
    expect(rowsOf(connections()).map(nameOf)).toEqual(['harbour', 'harvest', 'orchard']);
    focus(rowsOf(connections())[0]);

    await user.keyboard('r');

    expect(search()).toHaveFocus();
    expect(search()).toHaveValue('har');
  });

  it('works from a row of Recent as from one of Connections', async () => {
    const { user } = mount({ recent: [connection('r1', 'orchard', { plugin: 'beta' })], groups: eight });
    focus(rowsOf(recent())[0]);

    await user.keyboard('o');

    expect(search()).toHaveFocus();
    expect(search()).toHaveValue('o');
  });

  it('is for a printable character alone: Space opens the row, and a chord, an arrow and Enter leave the focus where it is', async () => {
    const { onOpenConnection, user } = mount({ groups: eight });
    const row = within(connections()).getByRole('button', { name: 'meadow Connected' });
    focus(row);

    await user.keyboard('{Meta>}k{/Meta}');
    await user.keyboard('{Control>}k{/Control}');
    await user.keyboard('{Alt>}k{/Alt}');
    expect(row).toHaveFocus();
    expect(search()).toHaveValue('');

    await user.keyboard(' ');
    expect(onOpenConnection).toHaveBeenCalledTimes(1);
    expect(row).toHaveFocus();
    expect(search()).toHaveValue('');

    await user.keyboard('{Enter}');
    expect(onOpenConnection).toHaveBeenCalledTimes(2);
    await user.keyboard('{ArrowDown}');
    expect(row).not.toHaveFocus();
    expect(search()).not.toHaveFocus();
  });

  it('does nothing when there is no field to take the character: six rows or fewer', async () => {
    const { user } = mount({ groups: [group('acme', 'Acme', named('harbour', 'meadow', 'summit', 'valley', 'north', 'south'))] });
    const row = within(connections()).getByRole('button', { name: 'summit Connected' });
    focus(row);

    await user.keyboard('v');

    expect(row).toHaveFocus();
    expect(screen.queryByRole('searchbox')).toBeNull();
  });

  it('is for the connections: a character typed on a plugin\'s row leaves the focus on it', async () => {
    const { user } = mount({ groups: eight });
    const row = plugins().getByRole('button', { name: 'Acme' });
    focus(row);

    await user.keyboard('v');

    expect(row).toHaveFocus();
    expect(search()).toHaveValue('');
  });

  it('is for the connections: a character typed on the Retry leaves the focus on it, though it stands in the same column', async () => {
    const { user } = mount({ groups: eight, connections: 'failed' });
    const retry = screen.getByRole('button', { name: 'Retry' });
    focus(retry);

    await user.keyboard('v');

    expect(retry).toHaveFocus();
    expect(search()).toHaveValue('');
  });
});

describe('what the page tells a person who cannot see it', () => {
  const region = (): HTMLElement => part('announcement');

  it('has one polite live region from the first, empty, with no role of its own: a page that has a status of its own is found by that role', () => {
    mount({ groups: [group('acme', 'Acme', named('staging'))] });

    expect(region()).toHaveAttribute('aria-live', 'polite');
    expect(region()).toHaveAttribute('aria-atomic', 'true');
    expect(region()).not.toHaveAttribute('role');
    expect(region()).toHaveTextContent('');
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('says what it is told, and says a sentence told twice in a row twice: the node is replaced, not rewritten', () => {
    const { again } = mount({ groups: [group('acme', 'Acme', named('staging'))] });

    again({ announcement: { serial: 1, text: 'Copied staging' } });
    expect(region()).toHaveTextContent('Copied staging');
    const first = region().firstElementChild;

    again({ announcement: { serial: 2, text: 'Copied staging' } });
    expect(region()).toHaveTextContent('Copied staging');
    expect(region().firstElementChild).not.toBe(first);
  });
});

// What the page costs (HM2). Counts, never milliseconds: a render commit is what React reports to a `Profiler`, and a row is drawn when its render function reads its data, so a row whose data is watched says how often it was drawn. A page
// of 200 connections is one commit; a character typed in the field is at most two (the field's own and, if the host defers the narrowing, the list's); and a store that changes one connection draws that row and no other, because a row is
// memoised on its data, which is the same object while the connection is the same (`homeModel.ts`).
describe('what the page costs', () => {
  const many = (count: number): HomeConnectionRow[] => Array.from({ length: count }, (_, at) => connection(`k${String(at)}`, `connection ${String(at).padStart(3, '0')}`));

  function profiled(props: HomeProps) {
    const onRender = vi.fn();
    const tree = (current: HomeProps) => (
      <Profiler id="home" onRender={onRender}>
        <Home {...current} />
      </Profiler>
    );
    const view = render(tree(props));
    return {
      onRender,
      again: (next: HomeProps) => {
        view.rerender(tree(next));
      },
    };
  }

  /** A copy of the row whose state word counts its reads, by the row's key: the row's render function is the one thing that reads it. */
  function watched(row: HomeConnectionRow, reads: Map<string, number>): HomeConnectionRow {
    const copy = { ...row };
    Object.defineProperty(copy, 'word', {
      enumerable: true,
      get: () => {
        reads.set(row.key, (reads.get(row.key) ?? 0) + 1);
        return row.word;
      },
    });
    return copy;
  }

  const plain = (rows: readonly HomeConnectionRow[]): HomeConnectionGroup => ({ plugin: 'acme', label: 'Acme', named: false, rows });

  it('is one commit to put 200 connections of one plugin on the page', () => {
    const { onRender } = profiled(propsOf({ groups: [plain(many(200))] }));

    expect(rowsOf(document.body)).toHaveLength(200);
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(onRender.mock.calls[0]?.[1]).toBe('mount');
  });

  it('is at most two commits for a character typed in the field, and at least one: the count sees the keystroke', async () => {
    const user = userEvent.setup();
    const { onRender } = profiled(propsOf({ groups: [plain(many(200))] }));
    await user.click(search());
    onRender.mockClear();

    await user.keyboard('7');

    expect(search()).toHaveValue('7');
    expect(rowsOf(connections()).length).toBeLessThan(200);
    expect(onRender.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(onRender.mock.calls.length).toBeLessThanOrEqual(2);
  });

  it('draws the row of the connection that changed, and no other row of the 200', () => {
    const reads = new Map<string, number>();
    const rows = many(200).map((row) => watched(row, reads));
    const props = propsOf({ groups: [plain(rows)] });
    const { onRender, again } = profiled(props);
    expect(reads.size).toBe(200);
    reads.clear();
    onRender.mockClear();

    // The store says one connection is not reachable now: that row is a new object, and the other 199 are the ones the page has.
    const changed = watched({ ...rows[42], role: 'error', word: 'Not reachable' }, reads);
    again({ ...props, groups: [plain(rows.map((row, at) => (at === 42 ? changed : row)))] });

    expect(rowsOf(document.body)[42]).toHaveTextContent('connection 042 Not reachable');
    expect([...reads.keys()]).toEqual(['k42']);
    expect(onRender).toHaveBeenCalledTimes(1);
  });

  it('draws no row again for a render that changes none: the same rows and the same handlers', () => {
    const reads = new Map<string, number>();
    const props = propsOf({ groups: [plain(many(50).map((row) => watched(row, reads)))] });
    const { again } = profiled(props);
    reads.clear();

    again({ ...props });

    expect(reads.size).toBe(0);
  });

  // The control of the two above: the counter does see a row being drawn. Hand every row over as a new object, as a store that rebuilt its whole list would, and every row is drawn again.
  it('draws every row again when every row is a new object: the counter counts renders', () => {
    const reads = new Map<string, number>();
    const props = propsOf({ groups: [plain(many(50).map((row) => watched(row, reads)))] });
    const { again } = profiled(props);
    reads.clear();

    again({ ...props, groups: [plain(many(50).map((row) => watched(row, reads)))] });

    expect(reads.size).toBe(50);
  });
});

describe('the page\'s stylesheet', () => {
  it('is one column and two from 760 px of the page\'s own width: the plugins three parts, the connections two and 280 px at the least, inside 1120 px', () => {
    expect(block('.home')).toContain('container-type: inline-size;');
    expect(block('.home')).toContain('max-inline-size: 1120px;');
    expect(block('.grid')).toContain('grid-template-columns: minmax(0, 1fr);');

    const query = css.indexOf('@container (min-width: 760px)');
    expect(query, 'the query is on the page\'s own width').toBeGreaterThanOrEqual(0);
    expect(block('.grid', query)).toContain('grid-template-columns: minmax(0, 3fr) minmax(280px, 2fr);');
  });

  it('stacks the side column\'s sections 20 px apart, and lets both columns shrink to the grid\'s track', () => {
    const base = css.indexOf('The side column:');
    expect(base, 'the side column has its rule').toBeGreaterThanOrEqual(0);
    expect(block('.side', base)).toContain('flex-direction: column;');
    expect(block('.side', base)).toContain('gap: var(--ov-spacing-20);');
    expect(block('.side', base)).toContain('min-inline-size: 0;');
    expect(css).toMatch(/\.main \{\s*min-inline-size: 0;\s*\}/);
  });

  it('puts the field in the first row of the side column from two columns, and the plugins and Recent under it, so that their headings stand level (the mock\'s grid starts both columns at the same top)', () => {
    const query = css.indexOf('@container (min-width: 760px)');
    expect(block('.grid > .side', query)).toContain('display: contents;');
    expect(block('.grid > .side > .find', query)).toContain('grid-column: 2;');
    expect(block('.grid > .side > .find', query)).toContain('grid-row: 1;');
    expect(block('.grid > .main', query)).toContain('grid-row: 2 / span 2;');
    expect(block('.grid:not(:has(.find)) > .main', query)).toContain('grid-row: 1 / span 2;');
  });

  it('is the mock\'s row: the row height at the least, the row padding above and 12 px beside, 8 px between its parts, the control radius', () => {
    const row = block('.row');
    expect(row).toContain('min-block-size: var(--ov-row-height);');
    expect(row).toContain('padding: var(--ov-row-pad) var(--ov-spacing-12);');
    expect(row).toContain('gap: var(--ov-spacing-8);');
    expect(row).toContain('border-radius: var(--ov-radius-control);');
  });

  it('reaches 12 px past the content edge with each list, so that the row\'s own 12 px puts its text on the title\'s edge and its hover fill is not cut (the mock\'s `.home .rove`)', () => {
    expect(block('.rows')).toContain('margin-inline: calc(-1 * var(--ov-spacing-12));');
  });

  it('keeps the live region where a screen reader finds it and no eye does', () => {
    const said = block('.said');
    expect(said).toContain('position: absolute;');
    expect(said).toContain('clip-path: inset(50%);');
    expect(said).toContain('overflow: hidden;');
  });
});
