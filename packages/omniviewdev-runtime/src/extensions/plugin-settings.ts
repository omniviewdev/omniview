import type { ComponentType } from 'react';
export const PLUGIN_SETTINGS_EXTENSION_POINT_ID = 'omniview/plugin/settings';
export interface PluginSettingsNavigation {
  hasDrafts: boolean;
  saving: boolean;
  save: () => Promise<boolean>;
  discard: () => void;
}
export interface PluginSettingsBodyProps {
  pluginID: string;
  registerNavigation: (form: PluginSettingsNavigation | null) => void;
}
/** Registration owner, not descriptor metadata, determines which settings page may render this body. */
export interface PluginSettingsContribution {
  contractVersion: 1;
  label: string;
  component: ComponentType<PluginSettingsBodyProps>;
}
