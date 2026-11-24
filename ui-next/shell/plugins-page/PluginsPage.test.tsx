import { MenuHost } from '@omniviewdev/kit';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { Activity, Profiler, type ProfilerOnRenderCallback } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { createTabsStore, type TabId, type TabsStore } from '../../shell';
import { createContributions } from '../../plugins/host/contributions';
import { registerHostPage } from '../../plugins/host/hostPages';
import type { PluginEntry } from '../../plugins/host/pluginStore';
import { Published } from '../../plugins/host/published';
import { acme } from '../../plugins/testing';
import { makeNotices, manualClock, type Fixture } from '../core/notices/testing';
import { NoticesProvider } from '../notices/context';
import { createNoticesAnnouncer } from '../notices/host';
import { harness, inventoryEntry, settle, type Harness } from './core/testing';
import type { InventoryEntry } from './core/types';
import type * as Hooks from './hooks';
import { createPluginsPage, PLUGINS_ROUTE, type PluginsPageDeps } from './PluginsPage';

// The Plugins page as the window draws it: over the page's real model, the real tab model it is a tab of, the host's real notices store, and the invented inventory and window of `core/testing.ts`. What is under test is
// what the page does with them: that it draws the inventory, keeps the choice in the tab's memory, runs the host's calls and shows them under way, tells a failure through the notices in the host's words, asks before it
// uninstalls, takes the plugin out on the host's event, and listens only while it is on screen. jsdom has no layout, no top layer and no Escape key for a modal: the geometry and the paint are the probe's.

// The two hooks the panes read the model through are wrapped to count calls (a call is a render of the component that makes it) and delegate to the real ones, as the tab model's render-count test does.
const reads = vi.hoisted(() => ({ list: 0, rows: new Map<string, number>() }));

vi.mock('./hooks', async (importOriginal) => {
  const actual = await importOriginal<typeof Hooks>();
  return {
    ...actual,
    useList: (...args: Parameters<typeof actual.useList>) => {
      reads.list += 1;
      return actual.useList(...args);
    },
    useRow: (...args: Parameters<typeof actual.useRow>) => {
      reads.rows.set(args[1], (reads.rows.get(args[1]) ?? 0) + 1);
      return actual.useRow(...args);
    },
  };
});

/** A string no sentence of the page says: it stands for the text of a host error, which holds paths and what the plugin printed and is never drawn. */
const CANARY = 'exec /opt/zeta/bin/zeta: token=canary-9f3b7c1d exited with status 3';

/** What Wails gives the page: an error whose message is the host's envelope as JSON and whose cause is the envelope. */
const wails = (type: string, detail: string): Error => {
  const body = { type, title: 'Failed to do it', status: 500, detail };
  return Object.assign(new Error(JSON.stringify(body)), { cause: body });
};

const ALPHA_ENTRY: PluginEntry = { id: 'alpha', name: 'Alpha plugin', phase: 'ready', contribution: acme() };
const GAMMA_ENTRY: PluginEntry = { id: 'gamma', name: 'Gamma plugin', phase: 'failed', failure: { kind: 'missing', message: 'The plugin\'s interface could not be read.' } };

/** Alpha runs, beta is turned off, delta is stopped and gamma failed: the list sorts them by name. */
const four = [inventoryEntry('delta', { phase: 'Stopped' }), inventoryEntry('alpha'), inventoryEntry('gamma', { phase: 'Failed' }), inventoryEntry('beta', { enabled: false })];

type Options = {
  /** The entries of the window's plugin store. */
  readonly entries?: readonly PluginEntry[];
  /** The window has already read the inventory: the page's first frame has the list. */
  readonly seeded?: boolean;
  /** Routes of the plugin `alpha` that are open in the window besides the page's own tab. */
  readonly open?: readonly string[];
  /** Hears every commit of the page. */
  readonly onRender?: ProfilerOnRenderCallback;
};

