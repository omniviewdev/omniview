import React from 'react';
import { Call } from '@wailsio/runtime';
import { Button, Checkbox, Select, Switch } from '@omniviewdev/base-ui';
import { HOST_SETTINGS_SCOPE, useScopedSettings, useSettings } from '@omniviewdev/runtime';
import { LuChevronDown } from 'react-icons/lu';
import styles from './UpdatesSettingsPage.module.css';

const service = 'main.UpdateService';
type Status = { state: string; version: string; availableVersion: string; error: string; channel: string; switchTarget: string };
type ChannelOption = { channel: string; branch: string; status: string; desktopVersion: string; stateExists: boolean; stateIdentity: string; statePath: string; stateModifiedAt: string; stateFileModifiedAt: Record<string, string>; stateInUse: 'in-use' | 'not-in-use' | 'unknown'; stateError: string };
type ChannelList = { current: string; options: ChannelOption[]; error: string };

const channelName = (channel: string) => channel === 'stable' ? 'Stable' : channel === 'nightly' ? 'Nightly' : channel;

function ProfileFileTimes({ times }: { times: Record<string, string> | undefined }) {
  const entries = Object.entries(times ?? {});
  return <div>
    <p>Profile file modification times:</p>
    {entries.length === 0
      ? <p>Unavailable</p>
      : <ul>{entries.map(([file, modified]) => <li key={file}>{file}: {modified}</li>)}</ul>}
  </div>;
}

