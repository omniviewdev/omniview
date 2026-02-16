# 08 -- Dev Tools UI

## Phase 7: Developer Tools UI Components

**Goal**: Provide full visibility into dev server status, build logs, errors, and connection health through the Omniview UI using MUI Joy components.

**Prerequisites**: Phases 1-6 complete. The DevServerManager emits Wails events that the UI consumes.

---

## 1. New Types: `ui/features/devtools/types.ts`

```typescript
/**
 * Types for the plugin dev tools system.
 * These mirror the Go-side DevServerState and related structs.
 */

/** The mode a dev server instance is running in. */
export type DevServerMode = 'managed' | 'external';

/** Status of the Vite dev server. */
export type ViteStatus = 'idle' | 'starting' | 'running' | 'error' | 'stopped';

/** Status of the Go backend. */
export type GoStatus = 'idle' | 'building' | 'ready' | 'error' | 'stopped';

/** Aggregate status for display purposes. */
export type DevServerAggregateStatus = 'ready' | 'building' | 'error' | 'stopped' | 'connecting';

/**
 * Full dev server state for a single plugin.
 * Matches the JSON emitted by the Go DevServerManager via Wails events.
 * Canonical definition in ui/hooks/plugin/useDevServer.ts -- see 04-frontend-dev-loading.md
 */
export interface DevServerState {
  pluginId: string;
  mode: DevServerMode;
  viteStatus: ViteStatus;
  vitePort: number;
  viteUrl: string;
  goStatus: GoStatus;
  grpcConnected: boolean;
  lastBuildMs?: number;
  viteError?: string;
  goError?: string;
  buildCount: number;
  errorCount: number;
}

/**
 * A structured build error from the Go compiler output.
 */
export interface DevBuildError {
  file: string;
  line: number;
  column: number;
  message: string;
  severity: 'error' | 'warning';
}

/**
 * A single line of build output (from Vite or Go compiler).
 */
export interface DevBuildLine {
  pluginId: string;
  source: 'vite' | 'go' | 'system';
  timestamp: string;
  content: string;
  level: 'stdout' | 'stderr' | 'info' | 'error';
}

/**
 * Summary of all dev server instances, used by the footer indicators.
 */
export interface DevServerSummary {
  total: number;
  ready: number;
  building: number;
  error: number;
  stopped: number;
}

/**
 * Derive the aggregate status from a DevServerState.
 */
export function getAggregateStatus(state: DevServerState): DevServerAggregateStatus {
  if (state.goStatus === 'error' || state.viteStatus === 'error') return 'error';
  if (state.goStatus === 'building' || state.viteStatus === 'starting') return 'building';
  if (state.viteStatus === 'stopped' && !state.grpcConnected) return 'stopped';
  if (!state.grpcConnected) return 'connecting';
  if (state.goStatus === 'ready' && (state.viteStatus === 'running' || state.viteStatus === 'stopped')) return 'ready';
  return 'ready';
}

/**
 * Color mapping for aggregate status values.
 */
export const STATUS_COLORS: Record<DevServerAggregateStatus, 'success' | 'warning' | 'danger' | 'neutral' | 'primary'> = {
  ready: 'success',
  building: 'warning',
  error: 'danger',
  stopped: 'neutral',
  connecting: 'primary',
};
```

---

## 2. New Event Bus: `ui/features/devtools/events.ts`

```typescript
import { eventbus } from '@/events/eventbus';
import type { DevServerState, DevBuildLine, DevBuildError } from './types';

type DevToolsEvents = {
  /**
   * Fired when any dev server's status changes.
   * Source: Wails event `plugin/devserver/status`
   */
  onStatusChange: (state: DevServerState) => void;

  /**
   * Fired when a build output line is received.
   * Source: Wails event `plugin/devserver/log`
   */
  onBuildLog: (line: DevBuildLine) => void;

  /**
   * Fired when structured build errors are reported.
   * Source: Wails event `plugin/devserver/error`
   */
  onBuildError: (payload: { pluginId: string; errors: DevBuildError[] }) => void;

  /**
   * Fired when user requests to open the build output for a plugin.
   */
  onOpenBuildOutput: (pluginId: string) => void;

  /**
   * Fired when user requests to restart a dev server.
   */
  onRestartDevServer: (pluginId: string) => void;
};

export const devToolsChannel = eventbus<DevToolsEvents>();
```

### Wiring Wails Events to the Event Bus

Create `ui/features/devtools/wailsBridge.ts`:

