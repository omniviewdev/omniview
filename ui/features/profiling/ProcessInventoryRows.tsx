import { useQuery } from '@tanstack/react-query';
import { ProcessInventory, type InventoryProcess as Process } from '@omniviewdev/runtime/api';
import { LuInfo } from 'react-icons/lu';
import HintTooltip from '@/components/base/HintTooltip';
import { currentWindow } from '@/features/windows/identity';
import { FooterTrigger, footerStyles as styles } from '@/components/displays/Footer/parts';
import { useWindowVisible } from './useHostProfilingStatus';

const processRoleLabels: Record<string, string> = { host: 'Host', plugin: 'Plugin', webcontent: 'WebContent', gpu: 'GPU' };

function validIdentity(process: Process) {
  const identity = process.identity;
  return process.error === '' && identity && Number.isSafeInteger(identity.pid) && identity.pid > 0
    && typeof identity.startIdentity === 'string' && identity.startIdentity.length > 0
    && typeof identity.executable === 'string' && identity.executable.length > 0;
}

function canShowIdentity(process: Process, host: Process | undefined) {
  if (!validIdentity(process)) {
    return false;
  }

  if (process.role !== 'host' && process.role !== 'plugin') {
    return false;
  }

  if (process.ownership === 'verified') {
    return true;
  }

  return process.role === 'plugin' && process.ownership === 'shared' && process.evidence === 'in-process'
    && host?.role === 'host' && host.ownership === 'verified' && validIdentity(host)
    && process.identity?.pid === host.identity?.pid
    && process.identity?.startIdentity === host.identity?.startIdentity
    && process.identity?.executable === host.identity?.executable;
}

export default function ProcessInventoryRows() {
  const visible = useWindowVisible();
  return visible ? <VisibleProcessInventoryRows key={currentWindow.name} /> : null;
}

function VisibleProcessInventoryRows() {
  const inventory = useQuery({
    queryKey: ['process-inventory', currentWindow.name],
    queryFn: async ({ signal }) => {
      signal.throwIfAborted();
      const snapshot = await ProcessInventory.GetSnapshot();
      signal.throwIfAborted();
      return snapshot;
    },
    gcTime: 0,
    refetchOnMount: 'always',
    retry: false,
    refetchInterval: 5000,
    refetchIntervalInBackground: false,
  });
  const pending = inventory.isPending || !inventory.isFetchedAfterMount;
  const processes = !pending && !inventory.isError ? inventory.data?.processes ?? [] : [];
  const host = processes.find(process => process.key === 'host' && process.role === 'host');
  return <section aria-label='Process inventory' className={styles.Details}>
    <div className={styles.DetailRow}>
      <span className={styles.DetailLabel}>Processes</span>
      <HintTooltip content='Point-in-time identities, not a liveness guarantee. WebContent/GPU ownership is unverified; no worker PIDs are inferred. Window IDs identify host windows, not renderer processes.'>
        <FooterTrigger aria-label='Process mapping limits'><LuInfo size={12} /></FooterTrigger>
      </HintTooltip>
    </div>
    {inventory.isError && <div className={styles.ErrorBox} role='alert'>Process inventory unavailable</div>}
    {pending && <div role='status'>Loading processes…</div>}
    {processes.map(process => {
      const showIdentity = canShowIdentity(process, host);
      const ownership = showIdentity ? process.ownership : 'unverified';
      const role = processRoleLabels[process.role] ?? 'Unknown';
      return <details key={process.key}>
        <summary className={styles.DetailRow}>
          <span>{role}{process.pluginID ? ` · ${process.pluginID}` : ''}</span>
          <span className={styles.Meta}>{showIdentity ? `PID ${process.identity!.pid} · ` : ''}{ownership}</span>
        </summary>
        <div className={styles.Detail}>
          {showIdentity && <>
            <div>Start identity: <code style={{ overflowWrap: 'anywhere' }}>{process.identity!.startIdentity}</code></div>
            <div>Executable: <code style={{ overflowWrap: 'anywhere' }}>{process.identity!.executable}</code></div>
          </>}
          <div>Window association: {process.windowAssociation === 'verified' && process.role === 'host' && showIdentity ? 'verified' : 'unverified'}</div>
          {process.role === 'host' && process.windows?.map(window => <div key={`${window.id}:${window.name}`}>
            {window.name.length === 0 ? 'Unnamed window' : window.name} · Wails ID {window.id}
            {showIdentity && window.ownership === 'verified' && !window.error && Number.isSafeInteger(window.nativeID) && window.nativeID > 0
              ? ` · Native ID ${window.nativeID}` : ' · Native ID unverified'}
          </div>)}
          {process.error && <HintTooltip content={process.error}>
            <FooterTrigger aria-label={`${role} process issue`}><LuInfo size={12} /></FooterTrigger>
          </HintTooltip>}
        </div>
      </details>;
    })}
  </section>;
}
