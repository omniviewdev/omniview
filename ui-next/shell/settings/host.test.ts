import { afterEach, describe, expect, it, vi, type Mock } from 'vitest';
import { deferred } from '../core/fields/testing';
import { createSettingsControl, type SurfaceModule } from './host';
import { fakeHost, fakeSession } from './model/testing';
import type { SettingsClient } from './model/types';

// The control is the part of Settings that is always loaded: whether the sheet is open, the page it was last on, and the loading of everything else. A closed sheet is a store that holds nothing, so that the
// code of the sheet (the adapter, the session, the parts it draws) can be a chunk the window fetches when somebody asks for it.

const flush = async (): Promise<void> => {
  for (let round = 0; round < 8; round += 1) {
    await Promise.resolve();
  }
};

type Rig = { readonly module: SurfaceModule; readonly sessions: Array<{ readonly client: SettingsClient | undefined; readonly dispose: Mock<() => void> }> };

function moduleOf(): Rig {
  const sessions: Rig['sessions'] = [];
  const module: SurfaceModule = {
    Surface: () => null,
    createSession: (client) => {
      const dispose = vi.fn();
      sessions.push({ client, dispose });
      return fakeSession(dispose);
    },
  };
  return { module, sessions };
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('a control that has not been asked', () => {
  it('is closed, holds nothing, and has not loaded anything', () => {
    const load = vi.fn();
    const control = createSettingsControl({ load });
    expect(control.getSnapshot()).toEqual({ open: false });
    expect(load).not.toHaveBeenCalled();
  });
});

describe('where there are native windows', () => {
  it('asks the host for its Settings window and draws no sheet: the control says so', async () => {
    const { module } = moduleOf();
    const load = vi.fn(async () => module);
    const openWindow = vi.fn(async () => undefined);
    const control = createSettingsControl({ load, openWindow });
    expect(control.mode).toBe('window');
    control.open();
    await flush();
    expect(openWindow).toHaveBeenCalledTimes(1);
    expect(load).not.toHaveBeenCalled();
    expect(control.getSnapshot()).toEqual({ open: false });
    control.open();
    await flush();
    expect(openWindow).toHaveBeenCalledTimes(2);
  });

  it('leaves the person with the sheet when the host cannot show its window, and says why', async () => {
    const { module } = moduleOf();
    const load = vi.fn(async () => module);
    const failure = new Error('no window');
    const onError = vi.fn();
    const control = createSettingsControl({ load, openWindow: async () => Promise.reject(failure), onError });
    control.open();
    await flush();
    expect(onError).toHaveBeenCalledWith(failure);
    expect(control.getSnapshot().open).toBe(true);
  });

  it('is a sheet where there is no window to ask', () => {
    expect(createSettingsControl({ load: vi.fn() }).mode).toBe('sheet');
  });
});

describe('open', () => {
  it('loads the sheet\'s code once, and the sheet is open when it has arrived, with a session made for it', async () => {
    const { module, sessions } = moduleOf();
    const loading = deferred<SurfaceModule>();
    const load = vi.fn(async () => loading.promise);
    const { client } = fakeHost();
    const control = createSettingsControl({ load, client });
    const heard = vi.fn();
    control.subscribe(heard);
    control.open();
    expect(load).toHaveBeenCalledTimes(1);
    expect(control.getSnapshot().open).toBe(false);
    loading.resolve(module);
    await flush();
    const state = control.getSnapshot();
    expect(state.open).toBe(true);
    expect(state.open ? state.module : undefined).toBe(module);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.client).toBe(client);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('is asked twice and opens once: while it loads, and while it is open', async () => {
    const { module, sessions } = moduleOf();
    const load = vi.fn(async () => module);
    const control = createSettingsControl({ load });
    control.open();
    control.open();
    await flush();
    control.open();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
    expect(sessions).toHaveLength(1);
  });

  it('keeps the code it loaded: a second opening does not fetch it again', async () => {
    const { module } = moduleOf();
    const load = vi.fn(async () => module);
    const control = createSettingsControl({ load });
    control.open();
    await flush();
    control.close();
    control.open();
    await flush();
    expect(control.getSnapshot().open).toBe(true);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('stays closed and says why when the code cannot be loaded, and can be asked again', async () => {
    const { module } = moduleOf();
    const onError = vi.fn();
    const load = vi.fn<() => Promise<SurfaceModule>>().mockRejectedValueOnce(new Error('offline')).mockResolvedValue(module);
    const control = createSettingsControl({ load, onError });
    control.open();
    await flush();
    expect(control.getSnapshot().open).toBe(false);
    expect(onError).toHaveBeenCalledTimes(1);
    control.open();
    await flush();
    expect(control.getSnapshot().open).toBe(true);
  });
});

describe('close', () => {
  it('closes the sheet, disposes its session, and tells the people who watch, once', async () => {
    const { module, sessions } = moduleOf();
    const control = createSettingsControl({ load: async () => module });
    control.open();
    await flush();
    const heard = vi.fn();
    control.subscribe(heard);
    control.close();
    expect(control.getSnapshot()).toEqual({ open: false });
    expect(sessions[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    control.close();
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('while the code is still loading, cancels the opening: it does not open when it arrives', async () => {
    const { module, sessions } = moduleOf();
    const loading = deferred<SurfaceModule>();
    const control = createSettingsControl({ load: async () => loading.promise });
    control.open();
    control.close();
    loading.resolve(module);
    await flush();
    expect(control.getSnapshot().open).toBe(false);
    expect(sessions).toHaveLength(0);
  });
});

describe('the page it was last on', () => {
  it('is remembered for the window\'s life, so that Settings opens where it was left', async () => {
    const { module } = moduleOf();
    const control = createSettingsControl({ load: async () => module });
    expect(control.page.get()).toBeUndefined();
    control.open();
    await flush();
    control.page.set('terminal');
    control.close();
    control.open();
    await flush();
    expect(control.page.get()).toBe('terminal');
  });
});

describe('where the focus goes', () => {
  it('comes back to the element that had it when Settings was asked for, once the sheet has gone', async () => {
    const { module } = moduleOf();
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const control = createSettingsControl({ load: async () => module });
    control.open();
    await flush();
    // The sheet took the focus into itself, as a modal dialog does.
    const inside = document.createElement('input');
    document.body.append(inside);
    inside.focus();
    inside.remove();
    control.close();
    await flush();
    expect(document.activeElement).toBe(opener);
  });

  it('goes to the page when that element is gone: an action never leaves the focus on the body', async () => {
    const { module } = moduleOf();
    const page = document.createElement('main');
    page.tabIndex = -1;
    page.dataset.shellRegion = 'island';
    page.dataset.shellFocus = '';
    document.body.append(page);
    const opener = document.createElement('button');
    document.body.append(opener);
    opener.focus();
    const control = createSettingsControl({ load: async () => module });
    control.open();
    await flush();
    opener.remove();
    control.close();
    await flush();
    expect(document.activeElement).toBe(page);
  });

  it('is left where it was sent when something else took it while the sheet was closing', async () => {
    const { module } = moduleOf();
    const opener = document.createElement('button');
    const elsewhere = document.createElement('button');
    document.body.append(opener, elsewhere);
    opener.focus();
    const control = createSettingsControl({ load: async () => module });
    control.open();
    await flush();
    control.close();
    elsewhere.focus();
    await flush();
    expect(document.activeElement).toBe(elsewhere);
  });
});
