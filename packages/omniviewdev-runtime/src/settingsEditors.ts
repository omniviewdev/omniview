import type { ComponentType } from 'react';
import type { Setting } from './models';

export const SETTINGS_EDITOR_EXTENSION_POINT_ID = 'omniview/settings/editor';

/** Metadata for one authorized field. Stored values and defaults are never exposed here. */
export type SettingsEditorMetadata = Pick<Setting,
  'id' | 'label' | 'description' | 'type' | 'options' | 'fileSelection' | 'sensitive' | 'requiresRestart'>;

/** Host owns drafts, validation, save/reset, labels and focus. Editors only propose values. */
export type SettingsEditorProps = {
  settingId: string;
  setting: SettingsEditorMetadata;
  value: unknown;
  dirty: boolean;
  disabled?: boolean;
  validation?: { valid: boolean; message: string };
  inputId: string;
  labelledBy: string;
  describedBy: string;
  onChange: (value: unknown) => void;
  /** Attach to the editable control; detach with null when that control unmounts. */
  registerFocusTarget?: (element: HTMLElement | null) => void;
};

/**
 * Export through extensionRegistrations at omniview/settings/editor, with this object
 * as registration.value. settingId is opaque (including dots), and can name only
 * an existing field owned by the loading plugin. Registration.plugin is ignored.
 * One editor per plugin/field is allowed; ambiguity or failures use the generic field.
 * No settings rows are created by a contribution. No save or commit API is exposed.
 */
export type SettingsEditorV1 = {
  schemaVersion: 1;
  settingId: string;
  editor: ComponentType<SettingsEditorProps>;
};
