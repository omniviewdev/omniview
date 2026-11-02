import { useState } from 'react';
import { Button, Dialog, RadioGroup, Stack, Text } from '@omniviewdev/base-ui';
import { usePlugin } from '@/hooks/plugin/usePluginManager';
import { compareVersions, orderedVersions } from './versionPolicy';
import styles from './PluginDetails.module.css';

type Props = { pluginID: string; currentVersion?: string; installed?: boolean };
type Release = { version: string; compatible?: boolean; compatibility_reason?: string; discovery_supported?: boolean };

export default function PluginUpdateButton({ pluginID, currentVersion = '', installed = false }: Props) {
  const { versions, update, operation } = usePlugin({ id: pluginID, installed: false });
  const [chooser, setChooser] = useState(false);
  const [selection, setSelection] = useState<{ id: string; version: string }>();
  const [confirm, setConfirm] = useState(false);
  const list = orderedVersions((versions.data ?? []) as Release[]);
  const compatible = list.filter(v => v.compatible !== false);
  const recommended = compatible.find(v => !v.version.includes('-')) ?? compatible[0];
  const selected = list.find(v => selection?.id === pluginID && v.version === selection.version) ?? recommended ?? list[0];
  const downgrade = !!selected && !!currentVersion && compareVersions(selected.version, currentVersion) < 0;
  const busy = !!operation;
  const run = async (version: string) => {
    try {
      await update(version);
      setChooser(false);
      setConfirm(false);
    } catch {
      // The mutation reports the structured runtime error. Keep selection for retry.
      setConfirm(false);
    }
  };
  const label = installed ? 'Update' : 'Install';
  return <Stack direction='column' spacing={3} className={styles.InstallCard}>
    <Stack direction='row' spacing={3} align='center' wrap>
      <Stack direction='column' spacing={1} className={styles.InstallSummary}>
        <Text weight='semibold'>{installed ? 'Manage installation' : 'Install plugin'}</Text>
        <Text size='sm' tone='muted'>{currentVersion ? `Installed ${currentVersion} · ` : ''}{recommended ? `Recommended ${recommended.version}` : 'No compatible release'}</Text>
        {recommended?.compatibility_reason && <Text size='xs' tone='muted'>{recommended.compatibility_reason}</Text>}
      </Stack>
      <Button size='sm' color='brand' variant='solid'
        disabled={busy || !recommended || (!!currentVersion && compareVersions(recommended.version, currentVersion) <= 0)}
        onClick={() => { if (recommended) void run(recommended.version); }}>
        {operation ?? (versions.isLoading ? 'Loading versions…' : currentVersion && recommended && compareVersions(recommended.version, currentVersion) <= 0 ? 'Installed' : `${label}${recommended ? ` ${recommended.version}` : ''}`)}
      </Button>
      <Button size='sm' variant='outline' disabled={busy} onClick={() => setChooser(true)}>Other versions…</Button>
    </Stack>
    <Stack direction='row' spacing={2} align='center'>
      <Text size='xs' tone='muted'>{versions.isFetching ? 'Checking marketplace…' : versions.dataUpdatedAt ? `Checked ${new Date(versions.dataUpdatedAt).toLocaleTimeString()}` : 'Marketplace not checked'}</Text>
      <Button size='sm' variant='outline' disabled={versions.isFetching || busy} onClick={() => void versions.refetch()}>Refresh</Button>
    </Stack>
    {operation && <Text size='sm' role='status'>{operation}</Text>}
    {versions.isError && <Text size='sm' role='alert'>Could not load versions. <button type='button' onClick={() => void versions.refetch()}>Retry</button></Text>}
    {!versions.isLoading && !versions.isError && !list.length && <Text size='sm' tone='muted'>No compatible releases available.</Text>}
    {list[0]?.compatible === false && <Text size='sm' role='status'>Newer release {list[0].version}: {list[0].compatibility_reason || 'Not compatible with this IDE.'}</Text>}
    <Dialog open={chooser} onClose={() => { if (!busy) setChooser(false); }} size='md'>
      <Dialog.Title>Choose plugin version</Dialog.Title>
      <Dialog.Body>
        <Stack direction='column' spacing={3}>
          <RadioGroup className={styles.VersionList} aria-label='Plugin version'
            value={selected?.version ?? ''} onValueChange={version => setSelection({ id: pluginID, version })}>
            {list.map(release => <RadioGroup.Item key={release.version} className={styles.VersionRow}
              value={release.version} disabled={busy} aria-label={release.version}
              description={release.compatibility_reason || undefined}>
                <Text weight='semibold'>{release.version}</Text>
                <Text as='span' size='xs' tone='muted'>
                  {release.version === currentVersion ? ' · Installed' : release === recommended ? ' · Recommended' : ''}
                  {release.version.includes('-') ? ' · Prerelease' : ''}
                </Text>
            </RadioGroup.Item>)}
          </RadioGroup>
        </Stack>
      </Dialog.Body>
      <Dialog.Footer>
        <Button variant='outline' disabled={busy} onClick={() => setChooser(false)}>Cancel</Button>
        <Button color={downgrade ? 'danger' : 'brand'} disabled={busy || !selected || selected.compatible === false || selected.version === currentVersion} onClick={() => { if (downgrade) setConfirm(true); else if (selected) void run(selected.version); }}>{downgrade ? 'Downgrade…' : `${label} ${selected?.version ?? ''}`}</Button>
      </Dialog.Footer>
    </Dialog>
    <Dialog open={confirm} onClose={() => { if (!busy) setConfirm(false); }} size='sm'>
      <Dialog.Title>Confirm downgrade</Dialog.Title>
      <Dialog.Body><Text>Downgrade from {currentVersion} to {selected?.version}? Existing plugin data may not work with this release.</Text></Dialog.Body>
      <Dialog.Footer><Button variant='outline' disabled={busy} onClick={() => setConfirm(false)}>Cancel</Button><Button color='danger' disabled={busy} onClick={() => { if (selected) void run(selected.version); }}>{operation ?? 'Confirm downgrade'}</Button></Dialog.Footer>
    </Dialog>
  </Stack>;
}
