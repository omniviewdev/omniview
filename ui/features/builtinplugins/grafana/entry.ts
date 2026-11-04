import { PluginWindow, CONNECTION_SETTINGS_EXTENSION_POINT_ID, PLUGIN_SETTINGS_EXTENSION_POINT_ID, type PluginSettingsContribution, type ConnectionSettingsContribution, type ExtensionRegistration } from '@omniviewdev/runtime';
import type { RouteObject } from 'react-router';
import GrafanaSettings from './Settings';
import GrafanaConnectionSettings from './ConnectionSettings';

export const routes: RouteObject[] = [{ path: '/', Component: GrafanaSettings }];
export const extensionRegistrations: ExtensionRegistration[] = [{
  extensionPointId: PLUGIN_SETTINGS_EXTENSION_POINT_ID,
  registration: { id: 'grafana/global-settings', plugin: 'grafana', label: 'Grafana', value: {
    contractVersion: 1, label: 'Grafana', component: GrafanaSettings,
  } satisfies PluginSettingsContribution },
}, {
  extensionPointId: CONNECTION_SETTINGS_EXTENSION_POINT_ID,
  registration: {
    id: 'grafana/connection-metrics', plugin: 'grafana', label: 'External metrics',
    value: { contractVersion: 1, label: 'External metrics', signals: ['metrics'], component: GrafanaConnectionSettings } satisfies ConnectionSettingsContribution,
  },
}];
export const plugin = new PluginWindow().setRootPage(GrafanaSettings).withRoutes(routes);