```typescript
import { EventsOn } from '@omniviewdev/runtime/runtime';
import { devToolsChannel } from './events';
import type { DevServerState, DevBuildLine, DevBuildError } from './types';

/**
 * Initializes the bridge between Go-side Wails events and the
 * frontend dev tools event bus. Call once at app startup.
 * Returns a cleanup function that removes all listeners.
 */
export function initDevToolsBridge(): () => void {
  const cleanups: Array<() => void> = [];

  cleanups.push(
    EventsOn('plugin/devserver/status', (state: DevServerState) => {
      devToolsChannel.emit('onStatusChange', state);
    }),
  );

  cleanups.push(
    EventsOn('plugin/devserver/log', (line: DevBuildLine) => {
      devToolsChannel.emit('onBuildLog', line);
    }),
  );

  cleanups.push(
    EventsOn('plugin/devserver/error', (payload: { pluginId: string; errors: DevBuildError[] }) => {
      devToolsChannel.emit('onBuildError', payload);
    }),
  );

  return () => {
    cleanups.forEach((fn) => fn());
  };
}
```

### Hook for Consuming Dev Server State

Create `ui/features/devtools/useDevServers.ts`:

```typescript
import { useCallback, useEffect, useRef, useState } from 'react';
import { devToolsChannel } from './events';
import type { DevServerState, DevServerSummary } from './types';
import { getAggregateStatus } from './types';

/**
 * Hook that tracks the state of all dev server instances.
 * Returns a map of pluginId -> state, plus a summary.
 */
export function useDevServers() {
  const [servers, setServers] = useState<Map<string, DevServerState>>(new Map());

  useEffect(() => {
    const unsub = devToolsChannel.on('onStatusChange', (state) => {
      setServers((prev) => {
        const next = new Map(prev);
        if (state.grpcConnected === false && state.viteStatus === undefined) {
          // Plugin fully disconnected -- remove from map
          next.delete(state.pluginId);
        } else {
          next.set(state.pluginId, state);
        }
        return next;
      });
    });

    return unsub;
  }, []);

  const summary: DevServerSummary = {
    total: servers.size,
    ready: 0,
    building: 0,
    error: 0,
    stopped: 0,
  };

  servers.forEach((state) => {
    const agg = getAggregateStatus(state);
    switch (agg) {
      case 'ready':
        summary.ready++;
        break;
      case 'building':
        summary.building++;
        break;
      case 'error':
        summary.error++;
        break;
      case 'stopped':
        summary.stopped++;
        break;
    }
  });

  return { servers, summary };
}
```

---

## 3. Footer Status Indicators

### File: `ui/components/displays/Footer/PluginDevStatusIndicators.tsx`

```typescript
import React from 'react';
import Chip from '@mui/joy/Chip';
import Stack from '@mui/joy/Stack';
import Tooltip from '@mui/joy/Tooltip';
import Typography from '@mui/joy/Typography';
import { LuCircle, LuPlug } from 'react-icons/lu';

import { useDevServers } from '@/features/devtools/useDevServers';
import { devToolsChannel } from '@/features/devtools/events';
import type { DevServerAggregateStatus } from '@/features/devtools/types';
import { getAggregateStatus, STATUS_COLORS } from '@/features/devtools/types';

/**
 * Dot color mapping for the indicator circles.
 */
const DOT_COLORS: Record<DevServerAggregateStatus, string> = {
  ready: 'var(--joy-palette-success-400)',
  building: 'var(--joy-palette-warning-400)',
  error: 'var(--joy-palette-danger-400)',
  stopped: 'var(--joy-palette-neutral-400)',
  connecting: 'var(--joy-palette-primary-400)',
};

/**
 * Status label for tooltips.
 */
const STATUS_LABELS: Record<DevServerAggregateStatus, string> = {
  ready: 'Ready',
  building: 'Building...',
  error: 'Error',
  stopped: 'Stopped',
  connecting: 'Connecting...',
};

/**
 * Footer component that shows colored dots for each active dev server instance.
 * Clicking a dot opens the build output tab for that plugin.
 *
 * Color scheme:
 *  - Green:  ready (Vite running, Go compiled, gRPC connected)
 *  - Amber:  building (Go compiling or Vite starting)
 *  - Red:    error (build error or connection failure)
 *  - Gray:   stopped
 *  - Blue:   connecting
 */
const PluginDevStatusIndicators: React.FC = () => {
  const { servers, summary } = useDevServers();

  // Don't render anything if no dev servers are active
  if (summary.total === 0) {
    return null;
  }

  const handleClick = (pluginId: string) => {
    devToolsChannel.emit('onOpenBuildOutput', pluginId);
  };

  const entries = Array.from(servers.entries());

  return (
    <Stack direction="row" alignItems="center" gap={0.5}>
      <Tooltip
        title={
          <Typography level="body-xs">
            {summary.total} dev server{summary.total !== 1 ? 's' : ''} active
          </Typography>
        }
        size="sm"
        variant="soft"
      >
        <Chip
          size="sm"
          variant="soft"
          color={summary.error > 0 ? 'danger' : summary.building > 0 ? 'warning' : 'success'}
          startDecorator={<LuPlug size={10} />}
          sx={{
            '--Chip-minHeight': '16px',
            '--Chip-radius': '4px',
            fontSize: '10px',
            fontWeight: 600,
            cursor: 'default',
          }}
        >
          DEV
        </Chip>
      </Tooltip>

      {entries.map(([pluginId, state]) => {
        const aggStatus = getAggregateStatus(state);
        const color = DOT_COLORS[aggStatus];
        const label = STATUS_LABELS[aggStatus];

        return (
          <Tooltip
            key={pluginId}
            title={
              <Stack gap={0.25}>
                <Typography level="body-xs" fontWeight={600}>
                  {pluginId}
                </Typography>
                <Typography level="body-xs">
                  {label}
                  {state.mode === 'external' ? ' (external)' : ''}
                </Typography>
                {state.vitePort > 0 && (
                  <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
                    Vite: :{state.vitePort}
                  </Typography>
                )}
                {state.error && (
                  <Typography level="body-xs" sx={{ color: 'danger.plainColor' }}>
                    {state.error}
                  </Typography>
                )}
              </Stack>
            }
            size="sm"
            variant="outlined"
            placement="top"
          >
            <Stack
              component="button"
              onClick={() => handleClick(pluginId)}
              sx={{
                all: 'unset',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 14,
                height: 14,
                borderRadius: '50%',
                '&:hover': {
                  bgcolor: 'background.level1',
                },
                ...(aggStatus === 'building' && {
                  animation: 'pulse 1.5s ease-in-out infinite',
                  '@keyframes pulse': {
                    '0%, 100%': { opacity: 1 },
                    '50%': { opacity: 0.4 },
                  },
                }),
              }}
            >
              <LuCircle size={8} fill={color} color={color} />
            </Stack>
          </Tooltip>
        );
      })}
    </Stack>
  );
};

export default React.memo(PluginDevStatusIndicators);
```

