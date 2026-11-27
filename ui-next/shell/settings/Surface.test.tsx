import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { deferred, SENTINEL } from '../core/fields/testing';
import { hostSnapshot, setting } from './model/testing';
import type { HostSnapshot, SettingsPlugin } from './model/types';
import { mount, settle, teardown, type Mounted } from './testing';
import { Body } from './view/Body';
import { Surface } from './view/Surface';
import * as words from './view/words';

// The Settings sheet over the real session, the real form model and the real kit parts, with a host that answers from memory. These tests read what a person reads: which pages there are, which control each setting has, what a
// change does, what the lane says. jsdom has no layout and no top layer: the geometry and the modal's own behaviour are the probe's (probes/settings-probe.mjs).

vi.mock('./view/words', async (importOriginal) => {
  const actual = await importOriginal<typeof words>();
  return { ...actual, laneOf: vi.fn(actual.laneOf) };
});

afterEach(teardown);

const treeItem = (name: string) => screen.getByRole('treeitem', { name });
const pageItems = () => within(screen.getByRole('tree', { name: 'Settings pages' })).getAllByRole('treeitem').filter(item => item.hasAttribute('data-settings-page'));
const search = () => screen.getByRole('searchbox', { name: 'Search settings' });

async function goTo(m: Mounted, title: string): Promise<void> {
  await m.user.click(treeItem(title));
}

