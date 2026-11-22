import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { unloadedFailure } from '../../plugins/loader/failure';
import { createPluginsModel, type PluginsModel } from './core/model';
import { harness, inventoryEntry, settle, type Harness } from './core/testing';
import type { InventoryEntry } from './core/types';
import { SENTENCES } from './core/words';
import { acme } from '../../plugins/testing';
import { Detail } from './Detail';

// The detail pane of the Plugins page over a real model: what each state says (the chip, the lane, which slot buttons exist), that every action is the model's, the More menu, the progress that takes the primary slot and holds the
// focus, the card's rows, the empty pane, and that nothing a plugin wrote reaches the document.

type Opened = { readonly h: Harness; readonly model: PluginsModel; readonly onUninstall: Mock<(id: string) => void> };

const stops: Array<() => void> = [];
let popoverRule: HTMLStyleElement;

beforeEach(() => {
  // jsdom's default stylesheet hides every popover that is not `:popover-open`, a state it cannot match, so the menu's items could not be found by role. A browser shows the popover once it has been shown: this is the same rule, in the page
  // (the kit's own tests do the same).
  popoverRule = document.createElement('style');
  popoverRule.textContent = '[popover] { display: block; }';
  document.head.append(popoverRule);
});

afterEach(() => {
  popoverRule.remove();
  for (const stop of stops.splice(0)) {
    stop();
  }
});

/** A model over `entries`, attached and read, and the pane for `id` rendered over it. */
async function open(entries: readonly InventoryEntry[], id: string | null = entries[0]?.id ?? null): Promise<Opened> {
  const h = harness(entries);
  const model = createPluginsModel(h.deps);
  stops.push(model.attach());
  await act(async () => {
    await settle();
  });
  const onUninstall = vi.fn<(id: string) => void>();
  render(<Detail model={model} id={id} onUninstall={onUninstall} />);
  return { h, model, onUninstall };
}

const part = (name: string): HTMLElement | null => document.querySelector<HTMLElement>(`[data-pl-part="${name}"]`);

const slotButtons = (slot: 'slot-primary' | 'slot-secondary'): string[] => Array.from(part(slot)?.querySelectorAll('button') ?? [], (button) => button.textContent);

const rowLabels = (): string[] => Array.from(document.querySelectorAll('[data-pl-part="card-row"] dt'), (term) => term.textContent);

/** Opens the More menu and answers the names of its items. */
function menuItems(): string[] {
  const trigger = part('head-more');
  if (trigger === null) {
    return [];
  }

  fireEvent.click(trigger);
  return screen.queryAllByRole('menuitem', { hidden: true }).map((item) => item.textContent);
}

