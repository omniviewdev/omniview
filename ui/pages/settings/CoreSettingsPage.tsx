import React from 'react';
import { Text } from '@omniviewdev/base-ui';
import { useScopedSettings } from '@omniviewdev/runtime';
import { useSettingsForm } from '@/hooks/settings/useSettingsForm';
import AppearanceThemeSetting from '@/theme/AppearanceThemeSetting';
import SettingsEntries from './SettingsEntries';
import SettingsFormShell from './SettingsFormShell';
import { Section } from './settingsContext';
import styles from './SettingsPage.module.css';

const APPEARANCE_SETTING_RENDERERS = {
  'appearance.theme': () => <><AppearanceThemeSetting /><p>Theme changes save immediately.</p></>,
};

const PROFILING_PRESENTATION = {
  'developer.pprof_enabled': {
    label: 'Local profiling (pprof)',
    help: 'Unauthenticated, local-only access. Profiles may contain sensitive data; do not forward this port. Stop Pyroscope before CPU captures.',
  },
  'developer.pprof_port': {
    label: 'Profiling port',
    help: 'Use 0 to choose an available port automatically.',
  },
  'developer.plugin_pprof_enabled': {
    label: 'Plugin profiling (pprof)',
    help: 'Opens local-only profiling ports for plugin processes after restarting Omniview. Profiles may contain sensitive data; do not forward these ports. Stop Pyroscope before CPU captures.',
  },
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
      <div className={styles.HeaderText}>
        <h1 className={styles.Heading}><span>Application / </span>{category.label}</h1>
        <Text size='xs' tone='muted'>{category.description}</Text>
      </div>
    </div>
    <SettingsFormShell form={form} pendingRestart={pendingRestart} restartTarget='Omniview'>
      <SettingsEntries section={Section.Core} id={id} settings={category.settings}
        presentation={PROFILING_PRESENTATION}
        draftValues={form.draftValues} setDraftValues={form.setDraftValues} validation={form.validation} disabled={form.saving}
        renderSetting={id === 'appearance' ? APPEARANCE_SETTING_RENDERERS : undefined} />
    </SettingsFormShell>
  </div>;
}

export default CoreSettingsPage;
