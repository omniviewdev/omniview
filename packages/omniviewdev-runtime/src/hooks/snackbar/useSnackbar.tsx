import React, { createContext, useContext, type ReactNode } from 'react';
import { useToast, type ToastSeverity } from '@omniviewdev/base-ui';

type VariantType = 'default' | 'success' | 'error' | 'warning' | 'info';

type SnackbarContextType = {
  showSnackbar(message: string, status: VariantType, icon?: string, details?: string): void;
  showSnackbar(options: ShowSnackbarOptions): void;
};

const SnackbarContext = createContext<SnackbarContextType | undefined>(undefined);

type SnackbarProviderProps = {
  children: ReactNode;
};

type ShowSnackbarOptions = {
  message: string;
  status: VariantType;
  icon?: string;
  details?: string;
  showOnce?: boolean;
  autoHideDuration?: number;
  actions?: Array<{ label: string; onClick: () => void }>;
};

const variantToSeverity: Record<VariantType, ToastSeverity> = {
  default: 'info',
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'danger',
};

export const SnackbarProvider: React.FC<SnackbarProviderProps> = ({ children }) => {
  const { toast } = useToast();

  const [singleShowNotices, setSingleShowNotices] = React.useState<string[]>([]);

  const setNoticeShown = (message: string) => {
    setSingleShowNotices(prev => [...prev, message]);
  };

  const showSnackbar: SnackbarContextType['showSnackbar'] = (messageOrOptions: string | ShowSnackbarOptions, status?: VariantType, details?: string) => {
    const isOptions = typeof messageOrOptions === 'object';

    let _message = '';
    let _status: VariantType = 'info';
    let _details: string | undefined;
    let _autoHideDuration: number | undefined = 5000;
    let _actions: Array<{ label: string; onClick: () => void }> | undefined;

    if (isOptions) {
      _message = messageOrOptions.message;
      if (messageOrOptions.showOnce) {
        if (singleShowNotices.includes(_message)) {
          return;
        }
        setNoticeShown(_message);
      }

      _status = messageOrOptions.status;
      _details = messageOrOptions.details;
      _autoHideDuration = messageOrOptions.autoHideDuration ?? 5000;
      _actions = messageOrOptions.actions;
    } else {
      _message = messageOrOptions;
      _status = status!;
      _details = details;
    }

    // base-ui toasts take a single action; app errors carry one in practice.
    toast(_details ?? _message, {
      severity: variantToSeverity[_status] ?? 'info',
      title: _details ? _message : undefined,
      duration: _autoHideDuration,
      action: _actions?.[0],
    });
  };

  return (
    <SnackbarContext.Provider value={{ showSnackbar }}>
      {children}
    </SnackbarContext.Provider>
  );
};

export const useSnackbar = (): SnackbarContextType => {
  const context = useContext(SnackbarContext);
  if (context === undefined) {
    throw new Error('useCustomSnackbar must be used within a CustomSnackbarProvider');
  }

  return context;
};

export default useSnackbar;
