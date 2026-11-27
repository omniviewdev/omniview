import { describe, expect, it, vi } from 'vitest';
import type { SettingsScope } from '../../settings/model/types';

const changedClient = vi.hoisted(() => ({
  onChanged: vi.fn<(listener: (scope: SettingsScope) => void) => void>(), off: vi.fn(), list: vi.fn(async () => Promise.resolve([])),
}));
vi.mock('../../settings/runtime', () => ({ runtimeClient: () => ({ onChanged: (listener: (scope: SettingsScope) => void) => {
  changedClient.onChanged(listener); return changedClient.off;
} }) }));
vi.mock('@omniviewdev/runtime/api', () => ({ ExecClient: { ListTerminalShells: changedClient.list } }));
import { appShellList, createShellList, launchOf, shellMenu, shellsOf, type ShellChoice } from './profiles';

// The shells of this machine as the page offers them: what the host lists (`ListTerminalShells`), kept for as long as something listens, asked again when the settings change (the host decides which shell is the default, so
// a change of `terminal.defaultShell` is asked of the host and not worked out here), and drawn as the items of the `+`'s menu.

const BASH = { name: 'bash', path: '/bin/bash', default: false };
const ZSH = { name: 'zsh', path: '/usr/bin/zsh', default: true };

/** A host whose answers the test holds, and a settings event it can raise. */
function rig(answer: () => Promise<unknown> = async () => Promise.resolve([BASH, ZSH])) {
  const list = vi.fn(answer);
  const listeners = new Set<() => void>();
  const off = vi.fn();
  const warn = vi.fn();
  const shells = createShellList({
    list,
    warn,
    onChanged: (listener) => {
      listeners.add(listener);
      return () => {
        off();
        listeners.delete(listener);
      };
    },
  });
  return { shells, list, warn, off, listeners, changed: () => {
    listeners.forEach((listener) => {
      listener(); 
    }); 
  } };
}

const turns = async () => {
  for (let i = 0; i < 5; i += 1) {
    await Promise.resolve();
  }
};

describe('what the host lists', () => {
  it('is a profile for each shell, marked default only where the host says so', () => {
    expect(shellsOf([BASH, ZSH])).toEqual([
      { profile: { name: 'bash', path: '/bin/bash' }, isDefault: false },
      { profile: { name: 'zsh', path: '/usr/bin/zsh' }, isDefault: true },
    ]);
  });

  it('leaves out what is not a shell with a name and a path, and an answer that is not a list is no shells', () => {
    expect(shellsOf([{ name: 'bash' }, { path: '/bin/sh' }, { name: '', path: '/bin/x' }, null, 'zsh', 3, BASH]).map((choice) => choice.profile.path)).toEqual(['/bin/bash']);
    expect(shellsOf(undefined)).toEqual([]);
    expect(shellsOf({ shells: [BASH] })).toEqual([]);
  });

  it('never marks a default the host did not mark: a shell is the default by the host\'s word only', () => {
    expect(shellsOf([{ name: 'bash', path: '/bin/bash' }, { name: 'zsh', path: '/usr/bin/zsh', default: 'yes' }]).map((choice) => choice.isDefault)).toEqual([false, false]);
  });
});

describe('the list the page keeps', () => {
  it('asks nothing and listens to nothing until something listens: no work at rest', async () => {
    const r = rig();
    await turns();
    expect(r.list).not.toHaveBeenCalled();
    expect(r.listeners.size).toBe(0);
    expect(r.shells.getSnapshot()).toEqual([]);
  });

  it('asks the host once for any number of listeners, and tells them when the answer comes', async () => {
    const r = rig();
    const first = vi.fn();
    const second = vi.fn();
    r.shells.subscribe(first);
    r.shells.subscribe(second);
    await turns();
    expect(r.list).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
    expect(second).toHaveBeenCalledTimes(1);
    expect(r.shells.getSnapshot().map((choice) => choice.profile.name)).toEqual(['bash', 'zsh']);
  });

  it('answers the same list to every read until it changes (a store that returned a new list each time would render forever)', async () => {
    const r = rig();
    r.shells.subscribe(() => undefined);
    await turns();
    expect(r.shells.getSnapshot()).toBe(r.shells.getSnapshot());
  });

  it('asks the host again when the settings change, and the default is the one the host marks now', async () => {
    const answers = [[BASH, ZSH], [{ ...BASH, default: true }, { ...ZSH, default: false }]];
    const r = rig(async () => Promise.resolve(answers.shift()));
    r.shells.subscribe(() => undefined);
    await turns();
    expect(r.shells.getSnapshot().find((choice) => choice.isDefault)?.profile.name).toBe('zsh');
    r.changed();
    await turns();
    expect(r.list).toHaveBeenCalledTimes(2);
    expect(r.shells.getSnapshot().find((choice) => choice.isDefault)?.profile.name).toBe('bash');
  });

  it('keeps the answer to the last question when an earlier one comes in late', async () => {
    const held: Array<(answer: unknown) => void> = [];
    const r = rig(async () => new Promise((resolve) => {
      held.push(resolve); 
    }));
    r.shells.subscribe(() => undefined);
    r.changed();
    expect(held).toHaveLength(2);
    held[1]?.([BASH]);
    await turns();
    held[0]?.([ZSH]);
    await turns();
    expect(r.shells.getSnapshot().map((choice) => choice.profile.name)).toEqual(['bash']);
  });

  it('stops listening to the settings when the last listener leaves, and does not ask for a change that nobody is told of', async () => {
    const r = rig();
    const one = r.shells.subscribe(() => undefined);
    const two = r.shells.subscribe(() => undefined);
    await turns();
    one();
    expect(r.off).not.toHaveBeenCalled();
    two();
    expect(r.off).toHaveBeenCalledTimes(1);
    expect(r.listeners.size).toBe(0);
    r.changed();
    expect(r.list).toHaveBeenCalledTimes(1);
  });

  it('says so and keeps what it had when the host cannot answer', async () => {
    let fail = false;
    const r = rig(async () => (fail ? Promise.reject(new Error('no host')) : Promise.resolve([BASH])));
    r.shells.subscribe(() => undefined);
    await turns();
    fail = true;
    r.changed();
    await turns();
    expect(r.warn).toHaveBeenCalledTimes(1);
    expect(r.shells.getSnapshot().map((choice) => choice.profile.name)).toEqual(['bash']);
  });
});

