import { MenuHost } from '@omniviewdev/kit';
import { act, cleanup, fireEvent, render, screen, within, type RenderResult } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { Profiler, StrictMode, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { CLOSED_EVENT, CONNECTION_EVENT, CREATED_EVENT, UNLOADED_EVENT } from './api';
import * as model from './model';
import { createPortsStore, type PortsStore } from './PortsStore';
import { PortsBody } from './PortsBody';
import { fakePorts, session, settle, type FakePorts } from './testing';

// The body of the Ports tool, in the DOM: what it says while it reads, when it cannot, and when there is nothing; the table of forwards and what each cell says; the three actions of a row, in the buttons and in the menu, and what each does; the
// keyboard; and what it costs while nothing happens. Over the real store and the fake host of `testing.ts`. What the panel does with the body (when it is drawn, the tab that names it) is `PortsTool.panel.test.tsx`'s; what the rows say is
// `model.test.ts`'s; where things stand in a real engine is the probe's.

type Rig = { readonly fake: FakePorts; readonly store: PortsStore; readonly view: RenderResult; readonly user: UserEvent };

/** The body on a store over a fake host, under the window's one menu host, and the first answer of the host given when there is one. */
async function mount(sessions?: readonly unknown[], wrap: (body: ReactElement) => ReactElement = (body) => body): Promise<Rig> {
  const fake = fakePorts();
  const store = createPortsStore(fake.deps);
  const view = render(wrap(<MenuHost><PortsBody store={store} /></MenuHost>));
  if (sessions !== undefined) {
    await fake.answer(sessions);
  }

  return { fake, store, view, user: userEvent.setup() };
}

const body = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[data-shell-part="portsBody"]');
  if (found === null) {
    throw new Error('the tool draws no body');
  }

  return found;
};

const rows = (): HTMLElement[] => [...document.querySelectorAll<HTMLElement>('[data-ports-part="row"]')];
const rowOf = (id: string): HTMLElement => {
  const found = rows().find((row) => row.dataset.portsId === id);
  if (found === undefined) {
    throw new Error(`there is no row ${id}`);
  }

  return found;
};

/** One cell or part of a row, by the name the body gives it. */
const partOf = (row: HTMLElement, part: string): HTMLElement => {
  const found = row.querySelector<HTMLElement>(`[data-ports-part="${part}"]`);
  if (found === null) {
    throw new Error(`the row has no ${part}`);
  }

  return found;
};

const buttonOf = (id: string, name: string): HTMLElement => within(rowOf(id)).getByRole('button', { name });
const live = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[data-ports-part="live"]');
  if (found === null) {
    throw new Error('the tool has no live region');
  }

  return found;
};

/** What a row's four cells of data say, in the order the columns stand. The fifth holds the commands, whose words are their descriptions. */
const cells = (id: string): string[] => [...rowOf(id).querySelectorAll('td')].slice(0, 4).map((cell) => cell.textContent.trim());

const metrics = (): void => {
  vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(800);
  vi.spyOn(document.documentElement, 'clientHeight', 'get').mockReturnValue(600);
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function measure(this: Element) {
    return this.getAttribute('role') === 'menu' ? new DOMRect(0, 0, 200, 120) : new DOMRect(100, 60, 60, 24);
  });
};

let shown: HTMLStyleElement;
let warn: MockInstance<Console['warn']>;

beforeEach(() => {
  metrics();
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  // jsdom has no Popover API: the setup's stand-in marks an element and nothing shows it, and a popover is `display: none` from the user agent, with an importance a page rule does not beat without its own. The menu's items would not be in the accessibility tree. (A stylesheet of this test only: the product's CSS has none.)
  shown = document.createElement('style');
  shown.textContent = '[popover] { display: block !important; }';
  document.head.append(shown);
});

afterEach(() => {
  cleanup();
  shown.remove();
  vi.restoreAllMocks();
});

describe('while the host has not answered', () => {
  it('says that it is loading the forwarded ports, as a busy status, and draws no table and no count: nothing is known yet', async () => {
    await mount();
    expect(screen.getByRole('status', { name: 'Loading forwarded ports' })).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('table')).toBeNull();
    expect(document.querySelector('[data-ports-part="footer"]')).toBeNull();
  });
});

