import { describe, expect, it, vi } from 'vitest';
import type { HostSnapshot } from '../../settings/model/types';
import { DEFAULT_PREFERENCES, createTerminalPreferences, preferencesOf, sanitiseFontFamily, type PreferencesSourceOptions } from './preferences';

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
      snapshotOf({ fontFamily: '"Fira Code", monospace', fontSize: 15, lineHeight: 1.2, scrollback: 20_000, cursorStyle: 'bar', cursorBlink: true, cursorBlinkNext: false, macOptionIsMeta: 'on', bell: 'off', gpuAcceleration: 'off', copyOnSelect: true, multiLinePasteWarning: 'always' }),
    );
    expect(read).toEqual({ fontFamily: '"Fira Code", monospace', fontSize: 15, lineHeight: 1.2, scrollback: 20_000, cursorStyle: 'bar', cursorBlink: false, macOptionIsMeta: 'on', bell: 'off', gpuAcceleration: 'off', copyOnSelect: true, multiLinePasteWarning: 'always' });
    expect(preferencesOf(snapshotOf({ cursorBlink: false, cursorBlinkNext: true })).cursorBlink).toBe(true);
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

  it('never lets a font family carry anything but names: a semicolon, a url(), a brace or a line break is the theme\'s face', () => {
    for (const bad of ['a; color: red', 'url(https://evil.example/f.woff2)', 'Menlo, url(x)', 'a{b}', '"unterminated', 'a\nb', 'a\\b', 'x'.repeat(257), 'a,,b']) {
      expect(sanitiseFontFamily(bad), bad).toBe('');
      expect(preferencesOf(snapshotOf({ fontFamily: bad })).fontFamily, bad).toBe('');
    }

    expect(sanitiseFontFamily('  JetBrains Mono ,  Menlo ')).toBe('JetBrains Mono, Menlo');
    expect(sanitiseFontFamily('"Fira Code", monospace')).toBe('"Fira Code", monospace');
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
    expect(preferences.getSnapshot()).toMatchObject({ fontSize: 22, fontFamily: 'Menlo' });
    // Asking again is not asking the host again.
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
