import React, { createContext, useContext, type ReactNode } from 'react';
import { Button, useToast, type ToastSeverity } from '@omniviewdev/base-ui';

type VariantType = 'default' | 'success' | 'error' | 'warning' | 'info';

type SnackbarContextType = {
  showSnackbar(message: string, status: VariantType, icon?: string, details?: string): void;
  showSnackbar(options: ShowSnackbarOptions): void;
  openNotifications(): void;
  notificationCount: number;
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

type Notice = { id: number; message: string; details?: string; created: string; actions?: ShowSnackbarOptions['actions'] };

export const SnackbarProvider: React.FC<SnackbarProviderProps> = ({ children }) => {
  const { toast } = useToast();

  const [singleShowNotices, setSingleShowNotices] = React.useState<string[]>([]);
  const [notices, setNotices] = React.useState<Notice[]>([]);
  const [historyOpen, setHistoryOpen] = React.useState(false);
  const [selectedId, setSelectedId] = React.useState<number>();
  const [copyError, setCopyError] = React.useState('');
  const nextId = React.useRef(Date.now());

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

    let detailAction: { label: string; onClick: () => void } | undefined;
    if (_status === 'error') {
      const notice: Notice = {
        id: ++nextId.current, message: _message, details: _details,
        created: new Date().toISOString(), actions: _actions,
      };
      setNotices(previous => [...previous, notice].slice(-20));
      detailAction = { label: 'Details', onClick: () => {
        setSelectedId(notice.id);
        setHistoryOpen(true);
      } };
    }
    toast(_status === 'error' ? _message : _details ?? _message, {
      severity: variantToSeverity[_status] ?? 'info',
      title: _status !== 'error' && _details ? _message : undefined,
      duration: _autoHideDuration,
      action: detailAction ?? _actions?.[0],
    });
  };

  return (
    <SnackbarContext.Provider value={{ showSnackbar, openNotifications: () => setHistoryOpen(true), notificationCount: notices.length }}>
      {children}
      {historyOpen && (
        <aside aria-label="Notifications" style={{
          position: 'fixed', right: 16, bottom: 64, zIndex: 1400,
          width: 'min(600px, calc(100vw - 32px))', maxHeight: '70vh', overflow: 'auto',
          padding: 16, background: 'var(--ov-color-bg-surface, #202020)',
          color: 'var(--ov-color-fg-default, #eee)', border: '1px solid currentColor', borderRadius: 8,
        }}>
          <h2>Notifications</h2>
          <Button size="sm" variant="ghost" onClick={() => setHistoryOpen(false)}>Close</Button>
          <Button size="sm" variant="ghost" onClick={() => { setNotices([]); setSelectedId(undefined); setCopyError(''); }}>Clear history</Button>
          {notices.length === 0 && <p>No recent errors.</p>}
          {notices.slice().reverse().map(notice => (
            <details key={notice.id} open={selectedId === notice.id} onToggle={event => {
              if (event.currentTarget.open) setSelectedId(notice.id);
            }}>
              <summary>{notice.message} — <time dateTime={notice.created}>{new Date(notice.created).toLocaleString()}</time></summary>
              <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', userSelect: 'text' }}>{notice.details || notice.message}</pre>
              <Button size="sm" variant="ghost" onClick={async () => {
                setCopyError('');
                try {
                  await navigator.clipboard.writeText(`${notice.message}\n${notice.created}\n${notice.details ?? ''}`);
                } catch {
                  setCopyError('Copy failed. Select the diagnostic text and copy it manually.');
                }
              }}>Copy details</Button>
              {notice.actions?.map((action, index) => (
                <Button key={`${action.label}-${index}`} size="sm" variant="ghost" onClick={action.onClick}>{action.label}</Button>
              ))}
            </details>
          ))}
          {copyError && <p role="status">{copyError}</p>}
        </aside>
      )}
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
