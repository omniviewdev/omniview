import { useState, type ReactNode } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import Collapse from '@mui/material/Collapse';
import { LuChevronDown, LuChevronRight, LuX } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';

export interface PanelProps {
  title?: string;
  icon?: ReactNode;
  toolbar?: ReactNode;
  children: ReactNode;
  collapsible?: boolean;
  onClose?: () => void;
  elevation?: 'flat' | 'raised' | 'overlay';
  sx?: SxProps<Theme>;
}

const elevationMap: Record<string, string> = {
  flat: 'none',
  raised: '0 1px 3px rgba(0,0,0,0.12)',
  overlay: '0 4px 12px rgba(0,0,0,0.2)',
};

export default function Panel({
  title,
  icon,
  toolbar,
  children,
  collapsible = false,
  onClose,
  elevation = 'flat',
  sx,
}: PanelProps) {
  const [collapsed, setCollapsed] = useState(false);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        border: '1px solid var(--ov-border-default)',
        borderRadius: '6px',
        bgcolor: 'var(--ov-bg-surface)',
        boxShadow: elevationMap[elevation],
        overflow: 'hidden',
        ...sx as Record<string, unknown>,
      }}
    >
      {(title || toolbar || onClose) && (
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 0.75,
            borderBottom: collapsed ? 'none' : '1px solid var(--ov-border-muted)',
            bgcolor: 'var(--ov-bg-subtle)',
            minHeight: 36,
          }}
        >
          {collapsible && (
            <MuiIconButton
              size="small"
              onClick={() => setCollapsed((prev) => !prev)}
              sx={{ p: 0.25 }}
            >
              {collapsed ? <LuChevronRight size={14} /> : <LuChevronDown size={14} />}
            </MuiIconButton>
          )}
          {icon && <Box sx={{ display: 'flex', color: 'var(--ov-fg-muted)' }}>{icon}</Box>}
          {title && (
            <Typography
              variant="body2"
              sx={{
                fontWeight: 600,
                fontSize: '0.8125rem',
                color: 'var(--ov-fg-base)',
                flex: 1,
              }}
            >
              {title}
            </Typography>
          )}
          {toolbar && <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>{toolbar}</Box>}
          {onClose && (
            <MuiIconButton size="small" onClick={onClose} sx={{ p: 0.25, ml: 'auto' }}>
              <LuX size={14} />
            </MuiIconButton>
          )}
        </Box>
      )}
      <Collapse in={!collapsed}>
        <Box sx={{ flex: 1, overflow: 'auto' }}>{children}</Box>
      </Collapse>
    </Box>
  );
}

Panel.displayName = 'Panel';
