import { ExecClient, LogsClient, WindowClient } from '@omniviewdev/runtime/api';
import { currentWindow } from '@/features/windows';
import {
  type SerializedDrawerTab,
  collectDrawerTabIdsClaimedByOtherWindows,
  isTerminalSessionTab,
} from './drawerSlot';

export type DrawerRestorePlan = {
  /** Restored tabs whose backend session no longer exists (e.g. after an app restart). */
  deadTabIds: Set<string>;
  /** Live terminal sessions no window shows yet (main window only). */
  orphanedSessionTabs: SerializedDrawerTab[];
};

/**
 * Reconciles this window's restored tabs with the live backend sessions. The
 * main window also adopts terminal sessions that survived a reload, except
 * those another window's saved drawer state owns.
 */
export async function planDrawerRestore(restoredTabs: SerializedDrawerTab[]): Promise<DrawerRestorePlan> {
  const [execSessions, logSessions, statesByWindow] = await Promise.all([
    ExecClient.ListSessions(),
    LogsClient.ListSessions(),
    currentWindow.isMain ? WindowClient.ListStates() : Promise.resolve({}),
  ]);
  const liveExecSessions = execSessions.filter((session) => session !== null);
  const liveExecIds = new Set(liveExecSessions.map((session) => session.id));
  const liveLogIds = new Set(logSessions.filter((session) => session !== null).map((session) => session.id));

  const deadTabIds = new Set(restoredTabs
    .filter((tab) => (isTerminalSessionTab(tab) && !liveExecIds.has(tab.id))
      || (tab.variant === 'logs' && !liveLogIds.has(tab.id)))
    .map((tab) => tab.id));

  if (!currentWindow.isMain) {
    return { deadTabIds, orphanedSessionTabs: [] };
  }

  const claimedIds = collectDrawerTabIdsClaimedByOtherWindows(statesByWindow, currentWindow.name);
  const restoredIds = new Set(restoredTabs.map((tab) => tab.id));
  const now = new Date().toISOString();
  const orphanedSessionTabs = liveExecSessions
    .filter((session) => !claimedIds.has(session.id) && !restoredIds.has(session.id))
    .map((session): SerializedDrawerTab => ({
      id: session.id,
      title: `Session ${session.id.substring(0, 8)}`,
      variant: 'terminal',
      properties: session.labels,
      createdAt: now,
      updatedAt: now,
    }));
  return { deadTabIds, orphanedSessionTabs };
}
