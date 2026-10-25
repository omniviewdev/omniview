import React from 'react';

import { Avatar, Button, Text } from '@omniviewdev/base-ui';

// Types
import SettingsEntries from './SettingsEntries';
import { Section } from './settingsContext';
import styles from './SettingsPage.module.css';
import { usePluginSettings } from '@/hooks/settings/usePluginSettings';
import { usePlugin } from '@/hooks/plugin/usePluginManager';

type Props = {
  id: string;
};

/**
 * View and modify settings for a given plugin.
 */
const PluginSettingsPage: React.FC<Props> = ({ id }) => {
  const [draftValues, setDraftValues] = React.useState<Record<string, any>>({});

  const { plugin } = usePlugin({ id });
  const { settings, setSettings } = usePluginSettings({ plugin: id });

  const hasDrafts = Object.values(draftValues).some(v => v !== undefined);

  const commitDraftValues = () => {
    const values = Object.entries(draftValues).reduce<Record<string, any>>((acc, [id, value]) => {
      if (value !== undefined) {
        id = id.split('.')[1];
        acc[id] = value;
      }

      return acc;
    }, {});

    setSettings(values).then(() => {
      clearDraftValues();
    }).catch(() => {
      // error notification is handled by usePluginSettings hook
    });
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
      <div className={styles.Form}>
        <SettingsEntries
          section={Section.Plugins}
          id={id}
          settings={settings.data}
          draftValues={draftValues}
          setDraftValues={setDraftValues}
        />
      </div>

      {/* Action bar */}
      {hasDrafts && (
        <div className={styles.ActionBar}>
          <Button
            color='brand'
            variant='soft'
            onClick={commitDraftValues}
          >
            Save Changes
          </Button>
          <Button
            color='neutral'
            variant='ghost'
            onClick={clearDraftValues}
          >
            Discard
          </Button>
        </div>
      )}
    </div>
  );
};

export default PluginSettingsPage;
