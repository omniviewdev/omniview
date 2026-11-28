import { describe, expect, it, vi } from 'vitest';
import type { HostSnapshot, SettingsClient, SettingsScope } from '../../settings/model/types';
import { DEFAULT_PREFERENCES, appTerminalPreferences, canonicalFontFamily, createTerminalPreferences, preferencesOf, sanitiseFontFamily, type PreferencesSourceOptions } from './preferences';

// The terminal's settings as the page reads them (#697 step 1). The host declares and validates them (`internal/settings/terminal.go`); the page reads what the host's snapshot says as a value inside the
// producer's bounds, whatever it was sent, and keeps it for as long as something listens: a change is one event and one question of the host, and the same object comes back when nothing the terminal reads moved.

const snapshotOf = (values: Record<string, unknown>): HostSnapshot => ({
  categories: {
    terminal: {
      id: 'terminal',
      label: 'Terminal',
      description: '',
      icon: '',
      settings: Object.fromEntries(Object.entries(values).map(([id, value]) => [id, { id, label: id, description: '', type: 'text', value, default: null }])),
    },
  },
});

describe('what the page reads of the snapshot', () => {
  it('is the default of each setting when the host says nothing of it', () => {
    expect(preferencesOf({ categories: {} })).toEqual(DEFAULT_PREFERENCES);
    expect(preferencesOf(undefined)).toEqual(DEFAULT_PREFERENCES);
    expect(preferencesOf(snapshotOf({}))).toEqual(DEFAULT_PREFERENCES);
  });

  it('has the declared defaults, and the new tool\'s cursor does not blink', () => {
    expect(DEFAULT_PREFERENCES).toEqual({
      fontFamily: '',
      fontSize: 12,
      lineHeight: 1.5,
      scrollback: 5000,
      cursorStyle: 'block',
      cursorBlink: false,
      macOptionIsMeta: 'auto',
      bell: 'visual',
      gpuAcceleration: 'auto',
      copyOnSelect: false,
      multiLinePasteWarning: 'auto',
    });
  });

  it('is every value the host holds, and cursorBlink is read from the new tool\'s own key, never from the legacy one', () => {
    const read = preferencesOf(
      snapshotOf({ fontFamily: '"Fira Code", monospace', fontSize: 15, lineHeight: 1.2, scrollback: 20_000, cursorStyle: 'bar', cursorBlink: true, blinkingCursor: false, macOptionIsMeta: 'on', bell: 'off', gpuAcceleration: 'off', copyOnSelect: true, multiLinePasteWarning: 'always' }),
    );
    expect(read).toEqual({ fontFamily: '"Fira Code", monospace', fontSize: 15, lineHeight: 1.2, scrollback: 20_000, cursorStyle: 'bar', cursorBlink: false, macOptionIsMeta: 'on', bell: 'off', gpuAcceleration: 'off', copyOnSelect: true, multiLinePasteWarning: 'always' });
    expect(preferencesOf(snapshotOf({ cursorBlink: false, blinkingCursor: true })).cursorBlink).toBe(true);
  });

  it('holds a value to the producer\'s bounds even when the host sent one outside them (a file edited by hand, an older host)', () => {
    const read = preferencesOf(snapshotOf({ fontSize: 1000, lineHeight: 0, scrollback: 1_000_000_000, cursorStyle: 'beam', macOptionIsMeta: 'yes', bell: 'audible', gpuAcceleration: 1, copyOnSelect: 'true', multiLinePasteWarning: 'ask' }));
    expect(read).toEqual(DEFAULT_PREFERENCES);
    expect(preferencesOf(snapshotOf({ fontSize: 5 })).fontSize).toBe(12);
    expect(preferencesOf(snapshotOf({ fontSize: 72 })).fontSize).toBe(72);
    expect(preferencesOf(snapshotOf({ fontSize: 6.5 })).fontSize).toBe(12);
    expect(preferencesOf(snapshotOf({ lineHeight: 100 })).lineHeight).toBe(1.5);
    expect(preferencesOf(snapshotOf({ lineHeight: 2 })).lineHeight).toBe(2);
    expect(preferencesOf(snapshotOf({ lineHeight: 1 })).lineHeight).toBe(1);
    expect(preferencesOf(snapshotOf({ lineHeight: Number.NaN })).lineHeight).toBe(1.5);
    expect(preferencesOf(snapshotOf({ scrollback: 100_000 })).scrollback).toBe(100_000);
    expect(preferencesOf(snapshotOf({ scrollback: 0 })).scrollback).toBe(0);
    expect(preferencesOf(snapshotOf({ scrollback: -1 })).scrollback).toBe(5000);
    expect(preferencesOf(snapshotOf({ scrollback: Number.POSITIVE_INFINITY })).scrollback).toBe(5000);
  });

  it('writes every name that is not a generic family in quotes: a name that is not a CSS identifier (0xProto, 3270 Nerd Font) is no font unquoted, and the font load throws a SyntaxError', () => {
    expect(sanitiseFontFamily('0xProto')).toBe('"0xProto"');
    expect(sanitiseFontFamily('3270 Nerd Font, monospace')).toBe('"3270 Nerd Font", monospace');
    expect(sanitiseFontFamily('Menlo, 0xProto, ui-monospace')).toBe('"Menlo", "0xProto", ui-monospace');
    // What the browser makes of it: the list is a font the canvas takes.
    const context = document.createElement('canvas').getContext('2d');
    if (context !== null) {
      for (const text of ['0xProto', '3270 Nerd Font', 'Fira Code, monospace']) {
        expect(CSS.supports('font-family', sanitiseFontFamily(text))).toBe(true);
      }
    }
  });

  it('refuses the CSS-wide keywords and default, bare or quoted, in any case: unquoted they make the whole font list invalid', () => {
    for (const word of ['inherit', 'initial', 'unset', 'revert', 'revert-layer', 'default', 'Inherit', '"initial"', 'Menlo, inherit']) {
      expect(sanitiseFontFamily(word), word).toBe('');
    }
  });

  it('keeps a list the host accepted at 255 characters after quoting makes it longer: the length limit is the raw input\'s, and the canonical form is not held to it again', () => {
    const raw = `Menlo, ${'A'.repeat(237)}, monospace`;
    expect(raw).toHaveLength(255);
    const canonical = sanitiseFontFamily(raw);
    expect(canonical.length).toBeGreaterThan(256);
    expect(canonicalFontFamily(canonical)).toBe(canonical);
    expect(canonicalFontFamily('a; color: red')).toBe('');
    expect(sanitiseFontFamily('A'.repeat(257))).toBe('');
  });

  it('never lets a font family carry anything but names: a semicolon, a url(), a brace or a line break is the theme\'s face', () => {
    for (const bad of ['a; color: red', 'url(https://evil.example/f.woff2)', 'Menlo, url(x)', 'a{b}', '"unterminated', 'a\nb', 'a\\b', 'x'.repeat(257), 'a,,b']) {
      expect(sanitiseFontFamily(bad), bad).toBe('');
      expect(preferencesOf(snapshotOf({ fontFamily: bad })).fontFamily, bad).toBe('');
    }

    expect(sanitiseFontFamily('  JetBrains Mono ,  Menlo ')).toBe('"JetBrains Mono", "Menlo"');
    expect(sanitiseFontFamily('"Fira Code", monospace')).toBe('"Fira Code", monospace');
    expect(sanitiseFontFamily('\'Fira Code\', Monospace')).toBe('"Fira Code", monospace');
    expect(sanitiseFontFamily(42)).toBe('');
  });
});

