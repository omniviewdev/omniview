import { createContext, useReducer, useEffect, useRef } from 'react';
import Snackbar from '@mui/material/Snackbar';
import MuiAlert from '@mui/material/Alert';
import Box from '@mui/material/Box';
import MuiIconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';

import type { SemanticColor } from '../types';
import { toMuiColor } from '../types';

// --- Types ---

export interface ToastItem {
  id: string;
  message: string;
  color?: SemanticColor;
  duration?: number;
  action?: React.ReactNode;
  timestamp: number;
}

type ToastAction =
  | { type: 'ADD'; toast: ToastItem }
  | { type: 'DISMISS'; id: string }
  | { type: 'DISMISS_ALL' };

export interface ToastContextValue {
  dispatch: React.Dispatch<ToastAction>;
}

export const ToastContext = createContext<ToastContextValue | null>(null);

// --- Reducer ---

function toastReducer(state: ToastItem[], action: ToastAction): ToastItem[] {
  switch (action.type) {
    case 'ADD':
      // Dedup by message
      if (state.some((t) => t.message === action.toast.message)) return state;
      return [...state, action.toast];
    case 'DISMISS':
      return state.filter((t) => t.id !== action.id);
    case 'DISMISS_ALL':
      return [];
    default:
      return state;
  }
}

// --- Provider ---

export interface ToastProviderProps {
  children: React.ReactNode;
  maxVisible?: number;
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left';
}

const positionMap: Record<string, { vertical: 'top' | 'bottom'; horizontal: 'left' | 'right' }> = {
  'top-right': { vertical: 'top', horizontal: 'right' },
  'top-left': { vertical: 'top', horizontal: 'left' },
  'bottom-right': { vertical: 'bottom', horizontal: 'right' },
  'bottom-left': { vertical: 'bottom', horizontal: 'left' },
};

export default function ToastProvider({
  children,
  maxVisible = 3,
  position = 'bottom-left',
}: ToastProviderProps) {
  const [toasts, dispatch] = useReducer(toastReducer, []);
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Auto-dismiss
  useEffect(() => {
    for (const toast of toasts) {
      if (timers.current.has(toast.id)) continue;
      const dur = toast.duration ?? 5000;
      const timer = setTimeout(() => {
        dispatch({ type: 'DISMISS', id: toast.id });
        timers.current.delete(toast.id);
      }, dur);
      timers.current.set(toast.id, timer);
    }

    // Clean up removed
    for (const [id, timer] of timers.current) {
      if (!toasts.some((t) => t.id === id)) {
        clearTimeout(timer);
        timers.current.delete(id);
      }
    }
  }, [toasts]);

  useEffect(() => {
    return () => {
      timers.current.forEach((t) => clearTimeout(t));
    };
  }, []);

  const anchorOrigin = positionMap[position];
  const visible = toasts.slice(-maxVisible);

  const severityMap: Record<string, 'success' | 'info' | 'warning' | 'error'> = {
    success: 'success',
    info: 'info',
    warning: 'warning',
    error: 'error',
    danger: 'error',
    primary: 'info',
    secondary: 'info',
    neutral: 'info',
    accent: 'info',
    muted: 'info',
  };

  return (
    <ToastContext.Provider value={{ dispatch }}>
      {children}
      <Snackbar
        open={visible.length > 0}
        anchorOrigin={anchorOrigin}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          {visible.map((toast) => {
            const muiColor = toast.color ? toMuiColor(toast.color) : 'info';
            const severity = severityMap[muiColor] ?? 'info';
            return (
              <MuiAlert
                key={toast.id}
                severity={severity}
                variant="filled"
                action={
                  <>
                    {toast.action}
                    <MuiIconButton
                      size="small"
                      color="inherit"
                      onClick={() => dispatch({ type: 'DISMISS', id: toast.id })}
                    >
                      <CloseIcon fontSize="small" />
                    </MuiIconButton>
                  </>
                }
                sx={{ minWidth: 280, boxShadow: 6 }}
              >
                {toast.message}
              </MuiAlert>
            );
          })}
        </Box>
      </Snackbar>
    </ToastContext.Provider>
  );
}

ToastProvider.displayName = 'ToastProvider';