describe('each state of a plugin', () => {
  // The status lane's look: the quiet lane (no glyph) for a plugin that runs or is on its way, else a notice with the glyph of its tone.
  type Look = 'quiet' | 'status-info' | 'status-warning' | 'status-error';
  type Case = { readonly name: string; readonly entry: InventoryEntry; readonly chip: string | null; readonly title: string; readonly sentence: string; readonly tone: string; readonly look: Look; readonly primary: string[]; readonly secondary: string[]; readonly progress: boolean };
  const cases: Case[] = [
    { name: 'running', entry: inventoryEntry('alpha'), chip: 'Running', title: 'Alpha is running', sentence: SENTENCES.running, tone: 'success', look: 'quiet', primary: [], secondary: ['Reload'], progress: false },
    { name: 'starting', entry: inventoryEntry('alpha', { phase: 'Starting' }), chip: 'Starting', title: 'Starting Alpha…', sentence: SENTENCES.starting, tone: 'neutral', look: 'quiet', primary: [], secondary: [], progress: true },
    { name: 'starting again', entry: inventoryEntry('alpha', { phase: 'Recovering' }), chip: 'Recovering', title: 'Starting Alpha again…', sentence: SENTENCES.recovering, tone: 'neutral', look: 'quiet', primary: [], secondary: [], progress: true },
    { name: 'stopping', entry: inventoryEntry('alpha', { phase: 'Stopping' }), chip: 'Stopping', title: 'Stopping Alpha…', sentence: SENTENCES.stopping, tone: 'neutral', look: 'quiet', primary: [], secondary: [], progress: true },
    { name: 'degraded', entry: inventoryEntry('alpha', { phase: 'Degraded' }), chip: 'Degraded', title: 'Alpha is running with errors', sentence: SENTENCES.degraded, tone: 'warning', look: 'status-warning', primary: [], secondary: ['Reload'], progress: false },
    { name: 'disabled', entry: inventoryEntry('alpha', { enabled: false, phase: 'Installed' }), chip: 'Disabled', title: 'Alpha is disabled', sentence: SENTENCES.disabled, tone: 'neutral', look: 'status-info', primary: ['Enable'], secondary: [], progress: false },
    { name: 'stopped', entry: inventoryEntry('alpha', { phase: 'Stopped' }), chip: 'Stopped', title: 'Alpha is stopped', sentence: SENTENCES.stopped, tone: 'neutral', look: 'status-info', primary: ['Start'], secondary: [], progress: false },
    { name: 'failed', entry: inventoryEntry('alpha', { phase: 'Failed' }), chip: 'Did not start', title: 'Alpha didn\'t start', sentence: unloadedFailure('failed').message, tone: 'error', look: 'status-error', primary: ['Retry'], secondary: [], progress: false },
    { name: 'removing', entry: inventoryEntry('alpha', { phase: 'Uninstalling' }), chip: 'Removing', title: 'Removing Alpha…', sentence: SENTENCES.removing, tone: 'neutral', look: 'quiet', primary: [], secondary: [], progress: true },
    { name: 'unknown', entry: inventoryEntry('alpha', { phase: 'Mystery' }), chip: 'Unknown', title: 'Alpha is in a state this version does not know', sentence: SENTENCES.unknown, tone: 'neutral', look: 'status-info', primary: [], secondary: [], progress: false },
  ];

  it.each(cases)('$name: the chip, the lane and the slot buttons', async ({ entry, chip, title, sentence, tone, look, primary, secondary, progress }) => {
    await open([entry]);

    expect(part('head-chip')?.textContent ?? null).toBe(chip);
    const lane = part('lane');
    expect(lane?.getAttribute('role')).toBe('status');
    expect(lane?.getAttribute('data-pl-tone')).toBe(tone);
    expect(lane?.textContent).toContain(title);
    expect(lane?.textContent).toContain(sentence);
    expect(lane?.getAttribute('data-pl-quiet') === 'true').toBe(look === 'quiet');
    expect(lane?.querySelector('svg')?.getAttribute('data-ov-glyph') ?? 'quiet').toBe(look);
    expect(slotButtons('slot-primary')).toEqual(primary);
    expect(slotButtons('slot-secondary')).toEqual(secondary);
    expect(part('head-progress') !== null).toBe(progress);
  });

  it('says a quiet lane in two lines, the title and then the sentence, and no glyph', async () => {
    await open([inventoryEntry('alpha', { phase: 'Starting' })]);

    expect(Array.from(part('lane')?.children ?? [], (child) => `${child.tagName}: ${child.textContent}`)).toEqual(['P: Starting Alpha…', `P: ${SENTENCES.starting}`]);
  });

  it('keeps the one lane element as the state moves between the two looks, so the live region announces each change', async () => {
    const { h } = await open([inventoryEntry('alpha')]);
    const lane = part('lane');
    const enter = async (phase: string) => {
      await act(async () => {
        h.events.emit('plugin/state_change', { pluginID: 'alpha', to: phase });
        await settle();
      });
    };

    await enter('Failed');
    expect(part('lane')).toBe(lane);
    expect(lane?.getAttribute('data-pl-quiet')).toBeNull();
    expect(lane?.querySelector('svg')?.getAttribute('data-ov-glyph')).toBe('status-error');

    await enter('Starting');
    expect(part('lane')).toBe(lane);
    expect(lane?.getAttribute('data-pl-quiet')).toBe('true');
    expect(lane?.querySelector('svg')).toBeNull();
    expect(lane?.textContent).toContain('Starting Alpha…');
  });
});