describe('when the host could not be read', () => {
  it('says so in plain words and offers Try again, which asks the host again: loading, then what it says', async () => {
    const { fake, store, user } = await mount();
    await fake.fail(new Error('down'));
    expect(screen.getByText('Couldn\'t read the port forwards.')).toBeInTheDocument();
    expect(screen.queryByRole('table')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(fake.listed()).toBe(2);
    expect(store.getSnapshot().status).toBe('loading');
    expect(screen.getByRole('status', { name: 'Loading forwarded ports' })).toBeInTheDocument();
    await fake.answer([session('a')]);
    expect(screen.getByRole('table', { name: 'Forwarded ports' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
  });

  it('is reached by the keyboard: Try again is a button with the focus order of one', async () => {
    const { fake, user } = await mount();
    await fake.fail(new Error('down'));
    await user.tab();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
  });
});

describe('when the host holds no forward', () => {
  it('says what is missing and how one arrives, and has no button: a forward starts from a resource, and the tool starts none', async () => {
    await mount([]);
    expect(screen.getByText('No forwarded ports')).toBeInTheDocument();
    expect(screen.getByText('Forward a port of a resource to this computer.')).toBeInTheDocument();
    expect(within(body()).queryAllByRole('button')).toHaveLength(0);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('counts none in the footer', async () => {
    await mount([]);
    expect(screen.getByText('0 forwards')).toBeInTheDocument();
  });
});

describe('the table of forwards', () => {
  it('is a table named Forwarded ports, with the columns Resource, Mapping, Connection, Status and Actions, in that order, the last one named and not drawn', async () => {
    await mount([session('a')]);
    const table = screen.getByRole('table', { name: 'Forwarded ports' });
    const headers = within(table).getAllByRole('columnheader');
    expect(headers.map((header) => header.textContent)).toEqual(['Resource', 'Mapping', 'Connection', 'Status', 'Actions']);
    expect(headers.every((header) => header.getAttribute('scope') === 'col')).toBe(true);
    // The word of the last header is real text in a box that is not drawn: it names the column and takes no room.
    expect(within(headers[4]).getByText('Actions')).toBeInTheDocument();
  });

  it('has a row for each forward, in the order the store gives, each saying its resource, its mapping, its connection and its state', async () => {
    const { fake } = await mount();
    fake.names.set('acme', 'conn-1', 'Staging');
    await fake.answer([session('a', { local_port: 8081, remote_port: 8080 }), session('b', { created_at: '2026-11-24T11:00:00Z', state: 'PAUSED', local_port: 9000, remote_port: 5432 })]);
    expect(rows().map((row) => row.dataset.portsId)).toEqual(['a', 'b']);
    expect(cells('a')).toEqual(['res-a', 'port 8081 → :8080/TCP', 'Staging', 'Running']);
    expect(cells('b')).toEqual(['res-b', 'port 9000 → :5432/TCP', 'Staging', 'Paused']);
    expect(rowOf('a').dataset.portsState).toBe('running');
    expect(rowOf('b').dataset.portsState).toBe('paused');
  });

  it('draws a connection it has no name for as a dash that says what is missing, and never draws its id', async () => {
    await mount([session('a')]);
    const connection = partOf(rowOf('a'), 'connection');
    expect(within(connection).getByRole('img', { name: /^Not reported/ })).toBeInTheDocument();
    expect(document.body.textContent).not.toContain('conn-1');
  });

  it('says a static target by its address, and its connection as a dash that says there is none', async () => {
    await mount([session('a', { connection_type: 'STATIC', connection: { address: 'db.internal:5432' } })]);
    expect(rowOf('a').querySelector('[data-ports-part="resource"]')?.textContent).toBe('db.internal:5432');
    const connection = partOf(rowOf('a'), 'connection');
    expect(within(connection).getByRole('img', { name: /^Not applicable/ })).toBeInTheDocument();
  });

  it('says the mapping in the code face, and the protocol in it', async () => {
    await mount([session('a', { protocol: 'UDP' })]);
    expect(rowOf('a').querySelector('[data-ports-part="mapping"]')?.textContent).toBe('port 8081 → :8080/UDP');
  });

  it('says a resource it has no name for as a dash too: nothing is made up', async () => {
    await mount([session('a', { connection: { plugin_id: 'acme', connection_id: 'conn-1' } })]);
    const resource = partOf(rowOf('a'), 'resource');
    expect(within(resource).getByRole('img', { name: /^Not reported/ })).toBeInTheDocument();
  });

  it('draws the second line of the Resource cell for a forward whose plugin stopped, and says Stopped in the Status cell', async () => {
    const { fake } = await mount([session('a'), session('b')]);
    act(() => {
      fake.emit(UNLOADED_EVENT, { pluginID: 'acme', cause: 'crashed' });
    });
    expect(cells('a')).toEqual(['res-aIts plugin stopped.', 'port 8081 → :8080/TCP', '—', 'Stopped']);
    expect(rowOf('a').querySelector('[data-ports-part="reason"]')?.textContent).toBe('Its plugin stopped.');
    expect(rowOf('a').dataset.portsState).toBe('stopped');
  });

  it('says that a forward could not be stopped, on its row, with the host\'s words', async () => {
    const { fake, user } = await mount([session('a')]);
    await user.click(buttonOf('a', 'Stop'));
    await fake.closeFail(new Error('The plugin is busy.'));
    expect(rowOf('a').querySelector('[data-ports-part="reason"]')?.textContent).toBe('Couldn\'t stop it. The plugin is busy.');
    expect(cells('a')[3]).toBe('Running');
  });

  it('counts the forwards in the footer, in the singular for one', async () => {
    const { fake } = await mount([session('a')]);
    expect(screen.getByText('1 forward')).toBeInTheDocument();
    act(() => {
      fake.emit(CREATED_EVENT, session('b'));
    });
    expect(screen.getByText('2 forwards')).toBeInTheDocument();
  });

  it('follows the host: a forward created is a row, and one closed is gone, with nothing else drawn again', async () => {
    const { fake } = await mount([session('a')]);
    const first = rowOf('a');
    act(() => {
      fake.emit(CREATED_EVENT, session('b', { created_at: '2026-11-24T11:00:00Z' }));
    });
    expect(rows().map((row) => row.dataset.portsId)).toEqual(['a', 'b']);
    expect(rowOf('a')).toBe(first);
    act(() => {
      fake.emit(CLOSED_EVENT, session('a'));
    });
    expect(rows().map((row) => row.dataset.portsId)).toEqual(['b']);
  });
});

describe('the actions of a row', () => {
  it('are a group named for the forward, with Stop, Open in browser and Copy port in that order, as buttons with names', async () => {
    await mount([session('a')]);
    const group = within(rowOf('a')).getByRole('group', { name: 'Port actions for res-a, port 8081 → :8080/TCP' });
    expect(within(group).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Stop', 'Open in browser', 'Copy port']);
    expect(['stop', 'open', 'copy'].map((name) => group.querySelector(`[data-ports-action="${name}"]`) !== null)).toEqual([true, true, true]);
  });

  it('is always drawn, not on hover: the buttons are there for a row that nobody points at', async () => {
    await mount([session('a'), session('b')]);
    expect(screen.getAllByRole('button', { name: 'Stop' })).toHaveLength(2);
  });

  it('has no Open in browser for a UDP forward, and keeps the other two where they were: the column does not move', async () => {
    await mount([session('a'), session('b', { protocol: 'UDP' })]);
    expect(within(rowOf('b')).queryByRole('button', { name: 'Open in browser' })).toBeNull();
    const group = within(rowOf('b')).getByRole('group');
    expect(within(group).getAllByRole('button').map((button) => button.getAttribute('aria-label'))).toEqual(['Stop', 'Copy port']);
    // Stop stands first and Copy last in a row of three boxes: a placeholder holds the place of the one that is not offered.
    expect(group.children).toHaveLength(3);
    expect(group.children[1]?.getAttribute('aria-hidden')).toBe('true');
  });

  it('says why Open in browser and Copy address cannot be used for a forward that does not run: they stay focusable, say so as their description, and do nothing', async () => {
    const { fake, user } = await mount([session('a', { state: 'FAILED', local_host: '127.0.0.1' })]);
    for (const name of ['Open in browser', 'Copy address']) {
      const button = buttonOf('a', name);
      expect(button).toHaveAttribute('aria-disabled', 'true');
      expect(button).toHaveAccessibleDescription('The forward must be running.');
      await user.click(button);
    }

    expect(fake.opened).toEqual([]);
    expect(fake.copied).toEqual([]);
  });

  it('says the reason in the tip of a button that cannot be used, under its name, and only its name for one that can', async () => {
    await mount([session('a', { local_host: '127.0.0.1' }), session('b', { state: 'FAILED', local_host: '127.0.0.1' })]);
    expect(buttonOf('a', 'Open in browser').getAttribute('data-ov-tip')).toBe('Open in browser');
    expect(buttonOf('b', 'Open in browser').getAttribute('data-ov-tip')).toBe('Open in browser\nThe forward must be running.');
    expect(buttonOf('b', 'Stop').getAttribute('data-ov-tip')).toBe('Stop');
  });

  it('says that where a forward listens is not stated, for a forward whose producer states no host: Open in browser stays focusable, says so as its description and in its tip, and does nothing, and Copy is Copy port', async () => {
    const { fake, user } = await mount([session('a')]);
    const open = buttonOf('a', 'Open in browser');
    expect(open).toHaveAttribute('aria-disabled', 'true');
    expect(open).toHaveAccessibleDescription('Where this forward listens is not stated, so it cannot be opened from here.');
    expect(open.getAttribute('data-ov-tip')).toBe('Open in browser\nWhere this forward listens is not stated, so it cannot be opened from here.');
    await user.click(open);
    await settle();
    expect(fake.opened).toEqual([]);
    expect(fake.listed()).toBe(1);
    expect(buttonOf('a', 'Copy port').getAttribute('data-ov-tip')).toBe('Copy port');
    expect(within(rowOf('a')).queryByRole('button', { name: 'Copy address' })).toBeNull();
  });

  it('says that a forward that listens beyond this computer is not opened from here, and shows where it listens in its mapping', async () => {
    const { fake, user } = await mount([session('a', { local_host: '0.0.0.0' })]);
    expect(rowOf('a').querySelector('[data-ports-part="mapping"]')?.textContent).toBe('0.0.0.0:8081 → :8080/TCP');
    const open = buttonOf('a', 'Open in browser');
    expect(open).toHaveAccessibleDescription('This forward listens beyond this computer, so it is not opened from here.');
    await user.click(open);
    await settle();
    expect(fake.opened).toEqual([]);
    expect(buttonOf('a', 'Copy address')).toBeInTheDocument();
  });

  it('Stop shows Stopping at once, says that it waits as the description of Stop, and asks the host to close the forward', async () => {
    const { fake, user } = await mount([session('a')]);
    await user.click(buttonOf('a', 'Stop'));
    expect(fake.closed()).toEqual(['a']);
    expect(cells('a')[3]).toBe('Stopping');
    expect(buttonOf('a', 'Stop')).toHaveAttribute('aria-disabled', 'true');
    expect(buttonOf('a', 'Stop')).toHaveAccessibleDescription('Waiting for the stop to finish.');
    await user.click(buttonOf('a', 'Stop'));
    expect(fake.closed()).toEqual(['a']);
  });

  it('Stop ends with the row gone and a polite word for a person who cannot see it go', async () => {
    const { fake, user } = await mount([session('a'), session('b')]);
    await user.click(buttonOf('a', 'Stop'));
    act(() => {
      fake.emit(CLOSED_EVENT, session('a'));
    });
    expect(rows().map((row) => row.dataset.portsId)).toEqual(['b']);
    expect(live().textContent).toBe('Stopped port 8081 → :8080/TCP');
  });

  it('cannot Stop a forward whose plugin stopped, and says it as the description', async () => {
    const { fake } = await mount([session('a')]);
    act(() => {
      fake.emit(UNLOADED_EVENT, { pluginID: 'acme', cause: 'crashed' });
    });
    expect(buttonOf('a', 'Stop')).toHaveAttribute('aria-disabled', 'true');
    expect(buttonOf('a', 'Stop')).toHaveAccessibleDescription('Its plugin stopped.');
  });

  it('Open in browser opens the address in the system\'s browser, for a forward whose producer states where it listens', async () => {
    const { fake, user } = await mount([session('a', { local_port: 3000, local_host: '127.0.0.1' })]);
    fake.serve([session('a', { local_port: 3000, local_host: '127.0.0.1' })]);
    await user.click(buttonOf('a', 'Open in browser'));
    await settle();
    expect(fake.opened).toEqual(['http://127.0.0.1:3000']);
  });

  it('Copy port puts the port on the clipboard, draws a check mark on that button alone for a moment, says "Port copied" politely, and goes back when the moment is over', async () => {
    const { fake, user } = await mount([session('a'), session('b', { local_port: 9000 })]);
    fake.serve([session('a'), session('b', { local_port: 9000 })]);
    const glyph = (id: string): string | null => buttonOf(id, 'Copy port').querySelector('svg')?.getAttribute('data-ov-glyph') ?? null;
    expect(live()).toHaveAttribute('aria-live', 'polite');
    expect(live().textContent).toBe('');
    expect(glyph('a')).toBe('copy');
    await user.click(buttonOf('a', 'Copy port'));
    await settle();
    expect(fake.copied).toEqual(['8081']);
    expect(glyph('a')).toBe('check');
    expect(glyph('b')).toBe('copy');
    expect(live().textContent).toBe('Port copied');
    expect(fake.timers()).toBe(1);
    act(() => {
      fake.fire();
    });
    expect(glyph('a')).toBe('copy');
    expect(fake.timers()).toBe(0);
  });

  it('says again what it said, for a person who copied twice: a node is added to the live region for each thing said, so that the words are read again', async () => {
    const { fake, user } = await mount([session('a')]);
    fake.serve([session('a')]);
    await user.click(buttonOf('a', 'Copy port'));
    await settle();
    const first = live().firstElementChild;
    await user.click(buttonOf('a', 'Copy port'));
    await settle();
    expect(live().firstElementChild).not.toBe(first);
    expect(live().textContent).toBe('Port copied');
  });

  it('says that the clipboard refused, and draws no check mark', async () => {
    const { fake, user } = await mount([session('a')]);
    fake.serve([session('a')]);
    fake.clipboard.works = false;
    await user.click(buttonOf('a', 'Copy port'));
    await settle();
    expect(live().textContent).toBe('Couldn\'t copy the port');
    expect(buttonOf('a', 'Copy port').querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('copy');
  });

  it('Copy address, for a forward whose producer states where it listens, puts the host and the port on the clipboard and says "Address copied"', async () => {
    const { fake, user } = await mount([session('a', { local_host: '127.0.0.1' })]);
    fake.serve([session('a', { local_host: '127.0.0.1' })]);
    expect(rowOf('a').querySelector('[data-ports-part="mapping"]')?.textContent).toBe('127.0.0.1:8081 → :8080/TCP');
    await user.click(buttonOf('a', 'Copy address'));
    await settle();
    expect(fake.copied).toEqual(['127.0.0.1:8081']);
    expect(live().textContent).toBe('Address copied');
  });

  it('says that the system would not open the address, and warns on the console', async () => {
    const { fake, user } = await mount([session('a', { local_host: '127.0.0.1' })]);
    fake.serve([session('a', { local_host: '127.0.0.1' })]);
    fake.browser.reject = true;
    await user.click(buttonOf('a', 'Open in browser'));
    await settle();
    expect(live().textContent).toBe('Couldn\'t open 127.0.0.1:8081 in the browser');
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('the keyboard', () => {
  it('has one Tab stop for each row, on its first button: the arrows move inside the group, Home and End go to its ends, and Tab leaves it', async () => {
    const { user } = await mount([session('a'), session('b'), session('c')]);
    await user.tab();
    expect(buttonOf('a', 'Stop')).toHaveFocus();
    await user.keyboard('{ArrowRight}');
    expect(buttonOf('a', 'Open in browser')).toHaveFocus();
    await user.keyboard('{End}');
    expect(buttonOf('a', 'Copy port')).toHaveFocus();
    await user.keyboard('{Home}');
    expect(buttonOf('a', 'Stop')).toHaveFocus();
    await user.tab();
    expect(buttonOf('b', 'Stop')).toHaveFocus();
    await user.tab();
    expect(buttonOf('c', 'Stop')).toHaveFocus();
  });

  it('presses a button with Enter and with Space', async () => {
    const { fake, user } = await mount([session('a', { local_host: '127.0.0.1' })]);
    fake.serve([session('a', { local_host: '127.0.0.1' })]);
    await user.tab();
    await user.keyboard('{ArrowRight}{Enter}');
    await settle();
    expect(fake.opened).toHaveLength(1);
    await user.keyboard('{ArrowRight} ');
    await settle();
    expect(fake.copied).toHaveLength(1);
  });

  it('puts the focus on the row that took the place of the one that went, when the keyboard was on it: Stop ends a row and the keyboard is not lost on the page', async () => {
    const { fake, user } = await mount([session('a'), session('b'), session('c')]);
    buttonOf('b', 'Stop').focus();
    await user.keyboard('{Enter}');
    act(() => {
      fake.emit(CLOSED_EVENT, session('b'));
    });
    expect(rows().map((row) => row.dataset.portsId)).toEqual(['a', 'c']);
    expect(rowOf('c').contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.tagName).toBe('BUTTON');
  });

  it('puts it on the row before, when the last one went', async () => {
    const { fake, user } = await mount([session('a'), session('b')]);
    buttonOf('b', 'Stop').focus();
    await user.keyboard('{Enter}');
    act(() => {
      fake.emit(CLOSED_EVENT, session('b'));
    });
    expect(rowOf('a').contains(document.activeElement)).toBe(true);
  });

  it('leaves the focus where the person put it when it was not on the row that went', async () => {
    const { fake, user } = await mount([session('a'), session('b')]);
    buttonOf('a', 'Copy port').focus();
    await user.click(buttonOf('b', 'Stop'));
    buttonOf('a', 'Copy port').focus();
    act(() => {
      fake.emit(CLOSED_EVENT, session('b'));
    });
    expect(buttonOf('a', 'Copy port')).toHaveFocus();
  });

  it('does not pull the focus back when the person has gone elsewhere since: only a focus that was lost is found', async () => {
    const outside = document.createElement('button');
    document.body.append(outside);
    const { fake, user } = await mount([session('a'), session('b')]);
    buttonOf('b', 'Stop').focus();
    await user.keyboard('{Enter}');
    outside.focus();
    act(() => {
      fake.emit(CLOSED_EVENT, session('b'));
    });
    expect(outside).toHaveFocus();
    outside.remove();
  });
});

describe('the menu of a row', () => {
  it('opens on a secondary click on the row, for that row, as Stop, Open in browser and Copy port, named for the forward', async () => {
    const { fake } = await mount([session('a'), session('b', { local_port: 9000 })]);
    fake.serve([session('a'), session('b', { local_port: 9000 })]);
    expect(fireEvent.contextMenu(rowOf('b'), { button: 2, clientX: 30, clientY: 40 })).toBe(false);
    const menu = screen.getByRole('menu', { name: 'Actions for res-b, port 9000 → :8080/TCP' });
    expect(within(menu).getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual(['Stop', 'Open in browser', 'Copy port']);
    fireEvent.click(within(menu).getByRole('menuitem', { name: 'Copy port' }));
    await settle();
    expect(fake.copied).toEqual(['9000']);
  });

  it('opens on a secondary click on a cell as well as on the row\'s edge: the whole row is the trigger', async () => {
    await mount([session('a')]);
    fireEvent.contextMenu(partOf(rowOf('a'), 'mapping'), { button: 2 });
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it.each([
    ['Shift F10', { key: 'F10', shiftKey: true }],
    ['the Menu key', { key: 'ContextMenu' }],
  ])('opens on %s with the focus on one of the row\'s buttons, with the first item focused, and gives the focus back to the button on Escape', async (_name, init) => {
    await mount([session('a'), session('b')]);
    const copy = buttonOf('b', 'Copy port');
    copy.focus();
    expect(fireEvent.keyDown(copy, init)).toBe(false);
    const menu = screen.getByRole('menu', { name: /^Actions for res-b/ });
    expect(within(menu).getByRole('menuitem', { name: 'Stop' })).toHaveFocus();
    fireEvent.keyDown(document.activeElement ?? document.body, { key: 'Escape' });
    expect(screen.queryByRole('menu')).toBeNull();
    expect(copy).toHaveFocus();
  });

  it('has no Open in browser for a UDP forward', async () => {
    await mount([session('a', { protocol: 'UDP' })]);
    fireEvent.contextMenu(rowOf('a'), { button: 2 });
    expect(screen.getAllByRole('menuitem').map((item) => item.getAttribute('aria-label'))).toEqual(['Stop', 'Copy port']);
  });

  it('says why an item cannot be used and does nothing for it, as the button does', async () => {
    const { fake } = await mount([session('a', { state: 'PAUSED' })]);
    fireEvent.contextMenu(rowOf('a'), { button: 2 });
    const open = screen.getByRole('menuitem', { name: 'Open in browser' });
    expect(open).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(open);
    await settle();
    expect(fake.opened).toEqual([]);
  });

  it('Stop in the menu does what the button does', async () => {
    const { fake } = await mount([session('a')]);
    fireEvent.contextMenu(rowOf('a'), { button: 2 });
    fireEvent.click(screen.getByRole('menuitem', { name: 'Stop' }));
    await settle();
    expect(fake.closed()).toEqual(['a']);
    expect(cells('a')[3]).toBe('Stopping');
  });

  it('is put away when the row that holds it changes what it can do: an open menu is a snapshot, and a stale one is closed', async () => {
    const { fake } = await mount([session('a'), session('b')]);
    fireEvent.contextMenu(rowOf('a'), { button: 2 });
    expect(screen.getByRole('menu')).toBeInTheDocument();
    act(() => {
      fake.emit(UNLOADED_EVENT, { pluginID: 'acme', cause: 'crashed' });
    });
    expect(screen.queryByRole('menu')).toBeNull();
  });

  it('keeps the keyboard in the table when the row that holds an open menu goes: the host puts the menu away and gives the focus to the table, and it goes on to the row that took the place of the one that went', async () => {
    const { fake } = await mount([session('a'), session('b'), session('c')]);
    const copy = buttonOf('b', 'Copy port');
    copy.focus();
    fireEvent.keyDown(copy, { key: 'F10', shiftKey: true });
    expect(screen.getByRole('menuitem', { name: 'Stop' })).toHaveFocus();
    act(() => {
      fake.emit(CLOSED_EVENT, session('b'));
    });
    await settle();
    expect(screen.queryByRole('menu')).toBeNull();
    expect(rows().map((row) => row.dataset.portsId)).toEqual(['a', 'c']);
    expect(rowOf('c').contains(document.activeElement)).toBe(true);
    expect(document.activeElement?.tagName).toBe('BUTTON');
  });

  it('is not drawn while it is closed: no menu, no item, in a table of rows', async () => {
    await mount([session('a'), session('b')]);
    expect(screen.queryByRole('menu')).toBeNull();
    expect(screen.queryAllByRole('menuitem')).toHaveLength(0);
  });
});

describe('what it costs', () => {
  it('listens to the host while it is on screen and to nothing when it is not: five events, taken off with the body', async () => {
    const { fake, view } = await mount([session('a')]);
    expect(fake.on()).toBe(5);
    expect(fake.handlers()).toBe(5);
    view.unmount();
    expect(fake.handlers()).toBe(0);
    expect(fake.off()).toBe(5);
    expect(fake.names.listeners()).toBe(0);
  });

  it('is the same under strict mode, where an effect runs twice: one set of handlers while it is on screen, none after', async () => {
    const { fake, view } = await mount([session('a')], (body) => <StrictMode>{body}</StrictMode>);
    await fake.answer([session('a')]);
    expect(fake.handlers()).toBe(5);
    expect(rows()).toHaveLength(1);
    view.unmount();
    expect(fake.handlers()).toBe(0);
  });

  it('commits nothing and holds no timer while nothing happens', async () => {
    vi.useFakeTimers();
    try {
      const commits = vi.fn();
      const fake = fakePorts();
      const store = createPortsStore(fake.deps);
      render(
        <Profiler id="ports" onRender={commits}>
          <MenuHost>
            <PortsBody store={store} />
          </MenuHost>
        </Profiler>,
      );
      await fake.answer([session('a'), session('b')]);
      commits.mockClear();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(commits).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
      expect(fake.timers()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('commits once for each thing the host says, and renders no row but the one that changed', async () => {
    // A row renders by asking what its commands can do (`availabilityOf`): the calls say which rows rendered, and how often.
    const asked = vi.spyOn(model, 'availabilityOf');
    const rendered = (id: string): number => asked.mock.calls.filter(([row]) => row.id === id).length;
    const commits = vi.fn();
    const fake = fakePorts();
    const store = createPortsStore(fake.deps);
    render(
      <Profiler id="ports" onRender={commits}>
        <MenuHost>
          <PortsBody store={store} />
        </MenuHost>
      </Profiler>,
    );
    await fake.answer([session('a'), session('b')]);
    commits.mockClear();
    asked.mockClear();
    act(() => {
      fake.emit(CREATED_EVENT, session('b', { local_port: 9999 }));
    });
    expect(commits).toHaveBeenCalledTimes(1);
    // The row that changed rendered once, which proves that the count counts; the one that did not, not at all.
    expect(rendered('b')).toBe(1);
    expect(rendered('a')).toBe(0);
    expect(cells('b')[1]).toBe('port 9999 → :8080/TCP');
    act(() => {
      fake.emit(CONNECTION_EVENT);
    });
    commits.mockClear();
    asked.mockClear();
    await fake.answer([session('a'), session('b', { local_port: 9999 })]);
    expect(commits).not.toHaveBeenCalled();
    expect(asked).not.toHaveBeenCalled();
  });

  it('commits once for a flood of events that arrive in tasks of their own: the frame is the commit', async () => {
    const commits = vi.fn();
    const fake = fakePorts();
    const store = createPortsStore(fake.deps);
    render(
      <Profiler id="ports" onRender={commits}>
        <MenuHost>
          <PortsBody store={store} />
        </MenuHost>
      </Profiler>,
    );
    await fake.answer([]);
    commits.mockClear();
    for (let index = 0; index < 60; index += 1) {
      act(() => {
        fake.deliver(CREATED_EVENT, session(`f-${String(index)}`));
      });
    }

    expect(commits).not.toHaveBeenCalled();
    act(() => {
      fake.frames.tick();
    });
    expect(commits).toHaveBeenCalledTimes(1);
    expect(rows()).toHaveLength(60);
  });
});

describe('the markup for a person who cannot see it', () => {
  it('names every control, groups the actions of a row, and keeps every state in a role that is read', async () => {
    const { fake } = await mount([session('a'), session('b', { protocol: 'UDP' })]);
    for (const button of screen.getAllByRole('button')) {
      expect(button).toHaveAccessibleName();
    }

    expect(screen.getAllByRole('group')).toHaveLength(2);
    expect(screen.getAllByRole('row')).toHaveLength(3);
    expect(live()).toHaveAttribute('aria-live', 'polite');
    act(() => {
      fake.emit(CLOSED_EVENT, session('a'));
    });
    expect(screen.getAllByRole('row')).toHaveLength(2);
  });

  it('draws the state with its word beside the glyph, never the glyph alone', async () => {
    await mount([session('a'), session('b', { state: 'FAILED' }), session('c', { state: 'PAUSED' })]);
    expect(cells('a')[3]).toBe('Running');
    expect(cells('b')[3]).toBe('Failed');
    expect(cells('c')[3]).toBe('Paused');
  });
});

describe('the footer', () => {
  /** What the footer says: the count of forwards, and how many of them are stopping, while some are. */
  const footer = (): string | undefined => document.querySelector('[data-ports-part="footer"]')?.textContent.trim();

  it('says how many forwards are stopping after the count, in plain words, while some are, and no more than the count when none is', async () => {
    const { fake, store } = await mount([session('a'), session('b'), session('c')]);
    expect(footer()).toBe('3 forwards');
    act(() => {
      store.stop('a');
    });
    expect(footer()).toBe('3 forwards · 1 stopping');
    act(() => {
      store.stop('b');
    });
    expect(footer()).toBe('3 forwards · 2 stopping');
    await act(async () => {
      await fake.closeAnswer(0);
    });
    expect(footer()).toBe('2 forwards · 1 stopping');
    await act(async () => {
      await fake.closeFail(new Error('The plugin is busy.'), 1);
    });
    expect(footer()).toBe('2 forwards');
  });

  it('says it of one forward in the singular, and is no more than the count again when the host has closed it', async () => {
    const { fake, store } = await mount([session('a')]);
    act(() => {
      store.stop('a');
    });
    expect(footer()).toBe('1 forward · 1 stopping');
    await act(async () => {
      await fake.closeAnswer(0);
    });
    expect(footer()).toBe('0 forwards');
  });

  it('is read as it was: the count is in the footer\'s own polite status, and nothing in the tool is assertive', async () => {
    const { store } = await mount([session('a'), session('b')]);
    act(() => {
      store.stop('a');
    });
    const footerElement = document.querySelector<HTMLElement>('[data-ports-part="footer"]')!;
    expect(within(footerElement).getByRole('status')).toHaveTextContent('2 forwards · 1 stopping');
    expect(body().querySelector('[aria-live="assertive"], [role="alert"]')).toBeNull();
  });
});

describe('the hint of the empty state', () => {
  it('is the kit\'s own part, which the stylesheet sets in the secondary size: the hook is in the page and says something', async () => {
    await mount([]);
    const hint = body().querySelector('[data-ov-part="hint"]');
    expect(hint).not.toBeNull();
    expect(hint?.textContent.trim()).not.toBe('');
  });
});

describe('which columns of the table are flexible', () => {
  const table = (): HTMLElement => document.querySelector<HTMLElement>('[data-ports-part="table"]')!;
  const fit = (cell: HTMLElement): HTMLElement | null => cell.querySelector<HTMLElement>('[data-ports-part="fit"]');

  it('says that a connection is named while some forward names one, and no longer when none does: the Connection column is a flexible one then, and a fixed one when it holds dashes only, as the mock\'s column is by what it holds', async () => {
    const { fake } = await mount([session('a'), session('b')]);
    expect(table()).not.toHaveAttribute('data-ports-names');
    act(() => {
      fake.names.set('acme', 'conn-1', 'Staging');
    });
    expect(table()).toHaveAttribute('data-ports-names');
    act(() => {
      fake.names.set('acme', 'conn-1', undefined);
    });
    expect(table()).not.toHaveAttribute('data-ports-names');
  });

  it('holds what the flexible columns show in a box of their own: what Resource shows always, and a name of Connection, and not the dash that stands for none', async () => {
    const { fake } = await mount([session('a')]);
    expect(fit(partOf(rowOf('a'), 'resource'))).not.toBeNull();
    expect(fit(partOf(rowOf('a'), 'connection'))).toBeNull();
    act(() => {
      fake.names.set('acme', 'conn-1', 'Staging');
    });
    expect(fit(partOf(rowOf('a'), 'connection'))?.textContent.trim()).toBe('Staging');
  });

  it('keeps a resource name that is wider than the cap whole for assistive technology, once: the cap is a width and cuts nothing in the page', async () => {
    const long = `web-${'x'.repeat(232)}`;
    await mount([session('a', { connection: { plugin_id: 'acme', connection_id: 'conn-1', resource_id: long, resource_key: 'widgets' } })]);
    expect(partOf(rowOf('a'), 'resource').textContent.split(long)).toHaveLength(2);
  });
});

describe('a button that was drawn for a session', () => {
  it('does not act on the session that took the id before the frame that draws it: Stop, Open in browser and Copy address are for the row that is on the screen', async () => {
    const { fake, user } = await mount([session('a')]);
    act(() => {
      fake.deliver(CREATED_EVENT, session('a', { created_at: '2026-11-24T12:00:00Z', local_port: 9000 }));
    });
    const listed = fake.listed();
    await user.click(buttonOf('a', 'Stop'));
    await user.click(buttonOf('a', 'Open in browser'));
    await user.click(buttonOf('a', 'Copy port'));
    expect(fake.closed()).toEqual([]);
    expect(fake.opened).toEqual([]);
    expect(fake.copied).toEqual([]);
    expect(fake.listed()).toBe(listed);
  });
});

describe('Try again', () => {
  /** The tool whose first read failed: the state that says so, and Try again in it. */
  async function failed(): Promise<Rig> {
    const rig = await mount();
    await act(async () => {
      await rig.fake.fail(new Error('down'));
    });
    return rig;
  }

  it('keeps the keyboard in the tool while the list is read again: the button goes with its state, and the focus is the body\'s', async () => {
    const { user } = await failed();
    screen.getByRole('button', { name: 'Try again' }).focus();
    await user.keyboard('{Enter}');
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(document.activeElement).toBe(body());
  });

  it('puts the keyboard back on Try again when the read fails again', async () => {
    const { fake, user } = await failed();
    screen.getByRole('button', { name: 'Try again' }).focus();
    await user.keyboard('{Enter}');
    await act(async () => {
      await fake.fail(new Error('down'));
    });
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
  });

  it('puts the keyboard on the first forward when the read answers', async () => {
    const { fake, user } = await failed();
    screen.getByRole('button', { name: 'Try again' }).focus();
    await user.keyboard('{Enter}');
    await act(async () => {
      await fake.answer([session('a'), session('b')]);
    });
    expect(rowOf('a').contains(document.activeElement)).toBe(true);
  });

  it('leaves the keyboard where the person went when they left the tool before the read answered', async () => {
    const { fake, user } = await failed();
    const outside = document.createElement('button');
    document.body.append(outside);
    screen.getByRole('button', { name: 'Try again' }).focus();
    await user.keyboard('{Enter}');
    outside.focus();
    await act(async () => {
      await fake.answer([session('a')]);
    });
    expect(outside).toHaveFocus();
    outside.remove();
  });
});

describe('the keyboard in the table when rows move', () => {
  it('goes to the row that took the place of the one that went, when a row was put before it first: the place is read from the table as it was drawn last, and not from where it was when it got the keyboard', async () => {
    const { fake } = await mount([session('a'), session('b'), session('c'), session('d')]);
    buttonOf('c', 'Copy port').focus();
    act(() => {
      fake.emit(CREATED_EVENT, session('x', { created_at: '2026-11-24T09:00:00Z' }));
    });
    expect(rows().map((row) => row.dataset.portsId)).toEqual(['x', 'a', 'b', 'c', 'd']);
    act(() => {
      fake.emit(CLOSED_EVENT, session('c'));
    });
    expect(rows().map((row) => row.dataset.portsId)).toEqual(['x', 'a', 'b', 'd']);
    expect(rowOf('d').contains(document.activeElement)).toBe(true);
  });
});
