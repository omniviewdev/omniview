import { Text } from '@omniviewdev/base-ui';
import { useHostProfilingStatus } from './useHostProfilingStatus';

export default function HostProfilingCard() {
  const profiling = useHostProfilingStatus();
  return <section aria-label='Host profiling'>
    <Text weight='semibold'>Host profiling</Text>
    <p>Local access is unauthenticated. Captures can expose sensitive process data. Do not forward this endpoint publicly.</p>
    <p>CPU profiling can conflict with Pyroscope. Stop other CPU captures before using pprof.</p>
    {profiling.isError && <p role='alert'>Could not load host profiling status.</p>}
    {profiling.isPending && <p role='status'>Loading host profiling status…</p>}
    {profiling.data && <>
      <p>{profiling.data.running ? 'Listener running' : 'Listener not running'}</p>
      {profiling.data.running && profiling.data.url && <p>Active URL: <code>{profiling.data.url}</code></p>}
      {profiling.data.error && <p role='alert'>{profiling.data.error}</p>}
      {profiling.data.source === 'environment' && <p role='note'>OMNIVIEW_PPROF_PORT overrides saved preferences. Remove the override and restart Omniview to apply saved preferences.</p>}
      <p>Saving preferences does not start, stop, or rebind the current listener. Restart Omniview manually.</p>
    </>}
  </section>;
}