### Changes to `ui/components/displays/Footer/LeftSide.tsx`

Add the indicators to the footer left side:

```typescript
import React from 'react';
import { Stack, Chip } from '@mui/joy';
import PluginDevStatusIndicators from './PluginDevStatusIndicators';

/**
 * Display on the bottom left side of the footer
 */
const FooterLeftSide: React.FC = () => {
  return (
    <Stack direction="row" alignItems="center" justifyContent="flex-start" gap={1}>
      {import.meta.env.DEV && (
        <Chip
          color="warning"
          size="sm"
          variant="soft"
          sx={{
            maxHeight: '13px',
            '--Chip-radius': '2px',
            '--Chip-minHeight': '13px',
            fontSize: 10,
            fontWeight: 700,
          }}
        >
          DEVELOPMENT MODE
        </Chip>
      )}
      <PluginDevStatusIndicators />
    </Stack>
  );
};

export default FooterLeftSide;
```

---

## 4. Bottom Drawer Build Output Tab

### 4.1 Changes to `ui/providers/BottomDrawer/types.ts`

Add `'devbuild'` to the variant union:

```typescript
export type BottomDrawerTab = {
  id: string;
  title: string;
  createdAt: Date;
  updatedAt: Date;
  icon?: string | React.ReactNode;
  variant: 'terminal' | 'logs' | 'editor' | 'browser' | 'file' | 'devbuild' | 'other';
  properties?: Record<string, unknown>;
};
```

### 4.2 Build Output Container: `ui/providers/BottomDrawer/containers/DevBuildOutput/index.tsx`

