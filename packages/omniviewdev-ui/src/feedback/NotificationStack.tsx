import React, { useState, useCallback, useRef, useEffect, createContext, useContext } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import MuiIconButton from '@mui/material/IconButton';
import MuiButton from '@mui/material/Button';
import { LuX, LuInfo, LuCircleCheck, LuCircleAlert, LuTriangleAlert } from 'react-icons/lu';
import type { SxProps, Theme } from '@mui/material/styles';


// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type NotificationSeverity = 'info' | 'success' | 'warning' | 'error';

export interface NotificationAction {
  label: string;
  onClick: () => void;
}

export interface StackNotification {
  id: string;
  severity: NotificationSeverity;
  title: string;
  message?: string;
  actions?: NotificationAction[];
  timeout?: number; // ms, 0 = no auto-dismiss
}

export interface NotificationStackContextValue {
  push: (notification: Omit<StackNotification, 'id'>) => string;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const NotificationStackContext = createContext<NotificationStackContextValue | null>(null);

export function useNotificationStack(): NotificationStackContextValue {
  const ctx = useContext(NotificationStackContext);
  if (!ctx) throw new Error('useNotificationStack must be used within a NotificationStackProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Severity config
// ---------------------------------------------------------------------------

const severityIcon: Record<NotificationSeverity, React.ReactNode> = {
  info: <LuInfo size={16} />,
  success: <LuCircleCheck size={16} />,
  warning: <LuTriangleAlert size={16} />,
  error: <LuCircleAlert size={16} />,
};

const severityColor: Record<NotificationSeverity, string> = {
  info: 'var(--ov-info-default)',
  success: 'var(--ov-success-default)',
  warning: 'var(--ov-warning-default)',
  error: 'var(--ov-danger-default)',
};


// ---------------------------------------------------------------------------
// Individual Toast Card
// ---------------------------------------------------------------------------

function NotificationCard({
  notification,
  onDismiss,
}: {
  notification: StackNotification;
  onDismiss: (id: string) => void;
}) {
  const { id, severity, title, message, actions, timeout } = notification;
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const ms = timeout ?? 8000;
    if (ms > 0) {
      timerRef.current = setTimeout(() => onDismiss(id), ms);
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  }, [id, timeout, onDismiss]);

  const borderColor = severityColor[severity];

  return (
    <Box
      sx={{
        display: 'flex',
        gap: 1,
        minWidth: 320,
        maxWidth: 420,
        bgcolor: 'var(--ov-bg-surface)',
        border: '1px solid var(--ov-border-default)',
        borderLeft: `3px solid ${borderColor}`,
        borderRadius: '6px',
        boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
        p: 1.5,
        animation: 'ov-notif-slide-in 0.2s ease-out',
        '@keyframes ov-notif-slide-in': {
          from: { opacity: 0, transform: 'translateX(40px)' },
          to: { opacity: 1, transform: 'translateX(0)' },
        },
      }}
    >
      {/* Severity icon */}
      <Box sx={{ color: borderColor, pt: '2px', flexShrink: 0 }}>
        {severityIcon[severity]}
      </Box>

      {/* Content */}
      <Box sx={{ flex: 1, minWidth: 0 }}>
        <Typography
          sx={{
            fontSize: '0.8125rem',
            fontWeight: 600,
            color: 'var(--ov-fg-base)',
            lineHeight: 1.4,
          }}
        >
          {title}
        </Typography>
        {message && (
          <Typography
            sx={{
              fontSize: '0.75rem',
              color: 'var(--ov-fg-muted)',
              lineHeight: 1.4,
              mt: 0.25,
            }}
          >
            {message}
          </Typography>
        )}
        {actions && actions.length > 0 && (
          <Box sx={{ display: 'flex', gap: 0.5, mt: 1 }}>
            {actions.map((action) => (
              <MuiButton
                key={action.label}
                size="small"
                variant="text"
                onClick={() => { action.onClick(); onDismiss(id); }}
                sx={{
                  textTransform: 'none',
                  fontSize: '0.6875rem',
                  fontWeight: 600,
                  color: 'var(--ov-accent-fg)',
                  minWidth: 'auto',
                  px: 1,
                  py: 0.25,
                }}
              >
                {action.label}
              </MuiButton>
            ))}
          </Box>
        )}
      </Box>

      {/* Dismiss */}
      <MuiIconButton
        size="small"
        onClick={() => onDismiss(id)}
        sx={{
          alignSelf: 'flex-start',
          p: '2px',
          color: 'var(--ov-fg-faint)',
          '&:hover': { color: 'var(--ov-fg-default)' },
        }}
      >
        <LuX size={14} />
      </MuiIconButton>
    </Box>
  );
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface NotificationStackProviderProps {
  children: React.ReactNode;
  maxVisible?: number;
  position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
  sx?: SxProps<Theme>;
}

let idCounter = 0;

export default function NotificationStackProvider({
  children,
  maxVisible = 5,
  position = 'bottom-right',
  sx,
}: NotificationStackProviderProps) {
  const [notifications, setNotifications] = useState<StackNotification[]>([]);

  const push = useCallback((notification: Omit<StackNotification, 'id'>): string => {
    const id = `notif-${++idCounter}`;
    setNotifications((prev) => [...prev, { ...notification, id }]);
    return id;
  }, []);

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((n) => n.id !== id));
  }, []);

  const dismissAll = useCallback(() => {
    setNotifications([]);
  }, []);

  const positionStyles: Record<string, React.CSSProperties> = {
    'bottom-right': { bottom: 32, right: 12 },
    'bottom-left': { bottom: 32, left: 12 },
    'top-right': { top: 12, right: 12 },
    'top-left': { top: 12, left: 12 },
  };

  const visible = notifications.slice(-maxVisible);

  return (
    <NotificationStackContext.Provider value={{ push, dismiss, dismissAll }}>
      {children}

      {/* Notification stack */}
      {visible.length > 0 && (
        <Box
          sx={{
            position: 'fixed',
            zIndex: 9998,
            display: 'flex',
            flexDirection: position.startsWith('bottom') ? 'column-reverse' : 'column',
            gap: 0.75,
            ...positionStyles[position],
            ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
          } as SxProps<Theme>}
        >
          {visible.map((notification) => (
            <NotificationCard
              key={notification.id}
              notification={notification}
              onDismiss={dismiss}
            />
          ))}
        </Box>
      )}
    </NotificationStackContext.Provider>
  );
}

NotificationStackProvider.displayName = 'NotificationStackProvider';