type Mounted = {
  readonly h: Harness;
  readonly tabs: TabsStore;
  readonly tabId: TabId;
  readonly notices: Fixture;
  readonly user: UserEvent;
  readonly unmount: () => void;
  /** Draws the page of the same tab anew, with a model of its own, as the window does when the tab's page is drawn again. */
  readonly remount: () => Promise<void>;
  /** Draws the page again with the window's Retry and whether the tab is on screen. */
  readonly show: (onRetry: (id: string) => void, visible?: boolean) => void;
  readonly onRetry: Mock<(id: string) => void>;
  /** How many listeners the page holds on the window's plugins: the tab model listens to them too. */
  readonly listening: () => number;
};

/** The page in a tab of a real tab model, over `plugins` as the host's inventory. Reads once, so that the first answers are in the DOM. */
async function mount(plugins: readonly InventoryEntry[], options: Options = {}): Promise<Mounted> {
  const h = harness(plugins);
  h.entries.set(options.entries ?? [ALPHA_ENTRY]);
  const deps: PluginsPageDeps = {
    read: h.read,
    actions: h.actions,
    events: h.events.source,
    seed: options.seeded === true ? () => plugins : undefined,
  };
  const definition = createPluginsPage(deps);
  registerHostPage(definition);
  const contributions = createContributions({ plugins: h.entries, frames: new Published() });
  let counter = 0;
  const tabs = createTabsStore({
    contributions,
    newId: () => {
      counter += 1;
      return `t${String(counter)}`;
    },
  });
  for (const contribution of options.open ?? []) {
    tabs.open({ route: { plugin: 'alpha', contribution } }, { how: 'new' });
  }

  const opened = tabs.open({ route: PLUGINS_ROUTE }, { how: 'new' });
  if (opened.status !== 'done') {
    throw new Error(`the page's tab did not open: ${JSON.stringify(opened)}`);
  }

  const windowListeners = h.entries.listeners();
  const notices = makeNotices({}, manualClock());
  const bindings = { store: notices.store, announcer: createNoticesAnnouncer() };
  const client = new QueryClient();
  const onRetry = vi.fn<(id: string) => void>();
  const draw = (retry: (id: string) => void, visible: boolean) => {
    const page = <definition.Page tabs={tabs} tabId={opened.id} plugins={h.entries} onRetry={retry} openPlugin={() => undefined} />;
    return (
      <QueryClientProvider client={client}>
        <NoticesProvider notices={bindings}>
          <Activity mode={visible ? 'visible' : 'hidden'}>
            {options.onRender === undefined ? (
              page
            ) : (
              <Profiler id="page" onRender={options.onRender}>
                {page}
              </Profiler>
            )}
          </Activity>
        </NoticesProvider>
      </QueryClientProvider>
    );
  };

  let view = render(draw(onRetry, true), { wrapper: MenuHost });
  await act(async () => {
    await settle();
  });

  return {
    h,
    tabs,
    tabId: opened.id,
    notices,
    user: userEvent.setup(),
    unmount: () => {
      view.unmount();
    },
    remount: async () => {
      view.unmount();
      view = render(draw(onRetry, true), { wrapper: MenuHost });
      await act(async () => {
        await settle();
      });
    },
    onRetry,
    listening: () => h.entries.listeners() - windowListeners,
    show: (retry, visible = true) => {
      view.rerender(draw(retry, visible));
    },
  };
}

let popoverRule: HTMLStyleElement;

beforeAll(() => {
  // jsdom has no `showModal` or `close`: stand-ins that set and remove the attribute, as the markup would. Local to this file, never in the shared setup.
  const proto = HTMLDialogElement.prototype as unknown as { showModal?: () => void; close?: () => void };
  proto.showModal ??= function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '');
  };

  proto.close ??= function close(this: HTMLDialogElement) {
    this.removeAttribute('open');
  };
});

beforeEach(() => {
  // jsdom's default stylesheet hides every popover that is not `:popover-open`, a state it cannot match, so the menu's items could not be found by role: the same rule a browser applies once the popover is shown.
  popoverRule = document.createElement('style');
  popoverRule.textContent = '[popover] { display: block; }';
  document.head.append(popoverRule);
  reads.list = 0;
  reads.rows.clear();
  // A failed action is logged with the host's own error, which is what the page never draws.
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  cleanup();
  popoverRule.remove();
  vi.restoreAllMocks();
});

