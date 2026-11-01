import React from 'react';
import { Text } from '@omniviewdev/base-ui';
import { useScopedSettings } from '@omniviewdev/runtime';
import { useSettingsForm } from '@/hooks/settings/useSettingsForm';
import { usePlugin } from '@/hooks/plugin/usePluginManager';
import SettingsEntries from './SettingsEntries';
import SettingsFormShell from './SettingsFormShell';
import { Section } from './settingsContext';
import styles from './SettingsPage.module.css';

const PluginSettingsPage: React.FC<{ id: string }> = ({ id }) => <PluginSettingsForm key={id} id={id} />;

function PluginSettingsForm({ id }: { id: string }) {
  const scoped = useScopedSettings({ kind: 'plugin', pluginId: id });
  const form = useSettingsForm(scoped);
  const { plugin } = usePlugin({ id });
  const category = scoped.categories.plugin;
  if (scoped.isLoading || plugin.isLoading) {
    return <p role='status'>Loading settings…</p>;
  }

  if (Boolean(scoped.error) || !category || !plugin.data) {
    return <p role='alert'>Could not load settings.</p>;
  }

  const pendingRestart = Object.values(category.settings).some(setting => setting?.pendingRestart);
  return <div className={styles.Root}>
    <div className={styles.Header}>
      <div className={styles.HeaderText}>
        <h1 className={styles.Heading}><span>Plugins / </span>{plugin.data.metadata.name}</h1>
        <Text size='xs' tone='muted'>{plugin.data.metadata.description}</Text>
      </div>
    </div>
    <SettingsFormShell form={form} pendingRestart={pendingRestart} restartTarget={`${plugin.data.metadata.name} plugin`}>
      <SettingsEntries section={Section.Plugins} id={id} settings={category.settings}
        draftValues={form.draftValues} setDraftValues={form.setDraftValues} validation={form.validation} disabled={form.saving} />
    </SettingsFormShell>
  </div>;
}

export default PluginSettingsPage;
