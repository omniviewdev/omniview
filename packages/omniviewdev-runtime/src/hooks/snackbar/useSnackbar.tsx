import React, { createContext, useContext, type ReactNode } from 'react';
import { useNotificationStack, type NotificationSeverity } from '@omniviewdev/ui/feedback';

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
};

const variantToSeverity: Record<VariantType, NotificationSeverity> = {
  default: 'info',
  info: 'info',
  success: 'success',
  warning: 'warning',
  error: 'error',
};

export const SnackbarProvider: React.FC<SnackbarProviderProps> = ({ children }) => {
  const { push } = useNotificationStack();

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
    } else {
      _message = messageOrOptions;
      _status = status!;
      _details = details;
    }

    push({
      severity: variantToSeverity[_status] ?? 'info',
      title: _message,
      message: _details,
      timeout: _autoHideDuration,
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
