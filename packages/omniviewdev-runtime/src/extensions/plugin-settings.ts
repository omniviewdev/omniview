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

/** React wrappers are object component types, not ordinary functions. */
export function isSettingsComponent(value: unknown): boolean {
  if (typeof value === 'function') return true;
  if (!value || typeof value !== 'object' || !('$$typeof' in value)) return false;
  const marker = value.$$typeof;
  return marker === Symbol.for('react.memo') ||
    marker === Symbol.for('react.lazy') ||
    marker === Symbol.for('react.forward_ref');
}