const rows = (): HTMLElement[] => screen.queryAllByRole('button').filter((button) => button.getAttribute('data-pl-part') === 'row');
const names = (): string[] => rows().map((row) => row.querySelector('[data-pl-part="row-name"]')?.textContent ?? '');
const rowOf = (name: string): HTMLElement => {
  const found = rows().find((row) => row.querySelector('[data-pl-part="row-name"]')?.textContent === name);
  if (found === undefined) {
    throw new Error(`no row ${name}: ${names().join(', ')}`);
  }

  return found;
};

const detail = (): HTMLElement => {
  const found = document.querySelector<HTMLElement>('[data-pl-part="detail"]');
  if (found === null) {
    throw new Error('the page draws no detail');
  }

  return found;
};

/** Lets the model's reads and calls answer, inside `act`. */
const flush = async (): Promise<void> => {
  await act(async () => {
    await settle();
  });
};

/** Chooses `label` in the More menu of the plugin on screen. */
async function choose(label: string): Promise<void> {
  fireEvent.click(within(detail()).getByRole('button', { name: /^More actions for/ }));
  fireEvent.click(await screen.findByRole('menuitem', { name: label, hidden: true }));
  await flush();
}

const progress = (): HTMLElement | null => within(detail()).queryByRole('group', { name: /ing / });

/** The toasts the host's notices show now, as records. */
function toastsOf(notices: Fixture) {
  return notices.store.getSnapshot().toasts.items;
}

describe('the page', () => {
  it('draws the host\'s inventory as the Installed list and the detail of the first plugin, in the order the model gives', async () => {
    await mount(four);

    expect(screen.getByRole('region', { name: 'Installed plugins' })).toBeInTheDocument();
    expect(names()).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
    expect(rowOf('Alpha')).toHaveAttribute('aria-current', 'true');
    expect(detail()).toHaveAccessibleName('Alpha');
    expect(within(detail()).getByRole('heading', { level: 2, name: 'Alpha' })).toBeInTheDocument();
  });

  it('is a tab with the mock\'s puzzle glyph', async () => {
    const { tabs, tabId } = await mount(four);

    expect(tabs.selectors.face(tabs.getSnapshot(), tabId)?.icon).toBe('puzzle');
  });

  it('shows the plugin whose row is chosen in the detail, and keeps the choice in the memory of its tab', async () => {
    const { tabs, tabId, user } = await mount(four);

    await user.click(rowOf('Delta'));

    expect(rowOf('Delta')).toHaveAttribute('aria-current', 'true');
    expect(detail()).toHaveAccessibleName('Delta');
    expect(tabs.selectors.tab(tabs.getSnapshot(), tabId)?.pageState).toEqual({ selected: 'delta' });
  });

  it.each([
    ['the window already holds the inventory', { seeded: true }],
    ['the window holds a plugin of the inventory before the inventory is read', {}],
  ] as const)('opens on the plugin its tab remembers when the tab\'s page is drawn again and %s', async (_name, options) => {
    const { user, remount } = await mount(four, options);
    await user.click(rowOf('Gamma'));

    await remount();

    expect(rowOf('Gamma')).toHaveAttribute('aria-current', 'true');
    expect(detail()).toHaveAccessibleName('Gamma');
  });
});

