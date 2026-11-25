import React from 'react';
import { parseAppError } from '../errors/parseAppError';
import { activityClient } from './client';
import {
  ActivityActionsContext,
  ActivityContext,
  NotificationCountContext,
  type ActivityActionsValue,
  type ActivityContextValue,
} from './context';
import { ActivityStore, connectActivityStore, isActiveTask } from './store';
import type {
  ActivityAction,
  ActivityRecord,
  DiagnosticAction,
  NotificationOptions,
  StartResourceActionRequest,
} from './types';

export type ActivityProviderProps = {
  children: React.ReactNode;
};

/** Mount once above consumers. Host owns work; this bridge owns observation only. */
export function ActivityProvider({ children }: ActivityProviderProps) {
  const [store] = React.useState(() => new ActivityStore());
  const view = React.useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  // Four failures, each held by its own source and gone when that source recovers; `error` is the
  // first of them that is set, in this order. The host's word that a host action's updates could
  // not be recorded: about that action, not about the service.
  const [observationError, setObservationError] = React.useState<string>();
  // The provider cannot observe the service: a subscription or a heartbeat failed, and none has
  // made it good. The only one of the four that says so.
  const [unavailable, setUnavailable] = React.useState<string>();
  // A `notify` or an `openDetails` that failed, until the same call succeeds.
  const [notifyError, setNotifyError] = React.useState<string>();
  const [detailsError, setDetailsError] = React.useState<string>();
  const error = observationError ?? unavailable ?? notifyError ?? detailsError;
  const [busyActions, setBusyActions] = React.useState<ReadonlySet<string>>(new Set());
  const busy = React.useRef(new Set<string>());
  const [actionErrors, setActionErrors] = React.useState<ReadonlyMap<string, string>>(new Map());
  const [selectedDetailsID, setSelectedDetailsID] = React.useState<string>();

  React.useEffect(() => {
    let stopped = false;
    let heartbeating = false;
    let observer = new AbortController();
    // Whether the store is being fed. A heartbeat renews the producer lease, not the subscription,
    // so only the subscription says whether the provider can observe.
    let feed: 'attaching' | 'attached' | 'failed' = 'attaching';
    // The observation-error events heard so far: a heartbeat or a subscription that began before
    // one says nothing of it.
    let told = 0;
    const stopErrors = activityClient.listenObservationErrors((event) => {
      told++;
      setObservationError(event.message);
    });
    const connect = async () => {
      observer.abort();
      observer = new AbortController();
      const { signal } = observer;
      const heard = told;
      feed = 'attaching';
      try {
        await connectActivityStore(store, activityClient, signal);
        if (!stopped && !signal.aborted) {
          feed = 'attached';
          setUnavailable(undefined);
          if (told === heard) setObservationError(undefined);
        }
      } catch (cause) {
        if (!stopped && !signal.aborted) {
          feed = 'failed';
          setUnavailable(parseAppError(cause).detail);
        }
      }
    };
    // The sentence of a lease the host did not renew, or nothing when it did.
    const renew = async () => {
      try {
        await activityClient.heartbeat();
        return undefined;
      } catch (cause) {
        return parseAppError(cause).detail;
      }
    };
    const heartbeat = async () => {
      if (stopped || heartbeating) return;
      heartbeating = true;
      const heard = told;
      try {
        const failure = await renew();
        if (stopped) return;
        if (failure !== undefined) {
          setUnavailable(failure);
        } else if (told === heard) {
          setObservationError(undefined);
        }
        // Recover observation/capability only. Never replay a producer mutation. A heartbeat that
        // got through while the subscription is down makes it again, and the provider can observe
        // when that succeeds.
        if (failure !== undefined || feed === 'failed') await connect();
      } finally {
        heartbeating = false;
      }
    };
    void connect();
    void heartbeat();
    const timer = setInterval(() => {
      void heartbeat();
    }, 10000);
    return () => {
      stopped = true;
      clearInterval(timer);
      observer.abort();
      stopErrors();
    };
  }, [store]);
  const setCollapsed = React.useCallback(
    async (id: string, collapsed: boolean) => {
      store.applyRecord(await activityClient.setPresentation({ id, collapsed }));
    },
    [store],
  );
  const dismissToast = React.useCallback(
    async (id: string) => {
      store.applyRecord(await activityClient.setPresentation({ id, toastDismissed: true }));
    },
    [store],
  );
  const clearHistory = React.useCallback(async () => {
    await activityClient.clearHistory();
    store.applySnapshot(await activityClient.snapshot());
  }, [store]);
  const notify = React.useCallback(
    async ({ title, severity, details, actions }: NotificationOptions) => {
      try {
        const typedActions = actions?.filter(
          (action): action is ActivityAction => 'kind' in action,
        );
        const diagnostics = actions?.filter(
          (action): action is DiagnosticAction => !('kind' in action),
        );
        const record = await activityClient.publishMessage({
          presentation: {
            title,
            details,
            ...(typedActions?.length ? { actions: typedActions } : {}),
          },
          severity,
        });
        if (diagnostics?.length) store.setDiagnosticActions(record.id, diagnostics);
        store.applyRecord(record);
        setNotifyError(undefined);
        return record;
      } catch (cause) {
        setNotifyError(parseAppError(cause).detail);
        return undefined;
      }
    },
    [store],
  );
  const startResourceAction = React.useCallback(
    async (request: StartResourceActionRequest) => {
      const record = await activityClient.startResourceAction(request);
      store.applyRecord(record);
      return record;
    },
    [store],
  );
  const requestCancellation = React.useCallback(
    async (id: string) => {
      const record = await activityClient.requestCancellation(id);
      store.applyRecord(record);
      return record;
    },
    [store],
  );
  const performAction = React.useCallback(
    async (
      record: ActivityRecord,
      action: ActivityAction | number,
      onAction?: (action: ActivityAction, record: ActivityRecord) => void | Promise<void>,
    ) => {
      const key = `${record.id}:${typeof action === 'number' ? `local:${action}` : action.id}`;
      if (busy.current.has(key)) return;
      busy.current.add(key);
      setBusyActions(new Set(busy.current));
      setActionErrors((previous) => {
        const next = new Map(previous);
        next.delete(key);
        return next;
      });
      try {
        if (typeof action === 'number') {
          const callback = store.getDiagnosticActions(record.id)[action];
          if (!callback) throw new Error('Diagnostic action is no longer available');
          await callback.onClick();
        } else if (action.kind === 'cancel-task') await requestCancellation(action.taskId);
        else {
          if (!onAction) throw new Error('Activity action handler is not mounted');
          await onAction(action, record);
        }
      } catch (cause) {
        setActionErrors((previous) => new Map(previous).set(key, parseAppError(cause).detail));
      } finally {
        busy.current.delete(key);
        setBusyActions(new Set(busy.current));
      }
    },
    [requestCancellation, store],
  );
  const openDetails = React.useCallback(
    (id: string) => {
      setSelectedDetailsID(id);
      store.openNotifications();
      void activityClient
        .setPresentation({ id, collapsed: false, read: true })
        .then((record) => {
          store.applyRecord(record);
          setDetailsError(undefined);
        })
        .catch((cause) => setDetailsError(parseAppError(cause).detail));
    },
    [store],
  );
  // The unread count and the actions are read apart from the rest of the activity state, so a reader
  // of either wakes only when its own value changes: a task's progress changes neither.
  const notificationCount = React.useMemo(
    () => view.records.filter((record) => !record.visibility.read).length,
    [view.records],
  );
  const actions = React.useMemo<ActivityActionsValue>(
    () => ({
      notify,
      openNotifications: store.openNotifications,
      startResourceAction,
      requestCancellation,
    }),
    [notify, store, startResourceAction, requestCancellation],
  );
  const value = React.useMemo<ActivityContextValue>(
    () => ({
      store,
      records: view.records,
      activeTasks: view.records.filter(isActiveTask),
      notificationCount,
      centerOpen: view.centerOpen,
      filter: view.filter,
      openNotifications: store.openNotifications,
      closeNotifications: store.closeNotifications,
      setCollapsed,
      dismissToast,
      clearHistory,
      notify,
      startResourceAction,
      requestCancellation,
      performAction,
      busyActions,
      actionErrors,
      unavailable,
      error,
      selectedDetailsID,
      openDetails,
      canHandleAction: (action) => action.kind === 'cancel-task',
    }),
    [
      notificationCount,
      store,
      view,
      setCollapsed,
      dismissToast,
      clearHistory,
      notify,
      startResourceAction,
      requestCancellation,
      performAction,
      busyActions,
      actionErrors,
      unavailable,
      error,
      selectedDetailsID,
      openDetails,
    ],
  );
  return (
    <ActivityActionsContext.Provider value={actions}>
      <NotificationCountContext.Provider value={notificationCount}>
        <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>
      </NotificationCountContext.Provider>
    </ActivityActionsContext.Provider>
  );
}