export default function UpdatesSettingsPage() {
  const [status, setStatus] = React.useState<Status>();
  const [channels, setChannels] = React.useState<ChannelList>();
  const [selectedChannel, setSelected] = React.useState('');
  const [copy, setCopy] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
  const [deletionError, setDeletionError] = React.useState('');
  const [channelError, setChannelError] = React.useState('');
  const [channelAttempt, setChannelAttempt] = React.useState(0);
  const [deleteChannel, setDeleteChannel] = React.useState('');
  const [deleteIdentity, setDeleteIdentity] = React.useState('');
  const [deleteConfirmation, setDeleteConfirmation] = React.useState('');
  const { settings } = useSettings();
  const { commit } = useScopedSettings(HOST_SETTINGS_SCOPE);
  const showFeatures = settings['developer.show_feature_channels'] === true;
  const refresh = React.useCallback(async () => {
    return Call.ByName(`${service}.Status`).then((value: unknown) => {
      setStatus(value as Status);
    }).catch((err: unknown) => {
      setError(String(err));
    });
  }, []);
  React.useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => {
      void refresh();
    }, 2000);
    return () => {
      window.clearInterval(timer);
    };
  }, [refresh]);
  const canListChannels = Boolean(status) && status?.state !== 'unconfigured';
  React.useEffect(() => {
    if (!canListChannels) {
      return;
    }

    let active = true;
    void Call.ByName(`${service}.ListChannels`).then((value: unknown) => {
      if (!active) {
        return;
      }

      const list = value as ChannelList;
      setChannels(list);
      setChannelError(list.error);
      setSelected(current => current || list.current);
    }).catch((err: unknown) => {
      if (active) {
        setChannelError(String(err));
      }
    });
    return () => {
      active = false;
    };
  }, [canListChannels, channelAttempt]);
  React.useEffect(() => {
    if (deleteChannel && channels?.options.find(option => option.channel === deleteChannel)?.stateIdentity !== deleteIdentity) {
      setDeleteChannel('');
      setDeleteConfirmation('');
      setDeleteIdentity('');
      setDeletionError(previous => previous || 'Channel data changed. Open a new deletion confirmation.');
    }
  }, [channels, deleteChannel, deleteIdentity]);
  const run = async (method: string, ...args: unknown[]) => {
    setError('');
    setBusy(true);
    try {
      await Call.ByName(`${service}.${method}`, ...args);
      if (method === 'SwitchChannel') {
        setChannelAttempt(attempt => attempt + 1);
      }
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }

    await refresh();
  };
  const deleteData = async (channel: string) => {
    setDeletionError('');
    setBusy(true);
    try {
      const [list, latestStatus] = await Promise.all([
        Call.ByName(`${service}.ListChannels`) as Promise<ChannelList>,
        Call.ByName(`${service}.Status`) as Promise<Status>,
      ]);
      setChannels(list);
      setChannelError(list.error);
      setStatus(latestStatus);
      const option = list.options.find(item => item.channel === channel);
      if (!deleteIdentity || !option || option.stateIdentity !== deleteIdentity || option.stateError || !option.stateExists || option.stateInUse === 'in-use'
        || channel === list.current || channel === latestStatus.channel || channel === latestStatus.switchTarget) {
        throw new Error('Channel data cannot be deleted. Profile status changed or could not be inspected.');
      }
      await Call.ByName(`${service}.DeleteChannelData`, channel, deleteIdentity);
      setChannels(list => list && {
        ...list,
        options: list.options.map(option => option.channel === channel ? { ...option, stateExists: false, stateModifiedAt: '', stateFileModifiedAt: {}, stateInUse: 'unknown' } : option),
      });
      setDeleteChannel('');
      setDeleteIdentity('');
      setDeleteConfirmation('');
      if (channel === selectedChannel) {
        setCopy(true);
      }
      setChannelAttempt(attempt => attempt + 1);
    } catch (err) {
      setDeletionError(String(err));
      setChannelAttempt(attempt => attempt + 1);
    } finally {
      setBusy(false);
    }
  };


  const state = status?.state ?? 'loading';
  const current = channels?.current ?? status?.channel ?? '';
  const selected = !showFeatures && selectedChannel.startsWith('feature-') && selectedChannel !== current
    ? current
    : selectedChannel;
  const target = channels?.options.find(option => option.channel === selected);
  const currentOption = channels?.options.find(option => option.channel === current);
  const options = channels?.options.filter(option =>
    (showFeatures || !option.channel.startsWith('feature-') || option.channel === current)
    && (option.status !== 'archived' || option.channel === current)) ?? [];
  const items = options.map(option => ({
    value: option.channel,
    label: `${channelName(option.channel)}${option.channel.startsWith('feature-') && !option.desktopVersion && option.channel !== current ? ' (no desktop build yet)' : ''}`,
  }));
  const deleteControls = (option: ChannelOption, archived = false) => deleteChannel === option.channel
    ? <div className={styles.confirmation}>
      <p>Permanently delete all files in {option.statePath}. This cannot be undone.</p>
      <p>A pending copy from an older app may fail if you delete this data.</p>
      <p>Deletion can stop partway if a filesystem error occurs. Remaining files may be kept in a quarantine folder.</p>
      <label>Type {option.channel} to confirm
        <input value={deleteConfirmation} disabled={busy} onChange={event => {
          setDeleteConfirmation(event.target.value);
        }} />
      </label>
      <div className={styles.actions}>
        <Button variant='solid' color='danger' disabled={busy || !deleteIdentity || option.stateIdentity !== deleteIdentity || Boolean(option.stateError) || option.stateInUse === 'in-use' || option.channel === status?.switchTarget || deleteConfirmation !== option.channel} onClick={() => {
          void deleteData(option.channel);
        }}>Permanently delete channel data</Button>
        <Button disabled={busy} onClick={() => {
          setDeleteChannel('');
          setDeleteIdentity('');
          setDeleteConfirmation('');
        }}>Cancel</Button>
      </div>
    </div>
    : <Button disabled={busy || !option.stateIdentity || Boolean(option.stateError) || option.stateInUse === 'in-use' || option.channel === status?.switchTarget} onClick={() => {
      setDeleteChannel(option.channel);
      setDeletionError('');
      setDeleteIdentity(option.stateIdentity);
      setDeleteConfirmation('');
    }}>{archived ? `Delete data for ${option.channel}` : 'Delete channel data'}</Button>;


  return <section>
    <h1>Updates</h1>
    {status?.version && <p>Current version: {status.version}</p>}
    <p role='status'>Status: {state === 'unconfigured' ? 'not configured' : state}</p>
    {status?.availableVersion && <p>Available version: {status.availableVersion}</p>}
    {(error || status?.error) && <p role='alert'>{error || status?.error}</p>}
    {deletionError && <p role='alert'>{deletionError} <Button onClick={() => {
      setDeletionError('');
    }}>Dismiss deletion error</Button></p>}
    {state === 'ready'
      ? <Button variant={status?.switchTarget ? 'solid' : undefined} color={status?.switchTarget ? 'danger' : undefined} onClick={() => {
        void run('Restart');
      }}>
        {status?.switchTarget ? `Restart into ${status.switchTarget}` : 'Restart to Update'}
      </Button>
      : <Button disabled={busy || ['loading', 'unconfigured', 'checking', 'downloading', 'verifying', 'installing'].includes(state)} onClick={() => {
        void run('Check');
      }}>
        Check for Updates
      </Button>}
    {status && state !== 'unconfigured' && <section>
      <h2>Release channel</h2>
      <p>Current channel: {channelName(current)}</p>
      {channelError && <p role='alert'>{channelError} <Button onClick={() => {
        setChannelAttempt(attempt => attempt + 1);
      }}>Retry channel discovery</Button></p>}
      {!channelError && currentOption?.status === 'archived' && <p role='alert'>This channel was retired. Switch to Stable to keep receiving updates.</p>}
      <Select.Root size='sm' value={selected} items={items} disabled={!channels || busy} onValueChange={(value) => {
        if (value !== null && value !== selected) {
          setSelected(value);
          setDeleteChannel('');
          setDeleteConfirmation('');
          setCopy(true);
        }
      }}>
        <Select.Trigger aria-label='Release channel'><Select.Value /><Select.Icon><LuChevronDown aria-hidden /></Select.Icon></Select.Trigger>
        <Select.Portal><Select.Positioner sideOffset={4}><Select.Popup><Select.List>
          {options.map(option => <Select.Item key={option.channel} value={option.channel} disabled={option.channel.startsWith('feature-') && !option.desktopVersion && option.channel !== current}>
            <Select.ItemText>{items.find(item => item.value === option.channel)?.label}</Select.ItemText>
          </Select.Item>)}
        </Select.List></Select.Popup></Select.Positioner></Select.Portal>
      </Select.Root>
      <label>Show feature channels <Switch checked={showFeatures} onCheckedChange={(checked) => {
        void commit({ 'developer.show_feature_channels': checked }).then(result => {
          if (!result.applied || result.uncertain) {
            setError(result.message ?? 'Could not apply setting');
          } else if (!checked && selectedChannel.startsWith('feature-') && selectedChannel !== current) {
            setSelected(current);
            setCopy(false);
            setDeleteChannel('');
            setDeleteConfirmation('');
          }
        }).catch((err: unknown) => {
          setError(String(err));
        });
      }} /></label>
      <Button disabled={busy} onClick={() => {
        setChannelAttempt(attempt => attempt + 1);
      }}>Refresh profile data</Button>
      {target && <div className={styles.profile}>
        <p>Data path: {target.statePath}</p>
        <p>Channel data: {target.stateError ? 'Unknown' : target.stateExists ? 'Exists' : 'Not found'}</p>
        {target.stateError && <p role='alert'>Profile inspection failed: {target.stateError}</p>}
        <p>Profile directory top-level entries modified: {target.stateModifiedAt || 'Unknown'}</p>
        <p>Profile in use: {target.stateInUse === 'in-use' ? 'Yes' : target.stateInUse === 'not-in-use' ? 'No' : 'Unknown'}</p>
        <ProfileFileTimes times={target.stateFileModifiedAt} />
        <p>Existing channel data is retained. Copying current data is available only for a new channel profile.</p>
        {selected !== current && (target.stateExists || target.stateError) && deleteControls(target)}
      </div>}
      {channels?.options.filter(option => option.status === 'archived' && option.channel !== current && (option.stateExists || option.stateError)).map(option =>
        <div key={option.channel} className={styles.profile}>
          <p>Retired channel: {option.channel}</p>
          <p>Data path: {option.statePath}</p>
          {option.stateError && <p role='alert'>Profile inspection failed: {option.stateError}</p>}
          <p>Profile directory top-level entries modified: {option.stateModifiedAt || 'Unknown'}</p>
          <p>Profile in use: {option.stateInUse === 'in-use' ? 'Yes' : option.stateInUse === 'not-in-use' ? 'No' : 'Unknown'}</p>
          <ProfileFileTimes times={option.stateFileModifiedAt} />
          {deleteControls(option, true)}
        </div>)}
      {target && selected !== current && <>
        {target.desktopVersion && <p>Target version: {target.desktopVersion}</p>}
        {!target.stateExists && !target.stateError && <Checkbox size='sm' checked={copy} onCheckedChange={setCopy}>Copy my current data to this channel</Checkbox>}
        <Button variant='solid' color='danger' disabled={busy || Boolean(target.stateError) || state === 'ready' || (target.channel.startsWith('feature-') && !target.desktopVersion)} onClick={() => {
          void run('SwitchChannel', selected, copy && !target.stateExists);
        }}>Download and switch</Button>
      </>}
    </section>}
  </section>;
}
