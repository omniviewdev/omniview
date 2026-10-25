import React from 'react';

import { Button, Text } from '@omniviewdev/base-ui';

// Project imports
import Icon from '@/components/icons/Icon';

// Types
import { useCategorySettings } from '@/hooks/settings/useCategorySettings';
import AppearanceThemeSetting from '@/theme/AppearanceThemeSetting';
import SettingsEntries from './SettingsEntries';
import { Section } from './settingsContext';
import styles from './SettingsPage.module.css';
import { useSettings } from '@omniviewdev/runtime';

type Props = {
  id: string;
};

const THEME_SETTING_ID = 'appearance.theme';
const APPEARANCE_SETTING_RENDERERS = {
  [THEME_SETTING_ID]: () => <AppearanceThemeSetting />,
};

/**
 * View and modify settings for a given namespace and section.
 */
const CoreSettingsPage: React.FC<Props> = ({ id: categoryID }) => {
  const [draftValues, setDraftValues] = React.useState<Record<string, any>>({});

  const { settings, setSettings } = useCategorySettings({ category: categoryID });
  const { reload } = useSettings();

  const hasDrafts = Object.entries(draftValues).some(
    ([id, value]) => id !== THEME_SETTING_ID && value !== undefined,
  );

  const commitDraftValues = () => {
    const values = Object.entries(draftValues).reduce<Record<string, any>>((acc, [id, value]) => {
      if (id !== THEME_SETTING_ID && value !== undefined) {
        acc[id] = value;
      }

      return acc;
    }, {});

    setSettings(values).then(() => {
      clearDraftValues();
      reload();
    }).catch(() => {
      // error notification is handled by useCategorySettings hook
    });
  };

  const clearDraftValues = () => {
    setDraftValues({});
  };

  if (settings.isLoading || settings.isError || !settings.data) {
    return null;
  }

  return (
    <div className={styles.Root}>
      {/* Header */}
      <div className={styles.Header}>
        <Icon name={settings.data.icon} size={22} />
        <div className={styles.HeaderText}>
          <Text weight='semibold' size='lg'>{settings.data.label}</Text>
          <Text size='xs' tone='muted'>{settings.data.description}</Text>
        </div>
      </div>

      {/* Settings form */}
      <div className={styles.Form}>
        <SettingsEntries
          section={Section.Core}
          id={categoryID}
          settings={settings.data.settings}
          draftValues={draftValues}
          setDraftValues={setDraftValues}
          renderSetting={categoryID === 'appearance' ? APPEARANCE_SETTING_RENDERERS : undefined}
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

export default CoreSettingsPage;
