import React from 'react';

import {
  type AttachCommit,
  type DetachCommit,
  type TabDescriptor,
  type TabTransferCommit,
  ContextMenu,
  EditorTabs,
  IconButton,
  Separator,
  Spinner,
} from '@omniviewdev/base-ui';

// provider
import {
  type BottomDrawerTab,
  useBottomDrawer,
  useSettings,
  useSnackbar,
  parseAppError,
  showAppError,
} from '@omniviewdev/runtime';

// project imports
import Icon from '@/components/icons/Icon';
import { LuChevronDown, LuChevronUp, LuMaximize, LuMinimize, LuPlus } from 'react-icons/lu';
import { SessionOptions, type LogSessionRequest } from '@omniviewdev/runtime/models';
import { ExecClient, LogsClient, WindowClient } from '@omniviewdev/runtime/api';
import {
  DRAWER_TAB_DRAG_TYPE,
  type WindowClientPoint,
  type WindowInfo,
  currentWindow,
  deliverTabToWindow,
  openWindow,
  useWindowsList,
} from '@/features/windows';

import { bottomDrawerChannel } from './events';
import {
  buildPanelDrawerSlot,
  isPendingDrawerTab,
  parseSerializedDrawerTab,
  serializeDrawerTab,
} from './drawerSlot';
import { useBottomDrawerWindow } from './windowContext';
import { devToolsChannel } from '@/features/devtools/events';
import { pluginLogChannel } from '@/features/pluginlogs/events';
import { Events } from '@omniviewdev/runtime/runtime';
import styles from './tabs.module.css';

/** Minimize/expand/fullscreen controls; only the workspace bottom drawer has them. */
export type DrawerResizeControls = {
  isMinimized: boolean;
  isFullscreen: boolean;
  onMinimize: () => void;
  onExpand: () => void;
  onFullscreen: () => void;
};

type Props = {
  resizeControls?: DrawerResizeControls;
};

type WindowMenuTarget = { name: string; label: string };

/** "Main window" for main, "Window N" for the others, numbered in creation order. */
function labelOtherWindows(windows: WindowInfo[]): WindowMenuTarget[] {
  const destinations = windows.filter((window) => window.kind !== 'settings');
  const secondaryNames = destinations.filter((window) => window.name !== 'main').map((window) => window.name);
  return destinations
    .filter((window) => window.name !== currentWindow.name)
    .map((window) => ({
      name: window.name,
      label: window.name === 'main' ? 'Main window' : `Window ${secondaryNames.indexOf(window.name) + 1}`,
    }));
}

function renderTabIcon(tab: BottomDrawerTab): React.ReactNode {
  if (tab.properties?.status === 'connecting') {
    return <Spinner size='xs' />;
  }

  return typeof tab.icon === 'string' ? <Icon name={tab.icon} size={14} /> : tab.icon;
}

/**
 * Renders the tabs for the bottom drawer. Tabs move between windows by drag
 * (onto another window's drawer strip, or released outside any window to tear
 * off into a new panel window) and by the tab context menu.
 */
