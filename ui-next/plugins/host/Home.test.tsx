import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Home, type HomeConnectionGroup, type HomeConnectionRow, type HomeProps } from './Home';
import { NoTabs, type HomeEntry } from './NoTabs';

// The Home page on its own (HM1): plain data in, what was chosen out. jsdom lays nothing out, so the two columns, the ellipsis and the focus ring are the screen's; the one thing of the layout that is a number the page is held to is read
// from the stylesheet as text, at the end. The rows are made by the host (`homeModel.ts`); here they are invented, and so are the plugins.

const css = await readFile(path.join(import.meta.dirname, 'Home.module.css'), 'utf8');

const entry = (id: string, label: string, state?: string): HomeEntry => ({ id, label, icon: 'box', tone: 'blue', state });
const connection = (key: string, name: string, over: Partial<HomeConnectionRow> = {}): HomeConnectionRow => ({ key, name, role: 'healthy', word: 'Connected', ...over });
const group = (plugin: string, label: string, rows: readonly HomeConnectionRow[]): HomeConnectionGroup => ({ plugin, label, icon: 'layers', tone: 'green', rows });
/** One connected connection for each name, its key the name. */
const named = (...names: readonly string[]): HomeConnectionRow[] => names.map((name) => connection(name, name));

function mount(over: Partial<HomeProps> = {}) {
  const onOpenPlugin = vi.fn<HomeProps['onOpenPlugin']>();
  const onOpenConnection = vi.fn<HomeProps['onOpenConnection']>();
  const props: HomeProps = { entries: [entry('acme', 'Acme'), entry('beta', 'Beta')], groups: [], connections: 'ready', empty: false, onOpenPlugin, onOpenConnection, ...over };
  const view = render(<Home {...props} />);
  return {
    onOpenPlugin,
    onOpenConnection,
    user: userEvent.setup(),
    again: (next: Partial<HomeProps>) => {
      view.rerender(<Home {...props} {...next} />);
    },
  };
}