```typescript
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/joy/Box';
import Button from '@mui/joy/Button';
import Chip from '@mui/joy/Chip';
import Divider from '@mui/joy/Divider';
import IconButton from '@mui/joy/IconButton';
import Option from '@mui/joy/Option';
import Select from '@mui/joy/Select';
import Tooltip from '@mui/joy/Tooltip';
import Typography from '@mui/joy/Typography';
import { useVirtualizer } from '@tanstack/react-virtual';
import {
  LuArrowDown,
  LuArrowDownToLine,
  LuRefreshCw,
  LuTrash2,
  LuCircle,
} from 'react-icons/lu';

import { devToolsChannel } from '@/features/devtools/events';
import type { DevBuildLine, DevServerState } from '@/features/devtools/types';
import { getAggregateStatus, STATUS_COLORS } from '@/features/devtools/types';

// --- Types ---

interface Props {
  /** The plugin ID whose build output to display, or undefined for all. */
  pluginId?: string;
}

// --- Source badge color palette (matches LogEntry pattern) ---

const SOURCE_BADGE_COLORS: Record<string, [string, string]> = {
  vite: ['#1a3a4a', '#7ec8e3'],
  go: ['#1a4a2a', '#7ee3a0'],
  system: ['#4a3a1a', '#e3c87e'],
};

// --- Build Line Component ---

interface BuildLineProps {
  line: DevBuildLine;
  showSource: boolean;
}

const BuildLine: React.FC<BuildLineProps> = React.memo(({ line, showSource }) => {
  const isError = line.level === 'stderr' || line.level === 'error';

  const [bg, fg] = SOURCE_BADGE_COLORS[line.source] ?? ['#3a3a3a', '#cccccc'];

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'flex-start',
        gap: 0.5,
        px: 1,
        py: '1px',
        fontFamily: 'monospace',
        fontSize: '12px',
        lineHeight: '18px',
        borderLeft: isError ? '3px solid var(--joy-palette-danger-400)' : '3px solid transparent',
        '&:hover': { bgcolor: 'background.level1' },
      }}
    >
      {/* Timestamp */}
      <Typography
        sx={{
          color: 'text.secondary',
          flexShrink: 0,
          fontSize: 'inherit',
          fontFamily: 'inherit',
          lineHeight: 'inherit',
          minWidth: '8ch',
        }}
      >
        {formatTime(line.timestamp)}
      </Typography>

      {/* Source badge */}
      {showSource && (
        <span
          style={{
            fontSize: '10px',
            lineHeight: '16px',
            height: 16,
            padding: '0 6px',
            borderRadius: 4,
            backgroundColor: bg,
            color: fg,
            flexShrink: 0,
            whiteSpace: 'nowrap',
          }}
        >
          {line.source}
        </span>
      )}

      {/* Content */}
      <Typography
        component="span"
        sx={{
          flex: 1,
          fontSize: 'inherit',
          fontFamily: 'inherit',
          lineHeight: 'inherit',
          whiteSpace: 'pre-wrap',
          wordBreak: 'break-all',
          ...(isError && { color: 'danger.plainColor' }),
        }}
      >
        {line.content}
      </Typography>
    </Box>
  );
});

BuildLine.displayName = 'BuildLine';

function formatTime(ts: string): string {
  if (!ts) return '';
  try {
    const d = new Date(ts);
    return d.toLocaleTimeString(undefined, {
      hour12: false,
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return ts;
  }
}

// --- Main Component ---

const DevBuildOutput: React.FC<Props> = ({ pluginId }) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [lines, setLines] = useState<DevBuildLine[]>([]);
  const [follow, setFollow] = useState(true);
  const [sourceFilter, setSourceFilter] = useState<string | null>(null);
  const [serverState, setServerState] = useState<DevServerState | null>(null);
  const isAutoScrolling = useRef(false);

  // Subscribe to build log events
  useEffect(() => {
    const unsubLog = devToolsChannel.on('onBuildLog', (line) => {
      if (pluginId && line.pluginId !== pluginId) return;
      setLines((prev) => {
        const next = [...prev, line];
        // Cap at 10000 lines to prevent memory issues
        return next.length > 10000 ? next.slice(-10000) : next;
      });
    });

    const unsubStatus = devToolsChannel.on('onStatusChange', (state) => {
      if (pluginId && state.pluginId !== pluginId) return;
      setServerState(state);
    });

    return () => {
      unsubLog();
      unsubStatus();
    };
  }, [pluginId]);

  // Filter lines by source
  const filteredLines = useMemo(() => {
    if (!sourceFilter) return lines;
    return lines.filter((l) => l.source === sourceFilter);
  }, [lines, sourceFilter]);

  // Virtual list
  const rowVirtualizer = useVirtualizer({
    count: filteredLines.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 18,
    overscan: 30,
  });

  // Auto-scroll when following
  useEffect(() => {
    if (follow && filteredLines.length > 0) {
      isAutoScrolling.current = true;
      rowVirtualizer.scrollToIndex(filteredLines.length - 1, { align: 'end' });
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          isAutoScrolling.current = false;
        });
      });
    }
  }, [follow, filteredLines.length]);

  // Detect scroll to engage/disengage follow
  const handleScroll = useCallback(() => {
    if (!parentRef.current || isAutoScrolling.current) return;
    const el = parentRef.current;
    const isAtBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 50;
    if (isAtBottom && !follow) setFollow(true);
    else if (!isAtBottom && follow) setFollow(false);
  }, [follow]);

  const handleClear = useCallback(() => {
    setLines([]);
  }, []);

  const handleRestart = useCallback(() => {
    if (pluginId) {
      devToolsChannel.emit('onRestartDevServer', pluginId);
    }
  }, [pluginId]);

  const jumpToBottom = useCallback(() => {
    setFollow(true);
    isAutoScrolling.current = true;
    rowVirtualizer.scrollToIndex(filteredLines.length - 1, { align: 'end' });
    requestAnimationFrame(() => {
      isAutoScrolling.current = false;
    });
  }, [filteredLines.length, rowVirtualizer]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualItems.length > 0 ? virtualItems[0].start : 0;
  const paddingBottom = virtualItems.length > 0
    ? rowVirtualizer.getTotalSize() - virtualItems[virtualItems.length - 1].end
    : 0;

  const aggStatus = serverState ? getAggregateStatus(serverState) : null;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        minHeight: 0,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      {/* Toolbar */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: '1px solid',
          borderColor: 'divider',
          bgcolor: 'background.surface',
          minHeight: 32,
          flexShrink: 0,
        }}
      >
        {/* Status indicator */}
        {aggStatus && (
          <Chip
            size="sm"
            variant="soft"
            color={STATUS_COLORS[aggStatus]}
            startDecorator={<LuCircle size={8} />}
            sx={{ '--Chip-minHeight': '20px', fontSize: '11px' }}
          >
            {aggStatus}
          </Chip>
        )}

        <Divider orientation="vertical" sx={{ mx: 0.5 }} />

        {/* Source filter */}
        <Select
          size="sm"
          variant="plain"
          value={sourceFilter ?? 'all'}
          onChange={(_, val) => setSourceFilter(val === 'all' ? null : val)}
          sx={{ minWidth: 80, fontSize: '12px' }}
        >
          <Option value="all">All</Option>
          <Option value="vite">Vite</Option>
          <Option value="go">Go</Option>
          <Option value="system">System</Option>
        </Select>

        <Divider orientation="vertical" sx={{ mx: 0.5 }} />

        {/* Controls */}
        <Tooltip title="Restart dev server">
          <IconButton size="sm" variant="plain" color="neutral" onClick={handleRestart}>
            <LuRefreshCw size={14} />
          </IconButton>
        </Tooltip>

        <Tooltip title="Clear output">
          <IconButton size="sm" variant="plain" color="neutral" onClick={handleClear}>
            <LuTrash2 size={14} />
          </IconButton>
        </Tooltip>

        <Tooltip title={follow ? 'Following' : 'Follow output'}>
          <IconButton
            size="sm"
            variant={follow ? 'soft' : 'plain'}
            color={follow ? 'primary' : 'neutral'}
            onClick={() => setFollow(!follow)}
          >
            <LuArrowDownToLine size={14} />
          </IconButton>
        </Tooltip>

        {/* Line count */}
        <Box sx={{ flex: 1 }} />
        <Typography level="body-xs" sx={{ color: 'text.tertiary', mr: 1 }}>
          {filteredLines.length.toLocaleString()} lines
        </Typography>
      </Box>

      {/* Virtualized output */}
      <Box
        ref={parentRef}
        onScroll={handleScroll}
        sx={{
          flex: 1,
          minHeight: 0,
          overflow: 'auto',
          bgcolor: 'background.body',
        }}
      >
        <Box sx={{ paddingTop: `${paddingTop}px`, paddingBottom: `${paddingBottom}px` }}>
          {virtualItems.map((virtualRow) => {
            const line = filteredLines[virtualRow.index];
            if (!line) return null;

            return (
              <Box
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={rowVirtualizer.measureElement}
                sx={{ minWidth: '100%' }}
              >
                <BuildLine
                  line={line}
                  showSource={!sourceFilter}
                />
              </Box>
            );
          })}
        </Box>
      </Box>

      {/* Jump to bottom FAB */}
      {!follow && filteredLines.length > 0 && (
        <Button
          size="sm"
          variant="soft"
          color="neutral"
          startDecorator={<LuArrowDown size={14} />}
          onClick={jumpToBottom}
          sx={{
            position: 'absolute',
            bottom: 16,
            right: 16,
            zIndex: 10,
          }}
        >
          Jump to bottom
        </Button>
      )}
    </Box>
  );
};

export default React.memo(DevBuildOutput, (prev, next) => {
  return prev.pluginId === next.pluginId;
});
```

