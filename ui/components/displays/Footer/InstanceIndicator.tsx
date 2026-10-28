import { useState, type ReactNode } from 'react';
import { Button, Chip, DescriptionList, Dialog, Heading, Text } from '@omniviewdev/base-ui';
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

function DetailSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={styles.InstanceSection} aria-label={title}>
      <Heading level={3} size='xs' className={styles.InstanceSectionTitle}>{title}</Heading>
      {children}
    </section>
  );
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
            <div className={styles.InstanceSummary}>
              <Chip size='sm' variant='soft' color={host.tone}><Dot status={host.tone} />{host.label}</Chip>
              <Text size='xs' tone='muted'>Host status; plugin servers report readiness separately.</Text>
            </div>
            <DetailSection title='Host'>
              <DescriptionList layout='horizontal' size='sm' className={styles.InstanceDetails}>
                <DescriptionList.Item label='Host build'>{development?.health.build ?? (development ? Object.entries(development.builds).filter(([name]) => name.startsWith('host')).map(([name, build]) => `${name.replace('host-', '')}: ${build.phase}`).join(' · ') || 'Unknown' : 'Unavailable')}</DescriptionList.Item>
                <DescriptionList.Item label='HMR'>{development?.health.hmr ?? 'Unverified'}</DescriptionList.Item>
              </DescriptionList>
            </DetailSection>
            <DetailSection title='Source & plugins'>
              <DescriptionList layout='horizontal' size='sm' className={styles.InstanceDetails}>
                <DescriptionList.Item label='Source freshness'>{development?.health.servedSource ?? 'Unknown'}</DescriptionList.Item>
                <DescriptionList.Item label='Source reload proof'>{development?.health.sourceReload ?? 'Unverified'}</DescriptionList.Item>
                <DescriptionList.Item label='Selected plugins'>{development?.selectedPluginCount === null || !development ? 'Unknown' : `${development.selectedPluginCount} selected (not a readiness check)`}</DescriptionList.Item>
              </DescriptionList>
            </DetailSection>
            {host.label !== 'Ready' && (
              <DetailSection title='Recovery'>
                <DescriptionList layout='horizontal' size='sm' className={styles.InstanceDetails}>
                  <DescriptionList.Item label='Failure stage'>{development?.failedStage ?? 'None reported'}</DescriptionList.Item>
                  <DescriptionList.Item label='Command' copyable={Boolean(development?.recoveryCommand)}>{development?.recoveryCommand ?? 'Inspect workspace status before trusting served source'}</DescriptionList.Item>
                </DescriptionList>
              </DetailSection>
            )}
          </div>
          <div className={footerStyles.Actions}>
            <PopoverAction icon={<LuInfo size={12} />} label='Full instance details' onClick={() => { close(); setOpen(true); void refreshInfo(); }} />
            <PopoverAction icon={<LuRefreshCw size={12} />} label='Refresh host identity' onClick={() => { void refreshInfo(); }} />
          </div>
        </>}
      </FooterPopover>
      <Dialog open={open} onClose={() => {
        setOpen(false); 
      }} size='lg'>
        <Dialog.Title>{identity ? `Development instance · ${identity.displayName}` : 'Instance unavailable'}</Dialog.Title>
        <Dialog.Body>
          <div className={styles.InstanceSummary}>
            <Chip size='sm' variant='soft' color={status === 'confirmed' ? 'success' : 'neutral'}>{status === 'confirmed' ? 'Identity confirmed' : 'Identity pending'}</Chip>
            <Text size='sm' tone='muted' role='status'>{STATUS_LABEL[status]}</Text>
          </div>
          {identity && (
            <DetailSection title='Identity'>
              <DescriptionList layout='horizontal' size='sm' className={styles.InstanceDetails}>
                <DescriptionList.Item label='Instance' copyable>{identity.instanceID}</DescriptionList.Item>
                <DescriptionList.Item label='Kind'><Chip size='xs' variant='soft' color='neutral'>{identity.kind}</Chip></DescriptionList.Item>
                {info && <DescriptionList.Item label='Workspace' copyable>{info.workspaceID || 'Not set'}</DescriptionList.Item>}
              </DescriptionList>
            </DetailSection>
          )}
          {info && <>
            <DetailSection title='Runtime'>
              <DescriptionList layout='horizontal' size='sm' className={styles.InstanceDetails}>
                <DescriptionList.Item label='Readiness'><Chip size='xs' variant='soft' color={info.readiness === 'host-ready' && status === 'confirmed' ? 'success' : 'neutral'}>{info.readiness || 'Not reported'}</Chip></DescriptionList.Item>
                <DescriptionList.Item label='Channel'>{info.channel}</DescriptionList.Item>
                <DescriptionList.Item label='Generation' copyable>{info.generation || 'Not set'}</DescriptionList.Item>
                <DescriptionList.Item label='State root' copyable>{info.stateRoot}</DescriptionList.Item>
              </DescriptionList>
            </DetailSection>
            <DetailSection title='Build'>
              <DescriptionList layout='horizontal' size='sm' className={styles.InstanceDetails}>
                <DescriptionList.Item label='Version'>{info.version || 'Not reported'}</DescriptionList.Item>
                <DescriptionList.Item label='Commit' copyable>{info.commit || 'Not reported'}</DescriptionList.Item>
              </DescriptionList>
            </DetailSection>
            <DetailSection title='Repositories'>
              {(info.repositories ?? []).length === 0 ? <Text size='sm' tone='muted'>No repositories reported.</Text> : (
                <div className={styles.InstanceRepositories}>
                  {info.repositories?.map((repo) => (
                    <section key={repo.id} className={styles.InstanceRepository} aria-label={repo.id}>
                      <Heading level={4} size='xs'>{repo.id}</Heading>
                      <DescriptionList layout='horizontal' size='sm' className={styles.InstanceDetails}>
                        <DescriptionList.Item label='Path' copyable>{repo.path}</DescriptionList.Item>
                        <DescriptionList.Item label='Ref' copyable>{repo.ref}</DescriptionList.Item>
                        {repo.commit && repo.commit !== repo.ref && <DescriptionList.Item label='Commit' copyable>{repo.commit}</DescriptionList.Item>}
                      </DescriptionList>
                    </section>
                  ))}
                </div>
              )}
            </DetailSection>
            <DetailSection title='Actual endpoints'>
              <DescriptionList layout='horizontal' size='sm' className={styles.InstanceDetails}>
                {ENDPOINT_NAMES.map((name) => (
                  <DescriptionList.Item label={name} key={name} copyable={Boolean(info.endpoints[name])}>
                    {info.endpoints[name] ? safeEndpoint(info.endpoints[name]) : <Text size='sm' tone='muted'>Not running</Text>}
                  </DescriptionList.Item>
                ))}
              </DescriptionList>
            </DetailSection>
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