describe('the actions', () => {
  it('reloads the plugin on screen through the host, and shows the work under way until the host answers', async () => {
    const { h, user } = await mount(four);
    const held = Promise.withResolvers<undefined>();
    h.actions.reload.mockReturnValueOnce(held.promise);

    await user.click(within(detail()).getByRole('button', { name: 'Reload' }));

    expect(h.actions.reload).toHaveBeenCalledTimes(1);
    expect(h.actions.reload).toHaveBeenCalledWith('alpha');
    expect(progress()).toHaveAccessibleName('Reloading Alpha');
    expect(within(detail()).queryByRole('button', { name: 'Reload' })).toBeNull();

    held.resolve(undefined);
    await flush();

    expect(progress()).toBeNull();
    expect(within(detail()).getByRole('button', { name: 'Reload' })).toBeInTheDocument();
  });

  it('disables the plugin on screen through the host, and shows the work under way until the host answers', async () => {
    const { h } = await mount(four);
    const held = Promise.withResolvers<undefined>();
    h.actions.setEnabled.mockReturnValueOnce(held.promise);

    await choose('Disable');

    expect(h.actions.setEnabled).toHaveBeenCalledTimes(1);
    expect(h.actions.setEnabled).toHaveBeenCalledWith('alpha', false);
    expect(progress()).toHaveAccessibleName('Disabling Alpha');

    held.resolve(undefined);
    await flush();

    expect(progress()).toBeNull();
  });

  it('enables a plugin that is turned off in two host calls: it is turned on, and then started', async () => {
    const { h, user } = await mount(four);
    await user.click(rowOf('Beta'));
    const turnedOn = Promise.withResolvers<undefined>();
    h.actions.setEnabled.mockReturnValueOnce(turnedOn.promise);

    await user.click(within(detail()).getByRole('button', { name: 'Enable' }));

    expect(h.actions.setEnabled).toHaveBeenCalledWith('beta', true);
    expect(progress()).toHaveAccessibleName('Enabling Beta');
    expect(h.actions.reload).not.toHaveBeenCalled();

    turnedOn.resolve(undefined);
    await flush();

    expect(h.actions.reload).toHaveBeenCalledTimes(1);
    expect(h.actions.reload).toHaveBeenCalledWith('beta');
  });
});

describe('a failed action', () => {
  it.each([
    ['an error that is not the host\'s envelope', new Error(CANARY), 'The host couldn\'t finish it. Try again.'],
    ['an error of the host\'s class load-failed', wails('omniview:plugin/load-failed', CANARY), 'The host couldn\'t stop it or start it.'],
  ])('is a sticky error notice of the host with a Retry, in words chosen by the class of the error and nothing of its text: %s', async (_name, error, sentence) => {
    const { h, notices, user } = await mount(four);
    h.actions.reload.mockRejectedValueOnce(error);

    await user.click(within(detail()).getByRole('button', { name: 'Reload' }));
    await flush();

    const [toast] = toastsOf(notices);
    expect(toastsOf(notices)).toHaveLength(1);
    expect(toast?.sticky).toBe(true);
    expect(toast?.record).toMatchObject({ severity: 'error', title: 'Couldn\'t reload Alpha', text: sentence, source: 'host', initiator: 'user' });
    expect(toast?.record?.actions.map((action) => action.label)).toEqual(['Retry']);
    expect(JSON.stringify(notices.store.getSnapshot())).not.toContain('canary');
    expect(document.body.textContent).not.toContain('canary');
    expect(document.body.textContent).not.toContain('/opt/zeta');
    // The work is over: the page is not left saying it is reloading.
    expect(progress()).toBeNull();
  });

  it('asks the host again when the notice\'s Retry is pressed', async () => {
    const { h, notices, user } = await mount(four);
    h.actions.reload.mockRejectedValueOnce(new Error(CANARY));
    await user.click(within(detail()).getByRole('button', { name: 'Reload' }));
    await flush();
    const id = toastsOf(notices)[0]?.record?.id ?? '';
    expect(h.actions.reload).toHaveBeenCalledTimes(1);

    act(() => {
      notices.store.run(id, 'again');
    });
    await flush();

    expect(h.actions.reload).toHaveBeenCalledTimes(2);
    expect(h.actions.reload).toHaveBeenLastCalledWith('alpha');
  });

  it('is told for a failed Disable too, and its Retry disables again', async () => {
    const { h, notices } = await mount(four);
    h.actions.setEnabled.mockRejectedValueOnce(new Error(CANARY));

    await choose('Disable');

    expect(toastsOf(notices)[0]?.record).toMatchObject({ severity: 'error', title: 'Couldn\'t disable Alpha' });
    act(() => {
      notices.store.run(toastsOf(notices)[0]?.record?.id ?? '', 'again');
    });
    await flush();

    expect(h.actions.setEnabled).toHaveBeenCalledTimes(2);
    expect(h.actions.setEnabled).toHaveBeenLastCalledWith('alpha', false);
    expect(document.body.textContent).not.toContain('canary');
  });

  it('is told for a cancelled call as nothing: the person asked for it', async () => {
    const { h, notices, user } = await mount(four);
    h.actions.reload.mockRejectedValueOnce(wails('omniview:cancelled', CANARY));

    await user.click(within(detail()).getByRole('button', { name: 'Reload' }));
    await flush();

    expect(toastsOf(notices)).toEqual([]);
  });
});

