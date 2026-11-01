import { Dot, footerStyles as styles } from '@/components/displays/Footer/parts';
import { usePluginProfilingStatuses } from './useHostProfilingStatus';

export default function PluginProfilingRows() {
  const profiling = usePluginProfilingStatuses();
  return <section aria-label='Plugin profiling' className={styles.Details}>
    <div className={styles.DetailLabel}>Plugins</div>
    {profiling.isPending && <div role='status'>Loading…</div>}
    {profiling.isError && <div className={styles.ErrorBox} role='alert'>Plugin status unavailable</div>}
    {!profiling.isError && profiling.data?.length === 0 && <div className={styles.Detail}>No plugins running</div>}
    {!profiling.isError && profiling.data?.map(plugin => {
      const failed = Boolean(plugin.error);
      const tone = !plugin.supported ? 'neutral' : failed ? 'danger' : plugin.running ? 'success' : 'neutral';
      return <div key={plugin.pluginID}>
        <div className={styles.DetailRow}>
          <span><Dot status={tone} /> {plugin.pluginID}</span>
          <span className={styles.Meta}>{plugin.pid > 0 ? `PID ${plugin.pid}` : ''}</span>
        </div>
        {plugin.supported && !failed && plugin.running && plugin.url
          ? <code className={styles.DetailValue}>{plugin.url}</code>
          : <span className={styles.Detail}>{!plugin.supported ? 'SDK update required' : failed ? plugin.error : 'Off'}</span>}
      </div>;
    })}
  </section>;
}