### 4.3 Rendering the DevBuild Tab in the Bottom Drawer

In the bottom drawer layout (the component that switches on tab variant to render the correct container), add a case for `'devbuild'`:

**File**: `ui/layouts/core/main/BottomDrawer/index.tsx`

Add the import and case:

```typescript
import DevBuildOutput from '@/providers/BottomDrawer/containers/DevBuildOutput';

// In the render switch:
case 'devbuild':
  return <DevBuildOutput pluginId={tab.id} />;
```

### 4.4 Creating DevBuild Tabs from Events

In `ui/providers/BottomDrawer/tabs.tsx`, add a listener for the `onOpenBuildOutput` event:

```typescript
// Add inside the useEffect that handles event subscriptions:

const unsubscribeOpenBuildOutput = devToolsChannel.on('onOpenBuildOutput', (pluginId) => {
  // Check if a tab already exists for this plugin
  const existing = tabs.find(
    (tab) => tab.variant === 'devbuild' && tab.id === `devbuild-${pluginId}`,
  );

  if (existing) {
    focusTab({ id: existing.id });
  } else {
    createTab({
      id: `devbuild-${pluginId}`,
      title: `Build: ${pluginId}`,
      variant: 'devbuild',
      icon: 'LuHammer',
    });
  }
});

// Add to cleanup:
return () => {
  // ... existing cleanups ...
  unsubscribeOpenBuildOutput();
};
```

