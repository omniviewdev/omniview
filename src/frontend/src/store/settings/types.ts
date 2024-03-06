import { GeneralSettings } from './sections/general';
import { AppearanceSettings } from './sections/appearance';
import { NotificationSettings } from './sections/notifications';
import { EditorSettings } from './sections/editor';
import { TerminalSettings } from './sections/terminal';

// ======================================== SETTING TYPES ======================================== //

export type Setting = TextSetting | IntegerSetting | FloatSetting | SelectSetting | ToggleSetting | ColorSetting | DatetimeSetting;

/** A setting definition */
export interface BaseSetting {
  /** The type of the setting */
  type: 'text' | 'integer' | 'float' | 'select' | 'toggle' | 'color' | 'datetime' | 'password';
  /** The visibility of the setting */
  visible: boolean;
  /** The label for the setting */
  label: string;
  /** The description for the setting */
  description: string;
  /** Defines if the setting is private and not accessible by other plugins */
  private?: boolean;
  /** 
   * Optional group for the setting. If provided, the setting will be grouped with other settings in the UI with the 
   * same group, and will be formatted for capitalization and spacing. This is purely for UI purposes.
   */
  group?: string;
  /** 
   * Custom validator function for the setting. If specified, it must return either an empty string to 
   * indicate success, or a string with an error message to indicate failure.
   *
   * @param value The value to validate
   * @param settings The currently defined settings in the setting storage, keyed 
   *  by <section>.<namespace>.<id>. Useful for doing cross-setting validation.
   *
   * @returns An empty string if the value is valid, or an error message if it is not
   */
  validator?: (value: any, settings?: Record<string, any>) => string;
}

/** A setting with a text type */
export interface TextSetting extends BaseSetting {
  type: 'text';
  /** The default value for the setting */
  default: string;
  /** The set value for the setting */
  value: string;
  /** Optional minimum length for the text */
  minLength?: number;
  /** Optional maximum length for the text */
  maxLength?: number;
  /** Optional regex pattern validator for the text */
  pattern?: RegExp;
}

/** A setting with an integer type */
export interface IntegerSetting extends BaseSetting {
  type: 'integer';
  /** The default value for the setting */
  default: number;
  /** The set value for the setting */
  value: number;
  /** Optional minimum value for the integer */
  min?: number;
  /** Optional maximum value for the integer */
  max?: number;
  /** Optional step value for the integer */
  step?: number;
  /** Optional unit for the integer */
  unit?: string;
}

/** A setting with a float type */
export interface FloatSetting extends BaseSetting {
  type: 'float';
  /** The default value for the setting */
  default: number;
  /** The set value for the setting */
  value: number;
  /** Optional minimum value for the float */
  min?: number;
  /** Optional maximum value for the float */
  max?: number;
}

/** A setting with a select type */
export interface SelectSetting extends BaseSetting {
  type: 'select';
  /** The default value for the setting */
  default: string | string[];
  /** The set value for the setting */
  value: string | string[];
  /** The available options for the select */
  options: SelectSettingOption[];
  /** Optional multiple select */
  multiple?: boolean;
}

/** An option for a select setting */
export interface SelectSettingOption {
  /** The value for the option */
  value: string;
  /** Desriptive label for the option */
  label: string;
  /** Optional icon for the option */
  icon?: string;
  /** Optional description for the option */
  description?: string;
}

/** A setting with a toggle type */
export interface ToggleSetting extends BaseSetting {
  type: 'toggle';
  /** The default value for the setting */
  default: boolean;
  /** The set value for the setting */
  value: boolean;
}

/** A setting with a color type */
export interface ColorSetting extends BaseSetting {
  type: 'color';
  /** The default value for the setting */
  default: string;
  /** The set value for the setting */
  value: string;
}

/** A setting with a datetime type */
export interface DatetimeSetting extends BaseSetting {
  type: 'datetime';
  /** The default value for the setting */
  default: string;
  /** The set value for the setting */
  value: string;
  /** Optional minimum date for the datetime */
  min?: string;
  /** Optional maximum date for the datetime */
  max?: string;
}

// ======================================== STATE ======================================== //

/**
 * A namespace for settings groups related to a specific feature or area of the application.
 * Namespaces are used to organize settings into sections, and are used to group settings
 * together in the settings UI.
 *
 * The core settings namespace is reserved for the core application settings, and are read only to
 * other plugins by default. They, however, can be accessed by other plugins to read the core settings,
 * accessible in the `core` namespace.
 *
 * All plugins must define a namespace in which their plugins settings are defined, and must not
 * conflict between other plugins. As such, it is recommended to use a unique identifier for the
 * namespace, such as the plugin name or a unique identifier. This namespace identifier will be 
 * published along with the plugin, and will be used to access the settings for the plugin, as well
 * as allow other plugin publishers to use the settings defined (unless marked private at either the
 * namespace or setting level).
 */
export type SettingsNamespace = {
  /** Unique identifier for the settings namespace */
  id: string;
  /** The label for the settings namespace */
  label: string;
  /** Optional description for the settings namespace */
  description?: string;
  /** Optional icon for the settings namespace */
  icon?: string;
  /** 
   * Defines if the namespace is globally private and not accessible by other plugins.
   * If true, the namespace and all settings within it will not be accessible by other plugins.
   * This can be set to false to allow other plugins to access the settings within the namespace, with
   * individual settings being marked private.
   */
  private?: boolean;
  /** The sections for the settings namespace */
  sections: Record<string, SettingsSection>;
}

export type SettingsSection = {
  /** Unique identifier for the section */
  id: string;
  /** The label for the section */
  label: string;
  /** The description for the section */
  description: string;
  /** The icon for the section */
  icon: string;
  /** 
   * Defines if the section is globally private and not accessible by other plugins. If true, the
   * section and all settings within it will not be accessible by other plugins. This can be set to
   * false to allow other plugins to access the settings within the section, with individual settings
   * being marked private.
   */
  private?: boolean;
  /** The settings for the section */
  settings: Record<string, Setting>;
}

export type SettingsSectionEntry = GeneralSettings | AppearanceSettings | NotificationSettings | EditorSettings | TerminalSettings;
export type SettingsState = Record<string, SettingsNamespace>;