describe('Uninstall', () => {
  const dialog = (): HTMLElement => screen.getByRole('dialog', { hidden: true });

  it('opens a confirm that is a native dialog, with the focus on Cancel and the host\'s call not made', async () => {
    const { h } = await mount(four);

    await choose('Uninstall…');

    expect(dialog().tagName).toBe('DIALOG');
    expect(dialog()).toHaveAttribute('open');
    expect(dialog()).toHaveAccessibleName('Uninstall Alpha?');
    expect(within(dialog()).getByRole('button', { name: 'Cancel', hidden: true })).toHaveFocus();
    expect(h.actions.uninstall).not.toHaveBeenCalled();
  });

  it('closes on Escape (the dialog\'s cancel event) and gives the focus back to the control that opened it, and calls nothing', async () => {
    const { h } = await mount(four);
    const more = within(detail()).getByRole('button', { name: /^More actions for/ });
    more.focus();

    await choose('Uninstall…');
    const event = new Event('cancel', { cancelable: true });
    act(() => {
      dialog().dispatchEvent(event);
    });
    await flush();

    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(document.activeElement).toBe(more);
    expect(h.actions.uninstall).not.toHaveBeenCalled();
  });

  it('does nothing when Cancel is pressed: the dialog goes and the plugin stays', async () => {
    const { h, user } = await mount(four);
    await choose('Uninstall…');

    await user.click(within(dialog()).getByRole('button', { name: 'Cancel', hidden: true }));

    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(h.actions.uninstall).not.toHaveBeenCalled();
    expect(names()).toContain('Alpha');
  });

  it('calls the host once when it is confirmed, shows the work under way, and keeps the row until the host says the plugin is unloaded', async () => {
    const { h, user } = await mount(four);
    const held = Promise.withResolvers<undefined>();
    h.actions.uninstall.mockReturnValueOnce(held.promise);
    await choose('Uninstall…');

    await user.click(within(dialog()).getByRole('button', { name: 'Uninstall', hidden: true }));

    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
    expect(h.actions.uninstall).toHaveBeenCalledTimes(1);
    expect(h.actions.uninstall).toHaveBeenCalledWith('alpha');
    expect(progress()).toHaveAccessibleName('Uninstalling Alpha');

    // The call came back with success, and the inventory still lists the plugin: what takes it out of the list is the host's event, not the call.
    held.resolve(undefined);
    await flush();
    expect(h.actions.uninstall).toHaveBeenCalledTimes(1);
    expect(names()).toContain('Alpha');

    act(() => {
      h.events.emit('plugin/unloaded', { pluginID: 'alpha', cause: 'uninstalled' });
    });
    await flush();

    expect(names()).toEqual(['Beta', 'Delta', 'Gamma']);
    expect(detail()).toHaveAccessibleName('Beta');
  });

  it('leaves the row in the list when the plugin was unloaded for another cause', async () => {
    const { h } = await mount(four);

    act(() => {
      h.events.emit('plugin/unloaded', { pluginID: 'alpha', cause: 'crashed' });
    });
    await flush();

    expect(names()).toEqual(['Alpha', 'Beta', 'Delta', 'Gamma']);
  });

  it('names a plugin that is linked from a source folder Unlink, in the menu, the title and the button', async () => {
    const { h, user } = await mount([inventoryEntry('zeta', { devMode: true }), inventoryEntry('beta')], { entries: [] });
    expect(detail()).toHaveAccessibleName('Beta');
    await user.click(rowOf('Zeta'));

    await choose('Unlink…');

    expect(dialog()).toHaveAccessibleName('Unlink Zeta?');
    const confirm = within(dialog()).getByRole('button', { name: 'Unlink', hidden: true });
    expect(within(dialog()).queryByRole('button', { name: 'Uninstall', hidden: true })).toBeNull();
    await user.click(confirm);
    expect(h.actions.uninstall).toHaveBeenCalledWith('zeta');
  });

  it.each([
    [[], 'No tabs of Alpha are open.'],
    [['widgets', 'gadgets'], '2 open tabs of Alpha will stay open and say it is not installed.'],
  ])('says how many tabs of the plugin are open in the window: %j', async (open, sentence) => {
    await mount(four, { open });

    await choose('Uninstall…');

    const section = within(dialog()).getByRole('heading', { name: 'Open tabs', hidden: true }).parentElement;
    expect(section).toHaveTextContent(sentence);
  });
});

