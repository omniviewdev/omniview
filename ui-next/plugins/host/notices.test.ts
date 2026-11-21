import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTabsStore } from '../../shell';
import type { FrameV1, PaletteCommandV1 } from '../contract/v1';
import { acme } from '../testing';
import { createContributions, type PluginSource } from './contributions';
import { createHostNotices, failureNotice, type HostNotices } from './notices';
import { createHostPalette, type HostPalette } from './palette';
import type { PluginEntry } from './pluginStore';
import { Published } from './published';

// What the host does with the failure of a plugin's page command (ch16 S75, S77, S78, S85, S89a; docs/ui-next/status/E0-1.md): the command fails with the host's `apperror`, and the person gets a toast made of the
// class's words and the plugin's one sentence, whose Retry asks the same command again. The palette is NOT a source (S85: never a toast for palette feedback), and while it is open it holds the stack back (S89a).
// Built over the real tab model, the real palette and the real notices model; the plugin is invented (West) and fails with what the runtime's hooks throw: the envelope, as a `RuntimeError` whose message is its JSON.

/** The envelope as the host sends it (`apperror.AppError`, the eight of E0-1). */
const envelope = (code: string, type: string, title: string, status: number, detail: string) => ({ type, title, status, detail, code, requestId: '5b8c2f6e-7a43-4e0a-9d1f-0c7a1d2e3f40', recovery: 'none' });
const TIMEOUT = envelope('TIMEOUT', 'omniview:resource/timeout', 'Timed out', 408, 'The cluster did not complete the request in time.');
const FORBIDDEN = envelope('FORBIDDEN', 'omniview:resource/forbidden', 'Access denied', 403, 'The operation is not permitted.');

/** What Wails gives the page: an error whose `message` is the envelope's JSON and whose `cause` is the same object. */
const wails = (body: Readonly<Record<string, unknown>>): Error => Object.assign(new Error(JSON.stringify(body)), { cause: body });

type World = {
  readonly notices: HostNotices;
  readonly palette: HostPalette;
  /** What the tab model opened. */
  readonly opened: () => number;
  readonly set: (next: readonly PluginEntry[]) => void;
  readonly stop: () => void;
};

const west = (commands: Record<string, PaletteCommandV1> = {}): PluginEntry => ({
  id: 'west',
  name: 'West plugin',
  phase: 'ready',
  contribution: acme({
    plugin: { name: 'West' },
    palette: {
      providers: { things: { kind: 'match', section: 'Things', filter: 'commands', match: () => [{ id: 'c1', label: 'Fail on purpose', icon: 'refresh', command: { id: 'fail' } }] } },
      commands,
    },
  }),
});

function build(entry: PluginEntry = west()): World {
  let entries: readonly PluginEntry[] = [entry];
  const heard = new Set<() => void>();
  const plugins: PluginSource = {
    getSnapshot: () => entries,
    subscribe: (listener) => {
      heard.add(listener);
      return () => {
        heard.delete(listener);
      };
    },
  };
  const contributions = createContributions({ plugins, frames: new Published<FrameV1>() });
  const tabs = createTabsStore({ contributions });
  const notices = createHostNotices({ tabs, plugins, contributions, platform: 'other' });
  const palette = createHostPalette({ tabs, plugins, contributions, nodes: new Published(), panel: undefined, platform: 'other', onCloseWindow: undefined });
  const stops = [palette.attach(), notices.attach({ subscribe: palette.store.subscribe, open: () => palette.store.getSnapshot().open })];
  return {
    notices,
    palette,
    opened: () => tabs.getSnapshot().order.length,
    set: (next) => {
      entries = next;
      for (const listener of [...heard]) {
        listener();
      }
    },
    stop: () => {
      for (const stop of stops) {
        stop();
      }
    },
  };
}

const toastOf = (w: World) => w.notices.store.getSnapshot().toasts.items[0];
const retry = () => vi.fn<() => void>();

