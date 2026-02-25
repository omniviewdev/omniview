import { type MouseEvent } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import type { SxProps, Theme } from '@mui/material/styles';

type Status = 'healthy' | 'warning' | 'degraded' | 'error' | 'unknown' | 'pending';

const statusColors: Record<Status, string> = {
  healthy: 'var(--ov-success-default)',
  warning: 'var(--ov-warning-default)',
  degraded: 'var(--ov-warning-emphasis)',
  error: 'var(--ov-danger-default)',
  unknown: 'var(--ov-fg-muted)',
  pending: 'var(--ov-info-default)',
};

export interface AIResourceCardProps {
  kind: string;
  name: string;
  scope?: string;
  scopeLabel?: string;
  status?: Status;
  statusLabel?: string;
  icon?: React.ReactNode;
  iconColor?: string;
  metadata?: Array<{ label: string; value: string }>;
  compact?: boolean;
  onNavigate?: () => void;
  sx?: SxProps<Theme>;
}

function StatusPill({ status, label }: { status: Status; label?: string }) {
  return (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1,
        py: 0.25,
        borderRadius: '10px',
        bgcolor: `color-mix(in srgb, ${statusColors[status]} 15%, transparent)`,
        color: statusColors[status],
        fontSize: 'var(--ov-text-xs)',
        fontWeight: 'var(--ov-weight-medium)',
        lineHeight: 1,
      }}
    >
      <Box
        sx={{
          width: 6,
          height: 6,
          borderRadius: '50%',
          bgcolor: statusColors[status],
        }}
      />
      {label || status}
    </Box>
  );
}

export default function AIResourceCard({
  kind,
  name,
  scope,
  scopeLabel,
  status,
  statusLabel,
  icon,
  iconColor,
  metadata,
  compact = false,
  onNavigate,
  sx,
}: AIResourceCardProps) {
  const handleNavigate = (e: MouseEvent) => {
    e.stopPropagation();
    onNavigate?.();
  };

  if (compact) {
    return (
      <Chip
        size="small"
        icon={icon ? <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span> : undefined}
        label={`${kind}/${name}`}
        onClick={onNavigate}
        sx={{
          fontFamily: 'var(--ov-font-mono)',
          fontSize: 'var(--ov-text-xs)',
          fontWeight: 'var(--ov-weight-medium)',
          bgcolor: 'var(--ov-bg-surface)',
          border: '1px solid var(--ov-border-default)',
          color: 'var(--ov-fg-default)',
          cursor: onNavigate ? 'pointer' : 'default',
          '& .MuiChip-icon': { color: iconColor || 'var(--ov-accent)', ml: 0.5, mr: 0 },
          ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
        } as SxProps<Theme>}
      />
    );
  }

  return (
    <Box
      sx={{
        borderRadius: '8px',
        border: '1px solid var(--ov-border-default)',
        bgcolor: 'var(--ov-bg-surface)',
        overflow: 'hidden',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {/* Header */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          px: 1.5,
          py: 1,
        }}
      >
        <Chip
          size="small"
          icon={icon ? <span style={{ display: 'flex', alignItems: 'center' }}>{icon}</span> : undefined}
          label={kind}
          sx={{
            bgcolor: `color-mix(in srgb, ${iconColor || 'var(--ov-accent)'} 15%, transparent)`,
            color: iconColor || 'var(--ov-accent)',
            fontWeight: 'var(--ov-weight-semibold)',
            fontSize: 'var(--ov-text-xs)',
            height: 22,
            '& .MuiChip-icon': { color: iconColor || 'var(--ov-accent)', ml: 0.5, mr: 0 },
          }}
        />

        <Typography
          sx={{
            fontFamily: 'var(--ov-font-mono)',
            fontSize: 'var(--ov-text-sm)',
            fontWeight: 'var(--ov-weight-medium)',
            color: 'var(--ov-fg-default)',
            flex: 1,
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
          }}
        >
          {name}
        </Typography>

        {status && <StatusPill status={status} label={statusLabel} />}

        {onNavigate && (
          <MuiIconButton
            size="small"
            onClick={handleNavigate}
            aria-label="View resource"
            sx={{
              color: 'var(--ov-fg-faint)',
              '&:hover': { color: 'var(--ov-accent)' },
            }}
          >
            <OpenInNewIcon sx={{ fontSize: 14 }} />
          </MuiIconButton>
        )}
      </Box>

      {/* Scope + metadata */}
      {(scope || (metadata && metadata.length > 0)) && (
        <Box
          sx={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: 1.5,
            px: 1.5,
            py: 0.75,
            borderTop: '1px solid var(--ov-border-muted)',
            bgcolor: 'var(--ov-bg-surface-inset)',
          }}
        >
          {scope && (
            <Box sx={{ display: 'flex', gap: 0.5, alignItems: 'baseline' }}>
              <Typography
                sx={{
                  fontSize: 'var(--ov-text-xs)',
                  color: 'var(--ov-fg-faint)',
                }}
              >
                {scopeLabel || 'Scope'}:
              </Typography>
              <Typography
                sx={{
                  fontSize: 'var(--ov-text-xs)',
                  color: 'var(--ov-fg-muted)',
                  fontFamily: 'var(--ov-font-mono)',
                }}
              >
                {scope}
              </Typography>
            </Box>
          )}
          {metadata?.map((m) => (
            <Box key={m.label} sx={{ display: 'flex', gap: 0.5, alignItems: 'baseline' }}>
              <Typography
                sx={{
                  fontSize: 'var(--ov-text-xs)',
                  color: 'var(--ov-fg-faint)',
                }}
              >
                {m.label}:
              </Typography>
              <Typography
                sx={{
                  fontSize: 'var(--ov-text-xs)',
                  color: 'var(--ov-fg-muted)',
                  fontFamily: 'var(--ov-font-mono)',
                }}
              >
                {m.value}
              </Typography>
            </Box>
          ))}
        </Box>
      )}
    </Box>
  );
}

AIResourceCard.displayName = 'AIResourceCard';
