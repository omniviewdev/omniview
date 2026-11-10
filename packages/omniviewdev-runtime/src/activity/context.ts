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
function useActivityActionsContext() {
  const value = useContext(ActivityActionsContext);
  if (!value) throw new Error('Activity hooks must be used within ActivityProvider');
  return value;
}
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
    error,
  };
}
export function useNotifications() {
  const { notify, openNotifications } = useActivityActionsContext();
  const notificationCount = useContext(NotificationCountContext);
  if (notificationCount === undefined) throw new Error('Activity hooks must be used within ActivityProvider');
  return { notify, openNotifications, notificationCount };
}
export function useActivityActions() {
  const { startResourceAction, requestCancellation } = useActivityActionsContext();
  return { startResourceAction, requestCancellation };
}
export { useActivityContext };
