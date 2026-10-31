import { useState, type MouseEvent } from 'react';
import { EditorTabs, type TabDescriptor, type TabGroupDescriptor } from '@omniviewdev/base-ui';
import { PAGE_TAB_DRAG_TYPE } from '@/features/windows';
import { usePagePresentation } from '../pagePresentation';
import { toPageTabTransfer, type PagePane } from '../pagesState';
import { canTabLeaveWindow, pageStripInstanceId } from '../workspaceController';
import { usePagesState, useWorkspaceController } from '../WorkspaceProvider';
import { PAGE_GROUP_COLOR_VALUES, PageGroupMenu, PageTabMenu, RenameGroupDialog, type MenuPoint } from './PageTabMenus';
import styles from './Workspace.module.css';

const MIDDLE_BUTTON = 1;

type OpenMenu = { kind: 'tab' | 'group'; id: string; point: MenuPoint; key: number };

/** The page tab strip of one pane, with its "+" button and context menus. */
export function PageTabStrip({ pane }: { pane: PagePane }) {
  const controller = useWorkspaceController();
  const state = usePagesState();
  const paneTabs = pane.tabIds.map((id) => state.tabs[id]);
  const presentation = usePagePresentation(paneTabs);
  const [menu, setMenu] = useState<OpenMenu | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);

  const tabs: TabDescriptor[] = paneTabs.map((tab) => {
    const title = presentation.titleOf(tab);
    return {
      id: tab.id,
      title,
      icon: presentation.iconOf(tab),
      pinned: tab.pinned,
      groupId: tab.groupId ?? null,
      payload: toPageTabTransfer({ ...tab, title }),
    };
  });
  const groups: TabGroupDescriptor[] = state.groups.map((group) => ({
    id: group.id,
    title: group.title,
    color: PAGE_GROUP_COLOR_VALUES[group.color],
    collapsed: group.collapsed,
  }));

  const openMenu = (kind: OpenMenu['kind'], id: string, event: MouseEvent) => {
    event.preventDefault();
    setMenu({ kind, id, point: { x: event.clientX, y: event.clientY }, key: event.timeStamp });
  };

  return (
    <div
      className={styles.StripRow}
      data-ov-page-strip=''
      data-ov-pane-id={pane.id}
      onAuxClick={(event) => {
        // Middle-click closes a tab, as in a browser.
        const tabId = event.button === MIDDLE_BUTTON && event.target instanceof Element
          ? event.target.closest<HTMLElement>('[data-tab-id]')?.dataset.tabId
          : undefined;
        if (tabId && tabId in state.tabs) {
          event.preventDefault();
          controller.closeTabs([tabId]);
        }
      }}
    >
      <EditorTabs
        className={styles.Strip}
        aria-label={state.panes.length > 1 ? `Page tabs, pane ${state.panes.indexOf(pane) + 1}` : 'Page tabs'}
        variant='pill'
        size='sm'
        instanceId={pageStripInstanceId(pane.id)}
        dragType={PAGE_TAB_DRAG_TYPE}
        detachToBroker
        detachable={canTabLeaveWindow(state)}
        tabs={tabs}
        groups={groups}
        activeId={pane.activeTabId ?? undefined}
        onActiveChange={(tabId) => {
          controller.dispatch({ type: 'activate', tabId }); 
        }}
        onCloseTab={(tabId) => {
          controller.closeTabs([tabId]); 
        }}
        onReorder={(nextTabs) => {
          controller.dispatch({ type: 'reorder', paneId: pane.id, tabIds: nextTabs.map((tab) => tab.id) }); 
        }}
        onToggleGroupCollapsed={(groupId) => {
          const collapsed = !state.groups.find((group) => group.id === groupId)?.collapsed;
          controller.dispatch({ type: 'updateGroup', groupId, changes: { collapsed } });
        }}
        onContextMenuTab={(tabId, event) => {
          openMenu('tab', tabId, event); 
        }}
        onGroupContextMenu={(groupId, event) => {
          openMenu('group', groupId, event); 
        }}
        onAttachTab={(commit) => {
          controller.attachToPane(pane.id, commit); 
        }}
        onTabTransferred={(commit) => {
          controller.tabTransferred(commit); 
        }}
        onDetachCommit={(commit) => {
          controller
            .moveTabToNewWindow(commit.id, { clientX: commit.clientX, clientY: commit.clientY })
            .catch((error: unknown) => {
              console.error('[workspace] tearing off the tab failed', error);
            });
        }}
      />
      {menu?.kind === 'tab' && (
        <PageTabMenu key={menu.key} tabId={menu.id} point={menu.point} onClose={() => {
          setMenu(null); 
        }} />
      )}
      {menu?.kind === 'group' && (
        <PageGroupMenu
          key={menu.key}
          groupId={menu.id}
          point={menu.point}
          onClose={() => {
            setMenu(null); 
          }}
          onRename={setRenamingGroupId}
        />
      )}
      {renamingGroupId && <RenameGroupDialog groupId={renamingGroupId} onClose={() => {
        setRenamingGroupId(null); 
      }} />}
    </div>
  );
}
