import { useQuery } from '@tanstack/react-query';
import { UIInspection } from '@omniviewdev/runtime/api';
import { LuInfo } from 'react-icons/lu';
import HintTooltip from '@/components/base/HintTooltip';
import { Dot, FooterLabel, FooterTrigger, footerStyles as styles } from '@/components/displays/Footer/parts';
import { currentWindow } from '@/features/windows/identity';
import { useWindowVisible } from './useHostProfilingStatus';

export default function UIInspectionRow() {
  const visible = useWindowVisible();
  return visible ? <VisibleUIInspectionRow key={currentWindow.name} /> : null;
}

function VisibleUIInspectionRow() {
  const name = currentWindow.name;
  const inspection = useQuery({
    queryKey: ['ui-inspection', 'status', name],
    gcTime: 0,
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      const status = await UIInspection.GetStatus(name);
      signal.throwIfAborted();
      return status;
    },
    retry: false,
    refetchInterval: false,
  });
  const pending = inspection.isPending || !inspection.isFetchedAfterMount;
  const status = inspection.isError || pending ? undefined : inspection.data;
  const failed = !pending && (inspection.isError || Boolean(status?.error));
  const label = failed ? 'Error' : pending ? 'Loading' : !status?.supported ? 'Unavailable' : status.enabled ? 'On' : 'Off';
  const tone = failed ? 'danger' : pending ? 'info' : status?.supported && status.enabled ? 'success' : 'neutral';

  return <section aria-label='UI inspection' className={styles.Details}>
    <div className={styles.DetailRow}>
      <span className={styles.DetailLabel}>UI / {status?.engine || 'WebKit'}</span>
      <HintTooltip content='macOS 13.3+. Safari → Develop → This Mac → app → page, then record in Timelines. Inspection allows JavaScript access; captures may expose sensitive data.'>
        <FooterTrigger aria-label='UI inspection help'><LuInfo size={13} /></FooterTrigger>
      </HintTooltip>
      <Dot status={tone} />
      <FooterLabel tone={tone} label={label} />
    </div>
    {!pending && inspection.isError && <div className={styles.ErrorBox} role='alert'>Could not load UI inspection status.</div>}
    {status?.error && <div className={styles.ErrorBox} role='alert'>{status.error}</div>}
    {!failed && status?.supported && status.enabled && <>
      {status.application && <div className={styles.DetailRow}>
        <span className={styles.DetailLabel}>App</span>
        <span className={styles.DetailValue}>{status.application}</span>
      </div>}
      {status.target && <div className={styles.DetailRow}>
        <span className={styles.DetailLabel}>Page</span>
        <span className={styles.DetailValue}>{status.target}</span>
      </div>}
    </>}
  </section>;
}
