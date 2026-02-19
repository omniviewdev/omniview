import React from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import MuiDrawer from '@mui/material/Drawer';
import { LuX, LuCheck, LuBell } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor } from '../types';
import { toCssColor } from '../types';

export interface NotificationItem {
  id: string;
  title: string;
  message?: string;
  timestamp: Date;
  read?: boolean;
  color?: SemanticColor;
  icon?: React.ReactNode;
  action?: { label: string; onClick: () => void };
}

export interface NotificationCenterProps {
  open: boolean;
  onClose: () => void;
  notifications: NotificationItem[];
  onDismiss?: (id: string) => void;
  onMarkRead?: (id: string) => void;
  onClearAll?: () => void;
  width?: number;
  sx?: SxProps<Theme>;
}

function formatTime(date: Date): string {
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export default function NotificationCenter({
  open,
  onClose,
  notifications,
  onDismiss,
  onMarkRead,
  onClearAll,
  width = 360,
  sx,
}: NotificationCenterProps) {
  const unread = notifications.filter((n) => !n.read);
  const read = notifications.filter((n) => n.read);

  return (
    <MuiDrawer
      anchor="right"
      open={open}
      onClose={onClose}
      slotProps={{
        paper: {
          sx: {
            width,
            bgcolor: 'var(--ov-bg-surface)',
            borderLeft: '1px solid var(--ov-border-default)',
            ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
          } as SxProps<Theme>,
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
          borderBottom: '1px solid var(--ov-border-default)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <LuBell size={16} />
          <Typography sx={{ fontWeight: 600, fontSize: 'var(--ov-text-sm)', color: 'var(--ov-fg-base)' }}>
            Notifications
          </Typography>
          {unread.length > 0 && (
            <Box
              sx={{
                px: 0.75,
                py: 0.125,
                borderRadius: 999,
                bgcolor: 'var(--ov-accent-subtle)',
                color: 'var(--ov-accent-fg)',
                fontSize: 'var(--ov-text-xs)',
                fontWeight: 600,
              }}
            >
              {unread.length}
            </Box>
          )}
        </Box>
        <Box sx={{ display: 'flex', gap: 0.5 }}>
          {onClearAll && notifications.length > 0 && (
            <MuiIconButton size="small" onClick={onClearAll} sx={{ color: 'var(--ov-fg-muted)' }}>
              <LuCheck size={14} />
            </MuiIconButton>
          )}
          <MuiIconButton size="small" onClick={onClose} sx={{ color: 'var(--ov-fg-muted)' }}>
            <LuX size={14} />
          </MuiIconButton>
        </Box>
      </Box>

      {/* Notification list */}
      <Box sx={{ flex: 1, overflow: 'auto' }}>
        {notifications.length === 0 && (
          <Box sx={{ p: 4, textAlign: 'center' }}>
            <Typography sx={{ color: 'var(--ov-fg-faint)', fontSize: 'var(--ov-text-sm)' }}>
              No notifications
            </Typography>
          </Box>
        )}

        {unread.length > 0 && (
          <>
            <Typography sx={{ px: 2, pt: 1.5, pb: 0.5, fontSize: 'var(--ov-text-xs)', fontWeight: 600, color: 'var(--ov-fg-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Unread
            </Typography>
            {unread.map((item) => (
              <NotificationRow key={item.id} item={item} onDismiss={onDismiss} onMarkRead={onMarkRead} />
            ))}
          </>
        )}

        {read.length > 0 && (
          <>
            <Typography sx={{ px: 2, pt: 1.5, pb: 0.5, fontSize: 'var(--ov-text-xs)', fontWeight: 600, color: 'var(--ov-fg-faint)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Earlier
            </Typography>
            {read.map((item) => (
              <NotificationRow key={item.id} item={item} onDismiss={onDismiss} onMarkRead={onMarkRead} />
            ))}
          </>
        )}
      </Box>
    </MuiDrawer>
  );
}

function NotificationRow({
  item,
  onDismiss,
  onMarkRead,
}: {
  item: NotificationItem;
  onDismiss?: (id: string) => void;
  onMarkRead?: (id: string) => void;
}) {
  return (
    <Box
      sx={{
        px: 2,
        py: 1.5,
        display: 'flex',
        gap: 1.5,
        '&:hover': { bgcolor: 'var(--ov-state-hover)' },
        borderBottom: '1px solid var(--ov-border-muted)',
        ...(!item.read && { bgcolor: 'var(--ov-accent-subtle)', opacity: 1 }),
      }}
      onClick={() => onMarkRead?.(item.id)}
    >
      <Box sx={{ pt: 0.25, color: item.color ? toCssColor(item.color) : 'var(--ov-fg-muted)', flexShrink: 0 }}>
        {item.icon ?? <LuBell size={14} />}
      </Box>
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', mb: 0.25 }}>
          <Typography sx={{ fontSize: 'var(--ov-text-sm)', fontWeight: 500, color: 'var(--ov-fg-base)' }}>
            {item.title}
          </Typography>
          <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-faint)', whiteSpace: 'nowrap', ml: 1 }}>
            {formatTime(item.timestamp)}
          </Typography>
        </Box>
        {item.message && (
          <Typography sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-fg-muted)', lineHeight: 1.4 }}>
            {item.message}
          </Typography>
        )}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 0.5 }}>
          {item.action && (
            <Typography
              onClick={(e) => { e.stopPropagation(); item.action!.onClick(); }}
              sx={{ fontSize: 'var(--ov-text-xs)', color: 'var(--ov-accent-fg)', cursor: 'pointer', '&:hover': { textDecoration: 'underline' } }}
            >
              {item.action.label}
            </Typography>
          )}
          {onDismiss && (
            <MuiIconButton
              size="small"
              onClick={(e) => { e.stopPropagation(); onDismiss(item.id); }}
              sx={{ p: '2px', color: 'var(--ov-fg-faint)', '&:hover': { color: 'var(--ov-fg-default)' } }}
            >
              <LuX size={12} />
            </MuiIconButton>
          )}
        </Box>
      </Box>
    </Box>
  );
}

NotificationCenter.displayName = 'NotificationCenter';
