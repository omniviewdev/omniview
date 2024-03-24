import { type SettingsSection } from '@/store/settings/types';

export type NotificationSettings = SettingsSection;

export const initialState: NotificationSettings = {
  id: 'notifications',
  label: 'Notifications',
  description: 'Customize notification settings',
  icon: 'LuBell',
  settings: {
    enabled: {
      label: 'Enable Notifications',
      description: 'Whether to enable notifications globally',
      visible: true,
      type: 'toggle',
      default: true,
      value: true,
    },
    sounds: {
      label: 'Notification Sounds',
      description: 'Whether notifications should emit sounds',
      visible: true,
      type: 'toggle',
      default: true,
      value: true,
    },
  },
};
