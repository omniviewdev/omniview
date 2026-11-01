import React from 'react';
import { Text } from '@omniviewdev/base-ui';
import { useScopedSettings } from '@omniviewdev/runtime';
import Icon from '@/components/icons/Icon';
import { useSettingsForm } from '@/hooks/settings/useSettingsForm';
import AppearanceThemeSetting from '@/theme/AppearanceThemeSetting';
import SettingsEntries from './SettingsEntries';
import SettingsFormShell from './SettingsFormShell';
import { Section } from './settingsContext';
import styles from './SettingsPage.module.css';

const APPEARANCE_SETTING_RENDERERS = {
  'appearance.theme': () => <AppearanceThemeSetting />,
};

const PROFILING_PRESENTATION = {
  'developer.ui_inspection_enabled': {
    label: 'UI inspection (WebKit)',
    help: 'After restarting Omniview on macOS 13.3 or later, use Safari → Develop → This Mac → the app → the page, then the Timelines record button. Enable Safari developer features if needed. Captures may contain sensitive UI data.',
  },
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
      <Icon name={category.icon} size={22} />
      <div className={styles.HeaderText}>
        <Text weight='semibold' size='lg'>{category.label}</Text>
        <Text size='xs' tone='muted'>{category.description}</Text>
      </div>
    </div>
    <SettingsFormShell form={form} pendingRestart={pendingRestart} restartTarget='Omniview'>
      <SettingsEntries section={Section.Core} id={id} settings={category.settings}
        presentation={PROFILING_PRESENTATION}
        draftValues={form.draftValues} setDraftValues={form.setDraftValues} validation={form.validation}
        renderSetting={id === 'appearance' ? APPEARANCE_SETTING_RENDERERS : undefined} />
    </SettingsFormShell>
  </div>;
}

export default CoreSettingsPage;