describe('the window\'s Retry', () => {
  it('is the one current when a retry runs, not the one the page was drawn with', async () => {
    const { h, show, onRetry, user } = await mount(four, { entries: [ALPHA_ENTRY, GAMMA_ENTRY] });
    await user.click(rowOf('Gamma'));
    const newer = vi.fn<(id: string) => void>();

    show(newer);
    await user.click(within(detail()).getByRole('button', { name: 'Retry' }));

    expect(newer).toHaveBeenCalledTimes(1);
    expect(newer).toHaveBeenCalledWith('gamma');
    expect(onRetry).not.toHaveBeenCalled();
    // The window's Retry is the whole retry: the page asks the host for nothing itself.
    expect(h.actions.reload).not.toHaveBeenCalled();
  });
});

describe('what the page listens to', () => {
  it('attaches its listeners to the host and to the window\'s plugins when it is mounted, and releases every one when it is unmounted', async () => {
    const { h, unmount, listening } = await mount(four);

    expect(h.events.held()).toBeGreaterThan(0);
    expect(h.events.names()).toEqual(expect.arrayContaining(['plugin/state_change', 'plugin/unloaded', 'plugin/enablement_changed']));
    expect(listening()).toBe(1);

    unmount();

    expect(h.events.held()).toBe(0);
    expect(listening()).toBe(0);
  });

  it('releases them while the page is hidden, and reads the inventory again when it is shown, for what was said while nobody listened', async () => {
    const { h, show, onRetry, listening } = await mount(four);
    const reads = h.read.mock.calls.length;
    const attached = h.events.held();

    show(onRetry, false);
    await flush();
    expect(h.events.held()).toBe(0);
    expect(listening()).toBe(0);

    // The host installs a plugin while the page is hidden: it said so to nobody.
    h.list.current = [...four, inventoryEntry('epsilon')];
    h.events.emit('plugin/inventory_changed');
    await flush();
    expect(h.read).toHaveBeenCalledTimes(reads);
    expect(names()).toEqual([]);

    show(onRetry, true);
    await flush();

    expect(h.read).toHaveBeenCalledTimes(reads + 1);
    expect(h.events.held()).toBe(attached);
    expect(listening()).toBe(1);
    expect(names()).toEqual(['Alpha', 'Beta', 'Delta', 'Epsilon', 'Gamma']);
  });
});

describe('what a change costs', () => {
  const many = Array.from({ length: 200 }, (_, index) => inventoryEntry(`p${String(index).padStart(3, '0')}`));

  it('draws 200 plugins, the list and the detail, in one commit when the window already holds the inventory', async () => {
    const onRender = vi.fn();

    await mount(many, { entries: [], seeded: true, onRender });

    expect(rows()).toHaveLength(200);
    expect(detail()).toHaveAccessibleName('P000');
    expect(onRender).toHaveBeenCalledTimes(1);
    expect(onRender.mock.calls[0]?.[1]).toBe('mount');
  });

  it('renders the row of the plugin one state change is about, and neither the list nor another row', async () => {
    const { h } = await mount(many, { entries: [], seeded: true });
    reads.list = 0;
    reads.rows.clear();

    act(() => {
      h.events.emit('plugin/state_change', { pluginID: 'p042', from: 'Running', to: 'Degraded' });
    });

    expect(rowOf('P042')).toHaveAttribute('data-pl-state', 'degraded');
    expect([...reads.rows.keys()]).toEqual(['p042']);
    expect(reads.rows.get('p042')).toBe(1);
    expect(reads.list).toBe(0);
  });
});
