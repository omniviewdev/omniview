import { Button, Spinner, Text } from '@omniviewdev/base-ui';
import React, { useId, type ReactNode } from 'react';
import { useResolvedPluginId } from '../hooks/useResolvedPluginId';
import { useConnectionReadiness, type ConnectionReadiness } from '../hooks/connection/useConnectionReadiness';

export interface ConnectionBoundaryProps {
  pluginID?: string;
  connectionID: string;
  children: ReactNode;
  fallback?: (state: ConnectionReadiness) => ReactNode;
}

export interface ConnectionBoundaryFallbackProps {
  state: ConnectionReadiness;
  connectionName?: string;
  /** Plugin-provided connection identity, shown above status instead of the generic connection name. */
  connectionDetails?: ReactNode;
  onEditConnection?: () => void;
  onBack?: () => void;
  backLabel?: string;
}

const rootStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'center',
  minHeight: 240, height: '100%', padding: 24, boxSizing: 'border-box',
  color: 'var(--ov-color-fg-default)',
};
const panelStyle: React.CSSProperties = { width: '100%', maxWidth: 560, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 16 };
const statusStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: 12 };
const headingStyle: React.CSSProperties = { margin: 0, fontSize: '1.125rem', fontWeight: 600 };
const actionsStyle: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8 };
const detailStyle: React.CSSProperties = { margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' };
const spinnerStyle: React.CSSProperties = { width: 20, height: 20, flexShrink: 0 };

const statusText: Record<Exclude<ConnectionReadiness['phase'], 'connected'>, { title: string; description: string }> = {
  checking: { title: 'Checking connection', description: 'Checking whether this connection is ready before loading resources.' },
  disconnected: { title: 'Connection is disconnected', description: 'Connect to load resources and continue at this location.' },
  connecting: { title: 'Connecting', description: 'Establishing the connection. Resources will load here when it is ready.' },
  unauthorized: { title: 'Authentication required', description: 'The connection could not authenticate. Check its credentials, then connect again.' },
  forbidden: { title: 'Connection access denied', description: 'The connection is not permitted to access this target. Check its credentials and permissions.' },
  'not-found': { title: 'Connection not found', description: 'This saved connection is no longer available. Return to connections or check its configuration.' },
  error: { title: 'Connection could not be verified', description: 'Check the connection settings and network, then connect again or retry the check.' },
};

/** Presentation only: no connection requests or automatic recovery. */
export function ConnectionBoundaryFallback({ state, connectionName, connectionDetails, onEditConnection, onBack, backLabel = 'Back to connections' }: ConnectionBoundaryFallbackProps) {
  const headingID = useId();
  if (state.phase === 'connected') return null;
  const busy = state.phase === 'checking' || state.phase === 'connecting';
  const text = statusText[state.phase];
  const name = connectionName ?? state.connection?.name;

  return (
    <section style={rootStyle} aria-labelledby={headingID} aria-busy={busy}>
      <div style={panelStyle}>
        {connectionDetails ?? (name && <Text size="sm" tone="muted" style={detailStyle}>{name}</Text>)}
        <div style={statusStyle} role="status" aria-live="polite">
          {busy && <Spinner style={spinnerStyle} aria-hidden="true" />}
          <h2 id={headingID} style={headingStyle}>{text.title}</h2>
        </div>
        <Text as="p" size="sm" tone="muted" style={detailStyle}>{text.description}</Text>
        {state.message && <Text as="p" size="sm" style={detailStyle} role={busy ? 'status' : 'alert'}>{state.message}</Text>}
        <div style={actionsStyle}>
          {state.phase !== 'not-found' && (
            <Button size="sm" variant="solid" color="brand" disabled={busy} onClick={() => { void state.connect(); }}>Connect and continue</Button>
          )}
          <Button size="sm" variant="outline" color="neutral" disabled={state.phase === 'checking'} onClick={() => { void state.retry(); }}>Retry check</Button>
          {onEditConnection && <Button size="sm" variant="outline" color="neutral" onClick={onEditConnection}>Edit connection</Button>}
          {onBack && <Button size="sm" variant="outline" color="neutral" onClick={onBack}>{backLabel}</Button>}
        </div>
      </div>
    </section>
  );
}

function ConnectionBoundarySession({ pluginID, connectionID, children, fallback }: ConnectionBoundaryProps) {
  const state = useConnectionReadiness({ pluginID, connectionID });
  if (state.phase !== 'connected') {
    return fallback ? fallback(state) : <ConnectionBoundaryFallback state={state} connectionName={state.connection?.name || connectionID} />;
  }
  return <>{children}</>;
}

/** Mount children only after the backend confirms this connection is connected. */
export function ConnectionBoundary(props: ConnectionBoundaryProps) {
  const pluginID = useResolvedPluginId(props.pluginID);
  return <ConnectionBoundarySession {...props} pluginID={pluginID} key={JSON.stringify([pluginID, props.connectionID])} />;
}