const BottomDrawerTabs: React.FC<Props> = ({ resizeControls }) => {
  const { tabs, focused, focusTab, closeTab, closeTabs, createTab, updateTab, reorderTab } = useBottomDrawer();
  const { transferTabOut, adoptTabs } = useBottomDrawerWindow();
  const { showSnackbar } = useSnackbar();
  const { settings } = useSettings();
  const windows = useWindowsList();
  const canResize = tabs.length > 0;
  // One context menu serves the whole strip; right-clicking a tab records which.
  const [menuTabId, setMenuTabId] = React.useState<string | null>(null);

  const isPanelWindow = currentWindow.kind === 'panel';
  // A panel holding a single tab has nothing to tear off; moving it to another window still works.
  const canTearOff = !(isPanelWindow && tabs.length <= 1);
  const otherWindows = React.useMemo(() => labelOtherWindows(windows), [windows]);

  const createTerminal = React.useCallback(() => {
    const tempId = `pending-${crypto.randomUUID()}`;
    createTab({
      id: tempId,
      title: 'Connecting...',
      variant: 'terminal',
      icon: 'LuSquareTerminal',
      properties: { status: 'connecting' },
    });
    // No configured shell: an empty command lets the backend start the user's login shell.
    const shell = settings['terminal.defaultShell'];
    ExecClient.CreateTerminal(SessionOptions.createFrom({ command: typeof shell === 'string' && shell.length > 0 ? [shell] : [] }))
      .then((session) => {
        if (!session) {
          throw new Error('terminal session was not created');
        }

        updateTab(
          { id: tempId },
          {
            id: session.id,
            title: `Session ${session.id.substring(0, 8)}`,
            properties: { status: 'connected' },
          },
        );
      })
      .catch((err: unknown) => {
        updateTab(
          { id: tempId },
          { properties: { status: 'error', error: parseAppError(err).detail } },
        );
        console.error(err);
      });
  }, [createTab, updateTab, settings]);

  // The app menu event reaches every window; only the focused one opens a terminal.
  React.useEffect(() => Events.On('menu/view/terminal/create', () => {
    if (document.hasFocus()) {
      createTerminal();
    }
  }), [createTerminal]);

  // handle signals from across the app through the event bus
  React.useEffect(() => {
    const unsubscribeCreateSession = bottomDrawerChannel.on('onCreateSession', ({ plugin, connection, opts, icon, label, replaceSessionId }) => {
      const tempId = `pending-${crypto.randomUUID()}`;
      const pendingTab = {
        id: tempId,
        title: label ?? 'Connecting...',
        variant: 'terminal' as const,
        icon: icon ?? 'LuSquareTerminal',
        properties: {
          status: 'connecting',
          error: undefined,
          pluginID: plugin,
          connectionID: connection,
          opts: { ...opts },
        },
      };
      if (replaceSessionId) {
        updateTab({ id: replaceSessionId }, pendingTab);
        ExecClient.CloseSession(replaceSessionId).catch((err: unknown) => {
          console.error('Failed to close replaced session:', err);
        });
      } else {
        createTab(pendingTab);
      }

      ExecClient.CreateSession(plugin, connection, opts)
        .then((session) => {
          if (!session) {
            throw new Error('terminal session was not created');
          }

          updateTab(
            { id: tempId },
            {
              id: session.id,
              title: label ?? `Session ${session.id.substring(0, 8)}`,
              properties: {
                status: 'connected',
                pluginID: plugin,
                connectionID: connection,
                opts: { ...opts },
              },
            },
          );
        })
        .catch((err: unknown) => {
          updateTab(
            { id: tempId },
            {
              properties: {
                status: 'error',
                error: parseAppError(err).detail,
                pluginID: plugin,
                connectionID: connection,
                opts: { ...opts },
              },
            },
          );
          console.error('Failed to create session:', err);
        });
    });

    const unsubscribeCreateLogSession = bottomDrawerChannel.on('onCreateLogSession', ({
      plugin, connection, resourceKey, resourceID, resourceData, reference, route, target, follow, tailLines, icon, label, params,
    }) => {
      const opts: LogSessionRequest = {
        resource_key: resourceKey,
        resource_id: resourceID,
        resource_data: resourceData,
        reference,
        route,
        options: {
          target: target ?? '',
          follow: follow ?? true,
          include_previous: false,
          include_timestamps: true,
          tail_lines: tailLines ?? 1000,
          since_seconds: 0,
          limit_bytes: 0,
          include_source_events: true,
          params: params ?? {},
        },
      };
      LogsClient.CreateSession(plugin, connection, opts)
        .then((session) => {
          if (!session) {
            throw new Error('log session was not created');
          }

          createTab({
            id: session.id,
            title: label ?? `Logs ${session.id.substring(0, 8)}`,
            variant: 'logs',
            icon: icon ?? 'LuLogs',
          });
        })
        .catch((err: unknown) => {
          console.error('Failed to create log session:', err);
        });
    });

    const unsubscribeSessionClosed = bottomDrawerChannel.on('onSessionClosed', ({ id: sessionId }) => {
      closeTab({ id: sessionId });
    });

    const unsubscribeOpenBuildOutput = devToolsChannel.on('onOpenBuildOutput', (pluginId) => {
      const tabId = `devbuild-${pluginId}`;
      const existing = tabs.find(
        (tab) => tab.variant === 'devbuild' && tab.id === tabId,
      );

      if (existing) {
        focusTab({ id: existing.id });
      } else {
        createTab({
          id: tabId,
          title: `Build: ${pluginId}`,
          variant: 'devbuild',
          icon: 'LuHammer',
        });
      }
    });

    const unsubscribeOpenEditorDebug = devToolsChannel.on('onOpenEditorDebug', () => {
      const tabId = 'editor-debug';
      const existing = tabs.find(
        (tab) => tab.variant === 'editor-debug' && tab.id === tabId,
      );

      if (existing) {
        focusTab({ id: existing.id });
      } else {
        createTab({
          id: tabId,
          title: 'Editor Debug',
          variant: 'editor-debug',
          icon: 'LuFileCode',
        });
      }
    });

    const unsubscribeOpenPluginLogs = pluginLogChannel.on('onOpenPluginLogs', (pluginId) => {
      const tabId = `pluginlogs-${pluginId}`;
      const existing = tabs.find(
        (tab) => tab.variant === 'plugin-logs' && tab.id === tabId,
      );

      if (existing) {
        focusTab({ id: existing.id });
      } else {
        createTab({
          id: tabId,
          title: `${pluginId} Logs`,
          variant: 'plugin-logs',
          icon: 'LuScroll',
        });
      }
    });

    // DEV-only keyboard shortcut: Ctrl+Shift+E opens editor debug panel
    const handleEditorDebugShortcut = (e: KeyboardEvent) => {
      if (import.meta.env.DEV && e.ctrlKey && e.shiftKey && e.key === 'E') {
        e.preventDefault();
        devToolsChannel.emit('onOpenEditorDebug');
      }
    };

    document.addEventListener('keydown', handleEditorDebugShortcut);

    return () => {
      unsubscribeCreateSession();
      unsubscribeCreateLogSession();
      unsubscribeSessionClosed();
      unsubscribeOpenBuildOutput();
      unsubscribeOpenEditorDebug();
      unsubscribeOpenPluginLogs();
      document.removeEventListener('keydown', handleEditorDebugShortcut);
    };
  }, [tabs, createTab, updateTab, closeTab, focusTab]);

  // ===================================== MOVING TABS ===================================== //

  const moveTabToNewWindow = React.useCallback(async (tab: BottomDrawerTab, pointer?: WindowClientPoint) => {
    try {
      await openWindow({ kind: 'panel', slots: { drawer: buildPanelDrawerSlot(serializeDrawerTab(tab)) }, pointer });
      transferTabOut(tab.id);
    } catch (err) {
      showAppError(showSnackbar, err, 'Failed to move the tab to a new window');
    }
  }, [transferTabOut, showSnackbar]);

  const moveTabToWindow = React.useCallback(async (tab: BottomDrawerTab, target: WindowMenuTarget) => {
    try {
      await deliverTabToWindow(target.name, DRAWER_TAB_DRAG_TYPE, serializeDrawerTab(tab));
      transferTabOut(tab.id);
      WindowClient.Focus(target.name).catch((err: unknown) => {
        console.error(`[drawer] failed to focus window "${target.name}"`, err);
      });
    } catch (err) {
      showAppError(showSnackbar, err, `Failed to move the tab to ${target.label}`);
    }
  }, [transferTabOut, showSnackbar]);

  const handleTearOff = React.useCallback(({ id, clientX, clientY }: DetachCommit) => {
    const tab = tabs.find((candidate) => candidate.id === id);
    if (tab) {
      void moveTabToNewWindow(tab, { clientX, clientY });
    }
  }, [tabs, moveTabToNewWindow]);

  const handleAttach = React.useCallback(({ tab, insertIndex }: AttachCommit) => {
    let drawerTab;
    try {
      drawerTab = parseSerializedDrawerTab(tab.payload);
    } catch (err) {
      console.error('[drawer] dropped tab is not a drawer tab', err);
      return;
    }

    adoptTabs([drawerTab], { index: insertIndex, focusTabId: drawerTab.id });
  }, [adoptTabs]);

  const handleTransferred = React.useCallback(({ id }: TabTransferCommit) => {
    transferTabOut(id);
  }, [transferTabOut]);

  // ===================================== STRIP ===================================== //

  const tabDescriptors = React.useMemo((): TabDescriptor[] => tabs.map((tab) => ({
    id: tab.id,
    title: tab.title,
    icon: renderTabIcon(tab),
    // A connecting terminal gets its session id in this window; it cannot leave yet.
    detachable: !isPendingDrawerTab(tab),
    payload: serializeDrawerTab(tab),
  })), [tabs]);

  const handleActiveChange = React.useCallback((id: string) => {
    focusTab({ id });
  }, [focusTab]);

  const handleReorder = React.useCallback((_nextTabs: TabDescriptor[], { from, to }: { from: number; to: number }) => {
    reorderTab(from, to);
  }, [reorderTab]);

  const handleCloseTab = React.useCallback((id: string) => {
    closeTab({ id });
  }, [closeTab]);

  // Right-clicks outside a tab open no menu.
  const handleStripContextMenuCapture = React.useCallback((event: React.MouseEvent) => {
    if (event.target instanceof Element && event.target.closest('[data-tab-id]')) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
  }, []);

  const menuTabIndex = tabs.findIndex((tab) => tab.id === menuTabId);
  const menuTab = menuTabIndex === -1 ? undefined : tabs[menuTabIndex];
  const menuTabIsPending = menuTab !== undefined && isPendingDrawerTab(menuTab);

  return (
    <div className={styles.Bar} data-ov-drawer-strip=''>
      <div className={styles.Strip}>
        <IconButton
          size='sm'
          variant='ghost'
          color='neutral'
          aria-label='New terminal'
          className={styles.Button}
          onClick={createTerminal}
        >
          <LuPlus size={16} />
        </IconButton>
        <Separator orientation='vertical' className={styles.StripSeparator} />
        <ContextMenu.Root>
          <ContextMenu.Trigger
            render={<div className={styles.TabsViewport} onContextMenuCapture={handleStripContextMenuCapture} />}
          >
            <EditorTabs
              className={styles.Tabs}
              aria-label='Bottom drawer tabs'
              tabs={tabDescriptors}
              activeId={tabs[focused]?.id ?? ''}
              onActiveChange={handleActiveChange}
              onCloseTab={handleCloseTab}
              onContextMenuTab={setMenuTabId}
              onReorder={handleReorder}
              instanceId={`drawer-${currentWindow.name}`}
              dragType={DRAWER_TAB_DRAG_TYPE}
              detachToBroker
              onDetachCommit={canTearOff ? handleTearOff : undefined}
              onAttachTab={handleAttach}
              onTabTransferred={handleTransferred}
            />
          </ContextMenu.Trigger>
          <ContextMenu.Portal>
            <ContextMenu.Positioner>
              {menuTab !== undefined && (
                <ContextMenu.Popup>
                  <ContextMenu.Item onClick={() => {
                    closeTab({ id: menuTab.id });
                  }}>
                    Close Tab
                  </ContextMenu.Item>
                  <ContextMenu.Item onClick={() => {
                    closeTabs(tabs.slice(menuTabIndex + 1).map((tab) => ({ id: tab.id })));
                  }}>
                    Close Tabs to Right
                  </ContextMenu.Item>
                  <ContextMenu.Item onClick={() => {
                    closeTabs(tabs.slice(0, menuTabIndex).map((tab) => ({ id: tab.id })));
                  }}>
                    Close Tabs to Left
                  </ContextMenu.Item>
                  <ContextMenu.Item onClick={() => {
                    closeTabs(tabs.filter((tab) => tab.id !== menuTab.id).map((tab) => ({ id: tab.id })));
                  }}>
                    Close Other Tabs
                  </ContextMenu.Item>
                  <ContextMenu.Separator />
                  <ContextMenu.Item
                    disabled={menuTabIsPending || !canTearOff}
                    onClick={() => {
                      void moveTabToNewWindow(menuTab);
                    }}
                  >
                    Move to New Window
                  </ContextMenu.Item>
                  <ContextMenu.SubmenuRoot>
                    <ContextMenu.SubmenuTrigger disabled={menuTabIsPending || otherWindows.length === 0}>
                      Move to Window
                    </ContextMenu.SubmenuTrigger>
                    <ContextMenu.Portal>
                      <ContextMenu.Positioner sideOffset={6}>
                        <ContextMenu.Popup>
                          {otherWindows.map((target) => (
                            <ContextMenu.Item
                              key={target.name}
                              data-ov-window-target={target.name}
                              onClick={() => {
                                void moveTabToWindow(menuTab, target);
                              }}
                            >
                              {target.label}
                            </ContextMenu.Item>
                          ))}
                        </ContextMenu.Popup>
                      </ContextMenu.Positioner>
                    </ContextMenu.Portal>
                  </ContextMenu.SubmenuRoot>
                </ContextMenu.Popup>
              )}
            </ContextMenu.Positioner>
          </ContextMenu.Portal>
        </ContextMenu.Root>
      </div>

      {resizeControls && (
        <div className={styles.Actions}>
          <IconButton
            size='sm'
            variant='ghost'
            color='neutral'
            aria-label={resizeControls.isFullscreen ? 'Exit full screen' : 'Full screen'}
            className={styles.Button}
            disabled={!canResize}
            onClick={() => {
              if (canResize) {
                resizeControls.onFullscreen();
              }
            }}
          >
            {resizeControls.isFullscreen ? <LuMinimize size={14} /> : <LuMaximize size={14} />}
          </IconButton>
          <IconButton
            size='sm'
            variant='ghost'
            color='neutral'
            aria-label={resizeControls.isMinimized ? 'Expand' : 'Minimize'}
            className={styles.Button}
            disabled={!canResize}
            onClick={() => {
              if (!canResize) {
                return;
              }

              if (resizeControls.isMinimized) {
                resizeControls.onExpand();
              } else {
                resizeControls.onMinimize();
              }
            }}
          >
            {resizeControls.isMinimized ? <LuChevronUp size={14} /> : <LuChevronDown size={14} />}
          </IconButton>
        </div>
      )}
    </div>
  );
};

export default BottomDrawerTabs;
