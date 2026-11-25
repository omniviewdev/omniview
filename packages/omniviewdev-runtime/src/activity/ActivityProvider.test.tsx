// @vitest-environment jsdom
import React from 'react';
import { Dialog, ToastProvider, useToast } from '@omniviewdev/base-ui';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActivityProvider } from './ActivityProvider';
import { ActivitySurfaces } from './ActivitySurfaces';
import { useActivities, useActivityActions, useActivityContext, useNotifications } from './context';
import { progressPercent } from './ActivityCard';
import type {
  ActivityChange,
  ActivityObservationError,
  ActivityRecord,
  ActivitySubscription,
  NotificationOptions,
} from './types';

const native = vi.hoisted(() => ({
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
vi.mock('./client', () => ({ activityClient: native }));
let records: ActivityRecord[];
let revision: number;
let listener: (change: ActivityChange) => void;
let observationError: (error: ActivityObservationError) => void;
function record(id: string, task = false): ActivityRecord {
  return {
    id,
    revision: ++revision,
    source: {},
    kind: task ? 'task' : 'message',
    severity: 'error',
    createdAt: `2026-11-03T00:00:0${revision}Z`,
    updatedAt: '2026-11-03T00:00:00Z',
    presentation: {
      title: id,
      message: 'Preparing work',
      details: 'compiler error <unsafe>',
    },
    visibility: { collapsed: false, toastDismissed: false, read: false },
    ...(task
      ? {
          task: {
            state: 'running' as const,
            cancellation: 'available' as const,
          },
        }
      : {}),
  };
}
function publish(item: ActivityRecord) {
  records = records.some((value) => value.id === item.id)
    ? records.map((value) => (value.id === item.id ? item : value))
    : [...records, item];
  listener({ revision: item.revision, record: item });
}
function Trigger({
  options = {
    title: 'Installation failed',
    severity: 'error',
    details: 'compiler error <unsafe>',
  },
}: {
  options?: NotificationOptions;
}) {
  const { notify } = useNotifications();
  const { openNotifications } = useActivities();
  const { toast } = useToast();
  return (
    <>
      <button
        onClick={() => {
          void notify(options);
        }}
      >
        Notify
      </button>
      <button onClick={() => openNotifications()}>Notifications</button>
      <button onClick={() => openNotifications('active')}>Active tasks</button>
      <button onClick={() => toast('Ordinary notice')}>Plain toast</button>
    </>
  );
}
function WorkView() {
  const { startResourceAction } = useActivityActions();
  return (
    <button
      onClick={() => {
        void startResourceAction({
          pluginID: 'p',
          request: {
            action: 'run',
            route: { connection: 'c' },
            typeTarget: { provider: 'p', authority: 'c', type: 'work', scope: [] },
            input: { kind: 'uint64', value: '18446744073709551615' },
          },
          presentation: { title: 'Run' },
        });
      }}
    >
      Start work
    </button>
  );
}
function mount(
  options?: NotificationOptions,
  props: React.ComponentProps<typeof ActivitySurfaces> = {},
) {
  return render(
    <ToastProvider>
      <ActivityProvider>
        <Trigger options={options} />
        <ActivitySurfaces {...props} />
      </ActivityProvider>
    </ToastProvider>,
  );
}
beforeEach(() => {
  vi.resetAllMocks();
  records = [];
  revision = 0;
  native.heartbeat.mockResolvedValue(undefined);
  native.unsubscribe.mockResolvedValue(undefined);
  native.subscribe.mockImplementation(async () => ({
    id: 'view',
    snapshot: { revision, records: [...records] },
  }));
  native.attach.mockImplementation(async () => ({
    revision,
    records: [...records],
  }));
  native.listen.mockImplementation((_id, callback) => {
    listener = callback;
    return () => undefined;
  });
  native.listenObservationErrors.mockImplementation((callback) => {
    observationError = callback;
    return () => undefined;
  });
  native.snapshot.mockImplementation(async () => ({
    revision,
    records: [...records],
  }));
  native.publishMessage.mockImplementation(async (spec) => {
    const item = {
      ...record(spec.presentation.title),
      severity: spec.severity,
      presentation: spec.presentation,
    };
    records.push(item);
    return item;
  });
  native.setPresentation.mockImplementation(async (patch) => {
    const current = records.find((item) => item.id === patch.id)!;
    const item = {
      ...current,
      revision: ++revision,
      visibility: { ...current.visibility, ...patch },
    };
    publish(item);
    return item;
  });
  native.requestCancellation.mockImplementation(async (id) => {
    const current = records.find((item) => item.id === id)!;
    const item = {
      ...current,
      revision: ++revision,
      task: { ...current.task!, cancellation: 'requested' as const },
    };
    publish(item);
    return item;
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('shared activity presentation', () => {
  it('keeps a collapsed task outcome visible and stops indeterminate progress after observation loss', async () => {
    const item = record('Work', true);
    item.visibility.collapsed = true;
    item.presentation.progress = { kind: 'indeterminate' };
    records = [item];
    mount();
    const toast = await screen.findByRole('article', { name: 'Work' });
    expect(within(toast).getByRole('progressbar')).toBeTruthy();
    act(() =>
      publish({
        ...item,
        revision: ++revision,
        task: { ...item.task!, state: 'unknown' },
      }),
    );
    expect(within(toast).getByText('unknown')).toBeTruthy();
    expect(within(toast).queryByRole('progressbar')).toBeNull();
    expect(within(toast).getByRole('button', { name: 'Expand activity' })).toBeTruthy();
  });

  it('wakes a reader of only the actions on no activity update, and a reader of the unread count only when it changes', async () => {
    const renders = { actions: 0, count: 0 };
    function ActionsProbe() {
      useActivityActions();
      renders.actions++;
      return null;
    }
    function CountProbe() {
      const { notificationCount } = useNotifications();
      renders.count++;
      return <output aria-label="unread">{notificationCount}</output>;
    }
    render(
      <ToastProvider>
        <ActivityProvider>
          <ActionsProbe />
          <CountProbe />
        </ActivityProvider>
      </ToastProvider>,
    );
    await waitFor(() => expect(native.attach).toHaveBeenCalled());
    await act(async () => {});
    const settled = { ...renders };
    const task = record('Work', true);
    act(() => publish(task));
    expect(screen.getByLabelText('unread').textContent).toBe('1');
    expect(renders).toEqual({ actions: settled.actions, count: settled.count + 1 });
    // A task's progress changes its record, not the unread count: neither reader renders.
    const progressed = { ...task, revision: ++revision, updatedAt: '2026-11-03T00:00:09Z' };
    act(() => publish(progressed));
    expect(renders).toEqual({ actions: settled.actions, count: settled.count + 1 });
    act(() => publish({ ...progressed, revision: ++revision, visibility: { ...progressed.visibility, read: true } }));
    expect(screen.getByLabelText('unread').textContent).toBe('0');
    expect(renders).toEqual({ actions: settled.actions, count: settled.count + 2 });
  });

  it('retains plain diagnostics, copy feedback and trusted remediation', async () => {
    const retry = vi.fn();
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    mount({
      title: 'Installation failed',
      severity: 'error',
      details: 'compiler error <unsafe>',
      actions: [{ label: 'Retry', onClick: retry }],
    });
    fireEvent.click(screen.getByText('Notify'));
    await screen.findByRole('article', { name: 'Installation failed' });
    fireEvent.click(screen.getByText('Notifications'));
    const diagnostic = screen.getByRole('article', {
      name: 'Installation failed',
    });
    fireEvent.click(within(diagnostic).getByRole('button', { name: 'Details' }));
    expect(within(diagnostic).getByText('compiler error <unsafe>')).toBeTruthy();
    expect(document.querySelector('unsafe')).toBeNull();
    fireEvent.click(within(diagnostic).getByText('Copy details'));
    await waitFor(() =>
      expect(within(diagnostic).getByRole('status').textContent).toBe('Details copied.'),
    );
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining('compiler error <unsafe>'));
    fireEvent.click(within(diagnostic).getByText('Retry'));
    await waitFor(() => expect(retry).toHaveBeenCalledOnce());
    writeText.mockRejectedValueOnce(new Error('Clipboard denied'));
    fireEvent.click(within(diagnostic).getByText('Copy details'));
    await waitFor(() =>
      expect(within(diagnostic).getByRole('status').textContent).toContain('Copy failed.'),
    );
  });

  it('opens toast Details and restores external focus after the toast opener disappears', async () => {
    records = [record('Failure')];
    mount();
    const toast = await screen.findByRole('article', { name: 'Failure' });
    const opener = screen.getByText('Notifications');
    opener.focus();
    const details = within(toast).getByRole('button', { name: 'Details' });
    details.focus();
    fireEvent.click(details);
    const center = screen.getByRole('region', { name: 'Notifications' });
    expect(within(center).getByText('compiler error <unsafe>')).toBeTruthy();
    expect(toast.isConnected).toBe(false);
    fireEvent.keyDown(center, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('shows an inspectable observation failure without changing or replaying remote work', async () => {
    records = [record('Work', true)];
    native.publishMessage.mockRejectedValue(new Error('Storage unavailable'));
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    mount();
    await screen.findByRole('article', { name: 'Work' });
    const message = 'Activity observation failed. Verify the remote outcome before retrying.';
    act(() => observationError({ id: 'Work', pluginID: 'p', message }));
    expect(screen.getByText(message)).toBeTruthy();
    fireEvent.click(screen.getByText('Notifications'));
    const center = screen.getByRole('region', { name: 'Notifications' });
    expect(within(center).getByRole('alert').textContent).toBe(message);
    const work = within(center).getByRole('article', { name: 'Work' });
    expect(within(work).getByRole('img', { name: 'running' })).toBeTruthy();
    fireEvent.click(within(center).getByText('Copy diagnostic'));
    await waitFor(() => expect(within(center).getByText('Diagnostic copied.')).toBeTruthy());
    expect(writeText).toHaveBeenCalledWith(message);
  });

  it('lets a reviewed-action dialog consume Escape without closing the underlying center', async () => {
    const item = record('Repair');
    item.presentation.actions = [
      {
        id: 'repair',
        kind: 'resource-action',
        label: 'Review repair',
        intent: {
          pluginID: 'p',
          request: {
            route: { connection: 'c' },
            action: 'repair',
            typeTarget: { provider: 'p', authority: 'c', type: 'work', scope: [] },
            input: { kind: 'null' },
          },
        },
      },
    ];
    records = [item];
    function App() {
      const [review, setReview] = React.useState(false);
      return (
        <ToastProvider>
          <ActivityProvider>
            <Trigger />
            <ActivitySurfaces onAction={() => setReview(true)} />
            <Dialog open={review} onClose={() => setReview(false)}>
              <Dialog.Title>Review action</Dialog.Title>
              <Dialog.Body>Review required inputs before running.</Dialog.Body>
            </Dialog>
          </ActivityProvider>
        </ToastProvider>
      );
    }
    render(<App />);
    await screen.findByRole('article', { name: 'Repair' });
    fireEvent.click(screen.getByText('Notifications'));
    fireEvent.click(screen.getByText('Review repair'));
    const dialog = screen.getByRole('dialog', { name: 'Review action' });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    const center = screen.getByRole('region', { name: 'Notifications' });
    fireEvent.keyDown(screen.getByText('Notify'), { key: 'Escape' });
    expect(center.isConnected).toBe(true);
    center.focus();
    fireEvent.keyDown(center, { key: 'Escape' });
    expect(screen.queryByRole('region', { name: 'Notifications' })).toBeNull();
  });

  it('persists collapse and user hide across updates, completion and a new observer', async () => {
    records = [record('Work', true)];
    const view = mount();
    let card = await screen.findByRole('article', { name: 'Work' });
    fireEvent.click(within(card).getByLabelText('Collapse activity'));
    await waitFor(() => expect(within(card).queryByText('Preparing work')).toBeNull());
    expect(within(card).getByLabelText('Expand activity')).toBeTruthy();
    fireEvent.click(within(card).getByLabelText('Hide activity toast'));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Work' })).toBeNull());
    act(() =>
      publish({
        ...records[0],
        revision: ++revision,
        task: { ...records[0].task!, state: 'succeeded' },
      }),
    );
    expect(screen.queryByRole('article', { name: 'Work' })).toBeNull();
    view.unmount();
    mount();
    fireEvent.click(screen.getByText('Notifications'));
    card = await screen.findByRole('article', { name: 'Work' });
    expect(within(card).getByLabelText('Expand activity')).toBeTruthy();
    expect(within(card).queryByText('Preparing work')).toBeNull();
    fireEvent.click(screen.getByLabelText('Close notifications'));
    expect(screen.queryByRole('article', { name: 'Work' })).toBeNull();
  });

  it('admits one rich toast and keeps overflowing and terminal rows discoverable', async () => {
    records = [record('First', true), record('Second', true)];
    mount();
    await screen.findByRole('article');
    expect(screen.getAllByRole('article')).toHaveLength(1);
    fireEvent.click(screen.getByText('Active tasks'));
    expect(screen.getByRole('article', { name: 'First' })).toBeTruthy();
    expect(screen.getByRole('article', { name: 'Second' })).toBeTruthy();
    act(() =>
      publish({
        ...records[0],
        revision: ++revision,
        task: { ...records[0].task!, state: 'succeeded' },
      }),
    );
    expect(
      within(screen.getByRole('article', { name: 'First' })).getByRole('img', {
        name: 'succeeded',
      }),
    ).toBeTruthy();
    await act(async () => {
      fireEvent.click(screen.getByText('Notify'));
    });
    fireEvent.click(screen.getByLabelText('Close notifications'));
    await act(async () => undefined);
    expect(screen.queryAllByRole('article')).toHaveLength(0);
    fireEvent.click(screen.getByText('Notifications'));
    expect(screen.getByRole('article', { name: 'Installation failed' })).toBeTruthy();
  });

  it('keeps terminal DOM identity and expiry despite later progress updates', async () => {
    vi.useFakeTimers();
    records = [record('Work', true)];
    await act(async () => {
      mount();
    });
    const card = screen.getByRole('article', { name: 'Work' });
    act(() =>
      publish({
        ...records[0],
        revision: ++revision,
        task: { ...records[0].task!, state: 'succeeded' },
      }),
    );
    expect(screen.getByRole('article', { name: 'Work' })).toBe(card);
    expect(within(card).getByRole('img', { name: 'succeeded' })).toBeTruthy();
    await act(async () => {
      vi.advanceTimersByTime(7000);
    });
    act(() =>
      publish({
        ...records[0],
        revision: ++revision,
        presentation: {
          ...records[0].presentation,
          message: 'Retained result',
        },
      }),
    );
    expect(screen.getByRole('article', { name: 'Work' })).toBe(card);
    await act(async () => {
      vi.advanceTimersByTime(1000);
    });
    // Expiry commits the exit state before its transition-removal timer starts.
    expect(card.isConnected).toBe(true);
    await act(async () => {
      vi.advanceTimersByTime(201);
    });
    expect(screen.queryByRole('article', { name: 'Work' })).toBeNull();
    fireEvent.click(screen.getByText('Notifications'));
  });

  it('does not reopen a rich toast displaced by the shared viewport budget', async () => {
    records = [record('Work', true)];
    render(
      <ToastProvider maxVisible={1}>
        <ActivityProvider>
          <Trigger />
          <ActivitySurfaces />
        </ActivityProvider>
      </ToastProvider>,
    );
    await screen.findByRole('article', { name: 'Work' });
    fireEvent.click(screen.getByText('Plain toast'));
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Work' })).toBeNull());
    act(() =>
      publish({
        ...records[0],
        revision: ++revision,
        presentation: { title: 'Updated work' },
      }),
    );
    expect(screen.queryByRole('article', { name: 'Updated work' })).toBeNull();
    fireEvent.click(screen.getByText('Notifications'));
    expect(screen.getByRole('article', { name: 'Updated work' })).toBeTruthy();
  });

  it('disables busy actions and exposes safe failure feedback', async () => {
    const pending = Promise.withResolvers<void>();
    const item = record('Repair');
    item.presentation.actions = [
      {
        id: 'go',
        kind: 'navigate-resource',
        label: 'Open resource',
        target: {
          pluginID: 'p',
          targetId: 'target',
          route: { connection: 'c' },
          reference: {
            address: {
              provider: 'p',
              authority: 'a',
              type: 't',
              scope: [],
              id: 'r',
            },
          },
          representation: 'resource',
        },
      },
    ];
    records = [item];
    mount(undefined, { onAction: () => pending.promise });
    await screen.findByRole('article');
    fireEvent.click(screen.getByText('Notifications'));
    fireEvent.click(screen.getByText('Open resource'));
    expect((screen.getByText('Open resource…') as HTMLButtonElement).disabled).toBe(true);
    await act(async () => {
      pending.reject(new Error('private diagnostic'));
    });
    expect(screen.getByRole('alert').textContent).toBe('The operation could not be completed.');
    expect((screen.getByText('Open resource') as HTMLButtonElement).disabled).toBe(false);
  });

  it('omits unavailable actions and retains explicit cancellation until real completion', async () => {
    const item = record('Work', true);
    item.presentation.actions = [
      {
        id: 'go',
        kind: 'navigate-resource',
        label: 'Open resource',
        target: {
          pluginID: 'p',
          targetId: 'target',
          route: { connection: 'c' },
          reference: {
            address: {
              provider: 'p',
              authority: 'a',
              type: 't',
              scope: [],
              id: 'r',
            },
          },
          representation: 'resource',
        },
      },
    ];
    records = [item];
    mount(undefined, {
      onAction: () => undefined,
      canHandleAction: () => false,
    });
    const card = await screen.findByRole('article');
    expect(within(card).queryByText('Open resource')).toBeNull();
    fireEvent.click(within(card).getByText('Cancel'));
    await waitFor(() => expect(native.requestCancellation).toHaveBeenCalledWith(item.id));
    expect(within(card).getByRole('img', { name: 'running' })).toBeTruthy();
    expect(within(card).queryByRole('img', { name: 'cancelled' })).toBeNull();
  });

  it('continues adopted work after its resource view unmounts', async () => {
    native.startResourceAction.mockImplementation(async () => {
      const item = record('Adopted', true);
      records.push(item);
      return item;
    });
    function App() {
      const [show, setShow] = React.useState(true);
      return (
        <ToastProvider>
          <ActivityProvider>
            {show && <WorkView />}
            <button onClick={() => setShow(false)}>Leave resource</button>
            <Trigger />
            <ActivitySurfaces />
          </ActivityProvider>
        </ToastProvider>
      );
    }
    render(<App />);
    fireEvent.click(screen.getByText('Start work'));
    await screen.findByRole('article', { name: 'Adopted' });
    fireEvent.click(screen.getByText('Leave resource'));
    const card = screen.getByRole('article', { name: 'Adopted' });
    expect(within(card).getByRole('img', { name: 'running' })).toBeTruthy();
    act(() =>
      publish({
        ...records[0],
        revision: ++revision,
        task: { ...records[0].task!, state: 'succeeded' },
      }),
    );
    expect(within(card).getByRole('img', { name: 'succeeded' })).toBeTruthy();
  });

  it('tracks measured progress updates across collapse without inventing completion', async () => {
    const item = record('Rollout', true);
    item.presentation.progress = {
      kind: 'units',
      current: '2',
      total: '5',
      unit: 'pods',
    };
    records = [item];
    mount();
    const card = await screen.findByRole('article', { name: 'Rollout' });
    expect(within(card).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('40');
    fireEvent.click(within(card).getByRole('button', { name: 'Collapse activity' }));
    await waitFor(() =>
      expect(within(card).getByRole('button', { name: 'Expand activity' })).toBeTruthy(),
    );
    act(() =>
      publish({
        ...records[0],
        revision: ++revision,
        presentation: {
          ...item.presentation,
          progress: { kind: 'units', current: '5', total: '5', unit: 'pods' },
        },
      }),
    );
    expect(within(card).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('100');
    expect(within(card).getByRole('img', { name: 'running' })).toBeTruthy();
    act(() =>
      publish({
        ...records[0],
        revision: ++revision,
        presentation: {
          ...item.presentation,
          progress: { kind: 'indeterminate' },
        },
      }),
    );
    expect(within(card).getByRole('progressbar').hasAttribute('aria-valuenow')).toBe(false);
  });

  it('calculates exact unit and step ratios', () => {
    expect(
      progressPercent({
        kind: 'units',
        current: '9223372036854775808',
        total: '18446744073709551616',
        unit: 'bytes',
      }),
    ).toBe(50);
    expect(
      progressPercent({
        kind: 'steps',
        current: '1',
        total: '4',
        label: 'steps',
      }),
    ).toBe(25);
  });
});

// What the provider says when something failed, and when it stops saying it. `unavailable` is the observation's own failure: a subscription or a heartbeat that failed, and nothing since has made it good. `error` is what the toast and the
// notification center say, the first failure the provider holds: the host's observation-error event, then `unavailable`, then a failed `notify`, then a failed `openDetails`. Each goes when its own source recovers, and no other
// recovery takes it away. The clock is the test's (the provider's 10 s heartbeat is a fake interval), and every promise the provider waits on is the test's too, so the order of what happens is decided here, never by time.
describe('what the provider says of a failure, and when it stops', () => {
  const HEARTBEAT = 'The heartbeat was refused.';
  const SUBSCRIPTION = 'The subscription was refused.';
  const EVENT = 'Activity observation failed. Verify the remote outcome before retrying.';
  const NOTICE = 'The notice could not be stored.';
  const DETAILS = 'The record could not be opened.';
  /** The provider's wait between two heartbeats. */
  const INTERVAL = 10_000;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  /** A failure as a call of the host rejects with it: the envelope the provider reads its sentence from. */
  function refused(detail: string) {
    return new Error(
      JSON.stringify({ type: 'urn:omniview:test:refused', title: 'Refused', status: 503, detail }),
    );
  }
  function Reader() {
    const { error, unavailable } = useActivities();
    const { notify } = useNotifications();
    const { openDetails } = useActivityContext();
    return (
      <>
        <output aria-label="said">{JSON.stringify({ error, unavailable })}</output>
        <button
          onClick={() => {
            void notify({ title: 'Installation failed', severity: 'error' });
          }}
        >
          Notify
        </button>
        <button onClick={() => openDetails('m-1')}>Open details</button>
      </>
    );
  }
  /** What the provider says of a failure now: a member that is not there is a sentence it does not have. */
  const said = (): { error?: string; unavailable?: string } =>
    JSON.parse(screen.getByLabelText('said').textContent ?? '');
  /** Lets every promise the provider waits on settle and React commit what they set. No timer moves. */
  async function settle() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
  }
  /** One interval of the provider's clock, and what comes of the heartbeat it sends. */
  async function beat() {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(INTERVAL);
    });
    await settle();
  }
  async function mountReader() {
    const view = render(
      <ActivityProvider>
        <Reader />
      </ActivityProvider>,
    );
    await settle();
    return view;
  }
  /** The host tells the provider of an action whose updates it could not record. */
  const event = (message: string) => {
    act(() => observationError({ id: 'Work', pluginID: 'p', message }));
  };

  it('is unavailable from a heartbeat that failed while the subscription is made again, and is not once that succeeds', async () => {
    await mountReader();
    expect(said()).toEqual({});
    const again = Promise.withResolvers<ActivitySubscription>();
    native.heartbeat.mockRejectedValueOnce(refused(HEARTBEAT));
    native.subscribe.mockImplementationOnce(async () => again.promise);
    await beat();
    expect(said()).toEqual({ unavailable: HEARTBEAT, error: HEARTBEAT });
    again.resolve({ id: 'view-2', snapshot: { revision, records: [] } });
    await settle();
    expect(said()).toEqual({});
  });

  it('is unavailable from a subscription that failed, and its sentence is the error', async () => {
    const held = Promise.withResolvers<void>();
    native.subscribe.mockRejectedValueOnce(refused(SUBSCRIPTION));
    native.heartbeat.mockImplementationOnce(async () => held.promise);
    await mountReader();
    expect(said()).toEqual({ unavailable: SUBSCRIPTION, error: SUBSCRIPTION });
  });

  it('is available again when a heartbeat gets through and the subscription is made again', async () => {
    const held = Promise.withResolvers<void>();
    native.subscribe.mockRejectedValueOnce(refused(SUBSCRIPTION));
    native.heartbeat.mockImplementationOnce(async () => held.promise);
    await mountReader();
    expect(said().error).toBe(SUBSCRIPTION);
    held.resolve();
    await settle();
    expect(said()).toEqual({});
    expect(native.subscribe).toHaveBeenCalledTimes(2);
  });

  it('is still unavailable while the subscription keeps failing, though every heartbeat gets through, and tries it again once with each', async () => {
    const held = Promise.withResolvers<void>();
    native.subscribe.mockRejectedValue(refused(SUBSCRIPTION));
    native.heartbeat.mockImplementationOnce(async () => held.promise);
    await mountReader();
    expect(native.subscribe).toHaveBeenCalledTimes(1);
    held.resolve();
    await settle();
    expect(native.subscribe).toHaveBeenCalledTimes(2);
    for (const attempts of [3, 4, 5]) {
      await beat();
      expect(native.subscribe).toHaveBeenCalledTimes(attempts);
      expect(said()).toEqual({ unavailable: SUBSCRIPTION, error: SUBSCRIPTION });
    }
  });

  it('does not subscribe again for a heartbeat that gets through while the subscription holds', async () => {
    await mountReader();
    await beat();
    await beat();
    await beat();
    expect(native.heartbeat).toHaveBeenCalledTimes(4);
    expect(native.subscribe).toHaveBeenCalledTimes(1);
    expect(said()).toEqual({});
  });

  it('shows the host\'s observation-error event in `error` and not in `unavailable`, and the next heartbeat that gets through takes it away', async () => {
    await mountReader();
    event(EVENT);
    expect(said()).toEqual({ error: EVENT });
    await beat();
    expect(said()).toEqual({});
  });

  it('keeps an event that came while a heartbeat was in flight: that heartbeat was sent before it', async () => {
    await mountReader();
    const held = Promise.withResolvers<void>();
    native.heartbeat.mockImplementationOnce(async () => held.promise);
    await beat();
    event(EVENT);
    held.resolve();
    await settle();
    expect(said()).toEqual({ error: EVENT });
    await beat();
    expect(said()).toEqual({});
  });

  it('keeps an event that came while the subscription was being made again: that subscription began before it', async () => {
    await mountReader();
    const again = Promise.withResolvers<ActivitySubscription>();
    native.heartbeat.mockRejectedValueOnce(refused(HEARTBEAT));
    native.subscribe.mockImplementationOnce(async () => again.promise);
    await beat();
    event(EVENT);
    expect(said()).toEqual({ unavailable: HEARTBEAT, error: EVENT });
    again.resolve({ id: 'view-2', snapshot: { revision, records: [] } });
    await settle();
    expect(said()).toEqual({ error: EVENT });
    await beat();
    expect(said()).toEqual({});
  });

  it('takes an event away with a subscription that is made after it', async () => {
    await mountReader();
    event(EVENT);
    native.heartbeat.mockRejectedValueOnce(refused(HEARTBEAT));
    await beat();
    expect(said()).toEqual({});
  });

  it('shows a failed `notify` in `error` and not in `unavailable`, and the next `notify` that succeeds takes it away', async () => {
    await mountReader();
    native.publishMessage.mockRejectedValueOnce(refused(NOTICE));
    fireEvent.click(screen.getByText('Notify'));
    await settle();
    expect(said()).toEqual({ error: NOTICE });
    fireEvent.click(screen.getByText('Notify'));
    await settle();
    expect(said()).toEqual({});
  });

  it('shows a failed `openDetails` in `error` and not in `unavailable`, and the next `openDetails` that succeeds takes it away', async () => {
    records = [record('m-1')];
    await mountReader();
    native.setPresentation.mockRejectedValueOnce(refused(DETAILS));
    fireEvent.click(screen.getByText('Open details'));
    await settle();
    expect(said()).toEqual({ error: DETAILS });
    fireEvent.click(screen.getByText('Open details'));
    await settle();
    expect(said()).toEqual({});
  });

  it('does not take a failed `notify` or a failed `openDetails` away with a heartbeat or a subscription that succeeds, nor one of them with the other\'s success', async () => {
    records = [record('m-1')];
    await mountReader();
    native.setPresentation.mockRejectedValueOnce(refused(DETAILS));
    fireEvent.click(screen.getByText('Open details'));
    await settle();
    native.publishMessage.mockRejectedValueOnce(refused(NOTICE));
    fireEvent.click(screen.getByText('Notify'));
    await settle();
    expect(said()).toEqual({ error: NOTICE });
    // A heartbeat that gets through.
    await beat();
    expect(said()).toEqual({ error: NOTICE });
    // A heartbeat that fails, and the subscription that is made again and succeeds.
    native.heartbeat.mockRejectedValueOnce(refused(HEARTBEAT));
    await beat();
    expect(said()).toEqual({ error: NOTICE });
    // The `notify` that succeeds takes its own failure away: the other one is still held.
    fireEvent.click(screen.getByText('Notify'));
    await settle();
    expect(said()).toEqual({ error: DETAILS });
    fireEvent.click(screen.getByText('Open details'));
    await settle();
    expect(said()).toEqual({});
  });

  it('says the first of the failures it holds: the event, then unavailable, then a failed `notify`, then a failed `openDetails`', async () => {
    records = [record('m-1')];
    await mountReader();
    native.setPresentation.mockRejectedValueOnce(refused(DETAILS));
    fireEvent.click(screen.getByText('Open details'));
    await settle();
    expect(said()).toEqual({ error: DETAILS });
    native.publishMessage.mockRejectedValueOnce(refused(NOTICE));
    fireEvent.click(screen.getByText('Notify'));
    await settle();
    expect(said()).toEqual({ error: NOTICE });
    native.heartbeat.mockRejectedValueOnce(refused(HEARTBEAT));
    native.subscribe.mockRejectedValueOnce(refused(SUBSCRIPTION));
    await beat();
    expect(said()).toEqual({ unavailable: SUBSCRIPTION, error: SUBSCRIPTION });
    event(EVENT);
    expect(said()).toEqual({ unavailable: SUBSCRIPTION, error: EVENT });
    // The next heartbeat gets through and takes the event away; the subscription fails again, so it is still unavailable.
    native.subscribe.mockRejectedValueOnce(refused(HEARTBEAT));
    await beat();
    expect(said()).toEqual({ unavailable: HEARTBEAT, error: HEARTBEAT });
    // The subscription is made: the failures of the two calls are what is left, the first of them says.
    await beat();
    expect(said()).toEqual({ error: NOTICE });
    fireEvent.click(screen.getByText('Notify'));
    await settle();
    expect(said()).toEqual({ error: DETAILS });
    fireEvent.click(screen.getByText('Open details'));
    await settle();
    expect(said()).toEqual({});
  });

  it('takes the notification center\'s alert away when the observation recovers, as it does the provider\'s error', async () => {
    mount();
    await settle();
    fireEvent.click(screen.getByText('Notifications'));
    const center = screen.getByRole('region', { name: 'Notifications' });
    event(EVENT);
    expect(within(center).getByRole('alert').textContent).toBe(EVENT);
    await beat();
    expect(within(center).queryByRole('alert')).toBeNull();
  });

  it('leaves nothing behind when it unmounts: the interval, both listeners and the subscription are released', async () => {
    const stopErrors = vi.fn();
    const stopListening = vi.fn();
    native.listenObservationErrors.mockImplementation((callback) => {
      observationError = callback;
      return stopErrors;
    });
    native.listen.mockImplementation((_id, callback) => {
      listener = callback;
      return stopListening;
    });
    const timers = vi.getTimerCount();
    const view = await mountReader();
    expect(vi.getTimerCount()).toBe(timers + 1);
    expect(stopErrors).not.toHaveBeenCalled();
    expect(stopListening).not.toHaveBeenCalled();
    view.unmount();
    expect(vi.getTimerCount()).toBe(timers);
    expect(stopErrors).toHaveBeenCalledTimes(1);
    expect(stopListening).toHaveBeenCalledTimes(1);
    expect(native.unsubscribe).toHaveBeenCalledTimes(1);
    expect(native.unsubscribe).toHaveBeenCalledWith('view');
    const heartbeats = native.heartbeat.mock.calls.length;
    await beat();
    await beat();
    expect(native.heartbeat).toHaveBeenCalledTimes(heartbeats);
    expect(native.subscribe).toHaveBeenCalledTimes(1);
  });

  /** The subscription is down and a heartbeat is in flight when the provider unmounts: the heartbeat, and the end it comes to, are the test's. */
  async function unmountedMidHeartbeat() {
    const view = await mountReader();
    native.heartbeat.mockRejectedValueOnce(refused(HEARTBEAT));
    native.subscribe.mockRejectedValueOnce(refused(SUBSCRIPTION));
    await beat();
    expect(said().error).toBe(SUBSCRIPTION);
    const held = Promise.withResolvers<void>();
    native.heartbeat.mockImplementationOnce(async () => held.promise);
    await beat();
    expect(native.heartbeat).toHaveBeenCalledTimes(3);
    expect(native.subscribe).toHaveBeenCalledTimes(2);
    view.unmount();
    return held;
  }

  it('does not recover a heartbeat that gets through after it unmounted: the subscription is not made again', async () => {
    const held = await unmountedMidHeartbeat();
    held.resolve();
    await settle();
    expect(native.subscribe).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not recover a heartbeat that fails after it unmounted: the subscription is not made again', async () => {
    const held = await unmountedMidHeartbeat();
    held.reject(refused(HEARTBEAT));
    await settle();
    expect(native.subscribe).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
