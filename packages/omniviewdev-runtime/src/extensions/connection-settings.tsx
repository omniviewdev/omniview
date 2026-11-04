import { Component, Suspense, type ComponentType, type ReactNode } from 'react';
import { useExtensionPointSnapshot } from './provider';

export const CONNECTION_SETTINGS_EXTENSION_POINT_ID = 'omniview/connection/settings';

/** Owner supplies approved public metadata only. Rendering grants no backend authority. */
export interface ConnectionSettingsContext {
  resourcePluginID: string;
  connectionID: string;
  signal: 'metrics';
  catalogRevision: string;
  publicMetadata: Readonly<Record<string, string>>;
  resourceTypes: readonly string[];
}
export interface ConnectionSettingsContribution {
  contractVersion: 1;
  label: string;
  signals: readonly ConnectionSettingsContext['signal'][];
  component: ComponentType<ConnectionSettingsContext>;
}

class ContributionBoundary extends Component<{ children: ReactNode; label: string }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    return this.state.failed ? <p role="alert">{this.props.label} settings could not load. Native configuration remains available.</p> : this.props.children;
  }
}

/** The connection owner chooses placement. Contributions own independently scoped drafts. */
export function ConnectionSettingsContributions(props: ConnectionSettingsContext) {
  const { contributions } = useExtensionPointSnapshot<ConnectionSettingsContribution>(CONNECTION_SETTINGS_EXTENSION_POINT_ID);
  return <>{contributions.filter(({ value }) => value?.contractVersion === 1 &&
    value.signals.includes(props.signal) && typeof value.component === 'function').map(({ id, value }) => {
    const View = value.component;
    return <ContributionBoundary key={JSON.stringify([id, props.resourcePluginID, props.connectionID, props.signal])} label={value.label}>
      <Suspense fallback={<p role="status">Loading {value.label} settings…</p>}><View {...props} /></Suspense>
    </ContributionBoundary>;
  })}</>;
}