/** A host the test holds: its snapshot is `values`, a change event is `changed()`, and every question of it is counted. */
function rig(initial: Record<string, unknown> = {}, extra: Partial<PreferencesSourceOptions> = {}) {
  let values = initial;
  const snapshot = vi.fn(async () => Promise.resolve(snapshotOf(values)));
  const listeners = new Set<() => void>();
  const stops = vi.fn();
  const warn = vi.fn();
  const preferences = createTerminalPreferences({
    snapshot,
    onChanged: (listener) => {
      listeners.add(listener);
      return () => {
        stops();
        listeners.delete(listener);
      };
    },
    warn,
    ...extra,
  });
  return {
    preferences,
    snapshot,
    warn,
    stops,
    listeners,
    set: (next: Record<string, unknown>) => {
      values = next;
    },
    changed: () => {
      listeners.forEach((listener) => {
        listener();
      });
    },
  };
}

const turns = async () => {
  for (let i = 0; i < 6; i += 1) {
    await Promise.resolve();
  }
};

describe('the store the screens read', () => {
  it('holds the defaults, asks nothing and listens to nothing until someone does', async () => {
    const { preferences, snapshot, listeners } = rig({ fontSize: 20 });
    await turns();
    expect(preferences.getSnapshot()).toEqual(DEFAULT_PREFERENCES);
    expect(snapshot).not.toHaveBeenCalled();
    expect(listeners.size).toBe(0);
  });

  it('asks the host once when the first listener comes, and tells it when the answer is in', async () => {
    const { preferences, snapshot, listeners } = rig({ fontSize: 20 });
    const heard = vi.fn();
    preferences.subscribe(heard);
    preferences.subscribe(vi.fn());
    expect(listeners.size).toBe(1);
    await turns();
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(preferences.getSnapshot().fontSize).toBe(20);
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('is one question and one notification for one change event, and the object a terminal holds is the same until a value it reads moved', async () => {
    const { preferences, snapshot, set, changed } = rig({ fontSize: 14 });
    const heard = vi.fn();
    preferences.subscribe(heard);
    await turns();
    const before = preferences.getSnapshot();
    heard.mockClear();
    snapshot.mockClear();

    set({ fontSize: 16 });
    changed();
    await turns();
    expect(snapshot).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(preferences.getSnapshot()).not.toBe(before);
    expect(preferences.getSnapshot().fontSize).toBe(16);

    // A change of something the terminal does not read: asked, and nobody told.
    const held = preferences.getSnapshot();
    heard.mockClear();
    set({ fontSize: 16, theme: 'nord' });
    changed();
    await turns();
    expect(snapshot).toHaveBeenCalledTimes(2);
    expect(heard).not.toHaveBeenCalled();
    expect(preferences.getSnapshot()).toBe(held);
  });

  it('takes the answers in the order they were asked: an earlier answer that comes late is dropped', async () => {
    const gates: Array<(value: HostSnapshot) => void> = [];
    const { preferences, changed } = rig({}, {
      snapshot: async () =>
        new Promise<HostSnapshot>((resolve) => {
          gates.push(resolve);
        }),
    });
    preferences.subscribe(vi.fn());
    changed();
    expect(gates).toHaveLength(2);
    gates[1]?.(snapshotOf({ fontSize: 18 }));
    await turns();
    gates[0]?.(snapshotOf({ fontSize: 9 }));
    await turns();
    expect(preferences.getSnapshot().fontSize).toBe(18);
  });

  it('lets go of the host\'s event when the last listener leaves, and asks again when one comes (the host replays nothing)', async () => {
    const { preferences, snapshot, stops, listeners } = rig({ fontSize: 14 });
    const stop = preferences.subscribe(vi.fn());
    await turns();
    stop();
    expect(stops).toHaveBeenCalledTimes(1);
    expect(listeners.size).toBe(0);
    preferences.subscribe(vi.fn());
    await turns();
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it('says once that the host could not answer, keeps what it had, and settles all the same', async () => {
    const { preferences, warn } = rig({}, {
      snapshot: async () => {
        throw new Error('down');
      },
    });
    preferences.subscribe(vi.fn());
    await preferences.settled();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(preferences.getSnapshot()).toEqual(DEFAULT_PREFERENCES);
  });

  it('settles when the host has answered the first time, so a terminal is made in the person\'s settings and not in the defaults', async () => {
    const { preferences, snapshot } = rig({ fontSize: 22, fontFamily: 'Menlo' });
    let settled = false;
    const waiting = preferences.settled().then(() => {
      settled = true;
    });
    expect(snapshot).toHaveBeenCalledTimes(1);
    await waiting;
    expect(settled).toBe(true);
    expect(preferences.getSnapshot()).toMatchObject({ fontSize: 22, fontFamily: '"Menlo"' });
  });

  it('asks the host again for the next terminal when the last one was closed: the host replays nothing, so what is held is stale (a scrollback and a font changed meanwhile)', async () => {
    const { preferences, snapshot, set } = rig({ scrollback: 5000, fontFamily: 'Menlo' });
    const stop = preferences.subscribe(vi.fn());
    await preferences.settled();
    expect(preferences.getSnapshot()).toMatchObject({ scrollback: 5000, fontFamily: '"Menlo"' });
    stop();

    set({ scrollback: 20_000, fontFamily: 'Courier New' });
    await preferences.settled();
    expect(preferences.getSnapshot()).toMatchObject({ scrollback: 20_000, fontFamily: '"Courier New"' });
    expect(snapshot).toHaveBeenCalledTimes(2);
  });

  it('does not ask again for a terminal made while another lives: the host\'s events keep the snapshot current', async () => {
    const { preferences, snapshot } = rig({ fontSize: 22 });
    preferences.subscribe(vi.fn());
    await preferences.settled();
    await preferences.settled();
    expect(snapshot).toHaveBeenCalledTimes(1);
  });

  it('does not hold a terminal for a host that does not answer: it settles after a second and a half, and the answer that comes later is still taken', async () => {
    vi.useFakeTimers();
    try {
      const gate = Promise.withResolvers<HostSnapshot>();
      const { preferences } = rig({}, { snapshot: async () => gate.promise });
      let settled = false;
      void preferences.settled().then(() => {
        settled = true;
      });
      await vi.advanceTimersByTimeAsync(1_499);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(2);
      expect(settled).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      preferences.subscribe(vi.fn());
      gate.resolve(snapshotOf({ fontSize: 30 }));
      await vi.advanceTimersByTimeAsync(0);
      expect(preferences.getSnapshot().fontSize).toBe(30);
    } finally {
      vi.useRealTimers();
    }
  });

  it('waits for the newest question when several terminals ask before anyone listens: an older answer that is dropped does not release them', async () => {
    const gates: Array<(value: HostSnapshot) => void> = [];
    const { preferences } = rig({}, {
      snapshot: async () =>
        new Promise<HostSnapshot>((resolve) => {
          gates.push(resolve);
        }),
    });
    const first = preferences.settled();
    const second = preferences.settled();
    expect(gates).toHaveLength(2);
    let released = 0;
    void first.then(() => {
      released += 1;
    });
    void second.then(() => {
      released += 1;
    });
    gates[0]?.(snapshotOf({ scrollback: 20_000 }));
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 0);
    });
    expect(released).toBe(0);
    gates[1]?.(snapshotOf({ scrollback: 20_000 }));
    await Promise.all([first, second]);
    preferences.subscribe(vi.fn());
    expect(preferences.getSnapshot().scrollback).toBe(20_000);
  });

  it('asks again when the events connection comes back, while someone listens', async () => {
    let back: (() => void) | undefined;
    const { preferences, snapshot } = rig({}, {
      onReconnect: (listener) => {
        back = listener;
        return () => {
          back = undefined;
        };
      },
    });
    preferences.subscribe(vi.fn());
    await turns();
    back?.();
    await turns();
    expect(snapshot).toHaveBeenCalledTimes(2);
  });
});

// The app's store loads the settings client as a lazy chunk when the first question comes. A chunk that cannot load is a warning of the page, and never an unhandled rejection that leaves the host's events unregistered.
describe('the app\'s store when the settings chunk cannot load', () => {
  it('warns for a registration it could not make and raises nothing unhandled', async () => {
    vi.resetModules();
    let loads = 0;
    vi.doMock('../../settings/runtime', () => {
      loads += 1;
      throw new Error('chunk lost');
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const { appTerminalPreferences } = await import('./preferences');
      const store = appTerminalPreferences();
      const stop = store.subscribe(vi.fn());
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
      });
      const listening = warn.mock.calls.filter(([message]) => String(message).includes('could not be listened to'));
      expect(listening.length).toBeGreaterThanOrEqual(1);
      expect(loads).toBeGreaterThanOrEqual(1);
      stop();
    } finally {
      warn.mockRestore();
      vi.doUnmock('../../settings/runtime');
      vi.resetModules();
    }
  });
});

