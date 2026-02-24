import React from 'react';

// material-ui
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import { IconButton } from '@omniviewdev/ui/buttons';
import { ContextMenu } from '@omniviewdev/ui/menus';
import type { ContextMenuItem } from '@omniviewdev/ui/menus';
import { Text } from '@omniviewdev/ui/typography';
import { Stack } from '@omniviewdev/ui/layout';

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
} from '@omniviewdev/runtime';

// project imports
import Icon from '@/components/icons/Icon';
import { LuChevronDown, LuChevronUp, LuMaximize, LuMinimize, LuPlus, LuX } from 'react-icons/lu';
import { useSettings } from '@omniviewdev/runtime';
import { exec, logs } from '@omniviewdev/runtime/models';
import { ExecClient, LogsClient } from '@omniviewdev/runtime/api';

import { bottomDrawerChannel } from './events';
import { devToolsChannel } from '@/features/devtools/events';
import { EventsOn } from '@omniviewdev/runtime/runtime';

type Props = {
  isMinimized: boolean;
  isFullscreen: boolean;
  onMinimize: () => void;
  onExpand: () => void;
  onFullscreen: () => void;
}


/**
 * Renders the tabs for the bottom drawer.
 */
const BottomDrawerTabs: React.FC<Props> = ({ isMinimized, isFullscreen, onMinimize, onExpand, onFullscreen }) => {
  const { tabs, focused, focusTab, closeTab, closeTabs, createTab, createTabs, updateTab, reorderTab } = useBottomDrawer();
  const { settings } = useSettings();

  const getContextMenuItems = React.useCallback((index: number): ContextMenuItem[] => [
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
        ExecClient.CreateTerminal(exec.CreateTerminalOptions.createFrom({ command: [settings['terminal.defaultShell'] || '/bin/bash'] }))
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
            const msg = typeof err === 'string' ? err : (err as Error)?.message ?? String(err);
            updateTab(
              { id: tempId },
              { properties: { status: 'error', error: msg } },
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
          const msg = typeof err === 'string' ? err : (err as Error)?.message ?? String(err);
          updateTab(
            { id: tempId },
            {
              properties: {
                status: 'error',
                error: msg,
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
      const opts = logs.CreateSessionOptions.createFrom({
        resource_key: resourceKey,
        resource_id: resourceID,
        resource_data: resourceData,
        options: logs.LogSessionOptions.createFrom({
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

    return () => {
      unsubscribeCreateSession();
      unsubscribeCreateLogSession();
      unsubscribeSessionClosed();
      unsubscribeOpenBuildOutput();
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

        console.log('newTabs', newTabs);
        createTabs(newTabs);
      }).catch((err: unknown) => {
        console.error(err);
      });

    const closerTerminal = EventsOn("menu/view/terminal/create", () => handleCreate('terminal'))

    return () => {
      closerTerminal()
    }

  }, []);

  return (
    <Stack
      direction={'row'}
      alignItems={'center'}
      justifyContent={'space-between'}
    >
      <Stack
        direction="row"
        alignItems={'center'}
        height={33}
        maxHeight={33}
        minHeight={33}
        gap={0.25}
        px={0.25}
        sx={{
          borderBottom: '1px solid',
          borderBottomColor: 'divider',
        }}
      >
        <IconButton
          size="sm"
          emphasis='soft'
          color='neutral'
          sx={{
            flex: 'none',
            minHeight: 28,
            minWidth: 28,
          }}
          onClick={() => {
            handleCreate('terminal');
          }}
        >
          <LuPlus size={16} />
        </IconButton>
        <Divider
          orientation='vertical'
          sx={{
            my: 0.5,
          }}
        />
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToParentElement, restrictToHorizontalAxis]}
        >
          <SortableContext items={tabs.map((_, index) => index)} strategy={horizontalListSortingStrategy}>
            {tabs.length !== 0 &&
              <Box
                sx={{
                  flex: 1,
                  overflow: 'hidden',
                  display: 'flex',
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    overflow: 'auto',
                    scrollSnapType: 'x mandatory',
                    '&::-webkit-scrollbar': { display: 'none' },
                  }}
                >
                  {tabs.map((tab, index) => (
                    <ContextMenu key={`bottom-drawer-tab-ctx-${index}`} items={getContextMenuItems(index)}>
                      <MemoizedBottomDrawerTabComponent
                        key={`bottom-drawer-tab-${index}`}
                        {...tab}
                        index={index}
                        selected={focused === index}
                        onRemove={handleRemove}
                        onChange={handleChange}
                      />
                    </ContextMenu>
                  ))}
                </Box>
              </Box>
            }

          </SortableContext>
        </DndContext>
      </Stack>

      <Stack
        direction="row"
        alignItems={'center'}
        height={33}
        maxHeight={33}
        minHeight={33}
        gap={0.25}
        px={1}
        pb={'1px'}
      >
        <IconButton
          size="sm"
          emphasis='soft'
          color='neutral'
          sx={{
            flex: 'none',
            minHeight: 28,
            minWidth: 28,
          }}
          onClick={onFullscreen}
        >
          {isFullscreen ? <LuMinimize size={14} /> : <LuMaximize size={14} />}
        </IconButton>
        <IconButton
          size="sm"
          emphasis='soft'
          color='neutral'
          sx={{
            flex: 'none',
            minHeight: 28,
            minWidth: 28,
          }}
          onClick={() => {
            if (isMinimized) {
              onExpand()
            } else {
              onMinimize()
            }
          }}
        >
          {isMinimized ? <LuChevronUp size={14} /> : <LuChevronDown size={14} />}
        </IconButton>
      </Stack>
    </Stack>
  );
};

type BottomDrawerTabProps = BottomDrawerTab & {
  index: number;
  selected: boolean;
  onRemove: (index: number) => void;
  onChange: (event: React.SyntheticEvent, newValue: string | number) => void;
};

const BottomDrawerTabComponent: React.FC<BottomDrawerTabProps> = ({ id, index, title, icon, properties, selected, onRemove, onChange }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
  } = useSortable({ id: index });

  return (
    <Box
      key={`bottom-drawer-tab-${id}`}
      ref={setNodeRef}
      {...attributes}
      {...listeners}
      sx={{
        height: 33,
        px: 1,
        display: 'flex',
        alignItems: 'center',
        minWidth: 150,
        flex: 'none',
        scrollSnapAlign: 'start',
        borderRight: '1px solid',
        borderRightColor: 'divider',
        borderLeft: index === 0 ? '1px solid' : '1px solid transparent',
        borderLeftColor: index === 0 ? 'divider' : 'transparent',
        cursor: 'pointer',
        bgcolor: selected ? 'action.selected' : 'transparent',
        borderBottom: '2px solid',
        borderBottomColor: selected ? 'primary.main' : 'transparent',
        transform: CSS.Translate.toString(transform),
        transition,
      }}
      onClick={(e) => onChange(e, index)}
    >
      <Stack
        direction="row"
        justifyContent={'space-between'}
        alignItems={'center'}
        gap={2}
        sx={{ width: '100%' }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          {properties?.status === 'connecting' ? (
            <CircularProgress size={14} sx={{ color: 'text.secondary' }} />
          ) : icon !== undefined ? (
            typeof icon === 'string' ? <Icon name={icon} size={14} /> : icon
          ) : null}
          <Text
            size="sm"
            sx={{
              fontSize: 13,
              color: selected ? 'neutral.50' : 'text.primary',
              fontWeight: selected ? 500 : 400,
              userSelect: 'none',
              WebkitUserSelect: 'none',
            }}
          >
            {title}
          </Text>
        </Box>
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            borderRadius: '4px',
            '&:hover': { bgcolor: 'action.hover' },
          }}
          onClick={(e) => {
            e.stopPropagation();
            onRemove(index);
          }}
          onKeyDown={(e) => e.stopPropagation()}
        >
          <LuX size={16} />
        </Box>
      </Stack>
    </Box>
  );
};

const MemoizedBottomDrawerTabComponent = React.memo(BottomDrawerTabComponent, (prev, next) => {
  return prev.id === next.id
    && prev.index === next.index
    && prev.title === next.title
    && prev.icon === next.icon
    && prev.selected === next.selected
    && prev.properties?.status === next.properties?.status;
});

export default BottomDrawerTabs;
