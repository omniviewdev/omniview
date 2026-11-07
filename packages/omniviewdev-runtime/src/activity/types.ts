import type { AccessRoute, ActionRequest, ResourceReference } from '../resource/v2/domain';

export type ActivitySeverity = 'info' | 'success' | 'warning' | 'error';
export type ActivityProgress =
  | { kind: 'indeterminate'; message?: string }
  | { kind: 'units'; current: string; total: string; unit: string }
  | { kind: 'steps'; current: string; total: string; label: string };
export type ActivityMetric = {
  id: string;
  label: string;
  value: string;
  unit?: string;
  tone?: ActivitySeverity;
};
export type ResourceNavigationIntent = {
  pluginID: string;
  targetId: string;
  route: AccessRoute;
  reference: ResourceReference;
  representation: string;
};
export type ResourceActionIntent = { pluginID: string; request: ActionRequest };
export type ActivityAction =
  | { id: string; kind: 'navigate-resource'; label: string; target: ResourceNavigationIntent }
  | { id: string; kind: 'resource-action'; label: string; intent: ResourceActionIntent }
  | { id: string; kind: 'cancel-task'; label: string; taskId: string };
export type ActivityPresentation = {
  title: string;
  message?: string;
  details?: string;
  progress?: ActivityProgress;
  metrics?: ActivityMetric[];
  actions?: ActivityAction[];
};
export type ActivitySource = {
  pluginID?: string;
  connectionID?: string;
  resource?: ResourceNavigationIntent;
};
export type TaskState =
  'starting' | 'running' | 'paused' | 'succeeded' | 'failed' | 'cancelled' | 'unknown';
export type ActivityRecord = {
  id: string;
  revision: number;
  source: ActivitySource;
  kind: 'task' | 'alert' | 'message';
  severity: ActivitySeverity;
  createdAt: string;
  updatedAt: string;
  observedAt?: string;
  parentId?: string;
  presentation: ActivityPresentation;
  task?: {
    state: TaskState;
    cancellation: 'unsupported' | 'available' | 'requested' | 'acknowledged';
    unknownReason?: string;
  };
  alert?: {
    key: string;
    state: 'firing' | 'resolved' | 'unknown';
    occurrences: number;
    acknowledgedAt?: string;
    snoozedUntil?: string;
  };
  visibility: { collapsed: boolean; toastDismissed: boolean; read: boolean };
};
export type ActivitySnapshot = { revision: number; records: ActivityRecord[] };
export type ActivityChange = { revision: number; record?: ActivityRecord; removedIds?: string[] };
export type ActivitySubscription = { id: string; snapshot: ActivitySnapshot };
export type ActivityObservationError = { id: string; pluginID: string; message: string };
export type ActivitySpec = {
  presentation: ActivityPresentation;
  source?: ActivitySource;
  severity?: ActivitySeverity;
  parentId?: string;
};
export type BeginTaskRequest = ActivitySpec;
export type ReportTaskRequest = {
  id: string;
  presentation: ActivityPresentation;
  state?: 'running' | 'paused';
  observedAt?: string;
};
export type FinishTaskRequest = {
  id: string;
  state: 'succeeded' | 'failed' | 'cancelled' | 'unknown';
  presentation?: ActivityPresentation;
};
export type AlertRequest = ActivitySpec & { key: string; observedAt: string };
export type ResolveAlertRequest = { key: string; observedAt: string };
export type SetPresentationRequest = {
  id: string;
  collapsed?: boolean;
  toastDismissed?: boolean;
  read?: boolean;
  snoozedUntil?: string;
  acknowledged?: boolean;
};
export type StartResourceActionRequest = {
  pluginID: string;
  request: ActionRequest;
  presentation: ActivityPresentation;
  parentId?: string;
};
export type ActivityFilter = 'all' | 'active' | 'attention';
/** Callbacks are trusted, same-session UI behavior. They never cross the host bridge. */
export type DiagnosticAction = { label: string; onClick: () => void | Promise<void> };
export type NotificationOptions = {
  title: string;
  severity: ActivitySeverity;
  details?: string;
  actions?: Array<ActivityAction | DiagnosticAction>;
};
