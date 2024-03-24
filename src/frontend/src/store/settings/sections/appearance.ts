import { type SettingsSection } from '../types';

export type AppearanceSettings = SettingsSection;

export const initialState: AppearanceSettings = {
  id: 'appearance',
  label: 'Appearance',
  description: 'Customize the look and feel of the application',
  icon: 'LuPaintbrush',
  settings: {
    mode: {
      label: 'Mode',
      description: 'Choose between light and dark mode for the UI, or let the system decide.',
      visible: true,
      type: 'select',
      default: 'system',
      value: 'system',
      options: [
        { value: 'light', label: 'Light' },
        { value: 'dark', label: 'Dark' },
        { value: 'system', label: 'System' },
      ],
    },
    theme: {
      label: 'Theme',
      description: 'Customize the look and feel of the UI with a custom theme',
      visible: true,
      type: 'select',
      default: 'default',
      value: 'default',
      options: [
        { value: 'default', label: 'Default' },
      ],
    },
    headerSearch: {
      label: 'Header Search',
      description: 'Enable or disable the search bar in the header',
      visible: true,
      type: 'toggle',
      default: true,
      value: true,
    },
    showSettingIds: {
      label: 'Show Setting IDs',
      description: 'Show the unique identifier for each setting in the settings panel',
      visible: true,
      type: 'toggle',
      default: false,
      value: false,
    },
  },
};