describe('the app\'s store when the settings client cannot be loaded at first', () => {
  const host = (): { client: SettingsClient; emit: (scope: SettingsScope) => void; values: Record<string, unknown>; listeners: () => number } => {
    const heard = new Set<(scope: SettingsScope) => void>();
    const values: Record<string, unknown> = {};
    const client = {
      snapshot: async () => Promise.resolve(snapshotOf(values)),
      onChanged: (listener: (scope: SettingsScope) => void) => {
        heard.add(listener);
        return () => {
          heard.delete(listener);
        };
      },
      onReconnect: () => () => undefined,
    } as unknown as SettingsClient;

    return {
      client,
      emit: (scope) => {
        heard.forEach((listener) => {
          listener(scope);
        });
      },
      values,
      listeners: () => heard.size,
    };
  };

  const quiet = () => vi.spyOn(console, 'warn').mockImplementation(() => undefined);

  it('registers with the host once the client loads, while a terminal is open: it gets the snapshot, and the changes after it, without every terminal closing', async () => {
    const warn = quiet();
    try {
      const { client, emit, values, listeners } = host();
      let attempts = 0;
      const store = appTerminalPreferences(async () => {
        attempts += 1;
        if (attempts === 1) {
          throw new Error('chunk lost');
        }

        return Promise.resolve(client);
      });
      const heard = vi.fn();
      store.subscribe(heard);
      await store.settled();
      expect(listeners()).toBe(0);
      expect(store.getSnapshot()).toEqual(DEFAULT_PREFERENCES);

      // A second terminal asks for the settings while the first is open: the chunk loads now, the registration is made and the snapshot comes.
      values.scrollback = 20_000;
      await store.settled();
      expect(listeners()).toBe(1);
      expect(store.getSnapshot().scrollback).toBe(20_000);
      expect(heard).toHaveBeenCalled();

      values.scrollback = 30_000;
      emit({ kind: 'host' });
      await store.settled();
      expect(store.getSnapshot().scrollback).toBe(30_000);
    } finally {
      warn.mockRestore();
    }
  });

  it('registers once, whatever the number of questions, and not for a plugin\'s scope', async () => {
    const { client, emit, values, listeners } = host();
    const store = appTerminalPreferences(async () => Promise.resolve(client));
    store.subscribe(vi.fn());
    await store.settled();
    await store.settled();
    expect(listeners()).toBe(1);
    values.fontSize = 30;
    emit({ kind: 'plugin', pluginId: 'p' });
    await store.settled();
    expect(store.getSnapshot().fontSize).toBe(12);
  });
});
