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
import { SettingsProvider } from '@omniviewdev/runtime/api';

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
  const [validation, setValidation] = React.useState<Record<string, { valid: boolean; message: string }>>({});
  const [saving, setSaving] = React.useState(false);
  const revision = React.useRef(0);

  React.useEffect(() => {
    setDraftValues({});
    setValidation({});
  }, [categoryID]);

  React.useEffect(() => {
    const current = ++revision.current;
    const entries = Object.entries(draftValues).filter(([, value]) => value !== undefined);
    setValidation(Object.fromEntries(entries.map(([id]) => [id, { valid: false, message: 'Checking…' }])));
    const timer = window.setTimeout(() => {
      entries.forEach(([id, value]) => {
        SettingsProvider.ValidateSetting(id, value).then(result => {
          if (revision.current === current) {
            setValidation(previous => ({ ...previous, [id]: result }));
          }
        }).catch(() => {
          if (revision.current === current) {
            setValidation(previous => ({ ...previous, [id]: { valid: false, message: 'Could not validate. Save to retry.' } }));
          }
        });
      });
    }, 400);
    return () => {
      window.clearTimeout(timer);
      revision.current++;
    };
  }, [draftValues, categoryID]);

  const { settings, setSettings } = useCategorySettings({ category: categoryID });
  const { reload } = useSettings();

  const hasDrafts = Object.entries(draftValues).some(
    ([id, value]) => id !== THEME_SETTING_ID && value !== undefined,
  );

  const commitDraftValues = async () => {
    const values = Object.entries(draftValues).reduce<Record<string, any>>((acc, [id, value]) => {
      if (id !== THEME_SETTING_ID && value !== undefined) {
        acc[id] = value;
      }

      return acc;
    }, {});

    setSaving(true);
    const current = revision.current;
    try {
      const results = await Promise.all(Object.entries(values).map(async ([id, value]) => (
        [id, await SettingsProvider.ValidateSetting(id, value)] as const
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

      reload();
    } catch {
      if (revision.current !== current) {
        return;
      }

      // Keep drafts on validation transport or persistence failure.
      setValidation(previous => ({
        ...previous,
        ...Object.fromEntries(Object.keys(values).map(id => [id, { valid: false, message: 'Could not save. Check the value and try again.' }])),
      }));
    } finally {
      setSaving(false);
    }
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
      <fieldset className={styles.Form} disabled={saving}>
        <SettingsEntries
          section={Section.Core}
          id={categoryID}
          settings={settings.data.settings}
          draftValues={draftValues}
          setDraftValues={setDraftValues}
          validation={validation}
          renderSetting={categoryID === 'appearance' ? APPEARANCE_SETTING_RENDERERS : undefined}
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

export default CoreSettingsPage;
