import { LuActivity, LuInfo, LuSettings } from 'react-icons/lu';
import HintTooltip from '@/components/base/HintTooltip';
import { useActivePageNavigation } from '@/features/workspace';
import {
  Dot, FooterLabel, FooterPopover, FooterTrigger, PopoverAction, PopoverHeader,
  footerStyles as styles,
} from '@/components/displays/Footer/parts';
import { useHostProfilingStatus } from './useHostProfilingStatus';
import PluginProfilingRows from './PluginProfilingRows';

export default function HostProfilingIndicator() {
  const profiling = useHostProfilingStatus();
  const { navigate } = useActivePageNavigation();
  const status = profiling.data;
  const failed = profiling.isError || Boolean(status?.error);
  const tone = failed ? 'danger' : profiling.isPending ? 'info' : status?.running ? 'success' : 'neutral';
  const label = failed ? 'Error' : profiling.isPending ? 'Loading' : status?.running ? 'Running' : 'Off';

  return <FooterPopover
    tooltip={`Host profiling · ${label}`}
    trigger={<FooterTrigger aria-label={`Host profiling: ${label}`}>
      <LuActivity size={13} />
      <Dot status={tone} />
      <span>pprof</span>
    </FooterTrigger>}
  >
    {close => <>
      <PopoverHeader icon={<LuActivity size={14} />} title='Profiling'>
        <HintTooltip content='Unauthenticated, local-only access. Profiles may contain sensitive data; do not forward this port. CPU captures cannot run alongside Pyroscope.'>
          <FooterTrigger aria-label='Profiling safety'><LuInfo size={13} /></FooterTrigger>
        </HintTooltip>
        <FooterLabel tone={tone} label={`Host ${label}`} />
      </PopoverHeader>
      <div className={styles.Details}>
        {profiling.isError && <div className={styles.ErrorBox} role='alert'>Could not load host profiling status.</div>}
        {profiling.isPending && <div role='status'>Loading host profiling status…</div>}
        {!profiling.isError && status?.running && status.url && <div className={styles.DetailRow}>
          <span className={styles.DetailLabel}>Host</span>
          <code className={styles.DetailValue}>{status.url}</code>
        </div>}
        {status?.error && <div className={styles.ErrorBox} role='alert'>{status.error}</div>}
        {status?.source === 'environment' && <div className={styles.DetailRow}>
          <span className={styles.DetailLabel}>Source</span>
          <HintTooltip content='OMNIVIEW_PPROF_PORT overrides saved settings until removed from the launch environment.'>
            <span tabIndex={0}>Environment override</span>
          </HintTooltip>
        </div>}
      </div>
      <PluginProfilingRows />
      <div className={styles.Actions}>
        <PopoverAction icon={<LuSettings size={12} />} label='Developer Settings' onClick={() => {
          navigate('/settings?section=core&category=developer');
          close();
        }} />
      </div>
    </>}
  </FooterPopover>;
}
