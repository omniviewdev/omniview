import { useState } from 'react';
import { Button, Dialog, RadioGroup, Select, Stack, Text } from '@omniviewdev/base-ui';
import { useSettings } from '@omniviewdev/runtime';
import { LuChevronDown } from 'react-icons/lu';
import { usePlugin } from '@/hooks/plugin/usePluginManager';
import { compareVersions, orderedVersions } from './versionPolicy';
import styles from './PluginDetails.module.css';

type Props = { pluginID: string; currentVersion?: string; installed?: boolean };
type Release = { version: string; channel?: string; compatible?: boolean; compatibility_reason?: string; discovery_supported?: boolean };

export default function PluginUpdateButton({ pluginID, currentVersion = '', installed = false }: Props) {
  const [channelChoice, setChannelChoice] = useState<string>();
  const { releaseState, channelVersions: versions, installFromChannel, operation } = usePlugin({ id: pluginID, installed: false, channel: channelChoice });
  const { settings } = useSettings();
  const effectiveChannel = releaseState.data?.effectiveChannel === '' ? 'stable' : (releaseState.data?.effectiveChannel ?? 'stable');
  const channel = channelChoice ?? effectiveChannel;
  const channels = releaseState.data?.channels ?? [];
  const activeChannels = channels.filter(item => item.status === 'active');
  const showSelector = (settings['developer.show_feature_channels'] === true && activeChannels.length > 0) || effectiveChannel !== 'stable';
  const retired = releaseState.data?.explicit && effectiveChannel !== 'stable' && !activeChannels.some(item => item.channel === effectiveChannel);
  const [chooser, setChooser] = useState(false);
  const [selection, setSelection] = useState<{ id: string; channel: string; version: string }>();
  const [confirm, setConfirm] = useState(false);
  const releases = (versions.data ?? []) as Release[];
  const list = orderedVersions(releases);
  const compatible = list.filter(v => v.compatible !== false);
  const stable = compatible.find(v => (!v.channel || v.channel === 'stable') && !v.version.split('+')[0].includes('-'));
  const recommended = (channel === 'stable' ? undefined : compatible.find(v => v.channel === channel)) ?? stable;
  const selected = list.find(v => selection?.id === pluginID && selection.channel === channel && v.version === selection.version) ?? recommended ?? list[0];
  const downgrade = !!selected && !!currentVersion && compareVersions(selected.version, currentVersion) < 0;
  const busy = !!operation;
  const run = async (version: string) => {
    try {
      const release = list.find(item => item.version === version);
      await installFromChannel({ channel: release?.channel === '' ? 'stable' : (release?.channel ?? 'stable'), version });
      setChooser(false);
      setConfirm(false);
    } catch {
      // The mutation reports the structured runtime error. Keep selection for retry.
      setConfirm(false);
    }
  };

  const label = installed ? 'Update' : 'Install';
  return <Stack direction='column' spacing={2} className={styles.InstallCard}>
    {showSelector && <Select.Root size='sm' value={channel} items={[
      { value: 'stable', label: 'Stable' },
      ...activeChannels.map(item => ({ value: item.channel, label: item.channel })),
      ...(retired ? [{ value: effectiveChannel, label: effectiveChannel }] : []),
    ]} disabled={busy} onValueChange={value => {
      if (value !== null) {
        setChannelChoice(value);
        setSelection(undefined);
      }
    }}>
      <Select.Trigger aria-label='Release channel'><Select.Value /><Select.Icon><LuChevronDown aria-hidden /></Select.Icon></Select.Trigger>
      <Select.Portal><Select.Positioner sideOffset={4}><Select.Popup><Select.List>
        <Select.Item value='stable'><Select.ItemText>Stable</Select.ItemText></Select.Item>
        {activeChannels.map(item => <Select.Item key={item.channel} value={item.channel}><Select.ItemText>{item.channel}</Select.ItemText></Select.Item>)}
        {retired && <Select.Item value={effectiveChannel} disabled><Select.ItemText>{effectiveChannel}</Select.ItemText></Select.Item>}
      </Select.List></Select.Popup></Select.Positioner></Select.Portal>
    </Select.Root>}
    {retired && <Text size='sm' role='alert'>This plugin's release channel was retired.</Text>}
    <Stack direction='row' spacing={2} align='center' wrap className={styles.InstallActions}>
      <Button size='sm' color='brand' variant='solid'
        disabled={busy || !recommended || (!!currentVersion && recommended.version === currentVersion && channel === effectiveChannel)}
        onClick={() => {
          if (recommended && currentVersion && compareVersions(recommended.version, currentVersion) < 0) {
            setSelection({ id: pluginID, channel, version: recommended.version });
            setConfirm(true);
          } else if (recommended) {
            void run(recommended.version);
          }
        }}>
        {versions.isLoading ? 'Loading versions…' : currentVersion && recommended?.version === currentVersion && channel === effectiveChannel ? 'Installed' : `${label}${recommended ? ` ${recommended.version}` : ''}`}
      </Button>
      <Button size='sm' variant='outline' disabled={busy} onClick={() => {
        setChooser(true); 
      }}>Other versions…</Button>
      <Button size='sm' variant='ghost' disabled={versions.isFetching || busy} onClick={async () => {
        await versions.refetch();
      }}>Refresh</Button>
      {versions.isFetching && !versions.isLoading && <Text size='xs' tone='muted' role='status'>Checking versions…</Text>}
    </Stack>
    {recommended?.compatibility_reason && <Text size='xs' tone='muted'>{recommended.compatibility_reason}</Text>}
    {operation && <Text size='sm' role='status'>{operation}</Text>}
    {releaseState.isError && <Text size='sm' role='alert'>Could not load release channels. <Button size='sm' variant='ghost' onClick={async () => {
      await releaseState.refetch();
    }}>Retry</Button></Text>}
    {versions.isError && <Text size='sm' role='alert'>Could not load versions. <Button size='sm' variant='ghost' onClick={async () => {
      await versions.refetch();
    }}>Retry</Button></Text>}
    {!releaseState.isError && !releaseState.isLoading && !versions.isLoading && !versions.isError && !list.length && <Text size='sm' tone='muted'>No compatible releases available.</Text>}
    {list[0]?.compatible === false && <Text size='sm' role='status'>{list[0].version} · {list[0].compatibility_reason ?? 'Not compatible with this IDE.'}</Text>}
    <Dialog open={chooser} onClose={() => {
      if (!busy) {
        setChooser(false);
      } 
    }} size='md'>
      <Dialog.Title>Choose plugin version</Dialog.Title>
      <Dialog.Body>
        <Stack direction='column' spacing={3}>
          <RadioGroup className={styles.VersionList} aria-label='Plugin version'
            value={selected?.version ?? ''} onValueChange={version => {
              setSelection({ id: pluginID, channel, version });
            }}>
            {list.map(release => <RadioGroup.Item key={release.version} className={styles.VersionRow}
              value={release.version} disabled={busy} aria-label={release.version}
              description={release.compatibility_reason ?? undefined}>
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
        <Button variant='outline' disabled={busy} onClick={() => {
          setChooser(false); 
        }}>Cancel</Button>
        <Button color={downgrade ? 'danger' : 'brand'} disabled={busy || !selected || selected.compatible === false || (selected.version === currentVersion && channel === effectiveChannel)} onClick={() => {
          if (downgrade) {
            setConfirm(true);
          } else if (selected) {
            void run(selected.version);
          } 
        }}>{downgrade ? 'Downgrade…' : `${label} ${selected?.version ?? ''}`}</Button>
      </Dialog.Footer>
    </Dialog>
    <Dialog open={confirm} onClose={() => {
      if (!busy) {
        setConfirm(false);
      } 
    }} size='sm'>
      <Dialog.Title>Confirm downgrade</Dialog.Title>
      <Dialog.Body><Text>Downgrade from {currentVersion} to {selected?.version}? Existing plugin data may not work with this release.</Text></Dialog.Body>
      <Dialog.Footer><Button variant='outline' disabled={busy} onClick={() => {
        setConfirm(false); 
      }}>Cancel</Button><Button color='danger' disabled={busy} onClick={() => {
        if (selected) {
          void run(selected.version);
        } 
      }}>{operation ?? 'Confirm downgrade'}</Button></Dialog.Footer>
    </Dialog>
  </Stack>;
}
