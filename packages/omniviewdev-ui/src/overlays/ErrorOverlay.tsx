import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import MuiButton from '@mui/material/Button';
import { LuX, LuTriangleAlert } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';

export interface ErrorOverlayAction {
  label: string;
  onClick: () => void;
}

export interface ErrorOverlayProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  message: string;
  file?: string;
  line?: number;
  stack?: string;
  actions?: ErrorOverlayAction[];
  sx?: SxProps<Theme>;
}

export default function ErrorOverlay({
  open,
  onClose,
  title = 'Error',
  message,
  file,
  line,
  stack,
  actions,
  sx,
}: ErrorOverlayProps) {
  if (!open) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        inset: 0,
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'rgba(0, 0, 0, 0.6)',
        backdropFilter: 'blur(4px)',
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <Box
        sx={{
          bgcolor: 'var(--ov-bg-surface)',
          border: '1px solid var(--ov-danger-default)',
          borderRadius: '8px',
          maxWidth: 560,
          width: '90%',
          maxHeight: '80vh',
          overflow: 'auto',
          boxShadow: '0 8px 32px rgba(0,0,0,0.3)',
        }}
      >
        {/* Header */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            px: 2.5,
            py: 1.5,
            borderBottom: '1px solid var(--ov-border-default)',
            bgcolor: 'var(--ov-danger-default)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, color: '#fff' }}>
            <LuTriangleAlert size={16} />
            <Typography sx={{ fontWeight: 600, fontSize: 'var(--ov-text-sm)' }}>
              {title}
            </Typography>
          </Box>
          <MuiIconButton size="small" onClick={onClose} sx={{ color: '#fff' }}>
            <LuX size={16} />
          </MuiIconButton>
        </Box>

        {/* Body */}
        <Box sx={{ px: 2.5, py: 2 }}>
          <Typography sx={{ fontSize: 'var(--ov-text-sm)', color: 'var(--ov-fg-base)', mb: 1.5, lineHeight: 1.5 }}>
            {message}
          </Typography>

          {file && (
            <Box
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 0.5,
                mb: 1.5,
                fontFamily: 'var(--ov-font-mono)',
                fontSize: 'var(--ov-text-xs)',
                color: 'var(--ov-fg-muted)',
              }}
            >
              <span>{file}</span>
              {line !== undefined && <span>:{line}</span>}
            </Box>
          )}

          {stack && (
            <Box
              component="pre"
              sx={{
                bgcolor: 'var(--ov-bg-surface-inset)',
                border: '1px solid var(--ov-border-muted)',
                borderRadius: '4px',
                p: 1.5,
                fontSize: 'var(--ov-text-xs)',
                fontFamily: 'var(--ov-font-mono)',
                color: 'var(--ov-fg-muted)',
                overflow: 'auto',
                maxHeight: 200,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
                m: 0,
              }}
            >
              {stack}
            </Box>
          )}
        </Box>

        {/* Actions */}
        {actions && actions.length > 0 && (
          <Box
            sx={{
              display: 'flex',
              justifyContent: 'flex-end',
              gap: 1,
              px: 2.5,
              py: 1.5,
              borderTop: '1px solid var(--ov-border-default)',
            }}
          >
            {actions.map((action) => (
              <MuiButton
                key={action.label}
                size="small"
                variant="outlined"
                onClick={action.onClick}
                sx={{ textTransform: 'none', fontSize: 'var(--ov-text-sm)' }}
              >
                {action.label}
              </MuiButton>
            ))}
            <MuiButton
              size="small"
              variant="contained"
              onClick={onClose}
              sx={{ textTransform: 'none', fontSize: 'var(--ov-text-sm)' }}
            >
              Dismiss
            </MuiButton>
          </Box>
        )}
      </Box>
    </Box>
  );
}

ErrorOverlay.displayName = 'ErrorOverlay';
