import React, { Component, Suspense, useContext, type ReactNode } from 'react';
import { Text } from '@omniviewdev/base-ui';
import { useScopedSettings, useExtensionPointSnapshot, PLUGIN_SETTINGS_EXTENSION_POINT_ID, isSettingsComponent, type PluginSettingsContribution } from '@omniviewdev/runtime';
import { SettingsFormRegistration, useSettingsForm } from '@/hooks/settings/useSettingsForm';
import { usePlugin } from '@/hooks/plugin/usePluginManager';
import SettingsEntries from './SettingsEntries';
import SettingsFormShell from './SettingsFormShell';
import { Section } from './settingsContext';
import styles from './SettingsPage.module.css';

class SettingsBodyBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  static getDerivedStateFromError() {
    return { failed: true }; 
  }

  state = { failed: false };

  render() {
    return this.state.failed ? <><p role="alert">Plugin settings contribution could not load.</p>{this.props.fallback}</> : <>{this.props.children}</>;
  }
}

const PluginSettingsPage: React.FC<{ id: string }> = ({ id }) => {
  const { contributions } = useExtensionPointSnapshot<PluginSettingsContribution>(PLUGIN_SETTINGS_EXTENSION_POINT_ID);
  const register = useContext(SettingsFormRegistration);
  const matches = contributions.filter(contribution => contribution.plugin === id && contribution.value?.contractVersion === 1);
  if (matches.length !== 1 || !isSettingsComponent(matches[0]?.value.component)) {
    return <PluginSettingsForm key={id} id={id} />;
  }

  const contribution = matches[0];
  const Body = contribution.value.component;
  return <div className={styles.Root}><div className={styles.Header}><h1 className={styles.Heading}><span>Plugins / </span>{contribution.value.label}</h1></div>
    <SettingsBodyBoundary key={JSON.stringify([id, contribution.id])} fallback={<PluginSettingsForm id={id} />}><Suspense fallback={<p role="status">Loading plugin settings…</p>}>
      <Body pluginID={id} registerNavigation={register ?? (() => undefined)} />
    </Suspense></SettingsBodyBoundary>
  </div>;
};

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
