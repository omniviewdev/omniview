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

import { LuCircleCheck, LuCircleAlert, LuCircleSlash, LuX } from 'react-icons/lu';
import { useInformerState, InformerResourceState } from '@omniviewdev/runtime';
import { ResourceClient } from '@omniviewdev/runtime/api';
import { parseResourceKey, formatGroup } from '../../utils/resourceKey';

interface SyncProgressDialogProps {
  open: boolean;
  onClose: () => void;
  clusterName: string;
  pluginID: string;
  connectionID: string;
}

type ResourceItem = { key: string; kind: string; state: InformerResourceState; count: number };

/** Whether a state is terminal (done — won't change further) */
const isTerminal = (s: InformerResourceState) =>
  s === InformerResourceState.Synced ||
  s === InformerResourceState.Error ||
  s === InformerResourceState.Cancelled;

function StateIcon({ state }: { state: InformerResourceState }) {
  switch (state) {
    case InformerResourceState.Pending:
      return <CircularProgress size={14} thickness={5} sx={{ color: 'var(--ov-fg-faint)' }} />;
    case InformerResourceState.Syncing:
      return <CircularProgress size={14} thickness={5} sx={{ color: 'var(--ov-accent-fg, #58a6ff)' }} />;
    case InformerResourceState.Synced:
      return <LuCircleCheck size={14} color="#3fb950" />;
    case InformerResourceState.Error:
      return <LuCircleAlert size={14} color="#f85149" />;
    case InformerResourceState.Cancelled:
      return <LuCircleSlash size={14} color="var(--ov-fg-faint)" />;
    default:
      return null;
  }
}

/** Per-group progress summary */
function GroupProgress({ items }: { items: ResourceItem[] }) {
  const total = items.length;
  const done = items.filter(i => isTerminal(i.state)).length;
  const allDone = done === total;
  const hasError = items.some(i => i.state === InformerResourceState.Error);
  const percent = total > 0 ? Math.round((done / total) * 100) : 0;

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
            bgcolor: hasError ? '#f85149' : allDone ? '#3fb950' : 'var(--ov-accent-fg, #58a6ff)',
            borderRadius: 1.5,
          },
        }}
      />
      <Text size="xs" sx={{ color: 'var(--ov-fg-faint)', minWidth: 28, textAlign: 'right', fontFamily: 'var(--ov-font-mono, monospace)' }}>
        {done}/{total}
      </Text>
    </Box>
  );
}

export default function SyncProgressDialog({
  open,
  onClose,
  clusterName,
  pluginID,
  connectionID,
}: SyncProgressDialogProps) {
  const { summary, syncProgress, isFullySynced } = useInformerState({ pluginID, connectionID });

  const resources = summary.data?.resources ?? {};
  const resourceCounts = summary.data?.resourceCounts ?? {};
  const totalResources = summary.data?.totalResources ?? 0;

  // Count resources that have reached a terminal state (synced, error, cancelled)
  const doneCount = React.useMemo(() => {
    let count = 0;
    for (const state of Object.values(resources)) {
      if (
        state === InformerResourceState.Synced ||
        state === InformerResourceState.Error ||
        state === InformerResourceState.Cancelled
      ) {
        count++;
      }
    }
    return count;
  }, [resources]);

  // Group resources by API group
  const grouped = React.useMemo(() => {
    const groups: Record<string, ResourceItem[]> = {};

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

  const percent = Math.round(syncProgress * 100);

  const handleRetry = async (resourceKey: string) => {
    try {
      await ResourceClient.EnsureInformerForResource(pluginID, connectionID, resourceKey);
    } catch (err) {
      console.error('Failed to retry informer:', err);
    }
  };

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
          {!isFullySynced && <CircularProgress size={16} thickness={5} sx={{ color: 'var(--ov-accent-fg, #58a6ff)' }} />}
          {isFullySynced && <LuCircleCheck size={16} color="#3fb950" />}
          <Text weight="semibold" size="sm">
            {isFullySynced ? `Synced "${clusterName}"` : `Syncing "${clusterName}"`}
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
                bgcolor: isFullySynced ? '#3fb950' : 'var(--ov-accent-fg, #58a6ff)',
                borderRadius: 3,
                transition: 'transform 0.3s ease',
              },
            }}
          />
          <Text size="xs" sx={{ color: 'var(--ov-fg-muted)', minWidth: 64, textAlign: 'right' }}>
            {percent}%&ensp;{doneCount}/{totalResources}
          </Text>
        </Box>
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
                  opacity: state === InformerResourceState.Cancelled ? 0.4 : 1,
                }}
              >
                <StateIcon state={state} />
                <Text size="xs" sx={{ flex: 1 }}>{kind}</Text>
                {state === InformerResourceState.Cancelled && (
                  <Text size="xs" sx={{ color: 'var(--ov-fg-faint)', fontStyle: 'italic' }}>
                    skipped
                  </Text>
                )}
                {state === InformerResourceState.Synced && count > 0 && (
                  <Text size="xs" sx={{ color: 'var(--ov-fg-faint)', fontFamily: 'var(--ov-font-mono, monospace)' }}>
                    {count}
                  </Text>
                )}
                {state === InformerResourceState.Error && (
                  <Button
                    emphasis="soft"
                    size="sm"
                    color="danger"
                    onClick={() => handleRetry(key)}
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
