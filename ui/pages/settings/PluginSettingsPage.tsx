import React from 'react';

import { Avatar, Button, Text } from '@omniviewdev/base-ui';

// Types
import SettingsEntries from './SettingsEntries';
import { Section } from './settingsContext';
import styles from './SettingsPage.module.css';
import { usePluginSettings } from '@/hooks/settings/usePluginSettings';
import { usePlugin } from '@/hooks/plugin/usePluginManager';
import { SettingsClient } from '@omniviewdev/runtime/api';

type Props = {
  id: string;
};

/**
 * View and modify settings for a given plugin.
 */
const PluginSettingsPage: React.FC<Props> = ({ id }) => {
  const [draftValues, setDraftValues] = React.useState<Record<string, any>>({});
  const [validation, setValidation] = React.useState<Record<string, { valid: boolean; message: string }>>({});
  const [saving, setSaving] = React.useState(false);
  const revision = React.useRef(0);
  const settingID = (key: string) => key.slice(id.length + 1);

  React.useEffect(() => {
    setDraftValues({});
    setValidation({});
  }, [id]);

  React.useEffect(() => {
    const current = ++revision.current;
    const entries = Object.entries(draftValues).filter(([, value]) => value !== undefined);
    setValidation(Object.fromEntries(entries.map(([key]) => [key, { valid: false, message: 'Checking…' }])));
    const timer = window.setTimeout(() => {
      entries.forEach(([key, value]) => {
        SettingsClient.ValidateSetting(id, key.slice(id.length + 1), value).then(result => {
          if (revision.current === current) {
            setValidation(previous => ({ ...previous, [key]: result }));
          }
        }).catch(() => {
          if (revision.current === current) {
            setValidation(previous => ({ ...previous, [key]: { valid: false, message: 'Could not validate. Ensure the plugin is running and supports settings validation.' } }));
          }
        });
      });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      revision.current++;
    };
  }, [draftValues, id]);

  const { plugin } = usePlugin({ id });
  const { settings, setSettings } = usePluginSettings({ plugin: id });

  const hasDrafts = Object.values(draftValues).some(v => v !== undefined);

  const commitDraftValues = async () => {
    const entries = Object.entries(draftValues).filter(([, value]) => value !== undefined);
    const values = Object.fromEntries(entries.map(([key, value]) => [settingID(key), value]));
    setSaving(true);
    const current = revision.current;
    try {
      const results = await Promise.all(entries.map(async ([key, value]) => (
        [key, await SettingsClient.ValidateSetting(id, settingID(key), value)] as const
      )));
      if (revision.current !== current) {
        return;
      }

      setValidation(Object.fromEntries(results));
      if (results.some(([, result]) => !result.valid)) {
        return;
      }

      await setSettings(values);
      if (revision.current === current) {
        clearDraftValues();
      }
    } catch {
      if (revision.current !== current) {
        return;
      }

      setValidation(previous => ({
        ...previous,
        ...Object.fromEntries(entries.map(([key]) => [key, { valid: false, message: 'Could not save. Ensure the plugin is running and check the value before retrying.' }])),
      }));
    } finally {
      setSaving(false);
    }
  };

  const clearDraftValues = () => {
    setDraftValues({});
  };

  if (settings.isLoading || settings.isError || !settings.data || !plugin.data) {
    return null;
  }

  return (
    <div className={styles.Root}>
      {/* Header */}
      <div className={styles.Header}>
        <Avatar size='sm' shape='rounded' src={plugin.data.metadata.icon} alt={plugin.data.metadata.name} className={styles.HeaderAvatar} />
        <div className={styles.HeaderText}>
          <Text weight='semibold' size='lg'>{plugin.data.metadata.name}</Text>
          <Text size='xs' tone='muted'>{plugin.data.metadata.description}</Text>
        </div>
      </div>

      {/* Settings form */}
      <fieldset className={styles.Form} disabled={saving}>
        <SettingsEntries
          section={Section.Plugins}
          id={id}
          settings={settings.data}
          draftValues={draftValues}
          setDraftValues={setDraftValues}
          validation={validation}
        />
      </fieldset>

      {/* Action bar */}
      {hasDrafts && (
        <div className={styles.ActionBar}>
          <Button
            color='brand'
            variant='soft'
            onClick={commitDraftValues}
            disabled={saving}
            aria-label='Save Changes'
            aria-busy={saving}
          >
            {saving ? 'Checking and saving…' : 'Save Changes'}
          </Button>
          <Button
            color='neutral'
            variant='ghost'
            onClick={clearDraftValues}
            disabled={saving}
          >
            Discard
          </Button>
        </div>
      )}
    </div>
  );
};

export default PluginSettingsPage;
