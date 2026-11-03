import React from 'react';
import { useToast } from '@omniviewdev/base-ui';
import { parseAppError } from '../errors/parseAppError';
import { ActivityContext, useActivityContext } from './context';
import { isActiveTask } from './store';
import { ActivityCard } from './ActivityCard';
import { NotificationCenter } from './NotificationCenter';
import type { ActivityAction, ActivityRecord } from './types';

export type ActivitySurfacesProps = {
  onAction?: (action: ActivityAction, record: ActivityRecord) => void | Promise<void>;
  canHandleAction?: (action: ActivityAction, record: ActivityRecord) => boolean;
};

function activitySummary(record: ActivityRecord) {
  return [record.presentation.title, record.task?.state ?? record.alert?.state]
    .filter(Boolean)
    .join('. ');
}

/** Mount once inside host theme and action contexts, beneath ActivityProvider. */
export function ActivitySurfaces({ onAction, canHandleAction }: ActivitySurfacesProps) {
  const context = useActivityContext();
  const { performAction: performContextAction } = context;
  const toastAPI = useToast();
  const toastRef = React.useRef(toastAPI);
  React.useEffect(() => {
    toastRef.current = toastAPI;
  }, [toastAPI]);
  const [surfaceError, setSurfaceError] = React.useState<string>();
  const [projectionVersion, refreshProjection] = React.useReducer((value) => value + 1, 0);
  const projected = React.useRef<{ id: string; terminal: boolean; summary: string } | undefined>(
    undefined,
  );
  const admitted = React.useRef(new Set<string>());
  const lastExternalFocus = React.useRef<HTMLElement | null>(null);
  React.useEffect(() => {
    const track = () => {
      const target = document.activeElement;
      if (target instanceof HTMLElement && !target.closest('[data-activity-surface]'))
        lastExternalFocus.current = target;
    };
    track();
    document.addEventListener('focusin', track);
    return () => document.removeEventListener('focusin', track);
  }, []);
  const restoreFocus = React.useCallback(() => {
    if (lastExternalFocus.current?.isConnected) lastExternalFocus.current.focus();
  }, []);
  const performAction = React.useCallback(
    (record: ActivityRecord, action: ActivityAction | number) =>
      performContextAction(record, action, onAction),
    [performContextAction, onAction],
  );
  const available = React.useCallback(
    (action: ActivityAction, record: ActivityRecord) =>
      action.kind === 'cancel-task' ||
      (!!onAction && (!canHandleAction || canHandleAction(action, record))),
    [onAction, canHandleAction],
  );
  const value = React.useMemo(
    () => ({
      ...context,
      performAction,
      canHandleAction: available,
      restoreFocus,
      error: surfaceError ?? context.error,
    }),
    [context, performAction, available, restoreFocus, surfaceError],
  );
  const { dismissToast, error, openNotifications } = value;
  React.useEffect(() => {
    const api = toastRef.current;
    const existing = projected.current;
    const current = existing && value.records.find((record) => record.id === existing.id);
    if (existing && (value.centerOpen || !current || current.visibility.toastDismissed)) {
      projected.current = undefined;
      api.dismiss(`activity:${existing.id}`);
    }
    const candidates = value.records.filter(
      (record) =>
        !record.visibility.toastDismissed &&
        !admitted.current.has(record.id) &&
        !(record.alert?.snoozedUntil && Date.parse(record.alert.snoozedUntil) > Date.now()),
    );
    if (value.centerOpen) {
      for (const record of candidates) admitted.current.add(record.id);
      return;
    }
    if (!projected.current && candidates.length) {
      const selected = candidates[0];
      for (const record of candidates) admitted.current.add(record.id);
      projected.current = {
        id: selected.id,
        terminal: !isActiveTask(selected) && selected.alert?.state !== 'firing',
        summary: activitySummary(selected),
      };
      api.toast(projected.current.summary, {
        id: `activity:${selected.id}`,
        severity: selected.severity === 'error' ? 'danger' : selected.severity,
        duration: projected.current.terminal ? 8000 : 0,
        content: (
          <ActivityContext.Provider value={value}>
            <ActivityCard record={selected} toast />
          </ActivityContext.Provider>
        ),
        onDismiss: (reason) => {
          if (projected.current?.id === selected.id) projected.current = undefined;
          if (reason === 'close' || reason === 'action')
            void dismissToast(selected.id).catch((cause) =>
              setSurfaceError(parseAppError(cause).detail),
            );
          refreshProjection();
        },
      });
      return;
    }
    for (const record of candidates) admitted.current.add(record.id);
    const active = projected.current;
    const record = active && value.records.find((item) => item.id === active.id);
    if (!active || !record) return;
    const terminal = !isActiveTask(record) && record.alert?.state !== 'firing';
    api.update(`activity:${record.id}`, {
      content: (
        <ActivityContext.Provider value={value}>
          <ActivityCard record={record} toast />
        </ActivityContext.Provider>
      ),
      severity: record.severity === 'error' ? 'danger' : record.severity,
      ...(terminal !== active.terminal ? { duration: terminal ? 8000 : 0 } : {}),
      ...(activitySummary(record) !== active.summary ? { message: activitySummary(record) } : {}),
    });
    active.terminal = terminal;
    active.summary = activitySummary(record);
  }, [value, dismissToast, projectionVersion]);
  React.useEffect(
    () => () => {
      const current = projected.current;
      projected.current = undefined;
      if (current) toastRef.current.dismiss(`activity:${current.id}`);
    },
    [],
  );
  React.useEffect(() => {
    if (error)
      toastRef.current.toast(error, {
        severity: 'danger',
        title: 'Activity observation',
        action: { label: 'Details', onClick: () => openNotifications() },
      });
  }, [error, openNotifications]);
  return (
    <ActivityContext.Provider value={value}>
      <NotificationCenter />
    </ActivityContext.Provider>
  );
}
