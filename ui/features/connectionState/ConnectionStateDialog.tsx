import React from 'react';

import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import IconButton from '@mui/material/IconButton';

import { Button } from '@omniviewdev/ui/buttons';
import { Text } from '@omniviewdev/ui/typography';

import { LuCircleCheck, LuCircleAlert, LuCircleSlash, LuShieldAlert, LuX } from 'react-icons/lu';
import { WatchState, parseResourceKey, formatGroup } from '@omniviewdev/runtime';

import type { ResourceStateItem } from './types';

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

export interface ConnectionStateDialogProps {
  open: boolean;
  onClose: () => void;
  connectionName: string;
  /** Per-resource watch states from useWatchState */
  resources: Record<string, WatchState>;
  /** Per-resource cached object counts */
  resourceCounts: Record<string, number>;
  /** Called when user clicks Retry on an errored resource */
  onRetryResource: (resourceKey: string) => void;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Whether a state is terminal (done — won't change further) */
const isTerminal = (s: WatchState) =>
  s === WatchState.SYNCED ||
  s === WatchState.ERROR ||
  s === WatchState.STOPPED ||
  s === WatchState.FAILED ||
  s === WatchState.FORBIDDEN ||
  s === WatchState.SKIPPED;

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function StateIcon({ state }: { state: WatchState }) {
  switch (state) {
    case WatchState.IDLE:
      return <LuCircleSlash size={14} color="var(--ov-fg-faint)" />;
    case WatchState.SYNCING:
      return <CircularProgress size={14} thickness={5} sx={{ color: 'var(--ov-accent-fg, #58a6ff)' }} />;
    case WatchState.SYNCED:
      return <LuCircleCheck size={14} color="#3fb950" />;
    case WatchState.ERROR:
      return <LuCircleAlert size={14} color="#f85149" />;
    case WatchState.FAILED:
      return <LuCircleAlert size={14} color="#f85149" />;
    case WatchState.FORBIDDEN:
      return <LuShieldAlert size={14} color="#d29922" />;
    case WatchState.STOPPED:
      return <LuCircleSlash size={14} color="var(--ov-fg-faint)" />;
    case WatchState.SKIPPED:
      return <LuCircleSlash size={14} color="var(--ov-fg-faint)" />;
    default:
      return <LuCircleSlash size={14} color="var(--ov-fg-faint)" />;
  }
}

/** Per-group progress summary — excludes SKIPPED from totals */
function GroupProgress({ items }: { items: ResourceStateItem[] }) {
  const watched = items.filter(i => i.state !== WatchState.SKIPPED);
  const skipped = items.length - watched.length;
  const total = watched.length;
  const done = watched.filter(i => isTerminal(i.state)).length;
  const allDone = total > 0 && done === total;
  const allSkipped = total === 0 && skipped > 0;
  const hasError = watched.some(i => i.state === WatchState.ERROR);
  const percent = total > 0 ? Math.round((done / total) * 100) : allSkipped ? 100 : 0;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, ml: 'auto' }}>
      <LinearProgress
        variant="determinate"
        value={percent}
        sx={{
          width: 48,
          height: 3,
          borderRadius: 1.5,
          bgcolor: 'rgba(255,255,255,0.08)',
          '& .MuiLinearProgress-bar': {
            bgcolor: hasError ? '#f85149' : (allDone || allSkipped) ? '#3fb950' : 'var(--ov-accent-fg, #58a6ff)',
            borderRadius: 1.5,
          },
        }}
      />
      <Text size="xs" sx={{ color: 'var(--ov-fg-faint)', minWidth: 28, textAlign: 'right', fontFamily: 'var(--ov-font-mono, monospace)' }}>
        {allSkipped ? `${skipped} skipped` : `${done}/${total}`}
      </Text>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export default function ConnectionStateDialog({
  open,
  onClose,
  connectionName,
  resources,
  resourceCounts,
  onRetryResource,
}: ConnectionStateDialogProps) {
  // Count resources by category: watched (attempted) vs skipped/inaccessible
  const { watchedTotal, watchedDone, skippedCount } = React.useMemo(() => {
    let watched = 0;
    let done = 0;
    let skipped = 0;
    for (const state of Object.values(resources)) {
      if (state === WatchState.SKIPPED) {
        skipped++;
        continue;
      }
      watched++;
      if (isTerminal(state)) {
        done++;
      }
    }
    return { watchedTotal: watched, watchedDone: done, skippedCount: skipped };
  }, [resources]);

  // Group resources by API group
  const grouped = React.useMemo(() => {
    const groups: Record<string, ResourceStateItem[]> = {};

    for (const [key, state] of Object.entries(resources)) {
      const { group, kind } = parseResourceKey(key);
      const label = formatGroup(group);
      if (!groups[label]) groups[label] = [];
      groups[label].push({ key, kind, state, count: resourceCounts[key] ?? 0 });
    }

    // Sort groups alphabetically, but put "Core" first
    return Object.entries(groups).sort(([a], [b]) => {
      if (a === 'Core') return -1;
      if (b === 'Core') return 1;
      return a.localeCompare(b);
    });
  }, [resources, resourceCounts]);

  // Progress based on watched resources only (SKIPPED excluded from denominator)
  const watchedAllDone = watchedTotal > 0 && watchedDone === watchedTotal;
  const percent = watchedTotal > 0 ? Math.round((watchedDone / watchedTotal) * 100) : 0;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            bgcolor: 'var(--ov-bg-elevated, #1c2128)',
            border: '1px solid var(--ov-border-default, #30363d)',
            borderRadius: '8px',
            color: 'var(--ov-fg-default, #c9d1d9)',
            backgroundImage: 'none',
          },
        },
      }}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2,
          py: 1.5,
          borderBottom: '1px solid var(--ov-border-default, #30363d)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {!watchedAllDone && <CircularProgress size={16} thickness={5} sx={{ color: 'var(--ov-accent-fg, #58a6ff)' }} />}
          {watchedAllDone && <LuCircleCheck size={16} color="#3fb950" />}
          <Text weight="semibold" size="sm">
            {watchedAllDone ? `Synced "${connectionName}"` : `Syncing "${connectionName}"`}
          </Text>
        </Box>
        <IconButton size="small" onClick={onClose} sx={{ color: 'var(--ov-fg-muted)' }}>
          <LuX size={16} />
        </IconButton>
      </Box>

      {/* Progress bar */}
      <Box sx={{ px: 2, py: 1, borderBottom: '1px solid var(--ov-border-default, #30363d)' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 0.5 }}>
          <LinearProgress
            variant="determinate"
            value={percent}
            sx={{
              flex: 1,
              height: 6,
              borderRadius: 3,
              bgcolor: 'rgba(255,255,255,0.08)',
              '& .MuiLinearProgress-bar': {
                bgcolor: watchedAllDone ? '#3fb950' : 'var(--ov-accent-fg, #58a6ff)',
                borderRadius: 3,
                transition: 'transform 0.3s ease',
              },
            }}
          />
          <Text size="xs" sx={{ color: 'var(--ov-fg-muted)', minWidth: 64, textAlign: 'right' }}>
            {percent}%&ensp;{watchedDone}/{watchedTotal}
          </Text>
        </Box>
        {skippedCount > 0 && (
          <Text size="xs" sx={{ color: 'var(--ov-fg-faint)', mt: 0.25 }}>
            {skippedCount} resource{skippedCount !== 1 ? 's' : ''} skipped (unavailable on this cluster)
          </Text>
        )}
      </Box>

      {/* Resource list */}
      <DialogContent sx={{ p: 0, maxHeight: 400 }}>
        {grouped.map(([groupLabel, items]) => (
          <Box key={groupLabel}>
            {/* Group header with progress */}
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                px: 2,
                py: 0.75,
                bgcolor: 'rgba(255,255,255,0.03)',
                borderBottom: '1px solid var(--ov-border-default, #30363d)',
              }}
            >
              <Text size="xs" weight="semibold" sx={{ color: 'var(--ov-fg-muted)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                {groupLabel}
              </Text>
              <GroupProgress items={items} />
            </Box>
            {items.sort((a, b) => a.kind.localeCompare(b.kind)).map(({ key, kind, state, count }) => (
              <Box
                key={key}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  px: 2,
                  py: 0.5,
                  borderBottom: '1px solid rgba(255,255,255,0.04)',
                  '&:last-child': { borderBottom: 'none' },
                  opacity: (state === WatchState.STOPPED || state === WatchState.SKIPPED || state === WatchState.IDLE) ? 0.4 : 1,
                }}
              >
                <StateIcon state={state} />
                <Text size="xs" sx={{ flex: 1 }}>{kind}</Text>
                {state === WatchState.FORBIDDEN && (
                  <Text size="xs" sx={{ color: '#d29922', fontStyle: 'italic' }}>
                    No access
                  </Text>
                )}
                {state === WatchState.SKIPPED && (
                  <Text size="xs" sx={{ color: 'var(--ov-fg-faint)', fontStyle: 'italic' }}>
                    Skipped
                  </Text>
                )}
                {state === WatchState.STOPPED && (
                  <Text size="xs" sx={{ color: 'var(--ov-fg-faint)', fontStyle: 'italic' }}>
                    Stopped
                  </Text>
                )}
                {state === WatchState.SYNCED && count > 0 && (
                  <Text size="xs" sx={{ color: 'var(--ov-fg-faint)', fontFamily: 'var(--ov-font-mono, monospace)' }}>
                    {count}
                  </Text>
                )}
                {(state === WatchState.ERROR || state === WatchState.FAILED) && (
                  <Button
                    emphasis="soft"
                    size="sm"
                    color="danger"
                    onClick={() => onRetryResource(key)}
                    sx={{ minWidth: 0, fontSize: '0.625rem', px: 1, py: 0.25 }}
                  >
                    Retry
                  </Button>
                )}
              </Box>
            ))}
          </Box>
        ))}
      </DialogContent>

      {/* Footer */}
      <DialogActions
        sx={{
          borderTop: '1px solid var(--ov-border-default, #30363d)',
          px: 2,
          py: 1,
        }}
      >
        <Button emphasis="soft" size="sm" color="neutral" onClick={onClose}>
          Dismiss
        </Button>
      </DialogActions>
    </Dialog>
  );
}
