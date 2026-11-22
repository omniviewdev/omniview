import type { ReactNode } from 'react';
import { ToastProvider } from '@omniviewdev/base-ui';
import { act, cleanup, renderHook, screen, type RenderHookResult } from '@testing-library/react';
import { Call } from '@wailsio/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityProvider } from '../../../../../../../packages/omniviewdev-runtime/src/activity/ActivityProvider';
import { ActivitySurfaces } from '../../../../../../../packages/omniviewdev-runtime/src/activity/ActivitySurfaces';
import type { LogEntry, LogStreamEvent } from '../../types';
import { StreamEventType } from '../../types';
import { useLogSources, type UseLogSourcesResult } from '../useLogSources';

// UpdateSessionOptions is a plain function, not a vi.fn: vitest attaches a handler to every promise a mock returns, which would hide an unhandled rejection.
const client = vi.hoisted(() => {
  const update = {
    calls: [] as unknown[][],
    result: undefined as { reject: Error } | { pending: Promise<never> } | undefined,
  };
  return {
    update,
    GetSession: vi.fn(),
    UpdateSessionOptions: async (...args: unknown[]): Promise<unknown> => {
      update.calls.push(args);
      if (update.result && 'pending' in update.result) {
        return update.result.pending;
      }

      return update.result ? Promise.reject(update.result.reject) : Promise.resolve(undefined);
    },
  };
});
vi.mock('@omniviewdev/runtime/api', () => ({ LogsClient: client }));

// The sink of a user-visible notification: what the host's `notify` publishes. A call here is a toast.
const activity = vi.hoisted(() => ({
  heartbeat: vi.fn(),
  subscribe: vi.fn(),
  attach: vi.fn(),
  unsubscribe: vi.fn(),
  listen: vi.fn(),
  listenObservationErrors: vi.fn(),
  publishMessage: vi.fn(),
  setPresentation: vi.fn(),
  snapshot: vi.fn(),
  clearHistory: vi.fn(),
  startResourceAction: vi.fn(),
  requestCancellation: vi.fn(),
}));
vi.mock('../../../../../../../packages/omniviewdev-runtime/src/activity/client', () => ({ activityClient: activity }));

const event = (type: number, source_id: string, message = 'x'): LogStreamEvent => ({ type, source_id, message, timestamp: '' });
const NO_ENTRIES: LogEntry[] = [];

type Props = { events: LogStreamEvent[]; sessionId?: string };
const mount = (initial: Props, wrapper?: (props: { children: ReactNode }) => ReactNode) =>
  renderHook(({ events, sessionId }: Props) => useLogSources({ sessionId, events, entries: NO_ENTRIES, version: 0 }), {
    initialProps: initial,
    wrapper: wrapper as never,
  });

const view = (hook: RenderHookResult<UseLogSourcesResult, Props>) => ({
  sources: hook.result.current.sources.map((source) => source.id),
  dimensions: hook.result.current.dimensions.map((dimension) => [dimension.key, dimension.values, [...dimension.selectedValues].sort(), dimension.allSelected]),
  selected: [...hook.result.current.selectedSourceIds].sort(),
  allSelected: hook.result.current.allSelected,
});

beforeEach(() => {
  client.GetSession.mockRejectedValue(new Error('no session'));
  client.update.calls.length = 0;
  client.update.result = undefined;
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
});

// SDK v0.22.0: an event kind the SDK does not know arrives as -1 (v0.21.0 sent it as 0, SOURCE_ADDED, which made a phantom source of the event's
// source_id here), and the opt-in kind 7 (SOURCE_CAUGHT_UP) arrives as 7. The viewer does not ask for 7.
describe('useLogSources and an event kind it does not read', () => {
  const unread = [
    event(-1, 'phantom'),
    event(-1, ''),
    event(7, 'a'),
    event(7, ''),
    event(8, 'b'),
    event(2 ** 31, 'c'),
  ];

  it('adds no source, no dimension value and no selection for them, and keeps the source it was told of', () => {
    const hook = mount({ events: [event(StreamEventType.SOURCE_ADDED, 'real', '')] });
    expect(view(hook).sources).toEqual(['real']);
    const before = view(hook);

    hook.rerender({ events: [event(StreamEventType.SOURCE_ADDED, 'real', ''), ...unread] });

    expect(view(hook)).toEqual(before);
    expect(view(hook)).toEqual({ sources: ['real'], dimensions: [], selected: ['real'], allSelected: true });
  });

  it('lists none of them in a filter dimension of a session whose sources carry labels', async () => {
    client.GetSession.mockResolvedValue({
      active_sources: [
        { id: 'web-0/app', labels: { pod: 'web-0' } },
        { id: 'web-1/app', labels: { pod: 'web-1' } },
      ],
      options: { params: { filter_labels: 'pod' } },
    });
    const hook = mount({ events: [], sessionId: 'session-1' });
    await act(async () => {
      await Promise.resolve();
    });
    const before = view(hook);
    expect(before.dimensions).toEqual([['pod', ['web-0', 'web-1'], ['web-0', 'web-1'], true]]);

    hook.rerender({ events: unread, sessionId: 'session-1' });

    expect(view(hook)).toEqual(before);
  });

  it('still adds a source told by a kind-0 event that follows them', () => {
    const hook = mount({ events: [] });
    hook.rerender({ events: [...unread] });
    hook.rerender({ events: [...unread, event(StreamEventType.SOURCE_ADDED, 'late', '')] });
    expect(view(hook).sources).toEqual(['late']);
  });
});

