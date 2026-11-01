import React from 'react';
import { Text } from '@omniviewdev/base-ui';
import { useScopedSettings } from '@omniviewdev/runtime';
import Icon from '@/components/icons/Icon';
import { useSettingsForm } from '@/hooks/settings/useSettingsForm';
import AppearanceThemeSetting from '@/theme/AppearanceThemeSetting';
import HostProfilingCard from '@/features/profiling/HostProfilingCard';
import SettingsEntries from './SettingsEntries';
import SettingsFormShell from './SettingsFormShell';
import { Section } from './settingsContext';
import styles from './SettingsPage.module.css';

const APPEARANCE_SETTING_RENDERERS = {
  'appearance.theme': () => <AppearanceThemeSetting />,
};

const CoreSettingsPage: React.FC<{ id: string }> = ({ id }) => <CoreSettingsForm key={id} id={id} />;

function CoreSettingsForm({ id }: { id: string }) {
  const scoped = useScopedSettings({ kind: 'host' });
  const form = useSettingsForm(scoped);
  const category = scoped.categories[id];
  if (scoped.isLoading) {
    return <p role='status'>Loading settings…</p>;
  }

  if (Boolean(scoped.error) || !category) {
    return <p role='alert'>Could not load settings.</p>;
  }

  const pendingRestart = Object.values(category.settings).some(setting => setting?.pendingRestart);
  return <div className={styles.Root}>
    <div className={styles.Header}>
      <Icon name={category.icon} size={22} />
      <div className={styles.HeaderText}>
        <Text weight='semibold' size='lg'>{category.label}</Text>
        <Text size='xs' tone='muted'>{category.description}</Text>
      </div>
    </div>
    {id === 'developer' && <HostProfilingCard />}
    <SettingsFormShell form={form} pendingRestart={pendingRestart} restartTarget='Omniview'>
      <SettingsEntries section={Section.Core} id={id} settings={category.settings}
        draftValues={form.draftValues} setDraftValues={form.setDraftValues} validation={form.validation}
        renderSetting={id === 'appearance' ? APPEARANCE_SETTING_RENDERERS : undefined} />
    </SettingsFormShell>
  </div>;
}

export default CoreSettingsPage;
