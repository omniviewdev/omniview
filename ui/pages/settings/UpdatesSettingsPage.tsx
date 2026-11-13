import React from 'react';
import { Call } from '@wailsio/runtime';
import { Button, Checkbox, Select, Switch } from '@omniviewdev/base-ui';
import { HOST_SETTINGS_SCOPE, useScopedSettings, useSettings } from '@omniviewdev/runtime';
import { LuChevronDown } from 'react-icons/lu';

const service = 'main.UpdateService';
type Status = { state: string; version: string; availableVersion: string; error: string; channel: string; switchTarget: string };
type ChannelOption = { channel: string; branch: string; status: string; desktopVersion: string; stateExists: boolean };
type ChannelList = { current: string; options: ChannelOption[]; error: string };

const channelName = (channel: string) => channel === 'stable' ? 'Stable' : channel === 'nightly' ? 'Nightly' : channel;

export default function UpdatesSettingsPage() {
  const [status, setStatus] = React.useState<Status>();
  const [channels, setChannels] = React.useState<ChannelList>();
  const [selectedChannel, setSelected] = React.useState('');
  const [copy, setCopy] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState('');
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
      setSelected(current => current || list.current);
    }).catch((err: unknown) => {
      if (active) {
        setError(String(err));
      }
    });
    return () => {
      active = false;
    };
  }, [canListChannels]);
  const run = async (method: string, ...args: unknown[]) => {
    setError('');
    setBusy(true);
    try {
      await Call.ByName(`${service}.${method}`, ...args);
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(false);
    }

    await refresh();
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

  return <section>
    <h1>Updates</h1>
    {status?.version && <p>Current version: {status.version}</p>}
    <p role='status'>Status: {state === 'unconfigured' ? 'not configured' : state}</p>
    {status?.availableVersion && <p>Available version: {status.availableVersion}</p>}
    {(error || status?.error) && <p role='alert'>{error || status?.error}</p>}
    {state === 'ready'
      ? <Button onClick={() => {
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
      {channels?.error && <p role='alert'>{channels.error}</p>}
      {currentOption?.status === 'archived' && <p role='alert'>This channel was retired. Switch to Stable to keep receiving updates.</p>}
      <Select.Root size='sm' value={selected} items={items} disabled={!channels || busy} onValueChange={(value) => {
        if (value !== null) {
          setSelected(value);
          setCopy(false);
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
          }
        }).catch((err: unknown) => {
          setError(String(err));
        });
      }} /></label>
      {target && selected !== current && <>
        {target.desktopVersion && <p>Target version: {target.desktopVersion}</p>}
        {!target.stateExists && <Checkbox size='sm' checked={copy} onCheckedChange={setCopy}>Copy my current data to this channel</Checkbox>}
        <Button disabled={busy || state === 'ready' || (target.channel.startsWith('feature-') && !target.desktopVersion)} onClick={() => {
          void run('SwitchChannel', selected, copy);
        }}>Download and switch</Button>
      </>}
    </section>}
  </section>;
}