describe('the menu of the `+`', () => {
  const choices: readonly ShellChoice[] = shellsOf([BASH, ZSH]);

  it('is an item for each shell: its name, its path, and the default marked', () => {
    const items = shellMenu(choices, () => undefined);
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ kind: 'action', label: 'bash', metadata: '/bin/bash' });
    expect(items[1]).toMatchObject({ kind: 'action', label: 'zsh', metadata: { text: 'Default  /usr/bin/zsh', icon: 'check' } });
  });

  it('opens the profile of the item that was chosen', () => {
    const open = vi.fn();
    const items = shellMenu(choices, open);
    const zsh = items[1];
    expect(zsh?.kind).toBe('action');
    if (zsh?.kind === 'action') {
      zsh.onSelect();
    }

    expect(open).toHaveBeenCalledWith({ name: 'zsh', path: '/usr/bin/zsh' });
  });

  it('is nothing when no shell is known', () => {
    expect(shellMenu([], () => undefined)).toEqual([]);
  });
});

describe('what a profile asks of the host', () => {
  it('is its path first and its arguments after it, with its directory and environment when it has them', () => {
    expect(launchOf({ name: 'zsh', path: '/usr/bin/zsh', args: ['-f'], cwd: '/work', env: { A: '1' } })).toEqual({ command: ['/usr/bin/zsh', '-f'], cwd: '/work', env: { A: '1' } });
  });

  it('says nothing of a directory or an environment it has none of', () => {
    const launch = launchOf({ name: 'zsh', path: '/usr/bin/zsh' });
    expect(launch).toEqual({ command: ['/usr/bin/zsh'] });
    expect(launch).not.toHaveProperty('cwd');
    expect(launch).not.toHaveProperty('env');
  });
});

describe('the list of the app', () => {
  it('does not listen to the settings when the last listener left before the settings client had loaded', async () => {
    changedClient.onChanged.mockClear();
    const stop = appShellList().subscribe(() => undefined);
    stop();
    await vi.dynamicImportSettled();
    await turns();
    expect(changedClient.onChanged).not.toHaveBeenCalled();
  });

  it('listens to the settings while someone listens, and lets go of them with the last listener', async () => {
    changedClient.onChanged.mockClear();
    changedClient.off.mockClear();
    const stop = appShellList().subscribe(() => undefined);
    await vi.dynamicImportSettled();
    await turns();
    expect(changedClient.onChanged).toHaveBeenCalledTimes(1);
    stop();
    expect(changedClient.off).toHaveBeenCalledTimes(1);
  });

  it('refreshes the terminal profiles for host changes, not plugin settings commits', async () => {
    changedClient.onChanged.mockClear();
    changedClient.list.mockClear();
    const stop = appShellList().subscribe(() => undefined);
    await vi.dynamicImportSettled();
    await turns();
    const change = changedClient.onChanged.mock.calls[0]![0];
    changedClient.list.mockClear();
    change({ kind: 'plugin', pluginId: 'terminal' });
    await turns();
    expect(changedClient.list).not.toHaveBeenCalled();
    change({ kind: 'host' });
    await turns();
    expect(changedClient.list).toHaveBeenCalledTimes(1);
    stop();
  });

  it('asks the host once more when it starts listening to the settings: a change made before that is not replayed', async () => {
    changedClient.onChanged.mockClear();
    changedClient.list.mockClear();
    const stop = appShellList().subscribe(() => undefined);
    await vi.dynamicImportSettled();
    await turns();
    expect(changedClient.onChanged).toHaveBeenCalledTimes(1);
    expect(changedClient.list).toHaveBeenCalledTimes(2);
    stop();
  });
});