const plugins = () => within(screen.getByRole('region', { name: 'Plugins you can open' }));
const connections = () => screen.getByRole('region', { name: 'Connections' });
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
    expect(title.compareDocumentPosition(line) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(line.compareDocumentPosition(screen.getByRole('region', { name: 'Plugins you can open' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('draws the plugins you can open before the connections, in the one column the narrow page has', () => {
    mount({ groups: [group('acme', 'Acme', named('staging'))] });

    const first = screen.getByRole('region', { name: 'Plugins you can open' });
    expect(first.compareDocumentPosition(connections()) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
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
  const acme = group('acme', 'Acme', [connection('a1', 'staging'), connection('a2', 'production', { role: 'attention', word: 'Needs sign-in' })]);
  const beta = group('beta', 'Beta', [connection('b1', 'sandbox', { role: 'stopped', word: 'Disconnected' })]);

  it('draws a list for each plugin, a row for each connection by its name with its state beside it, and the plugin\'s name over each list when there are several', () => {
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

  it('does not name the list when there is one plugin: the title says what they are', () => {
    mount({ groups: [acme] });

    expect(within(connections()).queryAllByRole('heading', { level: 3 })).toHaveLength(0);
    expect(listOf('Acme').getAllByRole('button')).toHaveLength(2);
  });

  it('puts the reason the last start failed on a second muted line under the name, which is whole to the pointer when it is cut, and no second line where there is none', () => {
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
    const { onOpenConnection, user } = mount({ groups: [acme, group('beta', 'Beta', [connection('b1', 'sandbox'), failed])] });
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

describe('while the connections are not known', () => {
  it('says that they are loading, under the title, and draws no row', () => {
    mount({ groups: [], connections: 'loading' });

    const region = connections();
    expect(within(region).getByRole('heading', { level: 2, name: 'Connections' })).toBeInTheDocument();
    expect(within(region).getByText('Connections are loading.')).toHaveAttribute('data-ov-tone', 'muted');
    expect(within(region).queryByText('Connections could not be read.')).toBeNull();
    expect(within(region).queryAllByRole('button')).toHaveLength(0);
  });

  it('says that they could not be read, and keeps the rows it has', () => {
    mount({ groups: [group('acme', 'Acme', named('staging'))], connections: 'failed' });

    const region = connections();
    expect(within(region).getByText('Connections could not be read.')).toHaveAttribute('data-ov-tone', 'muted');
    expect(within(region).queryByText('Connections are loading.')).toBeNull();
    expect(within(region).getByRole('button', { name: 'staging Connected' })).toBeInTheDocument();
  });

  it('says that they could not be read when there is no row to keep', () => {
    mount({ groups: [], connections: 'failed' });

    expect(within(connections()).getByText('Connections could not be read.')).toBeInTheDocument();
  });

  it('draws no section for connections that are read and that there are none of: no heading stands over nothing', () => {
    mount({ groups: [], connections: 'ready' });

    expect(screen.queryByRole('region', { name: 'Connections' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Connections' })).toBeNull();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByText('Connections are loading.')).toBeNull();
  });
});

describe('the field that narrows the connections by name', () => {
  const eight = [group('acme', 'Acme', named('harbour', 'meadow', 'summit', 'valley')), group('beta', 'Beta', named('harvest', 'north', 'orchard', 'river'))];

  it('is not there for six rows in all, and is there for seven, named by what it searches', () => {
    const { again } = mount({ groups: [group('acme', 'Acme', named('north', 'south', 'east')), group('beta', 'Beta', named('west', 'harbour', 'meadow'))] });
    expect(screen.queryByRole('searchbox')).toBeNull();

    again({ groups: [group('acme', 'Acme', named('north', 'south', 'east')), group('beta', 'Beta', named('west', 'harbour', 'meadow', 'summit'))] });
    expect(search()).toBeInTheDocument();
    expect(within(connections()).getByRole('searchbox', { name: 'Search connections' })).toBeInTheDocument();
  });

  it('narrows the rows to the names that match, keeps the plugin\'s name over what is left and takes away a plugin that has nothing left', async () => {
    const { user } = mount({ groups: eight });
    expect(rowsOf(connections())).toHaveLength(8);

    await user.type(search(), 'val');

    expect(rowsOf(connections()).map(nameOf)).toEqual(['valley']);
    // Whether the lists are named is the host's list of plugins, not what is left of it: a name that came and went with each key would move the rows.
    expect(within(connections()).getAllByRole('heading', { level: 3 }).map((heading) => heading.textContent)).toEqual(['Acme']);
    expect(within(connections()).queryByRole('group', { name: 'Beta connections' })).toBeNull();
  });

  it('ranks what it finds as the palette does, a whole name above one that starts with the query above one that has it inside, and keeps the order of rows that match alike', async () => {
    const { user } = mount({ groups: [group('acme', 'Acme', named('main-staging', 'staging-b', 'staging', 'staging-a', 'north', 'south', 'east'))] });

    await user.type(search(), 'staging');

    expect(rowsOf(connections()).map(nameOf)).toEqual(['staging', 'staging-b', 'staging-a', 'main-staging']);
  });

  it('matches the name alone: not the state, nor the reason', async () => {
    const failed = connection('a1', 'prod', { role: 'error', word: 'Not reachable', reason: 'The server did not answer' });
    const { user } = mount({ groups: [group('acme', 'Acme', [failed, ...named('north', 'south', 'east', 'west', 'harbour', 'meadow')])] });

    await user.type(search(), 'reachable');
    expect(rowsOf(connections())).toHaveLength(0);

    await user.clear(search());
    await user.type(search(), 'answer');
    expect(rowsOf(connections())).toHaveLength(0);

    await user.clear(search());
    await user.type(search(), 'connected');
    expect(rowsOf(connections())).toHaveLength(0);
  });

  it('says Nothing matches "<query>" when nothing does, in a status that is there while the field is, and gives the rows back when the text is cleared', async () => {
    const { user } = mount({ groups: eight });
    const status = screen.getByRole('status');
    expect(status).toBeEmptyDOMElement();

    await user.type(search(), ' zzz ');
    expect(screen.getByRole('status')).toBe(status);
    expect(status).toHaveTextContent('Nothing matches "zzz"');
    expect(rowsOf(connections())).toHaveLength(0);
    expect(within(connections()).queryByRole('group')).toBeNull();
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
    expect(rowsOf(connections())).toHaveLength(0);

    again({ groups: [group('acme', 'Acme', named('harbour', 'meadow', 'summit', 'valley', 'north', 'south'))] });

    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(rowsOf(connections())).toHaveLength(6);
  });
});

describe('the empty window', () => {
  const none = () => undefined;

  it('is the page with its line, inside the part the shell\'s probes read', () => {
    const { container } = render(<NoTabs entries={[entry('acme', 'Acme')]} onOpen={none} />);

    const part = container.querySelector('[data-shell-part="home"]');
    expect(part).not.toBeNull();
    expect(part).toContainElement(screen.getByRole('heading', { level: 1, name: 'Home' }));
    expect(part).toContainElement(screen.getByText('No tabs are open.'));
    expect(part).toContainElement(screen.getByRole('region', { name: 'Plugins you can open' }));
  });

  it('opens a plugin by its id alone', async () => {
    const onOpen = vi.fn<(id: string) => void>();
    render(<NoTabs entries={[entry('acme', 'Acme'), entry('beta', 'Beta')]} onOpen={onOpen} />);

    await userEvent.setup().click(within(screen.getByRole('region', { name: 'Plugins you can open' })).getByRole('button', { name: 'Beta' }));

    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onOpen).toHaveBeenCalledWith('beta');
  });

  it('draws no connections unless it is given some', () => {
    render(<NoTabs entries={[entry('acme', 'Acme')]} onOpen={none} />);

    expect(screen.queryByRole('region', { name: 'Connections' })).toBeNull();
    expect(screen.queryByText('Connections are loading.')).toBeNull();
  });

  it('draws the connections it is given and opens one through onOpenConnection, with the event', async () => {
    const onOpenConnection = vi.fn<HomeProps['onOpenConnection']>();
    render(<NoTabs entries={[entry('acme', 'Acme')]} onOpen={none} groups={[group('acme', 'Acme', named('staging'))]} onOpenConnection={onOpenConnection} />);

    await userEvent.setup().click(within(connections()).getByRole('button', { name: 'staging Connected' }));

    expect(onOpenConnection).toHaveBeenCalledTimes(1);
    expect(onOpenConnection).toHaveBeenCalledWith('acme', 'staging', expect.objectContaining({ type: 'click' }));
  });

  it('says what the window knows of the connections when it is told', () => {
    render(<NoTabs entries={[entry('acme', 'Acme')]} onOpen={none} connections="loading" />);

    expect(within(connections()).getByText('Connections are loading.')).toBeInTheDocument();
  });
});

describe('the page\'s stylesheet', () => {
  const block = (selector: string, from = 0): string => {
    const start = css.indexOf(`${selector} {`, from);
    expect(start, `${selector} has a rule`).toBeGreaterThanOrEqual(0);
    return css.slice(start, css.indexOf('}', start));
  };

  it('is one column and two from 760 px of the page\'s own width: the plugins three parts, the connections two and 280 px at the least, inside 1120 px', () => {
    expect(block('.home')).toContain('container-type: inline-size;');
    expect(block('.home')).toContain('max-inline-size: 1120px;');
    expect(block('.grid')).toContain('grid-template-columns: minmax(0, 1fr);');

    const query = css.indexOf('@container (min-width: 760px)');
    expect(query, 'the query is on the page\'s own width').toBeGreaterThanOrEqual(0);
    expect(block('.grid', query)).toContain('grid-template-columns: minmax(0, 3fr) minmax(280px, 2fr);');
  });
});