describe('the header', () => {
  it('names the pane by the plugin and draws the chips in order: version, origin, state last', async () => {
    await open([inventoryEntry('alpha', { origin: 'builtin', phase: 'Stopped', metadata: { version: '2.0.1' } })]);

    expect(screen.getByRole('region', { name: 'Alpha' })).toBe(part('detail'));
    expect(screen.getByRole('heading', { level: 2, name: 'Alpha' })).toBe(part('head-title'));
    const chips = Array.from(part('head-meta')?.children ?? [], (chip) => chip.getAttribute('data-pl-part'));
    expect(chips).toEqual(['head-version', 'head-origin', 'head-chip']);
    expect(part('head-version')?.textContent).toBe('2.0.1');
    expect(part('head-origin')?.textContent).toBe('Built-in');
  });

  it('says Dev-linked for a development link, and draws no origin for an installed plugin', async () => {
    await open([inventoryEntry('alpha', { devMode: true })]);
    expect(part('head-origin')?.textContent).toBe('Dev-linked');
  });

  it('draws no origin chip and no version chip for an installed plugin with no version', async () => {
    await open([inventoryEntry('alpha', { metadata: { version: '' } })]);

    expect(part('head-origin')).toBeNull();
    expect(part('head-version')).toBeNull();
  });

  it('says the facts with a separator and the summary under them', async () => {
    await open([inventoryEntry('alpha')]);

    expect(part('facts')?.textContent).toBe('by Fixture Labs · Apache-2.0 · Fixture');
    expect(part('summary')?.textContent).toBe('The alpha plugin.');
  });

  it('omits the facts that are empty and keeps the line', async () => {
    await open([inventoryEntry('alpha', { metadata: { author: null, license: '', category: '' } })]);

    expect(part('facts')).not.toBeNull();
    expect(part('facts')?.textContent).toBe('');
  });

  it('draws the plugin\'s tile in the first column of the header: the shared tile at 28 px, with the host\'s own glyph until the interface loads, then the rail\'s glyph and hue', async () => {
    const { h } = await open([inventoryEntry('alpha')]);

    const cell = part('head-tile');
    expect(cell?.children).toHaveLength(1);
    expect(cell?.firstElementChild).toHaveAttribute('data-size', '28');
    expect(cell?.firstElementChild).not.toHaveAttribute('data-accent');
    expect(cell?.querySelector('svg')).toHaveAttribute('data-ov-glyph', 'box');

    act(() => {
      h.entries.set([{ id: 'alpha', name: 'Alpha', phase: 'ready', contribution: acme({ rail: { label: 'Alpha', icon: 'server', order: 1 } }) }]);
    });

    expect(part('head-tile')?.firstElementChild).toHaveAttribute('data-accent', 'blue');
    expect(part('head-tile')?.querySelector('svg')).toHaveAttribute('data-ov-glyph', 'server');
    // The tile is decoration: the name beside it says what the plugin is.
    expect(part('head-tile')?.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('the actions are the model\'s', () => {
  it('Reload reloads the plugin', async () => {
    const { h } = await open([inventoryEntry('alpha')]);

    fireEvent.click(screen.getByRole('button', { name: 'Reload' }));

    expect(h.actions.reload).toHaveBeenCalledWith('alpha');
  });

  it('Start reloads a plugin that is stopped', async () => {
    const { h } = await open([inventoryEntry('alpha', { phase: 'Stopped' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Start' }));

    expect(h.actions.reload).toHaveBeenCalledWith('alpha');
  });

  it('Enable turns the plugin on and starts it', async () => {
    const { h } = await open([inventoryEntry('alpha', { enabled: false, phase: 'Installed' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));
    await act(async () => {
      await settle();
    });

    expect(h.actions.setEnabled).toHaveBeenCalledWith('alpha', true);
    expect(h.actions.reload).toHaveBeenCalledWith('alpha');
  });

  it('Retry asks the host to start a plugin that failed again', async () => {
    const { h } = await open([inventoryEntry('alpha', { phase: 'Failed' })]);

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(h.actions.reload).toHaveBeenCalledWith('alpha');
  });

  it('Disable and Uninstall are in the More menu: Disable calls the model, Uninstall calls the page', async () => {
    const { h, onUninstall } = await open([inventoryEntry('alpha')]);

    expect(menuItems()).toEqual(['Disable', 'Uninstall…']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Disable', hidden: true }));
    expect(h.actions.setEnabled).toHaveBeenCalledWith('alpha', false);
    // What the host would list once the plugin is off: the model reads the inventory again when the call ends.
    h.list.current = [inventoryEntry('alpha', { enabled: false, phase: 'Installed' })];

    await act(async () => {
      await settle();
    });
    expect(menuItems()).toEqual(['Uninstall…']);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Uninstall…', hidden: true }));
    expect(onUninstall).toHaveBeenCalledWith('alpha');
    expect(h.actions.uninstall).not.toHaveBeenCalled();
  });
});

describe('the More menu', () => {
  it('offers Uninstall alone for a plugin that is turned off', async () => {
    await open([inventoryEntry('alpha', { enabled: false, phase: 'Installed' })]);

    expect(menuItems()).toEqual(['Uninstall…']);
  });

  it('says Unlink for a development link', async () => {
    await open([inventoryEntry('alpha', { devMode: true })]);

    expect(menuItems()).toEqual(['Disable', 'Unlink…']);
  });

  it('never offers Uninstall for the product\'s own plugin', async () => {
    await open([inventoryEntry('alpha', { origin: 'builtin' })]);

    expect(menuItems()).toEqual(['Disable']);
  });

  it('draws no More button when the menu would have no items', async () => {
    await open([inventoryEntry('alpha', { origin: 'builtin', enabled: false, phase: 'Installed' })]);

    expect(part('head-more')).toBeNull();
    expect(part('slot-more')).not.toBeNull();
  });
});

describe('work under way', () => {
  it('takes the primary slot, holds the focus, and gives it back; the three slots keep their elements', async () => {
    const { h } = await open([inventoryEntry('alpha')]);
    const { promise, resolve: finish } = Promise.withResolvers<void>();
    h.actions.reload.mockImplementation(async () => {
      await promise;
    });
    const slots = ['slot-primary', 'slot-secondary', 'slot-more'].map((name) => part(name));
    const reload = screen.getByRole('button', { name: 'Reload' });
    reload.focus();

    fireEvent.click(reload);

    const progress = part('head-progress');
    expect(progress).not.toBeNull();
    expect(part('slot-primary')?.contains(progress)).toBe(true);
    expect(part('slot-primary')?.contains(screen.getByRole('progressbar', { name: 'Reloading Alpha' }))).toBe(true);
    expect(progress?.textContent).toBe('Reloading…');
    expect(screen.queryByRole('button', { name: 'Reload' })).toBeNull();
    expect(document.activeElement).toBe(progress);
    expect(['slot-primary', 'slot-secondary', 'slot-more'].map((name) => part(name))).toEqual(slots);

    await act(async () => {
      finish();
      await settle();
    });
    await act(async () => {
      await settle();
    });

    expect(part('head-progress')).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reload' }));
    expect(['slot-primary', 'slot-secondary', 'slot-more'].map((name) => part(name))).toEqual(slots);
  });

  it('keeps the lane quiet while the page\'s own work is under way, whatever notice the host\'s state would draw: the progress is the one presenter of the work', async () => {
    const { h } = await open([inventoryEntry('alpha', { enabled: false, phase: 'Installed' })]);
    const { promise, resolve: finish } = Promise.withResolvers<void>();
    h.actions.setEnabled.mockImplementation(async () => {
      await promise;
    });
    expect(part('lane')?.getAttribute('data-pl-quiet')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Enable' }));

    expect(part('lane')?.getAttribute('data-pl-quiet')).toBe('true');

    await act(async () => {
      finish();
      await settle();
    });
    await act(async () => {
      await settle();
    });

    expect(part('lane')?.getAttribute('data-pl-quiet')).toBeNull();
  });

  it('takes no focus from anyone when the host starts the work', async () => {
    const { h } = await open([inventoryEntry('alpha')]);
    const outside = document.createElement('button');
    document.body.append(outside);
    outside.focus();

    h.list.current = [inventoryEntry('alpha', { phase: 'Starting' })];
    await act(async () => {
      h.events.emit('plugin/state_change', { pluginID: 'alpha', to: 'Starting' });
      await settle();
    });

    expect(part('head-progress')).not.toBeNull();
    expect(document.activeElement).toBe(outside);
    outside.remove();
  });

  it('says the host\'s word for work it started itself, with no operation of this page', async () => {
    await open([inventoryEntry('alpha', { phase: 'Starting' })]);

    expect(part('head-progress')?.textContent).toBe('Starting…');
    expect(screen.getByRole('progressbar', { name: 'Starting Alpha' })).toBeTruthy();
  });
});

describe('the details card', () => {
  it('has a row for each fact the plugin has, and none for what it lacks', async () => {
    await open([inventoryEntry('alpha', { metadata: { license: '', category: '', author: null, capabilities: ['ui', 'resource', 'exec', 'networker', 'log', 'metric', 'settings', 'tools', 'odd'] } })]);

    expect(rowLabels()).toEqual(['Version', 'Source', 'Provides']);
    const provides = document.querySelectorAll('[data-pl-part="card-row"] dd')[2];
    expect(provides?.textContent).toBe('Pages, Resources, Shell access, Port forwarding, Logs, Metrics, Settings, Tools, Odd');
  });

  it('says where the plugin came from', async () => {
    await open([inventoryEntry('alpha', { origin: 'builtin' })]);
    expect(document.querySelectorAll('[data-pl-part="card-row"] dd')[4]?.textContent).toBe('Built into Omniview');
  });

  it('says a development link is linked from a source folder', async () => {
    await open([inventoryEntry('alpha', { devMode: true })]);
    expect(Array.from(document.querySelectorAll('[data-pl-part="card-row"] dd'), (value) => value.textContent)).toContain('Linked from a source folder');
  });

  it('draws the channel, the repository and the website as plain text, not links', async () => {
    await open([inventoryEntry('alpha', { releaseChannel: 'beta', metadata: { repository: 'https://example.test/repo', website: 'https://example.test' } })]);

    expect(rowLabels()).toEqual(['Version', 'Publisher', 'License', 'Category', 'Source', 'Provides', 'Channel', 'Repository', 'Website']);
    expect(part('card')?.querySelector('a')).toBeNull();
    expect(part('card')?.textContent).toContain('https://example.test/repo');
  });
});

describe('the empty pane', () => {
  it('says to choose a plugin when none is', async () => {
    await open([inventoryEntry('alpha')], null);

    expect(screen.getByText('Select a plugin')).toBeTruthy();
    expect(screen.getByText('Choose a plugin in the list to see what it does and how it is doing.')).toBeTruthy();
    expect(part('detail-empty')).not.toBeNull();
    expect(part('head')).toBeNull();
  });

  it('says it too for an id the list does not have', async () => {
    await open([inventoryEntry('alpha')], 'gone');

    expect(part('detail-empty')).not.toBeNull();
  });
});

describe('what a plugin wrote', () => {
  it('never reaches the document: a failed plugin\'s lane says the host\'s sentence', async () => {
    const poisoned: InventoryEntry & { readonly lastError: string } = { ...inventoryEntry('alpha', { phase: 'Failed' }), lastError: 'SECRET /Users/someone/.omniview/plugins/alpha: exit status 2' };
    await open([poisoned]);

    expect(document.body.textContent).not.toContain('SECRET');
    expect(document.body.innerHTML).not.toContain('/Users/someone');
    expect(part('lane')?.textContent).toContain('didn\'t start');
  });
});
