import { useState } from 'react';
import { Button, Dialog } from '@omniviewdev/base-ui';
import { useInstance } from '@/features/instance/InstanceContext';
import styles from './Header.module.css';

const ENDPOINT_NAMES = ['browser', 'vite', 'hmr', 'mcp', 'control', 'health'] as const;

const STATUS_LABEL = {
  unavailable: 'Instance identity is unavailable. Browser persistence is disabled for this preview.',
  boot: 'Boot identity loaded. Waiting for host details.',
  refreshing: 'Refreshing instance details from the host.',
  confirmed: 'Identity confirmed by the host.',
  error: 'Host details are unavailable. The validated boot identity remains active.',
  mismatch: 'Host identity does not match boot identity. Reload from the correct host; the storage profile has not changed.',
};

function safeEndpoint(endpoint: string): string {
  try {
    const url = new URL(endpoint);
    if (!['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol)) {
      return 'Unavailable';
    }

    // Endpoint query strings, fragments, and userinfo are never shown.
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return 'Unavailable';
  }
}

export default function InstanceIndicator() {
  const { identity, info, status, refreshInfo } = useInstance();
  const [open, setOpen] = useState(false);
  if (identity?.kind === 'production') {
    return null;
  }

  const label = identity ? `DEV · ${identity.displayName}` : 'Instance unavailable';

  return (
    <div className={styles.InstanceControl} onClick={(event) => {
      event.stopPropagation(); 
    }} onDoubleClick={(event) => {
      event.stopPropagation(); 
    }}>
      <button
        type='button'
        className={styles.InstanceChip}
        aria-label={`${label} — instance details`}
        aria-haspopup='dialog'
        aria-expanded={open}
        title={label}
        onClick={() => {
          setOpen(true);
          void refreshInfo();
        }}
      >
        {label}
      </button>
      <Dialog open={open} onClose={() => {
        setOpen(false); 
      }} size='md'>
        <Dialog.Title>{identity ? `Development instance · ${identity.displayName}` : 'Instance unavailable'}</Dialog.Title>
        <Dialog.Body>
          <p role='status'>{STATUS_LABEL[status]}</p>
          {identity && (
            <dl className={styles.InstanceDetails}>
              <dt>Instance</dt><dd>{identity.instanceID}</dd>
              <dt>Kind</dt><dd>{identity.kind}</dd>
              {info && <>
                <dt>Workspace</dt><dd>{info.workspaceID || 'Not set'}</dd>
                <dt>State root</dt><dd>{info.stateRoot}</dd>
                <dt>Generation</dt><dd>{info.generation || 'Not set'}</dd>
                <dt>Channel</dt><dd>{info.channel}</dd>
                <dt>Readiness</dt><dd>{info.readiness || 'Not reported'}</dd>
                <dt>Version</dt><dd>{info.version || 'Not reported'}</dd>
                <dt>Commit</dt><dd>{info.commit || 'Not reported'}</dd>
              </>}
            </dl>
          )}
          {info && <>
            <h3>Repositories</h3>
            {(info.repositories ?? []).length === 0 ? <p>No repositories reported.</p> : (
              <dl className={styles.InstanceDetails}>
                {info.repositories?.map((repo) => (
                  <div key={repo.id} className={styles.InstanceRepository}>
                    <dt>{repo.id}</dt>
                    <dd>{repo.path}<br />{repo.ref}{repo.commit ? ` · ${repo.commit}` : ''}</dd>
                  </div>
                ))}
              </dl>
            )}
            <h3>Actual endpoints</h3>
            <dl className={styles.InstanceDetails}>
              {ENDPOINT_NAMES.map((name) => (
                <div key={name} className={styles.InstanceRepository}>
                  <dt>{name}</dt><dd>{info.endpoints[name] ? safeEndpoint(info.endpoints[name]) : 'Not running'}</dd>
                </div>
              ))}
            </dl>
          </>}
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant='ghost' color='neutral' onClick={() => {
            setOpen(false); 
          }}>Close</Button>
        </Dialog.Footer>
      </Dialog>
    </div>
  );
}
