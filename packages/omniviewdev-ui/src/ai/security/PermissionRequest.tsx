import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiButton from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Checkbox from '@mui/material/Checkbox';
import FormControlLabel from '@mui/material/FormControlLabel';
import ShieldIcon from '@mui/icons-material/Shield';
import type { SxProps, Theme } from '@mui/material/styles';

export interface PermissionRequestProps {
  open: boolean;
  onAllow: (scope: 'once' | 'session' | 'always') => void;
  onDeny: () => void;
  request: {
    action: string;
    resource?: string;
    connection?: string;
    namespace?: string;
    requestedBy: string;
    riskLevel: 'info' | 'warning' | 'danger';
    description?: string;
  };
  sx?: SxProps<Theme>;
}

const riskColors: Record<PermissionRequestProps['request']['riskLevel'], string> = {
  info: 'var(--ov-info-default)',
  warning: 'var(--ov-warning-default)',
  danger: 'var(--ov-danger-default)',
};

const riskLabels: Record<PermissionRequestProps['request']['riskLevel'], string> = {
  info: 'Low Risk',
  warning: 'Medium Risk',
  danger: 'High Risk',
};

export default function PermissionRequest({
  open,
  onAllow,
  onDeny,
  request,
  sx,
}: PermissionRequestProps) {
  const [remember, setRemember] = useState(false);
  const color = riskColors[request.riskLevel];

  return (
    <Dialog
      open={open}
      onClose={onDeny}
      maxWidth="xs"
      fullWidth
      slotProps={{
        paper: {
          sx: {
            bgcolor: 'var(--ov-bg-surface)',
            border: '1px solid var(--ov-border-default)',
            borderRadius: '8px',
            ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
          } as SxProps<Theme>,
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pb: 1,
        }}
      >
        <ShieldIcon sx={{ fontSize: 20, color }} />
        <Typography
          sx={{
            flex: 1,
            fontSize: 'var(--ov-text-md)',
            fontWeight: 600,
            color: 'var(--ov-fg-default)',
          }}
        >
          Permission Required
        </Typography>
        <Box
          sx={{
            px: 1,
            py: 0.25,
            borderRadius: '4px',
            bgcolor: `color-mix(in srgb, ${color} 15%, transparent)`,
            color,
            fontSize: 'var(--ov-text-xs)',
            fontWeight: 600,
          }}
        >
          {riskLabels[request.riskLevel]}
        </Box>
      </DialogTitle>

      <DialogContent>
        <Box
          sx={{
            border: '1px solid var(--ov-border-default)',
            borderRadius: '6px',
            p: 1.5,
            mb: 1.5,
          }}
        >
          <Typography
            sx={{
              fontSize: 'var(--ov-text-sm)',
              fontWeight: 600,
              color: 'var(--ov-fg-default)',
              mb: 0.5,
            }}
          >
            {request.action}
          </Typography>

          {request.description && (
            <Typography
              sx={{
                fontSize: 'var(--ov-text-sm)',
                color: 'var(--ov-fg-muted)',
                mb: 1,
              }}
            >
              {request.description}
            </Typography>
          )}

          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
            {request.resource && (
              <DetailRow label="Resource" value={request.resource} />
            )}
            {request.connection && (
              <DetailRow label="Connection" value={request.connection} />
            )}
            {request.namespace && (
              <DetailRow label="Namespace" value={request.namespace} />
            )}
            <DetailRow label="Requested by" value={request.requestedBy} />
          </Box>
        </Box>

        <FormControlLabel
          control={
            <Checkbox
              size="small"
              checked={remember}
              onChange={(_, checked) => setRemember(checked)}
              sx={{ color: 'var(--ov-fg-muted)' }}
            />
          }
          label={
            <Typography sx={{ fontSize: 'var(--ov-text-sm)', color: 'var(--ov-fg-muted)' }}>
              Remember this choice
            </Typography>
          }
        />
      </DialogContent>

      <DialogActions sx={{ px: 2, pb: 2, gap: 1 }}>
        <MuiButton
          variant="outlined"
          size="small"
          onClick={onDeny}
          sx={{
            textTransform: 'none',
            borderColor: 'var(--ov-border-default)',
            color: 'var(--ov-fg-default)',
          }}
        >
          Deny
        </MuiButton>
        <MuiButton
          variant="outlined"
          size="small"
          onClick={() => onAllow('once')}
          sx={{
            textTransform: 'none',
            borderColor: 'var(--ov-border-default)',
            color: 'var(--ov-fg-default)',
          }}
        >
          Allow Once
        </MuiButton>
        <MuiButton
          variant="contained"
          size="small"
          onClick={() => onAllow(remember ? 'always' : 'session')}
          sx={{
            textTransform: 'none',
            bgcolor: color,
            '&:hover': { bgcolor: color, filter: 'brightness(0.9)' },
          }}
        >
          {remember ? 'Allow Always' : 'Allow for Session'}
        </MuiButton>
      </DialogActions>
    </Dialog>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', gap: 1 }}>
      <Typography
        sx={{
          fontSize: 'var(--ov-text-xs)',
          color: 'var(--ov-fg-faint)',
          minWidth: 80,
        }}
      >
        {label}:
      </Typography>
      <Typography
        sx={{
          fontSize: 'var(--ov-text-xs)',
          color: 'var(--ov-fg-default)',
          fontFamily: 'var(--ov-font-mono)',
        }}
      >
        {value}
      </Typography>
    </Box>
  );
}

PermissionRequest.displayName = 'PermissionRequest';