---

## 5. Enhanced Plugin Card: Dev Mode Section

### File: `ui/pages/plugins/DevModeSection.tsx`

```typescript
import React, { useEffect, useState } from 'react';
import Box from '@mui/joy/Box';
import Button from '@mui/joy/Button';
import Chip from '@mui/joy/Chip';
import Divider from '@mui/joy/Divider';
import Stack from '@mui/joy/Stack';
import Tooltip from '@mui/joy/Tooltip';
import Typography from '@mui/joy/Typography';
import {
  LuCircle,
  LuExternalLink,
  LuHammer,
  LuPlay,
  LuRefreshCw,
  LuSquare,
} from 'react-icons/lu';

import { devToolsChannel } from '@/features/devtools/events';
import type { DevServerState } from '@/features/devtools/types';
import { getAggregateStatus, STATUS_COLORS } from '@/features/devtools/types';

interface Props {
  pluginId: string;
  devPath: string;
}

/**
 * Dev mode section displayed inside InstalledPluginCard when the plugin is in dev mode.
 * Shows dev server status, controls, and build information.
 */
const DevModeSection: React.FC<Props> = ({ pluginId, devPath }) => {
  const [state, setState] = useState<DevServerState | null>(null);

  useEffect(() => {
    const unsub = devToolsChannel.on('onStatusChange', (s) => {
      if (s.pluginId === pluginId) {
        setState(s);
      }
    });
    return unsub;
  }, [pluginId]);

  const aggStatus = state ? getAggregateStatus(state) : 'stopped';

  const handleOpenBuildOutput = () => {
    devToolsChannel.emit('onOpenBuildOutput', pluginId);
  };

  const handleRestart = () => {
    devToolsChannel.emit('onRestartDevServer', pluginId);
  };

  return (
    <Box
      sx={{
        mt: 1,
        p: 1.5,
        borderRadius: 'sm',
        bgcolor: 'background.level1',
        border: '1px solid',
        borderColor: 'divider',
      }}
    >
      <Stack direction="row" alignItems="center" justifyContent="space-between" mb={1}>
        <Stack direction="row" alignItems="center" gap={1}>
          <Typography level="title-sm">Dev Server</Typography>
          <Chip
            size="sm"
            variant="soft"
            color={STATUS_COLORS[aggStatus]}
            startDecorator={<LuCircle size={6} />}
            sx={{ '--Chip-minHeight': '18px', fontSize: '10px' }}
          >
            {aggStatus.toUpperCase()}
          </Chip>
          {state?.mode === 'external' && (
            <Chip
              size="sm"
              variant="outlined"
              color="neutral"
              startDecorator={<LuExternalLink size={10} />}
              sx={{ '--Chip-minHeight': '18px', fontSize: '10px' }}
            >
              External
            </Chip>
          )}
        </Stack>

        <Stack direction="row" gap={0.5}>
          <Tooltip title="View build output" size="sm">
            <Button
              size="sm"
              variant="plain"
              color="neutral"
              startDecorator={<LuHammer size={14} />}
              onClick={handleOpenBuildOutput}
              sx={{ fontSize: '12px' }}
            >
              Logs
            </Button>
          </Tooltip>
          <Tooltip title="Restart dev server" size="sm">
            <Button
              size="sm"
              variant="plain"
              color="neutral"
              startDecorator={<LuRefreshCw size={14} />}
              onClick={handleRestart}
              sx={{ fontSize: '12px' }}
            >
              Restart
            </Button>
          </Tooltip>
        </Stack>
      </Stack>

      <Divider sx={{ mb: 1 }} />

      <Stack gap={0.5}>
        {/* Source path */}
        <Stack direction="row" gap={1}>
          <Typography level="body-xs" sx={{ color: 'text.tertiary', minWidth: 60 }}>
            Source:
          </Typography>
          <Typography
            level="body-xs"
            sx={{ fontFamily: 'monospace', color: 'text.secondary' }}
          >
            {devPath}
          </Typography>
        </Stack>

        {/* Vite status */}
        {state?.vitePort && state.vitePort > 0 && (
          <Stack direction="row" gap={1}>
            <Typography level="body-xs" sx={{ color: 'text.tertiary', minWidth: 60 }}>
              Vite:
            </Typography>
            <Typography level="body-xs" sx={{ fontFamily: 'monospace', color: 'text.secondary' }}>
              http://127.0.0.1:{state.vitePort}
            </Typography>
          </Stack>
        )}

        {/* gRPC status */}
        {state && (
          <Stack direction="row" gap={1}>
            <Typography level="body-xs" sx={{ color: 'text.tertiary', minWidth: 60 }}>
              gRPC:
            </Typography>
            <Typography
              level="body-xs"
              sx={{
                color: state.grpcConnected
                  ? 'success.plainColor'
                  : 'danger.plainColor',
              }}
            >
              {state.grpcConnected ? 'Connected' : 'Disconnected'}
            </Typography>
          </Stack>
        )}

        {/* Last build time */}
        {state?.lastBuildTime !== undefined && state.lastBuildTime > 0 && (
          <Stack direction="row" gap={1}>
            <Typography level="body-xs" sx={{ color: 'text.tertiary', minWidth: 60 }}>
              Build:
            </Typography>
            <Typography level="body-xs" sx={{ color: 'text.secondary' }}>
              {state.lastBuildTime}ms
            </Typography>
          </Stack>
        )}

        {/* Error */}
        {state?.error && (
          <Typography
            level="body-xs"
            sx={{
              color: 'danger.plainColor',
              fontFamily: 'monospace',
              mt: 0.5,
              p: 0.5,
              bgcolor: 'danger.softBg',
              borderRadius: 'xs',
            }}
          >
            {state.error}
          </Typography>
        )}
      </Stack>
    </Box>
  );
};

export default React.memo(DevModeSection);
```

