import { useContext, useCallback, useMemo } from 'react';
import { ToastContext } from './ToastProvider';
import type { SemanticColor } from '../types';

let toastId = 0;

interface ToastOptions {
  message: string;
  color?: SemanticColor;
  duration?: number;
  action?: React.ReactNode;
}

interface ToastFn {
  (options: ToastOptions): void;
  success: (message: string) => void;
  error: (message: string) => void;
  warning: (message: string) => void;
  info: (message: string) => void;
}

export interface UseToastReturn {
  toast: ToastFn;
  dismiss: (id: string) => void;
  dismissAll: () => void;
}

export function useToast(): UseToastReturn {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within a ToastProvider');

  const { dispatch } = ctx;

  const addToast = useCallback(
    (options: ToastOptions) => {
      dispatch({
        type: 'ADD',
        toast: {
          id: `toast-${toastId++}`,
          message: options.message,
          color: options.color,
          duration: options.duration,
          action: options.action,
          timestamp: Date.now(),
        },
      });
    },
    [dispatch],
  );

  const toast = useMemo(() => {
    const fn = ((options: ToastOptions) => addToast(options)) as ToastFn;
    fn.success = (message: string) => addToast({ message, color: 'success' });
    fn.error = (message: string) => addToast({ message, color: 'error' });
    fn.warning = (message: string) => addToast({ message, color: 'warning' });
    fn.info = (message: string) => addToast({ message, color: 'info' });
    return fn;
  }, [addToast]);

  const dismiss = useCallback(
    (id: string) => dispatch({ type: 'DISMISS', id }),
    [dispatch],
  );

  const dismissAll = useCallback(
    () => dispatch({ type: 'DISMISS_ALL' }),
    [dispatch],
  );

  return { toast, dismiss, dismissAll };
}
