import React, { createContext, useContext, type ReactNode } from 'react';
import { Button, Card, Code, EmptyState, IconButton, Text, Toolbar, useToast, type ToastSeverity } from '@omniviewdev/base-ui';
import { styles } from './NotificationCenter.styles';

type VariantType = 'default' | 'success' | 'error' | 'warning' | 'info';

type SnackbarContextType = {
  notificationCount: number;
  showSnackbar(message: string, status: VariantType, icon?: string, details?: string): void;
  showSnackbar(options: ShowSnackbarOptions): void;
  openNotifications(): void;
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
  const nextId = React.useRef(0);
  const panelRef = React.useRef<HTMLElement>(null);

  React.useEffect(() => {
    if (!historyOpen) {
      return;
    }

    const previousFocus = document.activeElement;
    panelRef.current?.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        setHistoryOpen(false);
      }
    };

    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) {
        previousFocus.focus();
      }
    };
  }, [historyOpen]);

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
    <SnackbarContext.Provider value={{ showSnackbar, openNotifications: () => {
      setHistoryOpen(true); 
    }, notificationCount: notices.length }}>
      {children}
      {historyOpen && (
        <Card ref={panelRef} style={styles.Panel} size="sm" variant="outline" surface="overlay" elevation={3}
          aria-label="Notifications" tabIndex={-1}>
          <Toolbar size="sm" style={styles.Header}>
            <Text size="sm" weight="semibold">Notifications</Text>
            <Text size="xs" tone="muted">{notices.length}</Text>
            <Toolbar.Group style={styles.HeaderActions}>
              <IconButton size="sm" variant="ghost" aria-label="Clear history" title="Clear history"
                disabled={notices.length === 0}
                onClick={() => {
                  setNotices([]); setSelectedId(undefined); setCopyError(''); 
                }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="m3 3 6 6m0-6L3 9M13 6h8M3 14h18M3 20h18" />
                </svg>
              </IconButton>
              <IconButton size="sm" variant="ghost" aria-label="Close notifications" title="Close notifications"
                onClick={() => {
                  setHistoryOpen(false); 
                }}>
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                  <path d="m6 9 6 6 6-6" />
                </svg>
              </IconButton>
            </Toolbar.Group>
          </Toolbar>
          <div style={styles.List}>
            {notices.length === 0 && <EmptyState size="sm" title="No recent errors" description="Error details will appear here." />}
            {notices.slice().reverse().map(notice => {
              const expanded = selectedId === notice.id;
              return (
                <div key={notice.id} style={styles.Notice}>
                  <div style={styles.Row}>
                    <svg style={styles.ErrorIcon} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-label="Error" role="img">
                      <circle cx="12" cy="12" r="9" /><path d="m9 9 6 6m0-6-6 6" />
                    </svg>
                    <Button size="sm" variant="ghost" style={styles.Message}
                      aria-expanded={expanded} aria-controls={`notification-${notice.id}`}
                      title={notice.message} onClick={() => {
                        setSelectedId(expanded ? undefined : notice.id); setCopyError(''); 
                      }}>
                      <Text size="sm" style={styles.MessageText} truncate={!expanded}>{notice.message}</Text>
                    </Button>
                    <IconButton size="sm" variant="ghost" aria-label={expanded ? 'Collapse details' : 'Expand details'}
                      title={expanded ? 'Collapse details' : 'Expand details'} aria-expanded={expanded}
                      aria-controls={`notification-${notice.id}`}
                      onClick={() => {
                        setSelectedId(expanded ? undefined : notice.id); setCopyError(''); 
                      }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                        <path d={expanded ? 'm6 15 6-6 6 6' : 'm6 9 6 6 6-6'} />
                      </svg>
                    </IconButton>
                    <IconButton size="sm" variant="ghost" aria-label={`Dismiss ${notice.message}`} title="Dismiss notification"
                      onClick={() => {
                        setNotices(previous => previous.filter(item => item.id !== notice.id));
                        if (expanded) {
                          setSelectedId(undefined); setCopyError(''); 
                        }
                      }}>
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
                        <path d="m6 6 12 12m0-12L6 18" />
                      </svg>
                    </IconButton>
                  </div>
                  <div id={`notification-${notice.id}`} hidden={!expanded} style={styles.Details}>
                    {expanded && <>
                      <Text size="xs" tone="muted"><time dateTime={notice.created}>{new Date(notice.created).toLocaleString()}</time></Text>
                      <Code size="sm" style={styles.Code}>{notice.details?.length ? notice.details : notice.message}</Code>
                      <div style={styles.Actions}>
                        <Button size="sm" variant="ghost" onClick={async () => {
                          setCopyError('');
                          try {
                            await navigator.clipboard.writeText(`${notice.message}\n${notice.created}\n${notice.details ?? ''}`);
                          } catch {
                            setCopyError('Copy failed. Select the diagnostic text and copy it manually.');
                          }
                        }}>Copy details</Button>
                        {notice.actions?.map((action, index) => (
                          <Button key={`${action.label}-${index}`} size="sm" variant="outline" onClick={action.onClick}>{action.label}</Button>
                        ))}
                      </div>
                    </>}
                  </div>
                </div>
              );
            })}
          </div>
          {copyError && <Text as="p" size="sm" role="status" style={styles.CopyError}>{copyError}</Text>}
        </Card>
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