### Changes to `ui/pages/plugins/InstalledPluginCard.tsx`

Add the DevModeSection after the existing dev mode chip:

```typescript
// Add import at the top:
import DevModeSection from './DevModeSection';

// Inside the component, after CardContent and before CardActions, add:
{plugin.data?.devMode && (
  <DevModeSection
    pluginId={id}
    devPath={plugin.data?.devPath ?? ''}
  />
)}
```

---

## 6. Error Overlay

### File: `ui/features/devtools/components/PluginDevOverlay.tsx`

This overlay is displayed on top of the plugin's rendered area when a build error occurs. It follows the pattern of Vite's own error overlay.

```typescript
import React, { useEffect, useState } from 'react';
import Box from '@mui/joy/Box';
import Button from '@mui/joy/Button';
import Card from '@mui/joy/Card';
import Divider from '@mui/joy/Divider';
import Stack from '@mui/joy/Stack';
import Typography from '@mui/joy/Typography';
import { LuTriangleAlert, LuX, LuRefreshCw } from 'react-icons/lu';

import { devToolsChannel } from '@/features/devtools/events';
import type { DevBuildError, DevServerState } from '@/features/devtools/types';

interface Props {
  /** The plugin ID to watch for errors. */
  pluginId: string;
  /** If true, the overlay can be dismissed by the user. */
  dismissable?: boolean;
}

/**
 * Error overlay displayed on top of a plugin's render area when build errors occur.
 * Shows structured error messages with file/line/column information.
 * Can be dismissed (errors persist in the build output tab).
 */
const PluginDevOverlay: React.FC<Props> = ({ pluginId, dismissable = true }) => {
  const [errors, setErrors] = useState<DevBuildError[]>([]);
  const [dismissed, setDismissed] = useState(false);
  const [hasError, setHasError] = useState(false);

  useEffect(() => {
    const unsubError = devToolsChannel.on('onBuildError', (payload) => {
      if (payload.pluginId !== pluginId) return;
      setErrors(payload.errors);
      setHasError(true);
      setDismissed(false); // New errors always show the overlay
    });

    const unsubStatus = devToolsChannel.on('onStatusChange', (state: DevServerState) => {
      if (state.pluginId !== pluginId) return;
      // Clear errors when build succeeds
      if (state.goStatus === 'ready' && state.error === undefined) {
        setErrors([]);
        setHasError(false);
      }
    });

    return () => {
      unsubError();
      unsubStatus();
    };
  }, [pluginId]);

  if (!hasError || dismissed || errors.length === 0) {
    return null;
  }

  const handleDismiss = () => {
    if (dismissable) {
      setDismissed(true);
    }
  };

  const handleRestart = () => {
    devToolsChannel.emit('onRestartDevServer', pluginId);
  };

  const handleViewLogs = () => {
    devToolsChannel.emit('onOpenBuildOutput', pluginId);
  };

  return (
    <Box
      sx={{
        position: 'absolute',
        inset: 0,
        zIndex: 1000,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <Card
        variant="outlined"
        sx={{
          maxWidth: 600,
          maxHeight: '80%',
          overflow: 'auto',
          bgcolor: 'background.surface',
          border: '1px solid',
          borderColor: 'danger.outlinedBorder',
        }}
      >
        {/* Header */}
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" gap={1}>
            <LuTriangleAlert size={18} color="var(--joy-palette-danger-400)" />
            <Typography level="title-md" sx={{ color: 'danger.plainColor' }}>
              Build Error
            </Typography>
            <Typography level="body-xs" sx={{ color: 'text.tertiary' }}>
              {pluginId}
            </Typography>
          </Stack>
          {dismissable && (
            <Button
              size="sm"
              variant="plain"
              color="neutral"
              onClick={handleDismiss}
              sx={{ minWidth: 0, minHeight: 0, p: 0.5 }}
            >
              <LuX size={16} />
            </Button>
          )}
        </Stack>

        <Divider sx={{ my: 1 }} />

        {/* Error list */}
        <Stack gap={1}>
          {errors.map((err, i) => (
            <Box
              key={i}
              sx={{
                p: 1,
                borderRadius: 'xs',
                bgcolor: 'background.level1',
                fontFamily: 'monospace',
                fontSize: '12px',
              }}
            >
              {/* File location */}
              <Typography
                level="body-xs"
                sx={{
                  color: 'text.tertiary',
                  mb: 0.5,
                  fontFamily: 'inherit',
                }}
              >
                {err.file}:{err.line}:{err.column}
              </Typography>
              {/* Error message */}
              <Typography
                level="body-sm"
                sx={{
                  color: err.severity === 'error' ? 'danger.plainColor' : 'warning.plainColor',
                  fontFamily: 'inherit',
                  whiteSpace: 'pre-wrap',
                  wordBreak: 'break-word',
                }}
              >
                {err.message}
              </Typography>
            </Box>
          ))}
        </Stack>

        <Divider sx={{ my: 1 }} />

        {/* Actions */}
        <Stack direction="row" gap={1} justifyContent="flex-end">
          <Button
            size="sm"
            variant="plain"
            color="neutral"
            onClick={handleViewLogs}
          >
            View Full Logs
          </Button>
          <Button
            size="sm"
            variant="soft"
            color="primary"
            startDecorator={<LuRefreshCw size={14} />}
            onClick={handleRestart}
          >
            Restart
          </Button>
        </Stack>
      </Card>
    </Box>
  );
};

export default React.memo(PluginDevOverlay);
```

