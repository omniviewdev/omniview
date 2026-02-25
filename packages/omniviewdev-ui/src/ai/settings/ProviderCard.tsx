import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiButton from '@mui/material/Button';
import MuiIconButton from '@mui/material/IconButton';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ProviderInfo {
  id: string;
  name: string;
  icon?: React.ReactNode;
  type: 'ollama' | 'openai' | 'anthropic' | 'custom';
  endpoint?: string;
  status: 'connected' | 'disconnected' | 'error';
}

export interface ProviderCardProps {
  provider: ProviderInfo;
  onConfigure: (id: string) => void;
  onTestConnection: (id: string) => void;
  onRemove: (id: string) => void;
  sx?: SxProps<Theme>;
}

const statusConfig: Record<
  ProviderInfo['status'],
  { color: string; label: string }
> = {
  connected: { color: 'var(--ov-success-default)', label: 'Connected' },
  disconnected: { color: 'var(--ov-fg-faint)', label: 'Disconnected' },
  error: { color: 'var(--ov-danger-default)', label: 'Error' },
};

export default function ProviderCard({
  provider,
  onConfigure,
  onTestConnection,
  onRemove,
  sx,
}: ProviderCardProps) {
  const st = statusConfig[provider.status];

  return (
    <Box
      sx={{
        border: '1px solid var(--ov-border-default)',
        borderRadius: '8px',
        bgcolor: 'var(--ov-bg-surface)',
        p: 2,
        display: 'flex',
        flexDirection: 'column',
        gap: 1.5,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        {provider.icon && (
          <Box sx={{ fontSize: 24, color: 'var(--ov-fg-default)', display: 'flex' }}>
            {provider.icon}
          </Box>
        )}

        <Box sx={{ flex: 1 }}>
          <Typography
            sx={{
              fontSize: 'var(--ov-text-md)',
              fontWeight: 600,
              color: 'var(--ov-fg-default)',
            }}
          >
            {provider.name}
          </Typography>
          {provider.endpoint && (
            <Typography
              sx={{
                fontSize: 'var(--ov-text-xs)',
                color: 'var(--ov-fg-faint)',
                fontFamily: 'var(--ov-font-mono)',
              }}
            >
              {provider.endpoint}
            </Typography>
          )}
        </Box>

        {/* Status dot */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <Box
            sx={{
              width: 8,
              height: 8,
              borderRadius: '50%',
              bgcolor: st.color,
            }}
          />
          <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: st.color }}>
            {st.label}
          </Typography>
        </Box>
      </Box>

      {/* Actions */}
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <MuiButton
          variant="outlined"
          size="small"
          onClick={() => onConfigure(provider.id)}
          sx={{
            textTransform: 'none',
            borderColor: 'var(--ov-border-default)',
            color: 'var(--ov-fg-default)',
            fontSize: 'var(--ov-text-xs)',
          }}
        >
          Configure
        </MuiButton>
        <MuiButton
          variant="outlined"
          size="small"
          onClick={() => onTestConnection(provider.id)}
          sx={{
            textTransform: 'none',
            borderColor: 'var(--ov-border-default)',
            color: 'var(--ov-fg-default)',
            fontSize: 'var(--ov-text-xs)',
          }}
        >
          Test Connection
        </MuiButton>
        <Box sx={{ flex: 1 }} />
        <MuiIconButton
          size="small"
          onClick={() => onRemove(provider.id)}
          sx={{
            color: 'var(--ov-fg-faint)',
            '&:hover': { color: 'var(--ov-danger-default)' },
          }}
        >
          <DeleteOutlineIcon sx={{ fontSize: 16 }} />
        </MuiIconButton>
      </Box>
    </Box>
  );
}

ProviderCard.displayName = 'ProviderCard';
