import React from 'react';
import { Call } from '@wailsio/runtime';
import { Button } from '@omniviewdev/base-ui';

const service = 'github.com/omniviewdev/omniview.UpdateService';
type Status = { state: string; version: string; availableVersion: string; error: string };

export default function UpdatesSettingsPage() {
  const [status, setStatus] = React.useState<Status>();
  const [error, setError] = React.useState('');
  const refresh = React.useCallback(async () => {
    try { setStatus(await Call.ByName(`${service}.Status`) as Status); }
    catch (err) { setError(String(err)); }
  }, []);
  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { void refresh(); }, 2000);
    return () => window.clearInterval(timer);
  }, [refresh]);
  const run = async (method: string) => {
    setError('');
    try { await Call.ByName(`${service}.${method}`); }
    catch (err) { setError(String(err)); }
    await refresh();
  };
  const state = status?.state ?? 'loading';
  return <section>
    <h1>Updates</h1>
    {status?.version && <p>Current version: {status.version}</p>}
    <p role='status'>Status: {state === 'unconfigured' ? 'not configured' : state}</p>
    {status?.availableVersion && <p>Available version: {status.availableVersion}</p>}
    {(error || status?.error) && <p role='alert'>{error || status?.error}</p>}
    {state === 'ready'
      ? <Button onClick={() => { void run('Restart'); }}>Restart to Update</Button>
      : <Button disabled={['loading', 'unconfigured', 'checking', 'downloading', 'verifying', 'installing'].includes(state)} onClick={() => { void run('Check'); }}>Check for Updates</Button>}
  </section>;
}