beforeEach(() => {
  vi.useFakeTimers();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('a command of a page that fails with the host\'s error', () => {
  it('is a failure toast of that plugin: the class\'s title and the plugin\'s one sentence, sticky, and an alert (E0-1: title the class\'s, detail the sentence)', () => {
    const w = build();
    failureNotice(w.notices.store, 'west', wails(TIMEOUT), retry());
    const toast = toastOf(w);
    expect(toast).toMatchObject({ sticky: true, urgent: true });
    expect(toast?.record).toMatchObject({ source: 'west', sourceName: 'West', severity: 'error', kind: 'message', title: 'Timed out', text: 'The cluster did not complete the request in time.', urgent: true });
    expect(w.notices.store.getSnapshot().recent[0]?.details).toContain('Code: TIMEOUT');
    w.stop();
  });

  it('keeps the host\'s own words for a class the host words itself (FORBIDDEN), whatever the plugin said', () => {
    const w = build();
    failureNotice(w.notices.store, 'west', wails(FORBIDDEN), retry());
    expect(toastOf(w)?.record).toMatchObject({ title: 'Access denied', text: 'The operation is not permitted.' });
    w.stop();
  });

  it('is a generic failure that shows none of its text when it is not the host\'s envelope: raw text is never chrome', () => {
    const w = build();
    failureNotice(w.notices.store, 'west', new Error('connect ECONNREFUSED 10.0.0.5:5432 password=hunter2'), retry());
    expect(toastOf(w)?.record).toMatchObject({ title: 'Operation failed', text: 'The operation could not be completed.' });
    expect(JSON.stringify(w.notices.store.getSnapshot())).not.toContain('hunter2');
    w.stop();
  });

  it('is no notice when it was a cancellation', () => {
    const w = build();
    failureNotice(w.notices.store, 'west', new DOMException('The operation was aborted.', 'AbortError'), retry());
    expect(w.notices.store.getSnapshot().recent).toEqual([]);
    w.stop();
  });

  it('is told once in the console: the plugin\'s own error is for its author', () => {
    const w = build();
    failureNotice(w.notices.store, 'west', wails(TIMEOUT), retry());
    expect(console.error).toHaveBeenCalledTimes(1);
    w.stop();
  });

  it('folds a failure that happens again into the one toast, with its count (S82)', () => {
    const w = build();
    for (let times = 0; times < 3; times += 1) {
      failureNotice(w.notices.store, 'west', wails(TIMEOUT), retry());
    }

    expect(w.notices.store.getSnapshot().toasts.items).toHaveLength(1);
    expect(toastOf(w)?.record).toMatchObject({ title: 'Timed out 3 times', count: 3 });
    w.stop();
  });
});

describe('the Retry of that toast', () => {
  it('is the one primary button, drawn with the verb\'s glyph, and runs the command again: acting drops the toast', () => {
    const again = retry();
    const w = build();
    failureNotice(w.notices.store, 'west', wails(TIMEOUT), again);
    const record = toastOf(w)?.record;
    expect(record?.actions.map((action) => [action.label, action.variant, action.icon, action.disabled])).toEqual([['Retry', 'primary', 'refresh', '']]);
    expect(w.notices.store.run(record?.id ?? '', 'again')).toMatchObject({ status: 'done' });
    expect(again).toHaveBeenCalledTimes(1);
    expect(w.notices.store.getSnapshot().toasts.items).toEqual([]);
    w.stop();
  });

  it('puts the toast back with a count when the command fails again: one toast, "Timed out 2 times", not two', () => {
    const w = build();
    const again = vi.fn(() => {
      failureNotice(w.notices.store, 'west', wails(TIMEOUT), again);
    });
    failureNotice(w.notices.store, 'west', wails(TIMEOUT), again);
    w.notices.store.run(toastOf(w)?.record?.id ?? '', 'again');
    expect(again).toHaveBeenCalledTimes(1);
    expect(w.notices.store.getSnapshot().toasts.items).toHaveLength(1);
    expect(toastOf(w)?.record).toMatchObject({ title: 'Timed out 2 times', count: 2 });
    w.stop();
  });

  it('is unavailable, and so no button, once the plugin has left: its reason is in the toast', () => {
    const w = build();
    failureNotice(w.notices.store, 'west', wails(TIMEOUT), retry());
    w.set([]);
    const record = toastOf(w)?.record;
    expect(record?.actions[0]).toMatchObject({ label: 'Retry' });
    expect(record?.actions[0]?.disabled).not.toBe('');
    expect(record?.reason).toMatch(/^Retry is unavailable\./);
    w.stop();
  });
});

describe('the palette is not a source (S85) and is a modal (S89a)', () => {
  const failing = (): PaletteCommandV1['run'] => () => {
    throw wails(TIMEOUT);
  };

  /** Runs the plugin's failing command from the palette, the way a person does. */
  function run(w: World): void {
    w.palette.store.open({ kind: 'commands' });
    w.palette.store.setQuery('fail on purpose');
    w.palette.store.activate(w.palette.store.getSnapshot().rows[0]?.id);
  }

  it('makes no toast of a command that fails in it: the palette says "This command failed." in its status line, in the host\'s words, and stays open', () => {
    const w = build(west({ fail: { run: failing() } }));
    run(w);
    expect(w.palette.store.getSnapshot().open).toBe(true);
    expect(JSON.stringify(w.palette.store.getSnapshot())).toContain('This command failed.');
    expect(JSON.stringify(w.palette.store.getSnapshot())).not.toContain('The cluster did not complete the request in time.');
    w.palette.store.close();
    expect(w.notices.store.getSnapshot().recent).toEqual([]);
    expect(w.notices.store.getSnapshot().toasts.items).toEqual([]);
    w.stop();
  });

  it('suspends the stack while it is open, and gives it back when it closes: a toast is never drawn over a dialog', () => {
    const w = build();
    failureNotice(w.notices.store, 'west', wails(TIMEOUT), retry());
    expect(w.notices.store.getSnapshot().toasts.items).toHaveLength(1);
    w.palette.store.open({});
    expect(w.notices.store.getSnapshot().toasts).toMatchObject({ suspended: true, items: [] });
    w.palette.store.close();
    expect(w.notices.store.getSnapshot().toasts.suspended).toBe(false);
    expect(toastOf(w)?.record).toMatchObject({ title: 'Timed out' });
    w.stop();
  });

  it('lets the stack go on when the window goes while the palette is open', () => {
    const w = build();
    w.palette.store.open({});
    expect(w.notices.store.getSnapshot().toasts.suspended).toBe(true);
    w.stop();
    expect(w.notices.store.getSnapshot().toasts.suspended).toBe(false);
  });
});

describe('an action that opens a page', () => {
  const page = { plugin: 'west', contribution: 'widgets', params: {} };

  it('is a button that opens the page through the tab model, and a warning that carries it stays until the user acts (S77)', () => {
    const w = build();
    w.notices.store.forSource('west').notify({ title: 'Quota is close', severity: 'warning', actions: [{ id: 'go', label: 'Open widgets', route: page }] });
    expect(toastOf(w)).toMatchObject({ sticky: true });
    expect(toastOf(w)?.record?.actions[0]).toMatchObject({ label: 'Open widgets', disabled: '' });
    expect(w.notices.store.run(toastOf(w)?.record?.id ?? '', 'go')).toMatchObject({ status: 'done' });
    expect(w.opened()).toBe(1);
    w.stop();
  });

  it('is no button for a plugin that is not there: the page says why in words, and the warning closes by itself (nothing to act on)', () => {
    const w = build();
    w.notices.store.forSource('west').notify({ title: 'Quota is close', severity: 'warning', actions: [{ id: 'go', label: 'Open gadgets', route: { plugin: 'nowhere', contribution: 'gadgets', params: {} } }] });
    const toast = toastOf(w);
    expect(toast).toMatchObject({ sticky: false });
    expect(toast?.record?.actions[0]?.disabled).not.toBe('');
    expect(toast?.record?.reason).toMatch(/^Open gadgets is unavailable\./);
    w.stop();
  });
});

describe('what the host hands the shell', () => {
  it('has a store, the window\'s live regions, and no notification centre yet: the summary toast has no Show', () => {
    const w = build();
    expect(typeof w.notices.store.getSnapshot).toBe('function');
    expect(typeof w.notices.announcer.announce).toBe('function');
    expect(w.notices.centre).toBeFalsy();
    w.stop();
  });

  it('says a plugin by its name in what it folds, and the host as Omniview', () => {
    const w = build();
    const plugin = w.notices.store.forSource('west');
    for (let index = 0; index < 3; index += 1) {
      plugin.notify({ title: `Thing ${String(index)}`, group: 'things', severity: 'warning' });
    }

    expect(w.notices.store.getSnapshot().recent[0]).toMatchObject({ title: '3 notifications from West' });
    expect(w.notices.store.notify({ title: 'Hello' }).record).toMatchObject({ sourceName: 'Omniview' });
    w.stop();
  });
});
