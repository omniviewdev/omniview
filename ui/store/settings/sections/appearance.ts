import { type SettingsSection } from '../types';

export type AppearanceSettings = SettingsSection;

export const initialState: AppearanceSettings = {
  id: 'appearance',
  label: 'Appearance',
  description: 'Customize the look and feel of the application',
  icon: 'LuPaintbrush',
  settings: {
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

