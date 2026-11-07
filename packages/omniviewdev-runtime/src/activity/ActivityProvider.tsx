import React from 'react';
import { parseAppError } from '../errors/parseAppError';
import { activityClient } from './client';
import { ActivityContext, type ActivityContextValue } from './context';
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
  const [error, setError] = React.useState<string>();
  const [observationError, setObservationError] = React.useState<string>();
  const [busyActions, setBusyActions] = React.useState<ReadonlySet<string>>(new Set());
  const busy = React.useRef(new Set<string>());
  const [actionErrors, setActionErrors] = React.useState<ReadonlyMap<string, string>>(new Map());
  const [selectedDetailsID, setSelectedDetailsID] = React.useState<string>();

  React.useEffect(() => {
    let stopped = false;
    let heartbeating = false;
    let observer = new AbortController();
    const stopErrors = activityClient.listenObservationErrors((event) =>
      setObservationError(event.message),
    );
    const connect = async () => {
      observer.abort();
      observer = new AbortController();
      const { signal } = observer;
      try {
        await connectActivityStore(store, activityClient, signal);
        if (!stopped && !signal.aborted) setError(undefined);
      } catch (cause) {
        if (!stopped && !signal.aborted) setError(parseAppError(cause).detail);
      }
    };
    const heartbeat = async () => {
      if (stopped || heartbeating) return;
      heartbeating = true;
      try {
        await activityClient.heartbeat();
      } catch (cause) {
        if (!stopped) {
          setError(parseAppError(cause).detail);
          // Recover observation/capability only. Never replay a producer mutation.
          await connect();
        }
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
        return record;
      } catch (cause) {
        const detail = parseAppError(cause).detail;
        setError(detail);
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
        .then(store.applyRecord)
        .catch((cause) => setError(parseAppError(cause).detail));
    },
    [store],
  );
  const value = React.useMemo<ActivityContextValue>(
    () => ({
      store,
      records: view.records,
      activeTasks: view.records.filter(isActiveTask),
      notificationCount: view.records.filter((record) => !record.visibility.read).length,
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
      error: observationError ?? error,
      selectedDetailsID,
      openDetails,
      canHandleAction: (action) => action.kind === 'cancel-task',
    }),
    [
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
      error,
      observationError,
      selectedDetailsID,
      openDetails,
    ],
  );
  return <ActivityContext.Provider value={value}>{children}</ActivityContext.Provider>;
}
