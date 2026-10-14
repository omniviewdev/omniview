import React from 'react';

import { ContextMenu, IconButton, Separator, Spinner } from '@omniviewdev/base-ui';

// third-party
import {
  DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext, horizontalListSortingStrategy, useSortable,
} from '@dnd-kit/sortable';
import { restrictToHorizontalAxis, restrictToParentElement } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';

// provider
import {
  type BottomDrawerTab,
  useBottomDrawer,
  parseAppError,
} from '@omniviewdev/runtime';

// project imports
import Icon from '@/components/icons/Icon';
import { LuChevronDown, LuChevronUp, LuMaximize, LuMinimize, LuPlus, LuX } from 'react-icons/lu';
import { useSettings } from '@omniviewdev/runtime';
import { SessionOptions, CreateSessionOptions, LogSessionOptions } from '@omniviewdev/runtime/models';
import { ExecClient, LogsClient } from '@omniviewdev/runtime/api';

import { bottomDrawerChannel } from './events';
import { devToolsChannel } from '@/features/devtools/events';
import { pluginLogChannel } from '@/features/pluginlogs/events';
import { Events } from '@omniviewdev/runtime/runtime';
import styles from './tabs.module.css';

type TabMenuItem = { key: string; label: string; onClick: () => void };

type Props = {
  hasTabs: boolean;
  isMinimized: boolean;
  isFullscreen: boolean;
  onMinimize: () => void;
  onExpand: () => void;
  onFullscreen: () => void;
}


/**
 * Renders the tabs for the bottom drawer.
 */