### Usage in PluginRenderer

The overlay wraps the plugin's render area:

```typescript
// In ui/features/plugins/components/PluginRenderer.tsx
import PluginDevOverlay from '@/features/devtools/components/PluginDevOverlay';

// In the render function, wrap the plugin output:
<Box sx={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
  {isDevMode && <PluginDevOverlay pluginId={pluginId} />}
  {/* ... existing plugin rendering ... */}
</Box>
```

---

## 7. File Index

| File | Status | Description |
|------|--------|-------------|
| `ui/features/devtools/types.ts` | **New** | TypeScript interfaces and helpers |
| `ui/features/devtools/events.ts` | **New** | Event bus for dev tools |
| `ui/features/devtools/wailsBridge.ts` | **New** | Wails events to event bus bridge |
| `ui/features/devtools/useDevServers.ts` | **New** | Hook for dev server state |
| `ui/features/devtools/components/PluginDevOverlay.tsx` | **New** | Error overlay component |
| `ui/components/displays/Footer/PluginDevStatusIndicators.tsx` | **New** | Footer status dots |
| `ui/components/displays/Footer/LeftSide.tsx` | **Modified** | Add indicators import |
| `ui/providers/BottomDrawer/types.ts` | **Modified** | Add `'devbuild'` variant |
| `ui/providers/BottomDrawer/containers/DevBuildOutput/index.tsx` | **New** | Build output container |
| `ui/providers/BottomDrawer/tabs.tsx` | **Modified** | Add devbuild tab creation |
| `ui/layouts/core/main/BottomDrawer/index.tsx` | **Modified** | Render devbuild tabs |
| `ui/pages/plugins/DevModeSection.tsx` | **New** | Dev mode section for plugin card |
| `ui/pages/plugins/InstalledPluginCard.tsx` | **Modified** | Add DevModeSection |

---

## 8. Event Flow Summary

```
Go DevServerManager
  │
  ├── Emits: plugin/devserver/status  ──→  wailsBridge.ts ──→ devToolsChannel.onStatusChange
  │                                                              │
  │                                                              ├── useDevServers hook (footer indicators)
  │                                                              ├── DevModeSection (plugin card)
  │                                                              ├── DevBuildOutput (build output tab)
  │                                                              └── PluginDevOverlay (error clearing)
  │
  ├── Emits: plugin/devserver/log     ──→  wailsBridge.ts ──→ devToolsChannel.onBuildLog
  │                                                              │
  │                                                              └── DevBuildOutput (append line)
  │
  └── Emits: plugin/devserver/error   ──→  wailsBridge.ts ──→ devToolsChannel.onBuildError
                                                                 │
                                                                 └── PluginDevOverlay (show errors)

User Actions:
  Footer dot click        ──→  devToolsChannel.onOpenBuildOutput  ──→  tabs.tsx creates/focuses tab
  Restart button click    ──→  devToolsChannel.onRestartDevServer ──→  Go DevServerManager.RestartDevServer()
```
