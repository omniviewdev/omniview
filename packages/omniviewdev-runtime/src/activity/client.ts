import { Call, Events, type CancellablePromise } from '@wailsio/runtime';
import { encodeRequestJSON } from '../resource/v2/requestJSON';
import type {
  ActivityChange,
  ActivityObservationError,
  ActivityRecord,
  ActivitySnapshot,
  ActivitySpec,
  ActivitySubscription,
  AlertRequest,
  BeginTaskRequest,
  FinishTaskRequest,
  ReportTaskRequest,
  ResolveAlertRequest,
  SetPresentationRequest,
  StartResourceActionRequest,
} from './types';

const service = 'github.com/omniviewdev/omniview/backend/pkg/activity.FrontendService';
function invoke<T>(method: string, ...args: unknown[]): CancellablePromise<T> {
  return Call.ByName(`${service}.${method}`, ...args);
}

// A producer capability belongs to this document, not an observing React mount.
// Unsubscribing a view leaves this capability valid until its heartbeat expires.
let producerSession: Promise<ActivitySubscription> | undefined;
let unclaimedSubscription: Promise<ActivitySubscription> | undefined;
function producer() {
  if (!producerSession) {
    producerSession = invoke<ActivitySubscription>('Subscribe');
    unclaimedSubscription = producerSession;
  }
  return producerSession;
}
function subscribe(): Promise<ActivitySubscription> {
  if (unclaimedSubscription) {
    const subscription = unclaimedSubscription;
    unclaimedSubscription = undefined;
    return subscription;
  }
  const subscription = invoke<ActivitySubscription>('Subscribe');
  producerSession ??= subscription;
  return subscription;
}
async function report<T>(method: string, ...args: unknown[]): Promise<T> {
  const session = await producer();
  return invoke<T>(method, session.id, ...args);
}
async function heartbeat(): Promise<void> {
  const current = producer();
  try {
    const session = await current;
    await invoke<void>('Heartbeat', session.id);
  } catch (error) {
    if (producerSession === current) {
      producerSession = undefined;
      unclaimedSubscription = undefined;
    }
    throw error;
  }
}

export const activityClient = {
  heartbeat,
  subscribe,
  attach: (id: string) => invoke<ActivitySnapshot>('Attach', id),
  snapshot: () => invoke<ActivitySnapshot>('Snapshot'),
  unsubscribe: (id: string) => invoke<void>('Unsubscribe', id),
  listen: (id: string, apply: (change: ActivityChange) => void) =>
    Events.On(`activity/change/${id}`, (event) => apply(event.data as ActivityChange)),
  listenObservationErrors: (receive: (error: ActivityObservationError) => void) =>
    Events.On('activity/observation-error', (event) =>
      receive(event.data as ActivityObservationError),
    ),
  beginTask: (request: BeginTaskRequest) =>
    report<ActivityRecord>('BeginTask', encodeRequestJSON(request)),
  reportTask: (request: ReportTaskRequest) =>
    report<ActivityRecord>('ReportTask', encodeRequestJSON(request)),
  finishTask: (request: FinishTaskRequest) =>
    report<ActivityRecord>('FinishTask', encodeRequestJSON(request)),
  publishMessage: (request: ActivitySpec) =>
    report<ActivityRecord>('PublishMessage', encodeRequestJSON(request)),
  upsertAlert: (request: AlertRequest) =>
    report<ActivityRecord>('UpsertAlert', encodeRequestJSON(request)),
  resolveAlert: (request: ResolveAlertRequest) => report<ActivityRecord>('ResolveAlert', request),
  setPresentation: (request: SetPresentationRequest) =>
    invoke<ActivityRecord>('SetPresentation', request),
  clearHistory: () => invoke<void>('ClearHistory'),
  requestCancellation: (id: string) => invoke<ActivityRecord>('RequestCancellation', id),
  startResourceAction: (request: StartResourceActionRequest) =>
    invoke<ActivityRecord>('StartResourceAction', encodeRequestJSON(request, [request.pluginID])),
};
export type ActivityClient = typeof activityClient;
