import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import MuiIconButton from '@mui/material/IconButton';
import EditIcon from '@mui/icons-material/Edit';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import type { SxProps, Theme } from '@mui/material/styles';

interface ContextSegment {
  label: string;
  icon?: React.ReactNode;
}

export interface AIContextBarProps {
  provider?: ContextSegment;
  connection?: ContextSegment;
  scope?: { label: string; value: string };
  resource?: { kind: string; name: string; icon?: React.ReactNode };
  onChangeScope?: () => void;
  sx?: SxProps<Theme>;
}

export default function AIContextBar({
  provider,
  connection,
  scope,
  resource,
  onChangeScope,
  sx,
}: AIContextBarProps) {
  const segments: React.ReactNode[] = [];

  if (provider) {
    segments.push(
      <Chip
        key="provider"
        size="small"
        icon={provider.icon ? <span style={{ display: 'flex', alignItems: 'center' }}>{provider.icon}</span> : undefined}
        label={provider.label}
        sx={{
          bgcolor: 'var(--ov-accent-subtle)',
          color: 'var(--ov-accent-fg)',
          fontWeight: 'var(--ov-weight-medium)',
          fontSize: 'var(--ov-text-xs)',
          height: 24,
          '& .MuiChip-icon': { ml: 0.5, mr: 0 },
        }}
      />,
    );
  }

  if (connection) {
    segments.push(
      <ChevronRightIcon
        key="sep-conn"
        sx={{ fontSize: 14, color: 'var(--ov-fg-faint)' }}
      />,
    );
    segments.push(
      <Chip
        key="connection"
        size="small"
        icon={connection.icon ? <span style={{ display: 'flex', alignItems: 'center' }}>{connection.icon}</span> : undefined}
        label={connection.label}
        variant="outlined"
        sx={{
          borderColor: 'var(--ov-border-default)',
          color: 'var(--ov-fg-default)',
          fontSize: 'var(--ov-text-xs)',
          height: 24,
          '& .MuiChip-icon': { ml: 0.5, mr: 0 },
        }}
      />,
    );
  }

  if (scope) {
    segments.push(
      <ChevronRightIcon
        key="sep-scope"
        sx={{ fontSize: 14, color: 'var(--ov-fg-faint)' }}
      />,
    );
    segments.push(
      <Chip
        key="scope"
        size="small"
        label={`${scope.label}: ${scope.value}`}
        variant="outlined"
        sx={{
          borderColor: 'var(--ov-border-default)',
          color: 'var(--ov-fg-muted)',
          fontSize: 'var(--ov-text-xs)',
          height: 24,
        }}
      />,
    );
  }

  if (resource) {
    segments.push(
      <ChevronRightIcon
        key="sep-res"
        sx={{ fontSize: 14, color: 'var(--ov-fg-faint)' }}
      />,
    );
    segments.push(
      <Chip
        key="resource"
        size="small"
        icon={resource.icon ? <span style={{ display: 'flex', alignItems: 'center' }}>{resource.icon}</span> : undefined}
        label={`${resource.kind}/${resource.name}`}
        variant="outlined"
        sx={{
          borderColor: 'var(--ov-border-muted)',
          color: 'var(--ov-fg-default)',
          fontFamily: 'var(--ov-font-mono)',
          fontSize: 'var(--ov-text-xs)',
          height: 24,
          '& .MuiChip-icon': { ml: 0.5, mr: 0 },
        }}
      />,
    );
  }

  if (segments.length === 0) return null;

  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: 0.5,
        px: 1.5,
        py: 0.75,
        borderRadius: '6px',
        bgcolor: 'var(--ov-bg-surface)',
        border: '1px solid var(--ov-border-default)',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {segments}

      {onChangeScope && (
        <MuiIconButton
          size="small"
          onClick={onChangeScope}
          aria-label="Change scope"
          sx={{
            ml: 'auto',
            color: 'var(--ov-fg-faint)',
            '&:hover': { color: 'var(--ov-fg-default)' },
          }}
        >
          <EditIcon sx={{ fontSize: 14 }} />
        </MuiIconButton>
      )}
    </Box>
  );
}

AIContextBar.displayName = 'AIContextBar';