describe('the sheet', () => {
  it('is a dialog named Settings, loading first with nothing to change and a Close that works', async () => {
    const gate = deferred<HostSnapshot>();
    const m = await mount({ first: async () => gate.promise });
    expect(screen.getByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Loading settings…')).toBeInTheDocument();
    expect(screen.queryByRole('navigation')).toBeNull();
    await m.user.click(screen.getByRole('button', { name: 'Close' }));
    expect(m.onClose).toHaveBeenCalledTimes(1);
    gate.resolve(hostSnapshot());
    await settle(m.clock);
    expect(screen.getByRole('navigation', { name: 'Settings pages' })).toBeInTheDocument();
  });

  it('asks the browser to close it with Escape through the dialog\'s own cancel event, and never by itself', async () => {
    const m = await mount();
    const dialog = screen.getByRole('dialog', { name: 'Settings' });
    expect(m.onClose).not.toHaveBeenCalled();
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(m.onClose).toHaveBeenCalledTimes(1);
  });
});

describe('the pages, by the keyboard', () => {
  it('follows focus on pages and uses the tree keys to cross, close and reopen branches', async () => {
    const m = await mount();
    expect(treeItem('Appearance')).toHaveFocus();
    await m.user.keyboard('{ArrowDown}');
    expect(treeItem('General')).toHaveFocus();
    expect(treeItem('General')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region', { name: 'General' })).toBeInTheDocument();
    await m.user.keyboard('{ArrowLeft}{ArrowLeft}');
    expect(treeItem('Core')).toHaveFocus();
    expect(treeItem('Core')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('treeitem', { name: 'General' })).toBeNull();
    expect(screen.getByRole('region', { name: 'General' })).toBeInTheDocument();
    await m.user.keyboard('{ArrowDown}{Enter}');
    expect(treeItem('Plugins')).toHaveFocus();
    expect(treeItem('Plugins')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('No plugin settings available.')).toBeNull();
    await m.user.keyboard('{Home}{ArrowRight}{ArrowRight}');
    expect(treeItem('Appearance')).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeInTheDocument();
    expect(m.page.last()).toBe('appearance');
    await m.user.keyboard('{End}');
    expect(treeItem('Plugins')).toHaveFocus();
    await m.user.keyboard(' ');
    expect(screen.getByText('No plugin settings available.')).toBeInTheDocument();
    expect(screen.getAllByRole('treeitem').filter(item => item.tabIndex === 0)).toEqual([treeItem('Plugins')]);
  });
});

describe('the pages', () => {
  it('lists the host’s categories in the design order, with the first page on screen', async () => {
    await mount();
    expect(pageItems().map(item => item.textContent)).toEqual(['Appearance', 'General', 'Editor', 'Terminal', 'Telemetry', 'Developer Settings']);
    expect(treeItem('Appearance')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Appearance' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 4 }).map((heading) => heading.textContent)).toEqual(['Colors', 'Layout and text', 'Window material', 'Surface opacity']);
    expect(screen.getByText('Customize the look and feel of the application')).toBeInTheDocument();
    expect(screen.queryByText(/Only backgrounds change|Active (here|in this window)/i)).toBeNull();
  });

  it('draw the glyph the host names for each category, now that the kit has all six, in a column of their own', async () => {
    await mount();
    expect(pageItems().map(item => item.querySelector('svg')?.getAttribute('data-ov-glyph'))).toEqual(['paintbrush', 'settings-2', 'code', 'square-terminal', 'activity', 'beaker']);
    expect(pageItems().map(item => item.querySelectorAll('svg').length)).toEqual([1, 1, 1, 1, 1, 1]);
    expect(treeItem('Core').querySelector('[data-ov-glyph="settings"]')).not.toBeNull();
    expect(treeItem('Plugins').querySelector('[data-ov-glyph="puzzle"]')).not.toBeNull();
    expect(treeItem('Plugins')).toHaveAttribute('aria-level', '1');
    expect(treeItem('Terminal')).toHaveAttribute('aria-level', '2');
  });

  it('put the keyboard on the page that is on screen when the sheet is ready', async () => {
    await mount();
    expect(treeItem('Appearance')).toHaveFocus();
  });

  it('takes focus after a cached session opens its native dialog', async () => {
    const m = await mount({ page: 'editor' });
    m.unmount();
    vi.spyOn(HTMLDialogElement.prototype, 'showModal').mockImplementation(function (this: HTMLDialogElement) {
      this.open = true;
      this.querySelector<HTMLButtonElement>('button')?.focus();
    });
    render(<Surface session={m.session} page={m.page} onClose={m.onClose} />);
    expect(treeItem('Editor')).toHaveFocus();
    await m.user.keyboard('{ArrowDown}');
    expect(treeItem('Terminal')).toHaveFocus();
  });

  it('change by pressing one, show that page and remember it for the next opening', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    expect(treeItem('Terminal')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('region', { name: 'Terminal' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Appearance' })).toBeNull();
    expect(m.page.last()).toBe('terminal');
  });

  it('start on the page that was left, when it is still there', async () => {
    await mount({ page: 'editor' });
    expect(screen.getByRole('region', { name: 'Editor' })).toBeInTheDocument();
    expect(treeItem('Editor')).toHaveAttribute('aria-current', 'page');
  });

  it('draws Appearance in design order and never offers a free-form theme ID', async () => {
    await mount();
    expect(screen.getByRole('radiogroup', { name: 'Theme' })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Theme' })).toBeNull();
    const rows = document.querySelectorAll('[data-settings-row]');
    expect([...rows].map((row) => row.getAttribute('data-settings-row'))).toEqual([
      'appearance.theme', 'appearance.density', 'appearance.textSize', 'appearance.motion',
      'appearance.windowMaterial', 'appearance.glassStyle', 'appearance.chromeOpacity', 'appearance.contentOpacity', 'appearance.menuOpacity', 'appearance.sheetOpacity',
    ]);
  });
});

describe('searching settings', () => {
  it('disambiguates equal setting titles by page and goes directly to the chosen control', async () => {
    const m = await mount();
    await m.user.click(treeItem('Core'));
    await m.user.type(search(), '  fOnT sIzE  ');
    const results = within(screen.getByRole('group', { name: 'Search results' })).getAllByRole('button');
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveAccessibleName(/Font Size.*Editor/);
    expect(results[1]).toHaveAccessibleName(/Font Size.*Terminal/);
    await m.user.keyboard('{ArrowDown}{ArrowDown}');
    expect(results[1]).toHaveFocus();
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeInTheDocument();
    await m.user.keyboard('{Enter}');
    expect(search()).toHaveValue('');
    expect(treeItem('Core')).toHaveAttribute('aria-expanded', 'true');
    expect(treeItem('Terminal')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('spinbutton', { name: 'Font Size' })).toHaveFocus();
    expect(m.page.last()).toBe('terminal');
    expect(m.host.calls.commit).toEqual([]);
  });

  it('searches page names, skips omitted settings and values, and clears without closing the sheet', async () => {
    const m = await mount();
    await m.user.type(search(), 'Native Terminal Application');
    expect(screen.getByText('No matching settings.')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Search results' })).toBeNull();
    await m.user.keyboard('{Escape}');
    expect(search()).toHaveValue('');
    expect(search()).toHaveFocus();
    expect(m.onClose).not.toHaveBeenCalled();
    await m.user.type(search(), '/bin/zsh');
    expect(screen.getByText('No matching settings.')).toBeInTheDocument();
    await m.user.click(screen.getByRole('button', { name: 'Clear search' }));
    await m.user.type(search(), 'termiNaL{Enter}');
    expect(treeItem('Terminal')).toHaveFocus();
    expect(treeItem('Terminal')).toHaveAttribute('aria-selected', 'true');
  });

  it('can choose the same setting twice on the current page, including a compound control', async () => {
    const m = await mount();
    for (let visit = 0; visit < 2; visit += 1) {
      await m.user.type(search(), 'UI Density{Enter}');
      expect(screen.getByRole('radio', { name: 'Comfortable' })).toHaveFocus();
      expect(search()).toHaveValue('');
    }

    expect(m.host.calls.commit).toEqual([]);
  });

  it('opens installed plugins with drawable settings, keeps opaque IDs scoped, and drops removed pages', async () => {
    const field = setting('cursor.["blink"]', 'toggle', 'Cursor Blink', 'Blink the cursor.', false);
    const m = await mount({
      prepare: host => {
        host.plugin({ id: 'example', name: 'Example', description: 'Example preferences.', icon: 'LuCode' }, [field]);
        host.plugin({ id: 'empty', name: 'Empty plugin', description: '', icon: '' }, []);
      },
    });
    expect(treeItem('Example')).toHaveAttribute('aria-level', '2');
    expect(screen.queryByRole('treeitem', { name: 'Empty plugin' })).toBeNull();
    await m.user.click(treeItem('Plugins'));
    await m.user.type(search(), 'Cursor Blink');
    const group = within(screen.getByRole('group', { name: 'Search results' }));
    expect(group.getAllByRole('button')).toHaveLength(2);
    await m.user.click(group.getByRole('button', { name: /Cursor Blink.*Plugins.*Example/ }));
    const toggle = screen.getByRole('switch', { name: 'Cursor Blink' });
    expect(toggle).toHaveFocus();
    expect(toggle).toHaveAttribute('aria-checked', 'false');
    expect(treeItem('Plugins')).toHaveAttribute('aria-expanded', 'true');
    expect(m.page.last()).toBe('plugin/example');
    await m.user.click(toggle);
    await settle(m.clock);
    expect(toggle).toHaveAttribute('aria-checked', 'true');
    expect(m.host.calls.commit).toEqual([]);
    expect(m.host.pluginCalls.commit).toEqual([['example', { [field.id]: true }]]);
    await m.user.click(treeItem('Core'));
    expect(treeItem('Core')).toHaveAttribute('aria-expanded', 'false');
    act(() => {
      m.host.removePlugin('example');
    });
    await settle(m.clock);
    expect(screen.queryByRole('treeitem', { name: 'Example' })).toBeNull();
    expect(treeItem('Appearance')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText('No plugin settings available.')).toBeInTheDocument();
  });

  it('preserves a requested plugin page until discovery finishes', async () => {
    const plugin = { id: 'example', name: 'Example', description: '', icon: 'LuCode' };
    const inventory = deferred<readonly SettingsPlugin[]>();
    const m = await mount({
      page: 'plugin/example',
      prepare: host => {
        host.plugin(plugin, [setting('enabled', 'toggle', 'Enabled', '', true)]);
        vi.spyOn(host.client, 'inventory').mockReturnValueOnce(inventory.promise);
      },
    });
    expect(m.page.last()).toBe('plugin/example');
    expect(screen.getByText('Loading plugin settings…')).toBeInTheDocument();
    inventory.resolve([plugin]);
    await settle(m.clock);
    expect(treeItem('Example')).toHaveFocus();
    expect(screen.getByRole('switch', { name: 'Enabled' })).toBeInTheDocument();
  });

  it('keeps Core usable when plugin discovery fails and retries without switching pages', async () => {
    const m = await mount({
      prepare: host => {
        vi.spyOn(host.client, 'inventory').mockRejectedValueOnce(new Error('offline'));
      },
    });
    expect(treeItem('Appearance')).toHaveAttribute('aria-current', 'page');
    await m.user.click(treeItem('Couldn’t list plugins. Retry'));
    await settle(m.clock);
    expect(treeItem('Plugins')).toHaveFocus();
    expect(screen.getByText('No plugin settings available.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Appearance' })).toBeInTheDocument();
  });

  it('offers no page for an empty host, but keeps the sidebar and both explanations accessible', async () => {
    await mount({ first: async () => ({ categories: {} }) });
    expect(pageItems()).toEqual([]);
    expect(screen.getByText('The host has no settings to show.')).toBeInTheDocument();
    expect(screen.getByText('No core settings available.')).toBeInTheDocument();
    expect(screen.getByText('No plugin settings available.')).toBeInTheDocument();
    expect(search()).toHaveAttribute('data-settings-part', 'search');
  });
});

describe('each setting has the control its kind asks for', () => {
  it('a choice is a select with the host\'s options, a switch is a switch, a whole number a spinbutton, a text a field', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    expect(screen.getByRole('switch', { name: 'Cursor Blink' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('combobox', { name: 'Cursor Style' })).toHaveValue('block');
    expect(within(screen.getByRole('combobox', { name: 'Cursor Style' })).getAllByRole('option').map((option) => option.textContent)).toEqual(['Block', 'Underline', 'Bar']);
    expect(screen.getByRole('spinbutton', { name: 'Font Size' })).toHaveValue('12');
    expect(screen.getByRole('textbox', { name: 'Default Shell' })).toHaveValue('/bin/zsh');
  });

  async function openPluginPaths(original: string[]) {
    const paths = setting('config.paths', 'text', 'Config Paths', 'The configuration files to load.', original, {
      fileSelection: { enabled: true, multiple: true, allowFolders: false, relative: false },
    });
    const m = await mount({
      prepare: host => {
        host.plugin({ id: 'example', name: 'Example', description: '', icon: '' }, [paths]);
      },
    });
    await m.user.type(search(), 'Config Paths{Enter}');
    const list = within(screen.getByRole('group', { name: 'Config Paths' }));
    return { m, list, paths };
  }

  it('edits, appends and removes plugin paths as ordered arrays without committing keystrokes', async () => {
    const original = ['/etc/example,config', '/work/my project/config'];
    const { m, list, paths } = await openPluginPaths(original);
    const first = list.getByRole('textbox', { name: 'Config Paths' });
    const add = list.getByRole('textbox', { name: 'Add a path to Config Paths' });
    expect(first).toHaveFocus();
    expect(first).toHaveValue(original[0]);
    expect(list.getByRole('textbox', { name: 'Config Paths, path 2' })).toHaveValue(original[1]);
    await m.user.clear(first);
    await m.user.type(first, '/tmp/reverted{Escape}');
    expect(first).toHaveValue(original[0]);
    await m.user.clear(first);
    await m.user.type(first, '/etc/updated');
    expect(m.host.pluginCalls.validate).toEqual([]);
    expect(m.host.pluginCalls.commit).toEqual([]);
    await m.user.tab();
    await settle(m.clock);
    await m.user.type(add, '/tmp/external{Enter}');
    await settle(m.clock);
    await m.user.click(list.getByRole('button', { name: 'Remove path 2 from Config Paths' }));
    await settle(m.clock);
    expect(add).toHaveFocus();
    const edits = [['/etc/updated', original[1]], ['/etc/updated', original[1], '/tmp/external'], ['/etc/updated', '/tmp/external']];
    expect(m.host.pluginCalls.validate).toEqual(edits.map(value => ['example', paths.id, value]));
    expect(m.host.pluginCalls.commit).toEqual(edits.map(value => ['example', { [paths.id]: value }]));
    expect(m.host.calls.commit).toEqual([]);
  });

  it('discards an unfinished path edit when another window changes the list', async () => {
    const { m, list, paths } = await openPluginPaths(['/a', '/b']);
    const second = list.getByRole('textbox', { name: 'Config Paths, path 2' });
    await m.user.type(second, '2');
    expect(second).toHaveValue('/b2');

    const external = { [paths.id]: ['/b', '/c'] };
    await act(async () => {
      await m.host.client.commit({ kind: 'plugin', pluginId: 'example' }, external);
    });
    await settle(m.clock);
    expect(list.getByRole('textbox', { name: 'Config Paths' })).toHaveValue('/b');
    expect(second).toHaveFocus();
    expect(second).toHaveValue('/c');
    await m.user.keyboard('{Enter}{Tab}');
    await settle(m.clock);
    expect(m.host.pluginCalls.validate).toEqual([]);
    expect(m.host.pluginCalls.commit).toEqual([['example', external]]);
  });

  it('says what the host says of each: the description is the control\'s description', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    expect(screen.getByRole('switch', { name: 'Cursor Blink' })).toHaveAccessibleDescription(/Whether the cursor should blink in the terminal/);
  });

  it('draws the opt-out of the shell integration in the Terminal page: a switch that is on, and says that it applies to terminals opened after the change and that no startup file is edited', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    const row = screen.getByRole('switch', { name: 'Shell Integration' });
    expect(row).toHaveAttribute('aria-checked', 'true');
    expect(row).toHaveAccessibleDescription(/Applies to terminals opened after the change; the shell's startup files are never edited\./);
  });

  it('a secret says whether the host holds one, never what it is', async () => {
    const m = await mount({ stored: { 'telemetry.auth_value': true } });
    await goTo(m, 'Telemetry');
    expect(screen.getByLabelText('OTLP Traces and Metrics Auth Value')).toHaveAttribute('placeholder', 'Saved · hidden');
    expect(screen.getByLabelText('Loki Auth Value')).toHaveAttribute('placeholder', 'Not set');
    expect(screen.getByLabelText('OTLP Traces and Metrics Auth Value')).toHaveValue('');
  });
});

describe('a change', () => {
  it('applies when a switch is pressed: the host is told the one setting, and the row says it differs from the default', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    expect(screen.queryByRole('button', { name: /^Reset / })).toBeNull();
    await m.user.click(screen.getByRole('switch', { name: 'Cursor Blink' }));
    await settle(m.clock);
    expect(m.host.calls.commit).toEqual([{ 'terminal.cursorBlink': false }]);
    expect(screen.getByRole('switch', { name: 'Cursor Blink' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Reset Cursor Blink to default' }).querySelector('svg')).toHaveAttribute('data-ov-glyph', 'rotate-ccw');
  });

  it('turns the shell integration off when its switch is pressed: the host is told the one setting', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    await m.user.click(screen.getByRole('switch', { name: 'Shell Integration' }));
    await settle(m.clock);
    expect(m.host.calls.commit).toEqual([{ 'terminal.shellIntegration': false }]);
    expect(screen.getByRole('switch', { name: 'Shell Integration' })).toHaveAttribute('aria-checked', 'false');
    expect(screen.getByRole('button', { name: 'Reset Shell Integration to default' })).toBeInTheDocument();
  });

  it('is undone by Reset, which then goes, and the keyboard is on the row\'s control', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    await m.user.click(screen.getByRole('switch', { name: 'Cursor Blink' }));
    await settle(m.clock);
    await m.user.click(screen.getByRole('button', { name: 'Reset Cursor Blink to default' }));
    await settle(m.clock);
    expect(m.host.calls.commit).toEqual([{ 'terminal.cursorBlink': false }, { 'terminal.cursorBlink': true }]);
    expect(screen.getByRole('switch', { name: 'Cursor Blink' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.queryByRole('button', { name: /^Reset / })).toBeNull();
    expect(screen.getByRole('switch', { name: 'Cursor Blink' })).toHaveFocus();
  });

  it('applies a choice at once and never asks the host about it first', async () => {
    const m = await mount();
    await m.user.click(screen.getByRole('radio', { name: 'Compact' }));
    await settle(m.clock);
    expect(m.host.calls.validate).toEqual([]);
    expect(m.host.calls.commit).toEqual([{ 'appearance.density': 'compact' }]);
  });

  it('is committed on Enter for a typed value, after the host has been asked about it, and says Saved', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    const field = screen.getByRole('textbox', { name: 'Default Shell' });
    await m.user.clear(field);
    await m.user.type(field, '/bin/fish');
    expect(m.host.calls.commit).toEqual([]);
    await m.user.keyboard('{Enter}');
    await settle(m.clock);
    expect(m.host.calls.validate).toEqual([['terminal.defaultShell', '/bin/fish']]);
    expect(m.host.calls.commit).toEqual([{ 'terminal.defaultShell': '/bin/fish' }]);
    expect(field).toHaveAccessibleDescription(/Saved\./);
    await act(async () => {
      await m.clock.advance(2_000);
    });
    expect(field).not.toHaveAccessibleDescription(/Saved\./);
  });

  it('is refused in the host\'s words, keeps what was typed, is announced once, and applies nothing', async () => {
    const m = await mount();
    await goTo(m, 'Developer Settings');
    m.host.next.validate = () => ({ valid: false, code: 'port_range', message: 'Enter a whole-number port from 0 to 65535.' });
    const field = screen.getByRole('spinbutton', { name: 'Host profiling port' });
    await m.user.clear(field);
    await m.user.type(field, '70000');
    await m.user.keyboard('{Enter}');
    await settle(m.clock);
    expect(field).toHaveValue('70000');
    expect(field).toHaveAttribute('aria-invalid', 'true');
    expect(field).toHaveAccessibleDescription(/Enter a whole-number port from 0 to 65535\./);
    expect(m.host.calls.commit).toEqual([]);
    expect(screen.getAllByRole('status').some((region) => region.textContent === 'Host profiling port: Enter a whole-number port from 0 to 65535.')).toBe(true);
  });

  it('does not keep a refused draft for the way back: the page is entered from what the host applied (S125, no draft outlives its field)', async () => {
    const m = await mount();
    await goTo(m, 'Developer Settings');
    m.host.next.validate = () => ({ valid: false, code: 'port_range', message: 'Enter a whole-number port from 0 to 65535.' });
    const refused = screen.getByRole('spinbutton', { name: 'Host profiling port' });
    await m.user.clear(refused);
    await m.user.type(refused, '70000');
    await m.user.keyboard('{Enter}');
    await settle(m.clock);
    expect(refused).toHaveAttribute('aria-invalid', 'true');
    await goTo(m, 'Terminal');
    await goTo(m, 'Developer Settings');
    const back = screen.getByRole('spinbutton', { name: 'Host profiling port' });
    expect(back).toHaveValue('6060');
    expect(back).not.toHaveAttribute('aria-invalid', 'true');
    expect(m.host.calls.commit).toEqual([]);
  });

  it('puts the applied value back on Escape in a field that has a draft, and the sheet stays open', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    const field = screen.getByRole('spinbutton', { name: 'Font Size' });
    await m.user.clear(field);
    await m.user.type(field, '30');
    await m.user.keyboard('{Escape}');
    expect(field).toHaveValue('12');
    expect(m.onClose).not.toHaveBeenCalled();
  });

  it('keeps the characters a person types into a number: "1." stays "1." while it is being typed', async () => {
    const m = await mount();
    await goTo(m, 'Developer Settings');
    const field = screen.getByRole('spinbutton', { name: 'Host profiling port' });
    await m.user.clear(field);
    await m.user.type(field, '6061.');
    expect(field).toHaveValue('6061.');
  });
});

describe('the cost of a keystroke', () => {
  it('draws the one row that has it: a key typed in a field is one row\'s render and no other row\'s', async () => {
    const m = await mount();
    await goTo(m, 'Developer Settings');
    const field = screen.getByRole('textbox', { name: 'Marketplace URL' });
    const laneOf = vi.mocked(words.laneOf);
    laneOf.mockClear();
    await m.user.type(field, 'x');
    // One keystroke: the row of that field draws; its ten neighbours do not.
    expect(laneOf.mock.calls.length).toBe(1);
  });
});

describe('a change made elsewhere', () => {
  it('moves a field that has no draft', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    act(() => {
      m.host.change('terminal.fontSize', 16);
    });
    await settle(m.clock);
    expect(screen.getByRole('spinbutton', { name: 'Font Size' })).toHaveValue('16');
  });

  it('leaves what a person is typing and says so on the field; Escape takes the other value', async () => {
    const m = await mount();
    await goTo(m, 'Terminal');
    const field = screen.getByRole('spinbutton', { name: 'Font Size' });
    await m.user.clear(field);
    await m.user.type(field, '18');
    act(() => {
      m.host.change('terminal.fontSize', 16);
    });
    await settle(m.clock);
    expect(field).toHaveValue('18');
    expect(field).toHaveAccessibleDescription(/Changed elsewhere to “16”\. Escape takes it\./);
    await m.user.keyboard('{Escape}');
    expect(field).toHaveValue('16');
    expect(field).not.toHaveAccessibleDescription(/Changed elsewhere/);
  });
});

describe('a secret', () => {
  it('is sent as typed, once, and then the row says one is saved; the typed value is in no node, attribute or message of the page', async () => {
    const m = await mount();
    await goTo(m, 'Telemetry');
    const field = screen.getByLabelText('Loki Auth Value');
    await m.user.type(field, SENTINEL);
    await m.user.keyboard('{Enter}');
    await settle(m.clock);
    expect(m.host.calls.commit).toEqual([{ 'telemetry.loki_auth_value': SENTINEL }]);
    expect(screen.getByLabelText('Loki Auth Value')).toHaveAttribute('placeholder', 'Saved · hidden');
    expect(screen.getByLabelText('Loki Auth Value')).toHaveValue('');
    expect(document.documentElement.outerHTML).not.toContain(SENTINEL);
    expect(m.session.announcements.getSnapshot().text).not.toContain(SENTINEL);
  });
});

describe('a sheet that cannot load', () => {
  it('says so, offers Retry with the keyboard on it, and Retry asks the host again', async () => {
    const m = await mount({ first: async () => Promise.reject(new Error('down')) });
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load settings');
    expect(screen.getByRole('button', { name: 'Retry' })).toHaveFocus();
    await m.user.click(screen.getByRole('button', { name: 'Retry' }));
    await settle(m.clock);
    expect(treeItem('Appearance')).toBeInTheDocument();
    expect(m.host.calls.snapshot).toBe(2);
  });
});

describe('a page that was not looking', () => {
  // The host's `settings/changed` is not replayed to a page whose events connection was down (server mode) or whose machine slept: it asks again when it is looked at.
  it.each([
    ['the window gets the focus again', () => window.dispatchEvent(new Event('focus'))],
    ['the page becomes visible', () => document.dispatchEvent(new Event('visibilitychange'))],
    ['the machine is online again', () => window.dispatchEvent(new Event('online'))],
  ])('asks the host again when %s, and follows what it missed', async (_name, look) => {
    vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
    const m = await mount();
    await goTo(m, 'Terminal');
    const before = m.host.calls.snapshot;
    m.host.values.set('terminal.fontSize', 20);
    act(() => {
      look();
    });
    await settle(m.clock);
    expect(m.host.calls.snapshot).toBe(before + 1);
    expect(screen.getByRole('spinbutton', { name: 'Font Size' })).toHaveValue('20');
  });

  it('does not ask while it is hidden, and holds no listener once it is gone', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const m = await mount();
    const before = m.host.calls.snapshot;
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await settle(m.clock);
    expect(m.host.calls.snapshot).toBe(before);
    visibility.mockReturnValue('visible');
    m.unmount();
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await settle(m.clock);
    expect(m.host.calls.snapshot).toBe(before);
  });
});

describe('a secret the host refused', () => {
  it('is gone from the form when the page is left and come back to: the typed text never outlives its field', async () => {
    const m = await mount({ stored: { 'telemetry.auth_value': true, 'telemetry.loki_auth_value': false } });
    await goTo(m, 'Telemetry');
    const state = m.session.getState();
    if (state.phase !== 'ready') {
      throw new Error('not ready');
    }

    const { form } = state;
    m.host.next.commit = async () => Promise.reject(new Error('refused'));
    act(() => {
      form.setValue('telemetry.loki_auth_value', SENTINEL);
    });
    await act(async () => {
      await form.commit('telemetry.loki_auth_value');
    });
    await settle(m.clock);
    expect(form.field('telemetry.loki_auth_value')?.secret).toEqual({ presence: 'unset', changed: true });
    expect(form.stats().secrets).toBe(1);
    await goTo(m, 'Editor');
    await goTo(m, 'Telemetry');
    expect(form.field('telemetry.loki_auth_value')?.secret).toEqual({ presence: 'unset', changed: false });
    expect(form.stats().secrets).toBe(0);
    expect(document.body.innerHTML).not.toContain(SENTINEL);
  });
});

describe('a secret typed while the other window changes it', () => {
  it('says so on the field in words that carry no text', async () => {
    const m = await mount({ stored: { 'telemetry.auth_value': true } });
    await goTo(m, 'Telemetry');
    const state = m.session.getState();
    if (state.phase !== 'ready') {
      throw new Error('not ready');
    }

    act(() => {
      state.form.setValue('telemetry.auth_value', SENTINEL);
    });
    await m.host.client.commit({ kind: 'host' }, { 'telemetry.auth_value': '' });
    m.host.change('telemetry.auth_value', '');
    await settle(m.clock);
    expect(screen.getByText(/Changed elsewhere\. Escape takes it\./)).toBeInTheDocument();
    expect(document.body.innerHTML).not.toContain(SENTINEL);
  });
});

describe('a body that is mounted anew', () => {
  // The Settings window's body is keyed by the host's request: each request for a page mounts a new one over the same session and form. Whatever the way it comes, a secret that is being typed never outlives the body it was typed in.
  it('holds no secret text in the form: a refused secret is gone from the vault after any remount', async () => {
    const m = await mount({ stored: { 'telemetry.auth_value': true, 'telemetry.loki_auth_value': false } });
    await goTo(m, 'Telemetry');
    const state = m.session.getState();
    if (state.phase !== 'ready') {
      throw new Error('not ready');
    }

    const { form } = state;
    m.host.next.commit = async () => Promise.reject(new Error('refused'));
    act(() => {
      form.setValue('telemetry.loki_auth_value', SENTINEL);
    });
    await act(async () => {
      await form.commit('telemetry.loki_auth_value');
    });
    await settle(m.clock);
    expect(form.stats().secrets).toBe(1);
    m.unmount();
    render(<Body session={m.session} page={m.page} headingLevel="h2" />);
    await settle(m.clock);
    expect(form.stats().secrets).toBe(0);
    expect(form.field('telemetry.loki_auth_value')?.secret).toEqual({ presence: 'unset', changed: false });
    expect(document.body.innerHTML).not.toContain(SENTINEL);
    // Enter in the field that reads empty sends nothing.
    const sent = m.host.calls.commit.length;
    await act(async () => {
      await form.commit('telemetry.loki_auth_value');
    });
    expect(m.host.calls.commit.length).toBe(sent);
  });
});