// SDK v0.22.0: UpdateSessionOptions on a log session that has ended, or is closing, answers CONFLICT when the update would start a source. The viewer
// syncs the selected sources 300 ms after any change of the selection, the first load included, so it asks exactly that of a Pod that has exited.
describe('the debounced sync of the selected sources, once the session has ended', () => {
  // What a bound Go method that returns an error gives the page (@wailsio/runtime, runtime.js `runtimeErrorHandler`): a RuntimeError whose message is
  // the Go error's text. The host's Go errors are an AppError, whose Error() is its JSON (backend/pkg/apperror/apperror.go), and a plugin's CONFLICT
  // reaches the page as that envelope with code CONFLICT (apperror/resource.go: CONFLICT is class RESOURCE_CONFLICT, 409, recovery refreshContract).
  const { RuntimeError } = Call;
  const conflict = new RuntimeError(
    JSON.stringify({
      type: 'omniview:resource/conflict',
      title: 'Conflict',
      status: 409,
      detail: 'The log session has ended; the update would start a source.',
      code: 'CONFLICT',
      recovery: 'refreshContract',
    }),
  );
  const plain = new RuntimeError('rpc error: code = Aborted desc = log session has ended');
  const withCause = Object.assign(new RuntimeError('logs: update session options'), { cause: { code: 'CONFLICT' } });

  const unhandled = vi.fn();
  const onUnhandled = (reason: unknown) => unhandled(reason);
  beforeEach(() => {
    unhandled.mockReset();
    process.on('unhandledRejection', onUnhandled);
    // Real setImmediate and microtasks: Node reports an unhandled rejection after the microtask queue drains.
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    activity.heartbeat.mockResolvedValue(undefined);
    activity.unsubscribe.mockResolvedValue(undefined);
    activity.subscribe.mockResolvedValue({ id: 'view', snapshot: { revision: 0, records: [] } });
    activity.attach.mockResolvedValue({ revision: 0, records: [] });
    activity.listen.mockReturnValue(() => undefined);
    activity.listenObservationErrors.mockReturnValue(() => undefined);
    activity.snapshot.mockResolvedValue({ revision: 0, records: [] });
    client.GetSession.mockResolvedValue({
      active_sources: [
        { id: 'web-0/app', labels: { pod: 'web-0' } },
        { id: 'web-1/app', labels: { pod: 'web-1' } },
      ],
      options: { params: { filter_labels: 'pod' } },
    });
  });
  afterEach(() => {
    process.off('unhandledRejection', onUnhandled);
  });

  const nextTurn = async () => {
    const turn = Promise.withResolvers<void>();
    setImmediate(turn.resolve);
    return turn.promise;
  };

  const settle = async () => {
    await act(async () => {
      await nextTurn();
      await nextTurn();
    });
  };

  const surfaces = ({ children }: { children: ReactNode }) => (
    <ToastProvider>
      <ActivityProvider>
        {children}
        <ActivitySurfaces />
      </ActivityProvider>
    </ToastProvider>
  );

  it.each([
    ['the host\'s AppError envelope with code CONFLICT', conflict],
    ['a bare RuntimeError with the gRPC text', plain],
    ['a RuntimeError with a cause, as the runtime builds it', withCause],
  ])('shows no toast, raises no unhandled rejection, and leaves sources, dimensions and selection as they were: %s', async (_name, rejection) => {
    client.update.result = { reject: rejection };
    const ended = event(StreamEventType.STREAM_ENDED, '', 'Complete');
    const hook = mount({ events: [ended], sessionId: 'session-1' }, surfaces);
    await settle();
    const loaded = view(hook);
    expect(loaded.sources).toEqual(['web-0/app', 'web-1/app']);

    // First load: the selection changed from nothing to everything, so the sync is due 300 ms after.
    expect(client.update.calls).toEqual([]);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await settle();
    expect(client.update.calls).toEqual([['session-1', { params: { enabled_sources: '' } }]]);
    expect(view(hook)).toEqual(loaded);

    // The user narrows to one pod: the sync names it, is refused the same way, and the narrowed selection stays.
    act(() => {
      hook.result.current.toggleValue('pod', 'web-1');
    });
    const narrowed = view(hook);
    expect(narrowed.selected).toEqual(['web-0/app']);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await settle();
    expect(client.update.calls).toEqual([
      ['session-1', { params: { enabled_sources: '' } }],
      ['session-1', { params: { enabled_sources: 'web-0/app' } }],
    ]);
    expect(view(hook)).toEqual(narrowed);

    expect(unhandled).not.toHaveBeenCalled();
    expect(activity.publishMessage).not.toHaveBeenCalled();
    expect(screen.queryByRole('article')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(/conflict|ended/i)).toBeNull();
  });

  it('shows the same when the rejection arrives after the viewer left', async () => {
    const late = Promise.withResolvers<never>();
    client.update.result = { pending: late.promise };
    const hook = mount({ events: [], sessionId: 'session-1' }, surfaces);
    await settle();
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    expect(client.update.calls).toHaveLength(1);
    hook.unmount();
    late.reject(conflict);
    await nextTurn();
    await nextTurn();
    expect(unhandled).not.toHaveBeenCalled();
    expect(activity.publishMessage).not.toHaveBeenCalled();
  });
});