const BottomDrawerTabs: React.FC<Props> = ({ hasTabs, isMinimized, isFullscreen, onMinimize, onExpand, onFullscreen }) => {
  const { tabs, focused, focusTab, closeTab, closeTabs, createTab, createTabs, updateTab, reorderTab } = useBottomDrawer();
  const canResize = hasTabs;
  // One context menu serves the whole strip; right-clicking a tab records which.
  const [menuIndex, setMenuIndex] = React.useState(0);
  const { settings } = useSettings();

  const getContextMenuItems = React.useCallback((index: number): TabMenuItem[] => [
    { key: 'close', label: 'Close Tab', onClick: () => closeTab({ index }) },
    { key: 'close-right', label: 'Close Tabs to Right', onClick: () => {
      const indices = [];
      for (let i = index + 1; i < tabs.length; i++) indices.push(i);
      closeTabs(indices.map(i => ({ index: i })));
    }},
    { key: 'close-left', label: 'Close Tabs to Left', onClick: () => {
      const indices = [];
      for (let i = 0; i < index; i++) indices.push(i);
      closeTabs(indices.map(i => ({ index: i })));
    }},
    { key: 'close-others', label: 'Close Other Tabs', onClick: () => {
      const indices = [];
      for (let i = 0; i < tabs.length; i++) {
        if (i !== index) indices.push(i);
      }
      closeTabs(indices.map(i => ({ index: i })));
    }},
  ], [tabs, closeTab, closeTabs]);

  // eslint-disable-next-line @typescript-eslint/ban-types -- null is required by onChange
  const handleChange = React.useCallback((_event: React.SyntheticEvent | null, newValue: string | number | null) => {
    if (typeof newValue === 'number') {
      focusTab({ index: newValue });
    }
  }, [focusTab]);

  const handleCreate = (variant: 'terminal' | 'browser') => {
    switch (variant) {
      case 'terminal': {
        const tempId = `pending-${crypto.randomUUID()}`;
        createTab({
          id: tempId,
          title: 'Connecting...',
          variant: 'terminal',
          icon: 'LuSquareTerminal',
          properties: { status: 'connecting' },
        });
        ExecClient.CreateTerminal(SessionOptions.createFrom({ command: [settings['terminal.defaultShell'] || '/bin/bash'] }))
          .then((session: any) => {
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
        break;
      }
      case 'browser':
        break;
    }
  };

  // handle signals from across the app through the event bus
  React.useEffect(() => {
    const unsubscribeCreateSession = bottomDrawerChannel.on('onCreateSession', ({ plugin, connection, opts, icon, label }) => {
      const tempId = `pending-${crypto.randomUUID()}`;
      createTab({
        id: tempId,
        title: label ?? 'Connecting...',
        variant: 'terminal',
        icon: icon ?? 'LuSquareTerminal',
        properties: {
          status: 'connecting',
          pluginID: plugin,
          connectionID: connection,
          opts: { ...opts },
        },
      });
      ExecClient.CreateSession(plugin, connection, opts)
        .then((session: any) => {
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
      plugin, connection, resourceKey, resourceID, resourceData, target, follow, tailLines, icon, label, params,
    }) => {
      const opts = CreateSessionOptions.createFrom({
        resource_key: resourceKey,
        resource_id: resourceID,
        resource_data: resourceData,
        options: LogSessionOptions.createFrom({
          target: target ?? '',
          follow: follow ?? true,
          include_previous: false,
          include_timestamps: true,
          tail_lines: tailLines ?? 1000,
          since_seconds: 0,
          limit_bytes: 0,
          include_source_events: true,
          params: params ?? {},
        }),
      });
      LogsClient.CreateSession(plugin, connection, opts)
        .then((session: any) => {
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
      console.log('onSessionClosed', sessionId);
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
  }, [tabs]);

  const handleRemove = React.useCallback((index: number) => {
    closeTab({ index });
  }, [closeTab]);

  // Sensors for DND Kit — pointer only, no keyboard sensor to avoid
  // Space/Enter key conflicts when tabs have focus.
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    }),
  );

  // Handler for drag end
  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;

    if (over && active.id !== over.id) {
      // Dispatch an action to reorder the tabs in your store
      // Replace this with your actual logic to update the order of tabs
      reorderTab(active.id as number, over.id as number);
    }
  };

  React.useEffect(() => {
    ExecClient.ListSessions()
      .then((sessions: any) => {
        const newTabs: BottomDrawerTab[] = [];

        // find and upsert any missing sessions where the id doesn't exist
        sessions.forEach((session: any) => {
          const existing = tabs.find(tab => tab.id === session.id);
          if (existing) {
            return;
          }

          newTabs.push({
            id: session.id,
            title: `Session ${session.id.substring(0, 8)}`,
            variant: 'terminal',
            icon: 'LuSquareTerminal',
            properties: session.labels,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        });

        if (newTabs.length > 0) {
          createTabs(newTabs);
        }
      }).catch((err: unknown) => {
        console.error(err);
      });

    const closerTerminal = Events.On("menu/view/terminal/create", () => handleCreate('terminal'))

    return () => {
      closerTerminal()
    }

  }, []);

  return (
    <div className={styles.Bar}>
      <div className={styles.Strip}>
        <IconButton
          size='sm'
          variant='ghost'
          color='neutral'
          aria-label='New terminal'
          className={styles.Button}
          onClick={() => {
            handleCreate('terminal');
          }}
        >
          <LuPlus size={16} />
        </IconButton>
        <Separator orientation='vertical' className={styles.StripSeparator} />
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToParentElement, restrictToHorizontalAxis]}
        >
          <SortableContext items={tabs.map((_, index) => index)} strategy={horizontalListSortingStrategy}>
            {tabs.length !== 0 &&
              <ContextMenu.Root>
                <ContextMenu.Trigger render={<div className={styles.TabsViewport} />}>
                  <div className={styles.TabsScroller} role='tablist' aria-label='Bottom drawer tabs'>
                    {tabs.map((tab, index) => (
                      <MemoizedBottomDrawerTabComponent
                        key={`bottom-drawer-tab-${index}`}
                        {...tab}
                        index={index}
                        selected={focused === index}
                        onRemove={handleRemove}
                        onChange={handleChange}
                        onContextMenu={setMenuIndex}
                      />
                    ))}
                  </div>
                </ContextMenu.Trigger>
                <ContextMenu.Portal>
                  <ContextMenu.Positioner>
                    <ContextMenu.Popup>
                      {getContextMenuItems(menuIndex).map(item => (
                        <ContextMenu.Item key={item.key} onClick={item.onClick}>
                          {item.label}
                        </ContextMenu.Item>
                      ))}
                    </ContextMenu.Popup>
                  </ContextMenu.Positioner>
                </ContextMenu.Portal>
              </ContextMenu.Root>
            }
          </SortableContext>
        </DndContext>
      </div>

      <div className={styles.Actions}>
        <IconButton
          size='sm'
          variant='ghost'
          color='neutral'
          aria-label={isFullscreen ? 'Exit full screen' : 'Full screen'}
          className={styles.Button}
          disabled={!canResize}
          onClick={() => {
            if (canResize) {
              onFullscreen();
            }
          }}
        >
          {isFullscreen ? <LuMinimize size={14} /> : <LuMaximize size={14} />}
        </IconButton>
        <IconButton
          size='sm'
          variant='ghost'
          color='neutral'
          aria-label={isMinimized ? 'Expand' : 'Minimize'}
          className={styles.Button}
          disabled={!canResize}
          onClick={() => {
            if (!canResize) {
              return;
            }
            if (isMinimized) {
              onExpand()
            } else {
              onMinimize()
            }
          }}
        >
          {isMinimized ? <LuChevronUp size={14} /> : <LuChevronDown size={14} />}
        </IconButton>
      </div>
    </div>
  );
};

type BottomDrawerTabProps = BottomDrawerTab & {
  index: number;
  selected: boolean;
  onRemove: (index: number) => void;
  onChange: (event: React.SyntheticEvent, newValue: string | number) => void;
  onContextMenu: (index: number) => void;
};

const BottomDrawerTabComponent: React.FC<BottomDrawerTabProps> = ({ id, index, title, icon, properties, selected, onRemove, onChange, onContextMenu }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: index });

  return (
    <div
      key={`bottom-drawer-tab-${id}`}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      role='tab'
      aria-selected={selected}
      className={styles.Tab}
      data-selected={selected || undefined}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      onClick={(e) => onChange(e, index)}
      onContextMenu={() => onContextMenu(index)}
    >
      <span className={styles.TabLabel}>
        {properties?.status === 'connecting' ? (
          <Spinner size='xs' />
        ) : icon !== undefined ? (
          typeof icon === 'string' ? <Icon name={icon} size={14} /> : icon
        ) : null}
        <span className={styles.TabTitle}>{title}</span>
      </span>
      <span
        className={styles.TabClose}
        aria-label='Close tab'
        onClick={(e) => {
          e.stopPropagation();
          onRemove(index);
        }}
        onKeyDown={(e) => e.stopPropagation()}
      >
        <LuX size={16} />
      </span>
    </div>
  );
};

const MemoizedBottomDrawerTabComponent = React.memo(BottomDrawerTabComponent, (prev, next) => {
  return prev.id === next.id
    && prev.index === next.index
    && prev.title === next.title
    && prev.icon === next.icon
    && prev.selected === next.selected
    && prev.properties?.status === next.properties?.status
    && prev.onContextMenu === next.onContextMenu;
});

export default BottomDrawerTabs;
