import React from 'react';
import { Button, Select } from '@omniviewdev/base-ui';
import { LuChevronDown } from 'react-icons/lu';
import {
  GetNativeTerminalApplications,
  GetNativeTerminalSupport,
} from '../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/exec/servicewrapper';
import type { Application } from '../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/internal/nativeapps/models';
import type { SettingsEditorProps } from './SettingsEntries';
import styles from './NativeTerminalApplicationSetting.module.css';

type Discovery =
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'ready'; applications: Application[] }
  | { status: 'error'; message: string };

export default function NativeTerminalApplicationSetting({ value, onChange, disabled, inputId, labelledBy, describedBy }: SettingsEditorProps) {
  const [discovery, setDiscovery] = React.useState<Discovery>({ status: 'loading' });
  const [attempt, setAttempt] = React.useState(0);
  const statusId = `${inputId}-discovery`;

  React.useEffect(() => {
    let active = true;
    setDiscovery({ status: 'loading' });
    async function discover() {
      try {
        if (!await GetNativeTerminalSupport()) {
          if (active) {
            setDiscovery({ status: 'unavailable' });
          }
          return;
        }

        const applications = await GetNativeTerminalApplications();
        if (active) {
          setDiscovery({ status: 'ready', applications });
        }
      } catch (error) {
        if (active) {
          setDiscovery({ status: 'error', message: error instanceof Error ? error.message : typeof error === 'string' ? error : '' });
        }
      }
    }
    void discover();
    return () => {
      active = false;
    };
  }, [attempt]);

  const applications = discovery.status === 'ready' ? discovery.applications : [];
  const selected = applications.find(application => application.id === value);
  const hasValue = typeof value === 'string' && value !== '';
  const missing = discovery.status === 'ready' && hasValue && !selected;
  const selectedName = selected?.name ?? (hasValue ? `${missing ? 'Unavailable application' : 'Selected application'} (${value})` : 'Choose an application');
  const retry = <Button type='button' size='xs' variant='ghost' color='neutral' disabled={disabled}
    onClick={() => setAttempt(previous => previous + 1)}>{discovery.status === 'error' ? 'Retry discovery' : 'Refresh applications'}</Button>;

  return <div className={styles.Root}>
    <Select.Root size='sm' value={selected?.id ?? null}
      items={applications.map(application => ({ value: application.id, label: application.name }))}
      disabled={disabled || discovery.status !== 'ready' || applications.length === 0}
      onValueChange={next => {
        if (next !== null) {
          onChange(next);
        }
      }}>
      <Select.Trigger id={inputId} aria-labelledby={labelledBy} aria-describedby={`${describedBy} ${statusId}`}
        aria-busy={discovery.status === 'loading'} className={styles.Trigger}>
        <Select.Value className={styles.Application}>
          {selected && <img src={selected.iconDataURL} alt='' className={styles.Icon} />}
          <span className={styles.Name}>{discovery.status === 'loading' ? 'Discovering applications…' : selectedName}</span>
        </Select.Value>
        <Select.Icon><LuChevronDown aria-hidden /></Select.Icon>
      </Select.Trigger>
      <Select.Portal>
        <Select.Positioner sideOffset={4} alignItemWithTrigger={false}>
          <Select.Popup className={styles.Popup}>
            <Select.List aria-label='Installed supported terminal applications'>
              {applications.map(application => <Select.Item key={application.id} value={application.id}>
                <Select.ItemText className={styles.Application}>
                  <img src={application.iconDataURL} alt='' className={styles.Icon} />
                  <span>{application.name}</span>
                </Select.ItemText>
              </Select.Item>)}
            </Select.List>
          </Select.Popup>
        </Select.Positioner>
      </Select.Portal>
    </Select.Root>
    <div id={statusId} className={styles.Status}>
      {discovery.status === 'loading' && <p role='status'>Looking for installed supported applications…</p>}
      {discovery.status === 'unavailable' && <p role='status'>Native terminal applications are available only on macOS. Your saved preference is unchanged.</p>}
      {discovery.status === 'error' && <>
        <p role='alert'>Could not discover installed applications. {discovery.message} Retry discovery to scan this Mac again. Your selection is unchanged.</p>
        {retry}
      </>}
      {discovery.status === 'ready' && <>
        {missing && <p role='status'>Selected application ({value}) is no longer available. Install it or choose an installed application. Your preference will not change until you save.</p>}
        {applications.length === 0 ? <>
          <p role='status'>No supported terminal applications were found. Install Terminal or iTerm2, then refresh applications.</p>
        </> : !missing && <p>Discovered on this Mac</p>}
        {retry}
      </>}
    </div>
  </div>;
}
