import { useState } from 'react';
import { Button, DescriptionList, Dialog } from '@omniviewdev/base-ui';
import { useInstance } from '@/features/instance/InstanceContext';
import { LuInfo, LuRefreshCw } from 'react-icons/lu';
import { Dot, FooterPopover, FooterTrigger, PopoverAction, PopoverHeader, footerStyles } from '@/components/displays/Footer/parts';
import { hostStatus, useDevelopmentStatus } from '@/features/instance/developmentStatus';
import styles from './Footer.module.css';

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
  const development = useDevelopmentStatus(info, status === 'confirmed' && identity?.kind === 'development');
  const host = hostStatus(development, status === 'confirmed' && info?.readiness === 'host-ready');
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
      <FooterPopover
        tooltip='Development host status'
        trigger={<FooterTrigger className={styles.StatusChip} aria-label={`${label} · ${host.label}`}><Dot status={host.tone} pulse={host.tone === 'warning'} />{label} · {host.label}</FooterTrigger>}
      >
        {(close) => <>
          <PopoverHeader title={identity ? `Development instance · ${identity.displayName}` : 'Instance unavailable'} />
          <div className={footerStyles.Details}>
            <p role='status'>{host.label === 'Ready' ? 'Host readiness confirmed. Plugin readiness is reported separately.' : 'Host status is not ready. Inspect the observations below.'}</p>
            <DescriptionList layout='vertical' size='sm'>
            {[
              ['Host build', development?.health.build ?? (development ? Object.entries(development.builds).filter(([name]) => name.startsWith('host')).map(([name, build]) => `${name}: ${build.phase}`).join(', ') || 'Unknown' : 'Unavailable')],
              ['HMR', development?.health.hmr ?? 'Unverified'],
              ['Source freshness', development?.health.servedSource ?? 'Unknown'],
              ['Source reload proof', development?.health.sourceReload ?? 'Unverified'],
              ['Selected plugins', development?.selectedPluginCount === null || !development ? 'Unknown' : `${development.selectedPluginCount} selected (not a readiness check)`],
              ['Failure stage', development?.failedStage ?? 'None reported'],
              ['Recovery', development?.recoveryCommand ?? 'Inspect workspace status before trusting served source'],
            ].map(([name, value]) => <DescriptionList.Item label={name} key={name}>{value}</DescriptionList.Item>)}
            </DescriptionList>
          </div>
          <div className={footerStyles.Actions}>
            <PopoverAction icon={<LuInfo size={12} />} label='Full instance details' onClick={() => { close(); setOpen(true); void refreshInfo(); }} />
            <PopoverAction icon={<LuRefreshCw size={12} />} label='Refresh host identity' onClick={() => { void refreshInfo(); }} />
          </div>
        </>}
      </FooterPopover>
      <Dialog open={open} onClose={() => {
        setOpen(false); 
      }} size='md'>
        <Dialog.Title>{identity ? `Development instance · ${identity.displayName}` : 'Instance unavailable'}</Dialog.Title>
        <Dialog.Body>
          <p role='status'>{STATUS_LABEL[status]}</p>
          {identity && (
            <DescriptionList layout='vertical' size='sm' className={styles.InstanceDetails}>
              <DescriptionList.Item label='Instance' copyable>{identity.instanceID}</DescriptionList.Item>
              <DescriptionList.Item label='Kind'>{identity.kind}</DescriptionList.Item>
              {info && <>
                <DescriptionList.Item label='Workspace' copyable>{info.workspaceID || 'Not set'}</DescriptionList.Item>
                <DescriptionList.Item label='State root' copyable>{info.stateRoot}</DescriptionList.Item>
                <DescriptionList.Item label='Generation' copyable>{info.generation || 'Not set'}</DescriptionList.Item>
                <DescriptionList.Item label='Channel'>{info.channel}</DescriptionList.Item>
                <DescriptionList.Item label='Readiness'>{info.readiness || 'Not reported'}</DescriptionList.Item>
                <DescriptionList.Item label='Version'>{info.version || 'Not reported'}</DescriptionList.Item>
                <DescriptionList.Item label='Commit' copyable>{info.commit || 'Not reported'}</DescriptionList.Item>
              </>}
            </DescriptionList>
          )}
          {info && <>
            <h3>Repositories</h3>
            {(info.repositories ?? []).length === 0 ? <p>No repositories reported.</p> : (
              <DescriptionList layout='vertical' size='sm' className={styles.InstanceDetails}>
                {info.repositories?.map((repo) => (
                  <DescriptionList.Item label={repo.id} key={repo.id}>
                    {repo.path}<br />{repo.ref}{repo.commit ? ` · ${repo.commit}` : ''}
                  </DescriptionList.Item>
                ))}
              </DescriptionList>
            )}
            <h3>Actual endpoints</h3>
            <DescriptionList layout='vertical' size='sm' className={styles.InstanceDetails}>
              {ENDPOINT_NAMES.map((name) => (
                <DescriptionList.Item label={name} key={name} copyable={Boolean(info.endpoints[name])}>
                  {info.endpoints[name] ? safeEndpoint(info.endpoints[name]) : 'Not running'}
                </DescriptionList.Item>
              ))}
            </DescriptionList>
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
