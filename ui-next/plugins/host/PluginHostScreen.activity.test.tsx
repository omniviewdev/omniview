import { act, cleanup, render, waitFor } from '@testing-library/react';
import { useSyncExternalStore } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ActivityFeed, ActivityRecordLike, SourceResolver } from '../../shell/panel/activity';
import { activityConditions } from './conditions';
import { PluginHostScreen } from './PluginHostScreen';

// What the screen's tap hands the feed of the Problems and Operations tools (`ActivityTap`): the records the runtime's activity provider holds AND its `unavailable`, the sentence for why it cannot observe the host's activity service
// right now (a subscribe or a heartbeat that failed, and nothing since has made it good). A failed observation holds no record, as an observation of no activity does not, so a tap that handed over the records alone would make the two
// look alike in both tools. The provider's `error` is not that sentence: it is the wider one its toast and its notification center say, and it also holds the failure of a notice that could not be published or of a record that could
// not be opened, which say nothing of whether the service can be observed. The provider is the test's here (it holds what the test says and tells every reader when that changes, as the provider's context does), and the host is the
// component that records the props it was given.

type Held = { readonly records: readonly ActivityRecordLike[]; readonly error: string | undefined; readonly unavailable: string | undefined };

const world = vi.hoisted(() => {
  const listeners = new Set<() => void>();
  let held: { readonly records: readonly unknown[]; readonly error: string | undefined; readonly unavailable: string | undefined } = { records: [], error: undefined, unavailable: undefined };
  return {
    /** What the provider holds now. */
    get: () => held,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set: (next: { readonly records: readonly unknown[]; readonly error: string | undefined; readonly unavailable: string | undefined }) => {
      held = next;
      for (const listener of [...listeners]) {
        listener();
      }
    },
    /** The props the host was given, in order. */
    given: [] as Array<{ readonly activity?: ActivityFeed | undefined }>,
    /** What the inventory says: nothing is installed. */
    inventory: { plugins: [] as readonly unknown[], state: 'ready' as const, retry: () => undefined },
  };
});

vi.mock('@omniviewdev/runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  ActivityProvider: ({ children }: { readonly children: unknown }) => children,
  useActivities: () => useSyncExternalStore(world.subscribe, world.get),
}));

vi.mock('@omniviewdev/runtime/api', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  WindowClient: {
    GetState: async () => Promise.resolve({}),
    SaveState: async () => Promise.resolve(),
    List: async () => Promise.resolve([{ name: 'main' }]),
    OpenSettings: async () => Promise.resolve(),
  },
}));

vi.mock('@omniviewdev/runtime/runtime', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  Window: { Name: async () => Promise.resolve('main'), Close: async () => Promise.resolve() },
  Events: { On: () => () => undefined },
  // eslint-disable-next-line @typescript-eslint/naming-convention -- the runtime names its browser call `OpenURL`
  Browser: { OpenURL: vi.fn() },
}));

vi.mock('./useInstalledPlugins', () => ({ useInstalledPlugins: () => world.inventory }));

vi.mock('./PluginHost', () => ({
  PluginHost: (props: { readonly activity?: ActivityFeed | undefined }) => {
    world.given.push(props);
    return null;
  },
}));

const SENTENCE = 'The activity service did not answer.';
const NOTICE = 'The notice could not be published.';

const record: ActivityRecordLike = {
  id: 'r-1',
  kind: 'alert',
  severity: 'warning',
  createdAt: '2026-11-24T10:00:00Z',
  source: { pluginID: 'alpha' },
  presentation: { title: 'Disk almost full' },
  alert: { key: 'disk', state: 'firing', occurrences: 1 },
  visibility: { read: false },
};

const resolver: SourceResolver = {
  plugin: (id) => ({ id: id ?? 'host', name: id ?? 'Omniview' }),
  connection: () => undefined,
};

afterEach(() => {
  cleanup();
  world.set({ records: [], error: undefined, unavailable: undefined });
  world.given.length = 0;
});

/** The screen drawn over what the provider holds, and the feed the host was given once it was drawn. */
async function drawn(held: Held): Promise<ActivityFeed> {
  world.set(held);
  render(<PluginHostScreen />);
  await waitFor(() => {
    expect(world.given.length).toBeGreaterThan(0);
  });
  const feed = world.given.at(-1)?.activity;
  if (feed === undefined) {
    throw new Error('The host was drawn with no activity feed.');
  }

  return feed;
}

describe('what the screen\'s tap hands the feed of the tools', () => {
  it('is the records the provider holds, and no sentence while it can observe the service', async () => {
    const records = [record];
    const feed = await drawn({ records, error: undefined, unavailable: undefined });
    expect(feed.getSnapshot()).toBe(records);
    expect(feed.getError()).toBeUndefined();
  });

  it('is the provider\'s `unavailable` when the observation failed, beside the records it holds, which are none: the tools can tell a failed read from an empty one', async () => {
    const feed = await drawn({ records: [], error: SENTENCE, unavailable: SENTENCE });
    expect(feed.getSnapshot()).toEqual([]);
    expect(feed.getError()).toBe(SENTENCE);
  });

  it('follows `unavailable` when it comes and when it clears, though the records are the very array they were: each is told once', async () => {
    const records = [record];
    const feed = await drawn({ records, error: undefined, unavailable: undefined });
    const heard = vi.fn();
    const stop = feed.subscribe(heard);

    act(() => {
      world.set({ records, error: SENTENCE, unavailable: SENTENCE });
    });
    expect(feed.getError()).toBe(SENTENCE);
    expect(feed.getSnapshot()).toBe(records);
    expect(heard).toHaveBeenCalledTimes(1);

    act(() => {
      world.set({ records, error: undefined, unavailable: undefined });
    });
    expect(feed.getError()).toBeUndefined();
    expect(heard).toHaveBeenCalledTimes(2);
    stop();
  });

  it('is no sentence for a failure of the provider that is not the observation: a notice that could not be published raises no row in Problems and wakes no tool', async () => {
    const records = [record];
    const feed = await drawn({ records, error: undefined, unavailable: undefined });
    const heard = vi.fn();
    const stop = feed.subscribe(heard);

    act(() => {
      world.set({ records, error: NOTICE, unavailable: undefined });
    });
    expect(feed.getError()).toBeUndefined();
    expect(activityConditions(feed.getError(), resolver)).toEqual([]);
    expect(heard).not.toHaveBeenCalled();
    stop();
  });

  it('goes when the observation recovers, though another failure of the provider is still held: the row of Problems is the observation\'s and nothing else\'s', async () => {
    const records = [record];
    const feed = await drawn({ records, error: SENTENCE, unavailable: SENTENCE });
    expect(activityConditions(feed.getError(), resolver)).toHaveLength(1);

    act(() => {
      world.set({ records, error: NOTICE, unavailable: undefined });
    });
    expect(feed.getError()).toBeUndefined();
    expect(activityConditions(feed.getError(), resolver)).toEqual([]);
  });
});
