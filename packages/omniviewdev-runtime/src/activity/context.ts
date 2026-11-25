import { createContext, useContext } from 'react';
import type {
  ActivityAction,
  ActivityFilter,
  ActivityRecord,
  NotificationOptions,
  StartResourceActionRequest,
} from './types';
import type { ActivityStore } from './store';

export type ActivityContextValue = {
  store: ActivityStore;
  records: ActivityRecord[];
  activeTasks: ActivityRecord[];
  notificationCount: number;
  centerOpen: boolean;
  filter: ActivityFilter;
  openNotifications: (filter?: ActivityFilter) => void;
  closeNotifications: () => void;
  setCollapsed: (id: string, collapsed: boolean) => Promise<void>;
  dismissToast: (id: string) => Promise<void>;
  clearHistory: () => Promise<void>;
  notify: (options: NotificationOptions) => Promise<ActivityRecord | undefined>;
  startResourceAction: (request: StartResourceActionRequest) => Promise<ActivityRecord>;
  requestCancellation: (id: string) => Promise<ActivityRecord>;
  performAction: (
    record: ActivityRecord,
    action: ActivityAction | number,
    onAction?: (action: ActivityAction, record: ActivityRecord) => void | Promise<void>,
  ) => Promise<void>;
  canHandleAction: (action: ActivityAction, record: ActivityRecord) => boolean;
  busyActions: ReadonlySet<string>;
  actionErrors: ReadonlyMap<string, string>;
  /**
   * Why the provider cannot observe the host's activity service right now: a subscription or a
   * heartbeat that failed, and none has made it good. Absent while it can. The records held may be
   * stale while it is set. It clears when a later subscription succeeds, or a later heartbeat does
   * (the subscription is then made again). A failed call or the host's observation-error event
   * never sets it.
   */
  unavailable?: string;
  /**
   * What the toast and the notification center say: the first failure the provider holds, in this
   * order: the host's `activity/observation-error` event (a host action whose updates could not be
   * recorded), `unavailable`, a failed `notify`, a failed `openDetails`. Each goes when its own
   * source recovers, and no other recovery takes it away: the event with the next heartbeat or
   * subscription that succeeds, a failed call with the next success of the same call.
   */
  error?: string;
  selectedDetailsID?: string;
  openDetails: (id: string) => void;
  restoreFocus?: () => void;
};
export const ActivityContext = createContext<ActivityContextValue | undefined>(undefined);
/**
 * The actions the provider binds to its store once. They never change while the provider lives, so
 * a reader of only these wakes on no activity update, however often records change.
 */
export type ActivityActionsValue = Pick<
  ActivityContextValue,
  'notify' | 'openNotifications' | 'startResourceAction' | 'requestCancellation'
>;
export const ActivityActionsContext = createContext<ActivityActionsValue | undefined>(undefined);
/** The unread count alone. A number replaces itself only when it changes, so its readers wake only then. */
export const NotificationCountContext = createContext<number | undefined>(undefined);
function useActivityContext() {
  const value = useContext(ActivityContext);
  if (!value) throw new Error('Activity hooks must be used within ActivityProvider');
  return value;
}
/**
 * Read the provider's action callbacks without subscribing to activity records.
 * @throws {Error} If no ActivityProvider is mounted above the caller.
 */
function useActivityActionsContext() {
  const value = useContext(ActivityActionsContext);
  if (!value) throw new Error('Activity hooks must be used within ActivityProvider');
  return value;
}
/**
 * Return the activity records, the notification center controls and the provider's failures:
 * `unavailable` (the service cannot be observed right now) and `error` (the first failure it holds).
 * @throws {Error} If no ActivityProvider is mounted above the caller.
 */
export function useActivities() {
  const {
    records,
    activeTasks,
    notificationCount,
    centerOpen,
    filter,
    openNotifications,
    closeNotifications,
    setCollapsed,
    dismissToast,
    clearHistory,
    unavailable,
    error,
  } = useActivityContext();
  return {
    records,
    activeTasks,
    notificationCount,
    centerOpen,
    filter,
    openNotifications,
    closeNotifications,
    setCollapsed,
    dismissToast,
    clearHistory,
    unavailable,
    error,
  };
}
/**
 * Return notification controls and the unread record count. Activity updates that leave the
 * count unchanged do not trigger a context update for this hook. `notify` resolves to undefined
 * on publication failure; the provider exposes the failure through its activity error state.
 * @throws {Error} If no ActivityProvider is mounted above the caller.
 */
export function useNotifications() {
  const { notify, openNotifications } = useActivityActionsContext();
  const notificationCount = useContext(NotificationCountContext);
  if (notificationCount === undefined) throw new Error('Activity hooks must be used within ActivityProvider');
  return { notify, openNotifications, notificationCount };
}
/**
 * Return resource-action and cancellation controls without subscribing to activity records.
 * Both controls resolve to the updated record and propagate host request failures as rejections.
 * @throws {Error} If no ActivityProvider is mounted above the caller.
 */
export function useActivityActions() {
  const { startResourceAction, requestCancellation } = useActivityActionsContext();
  return { startResourceAction, requestCancellation };
}
export { useActivityContext };
