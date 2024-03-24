import { type SettingsSection } from '@/store/settings/types';

export type GeneralSettings = SettingsSection;

export const initialState: GeneralSettings = {
  id: 'general',
  label: 'General',
  description: 'General settings for the overall application',
  icon: 'LuSettings2',
  settings: {
    language: {
      label: 'Language',
      description: 'The language to use for the application',
      visible: true,
      type: 'select',
      default: 'en',
      value: 'en',
      options: [
        { value: 'en', label: 'English' },
        { value: 'es', label: 'Spanish' },
        { value: 'fr', label: 'French' },
        { value: 'de', label: 'German' },
        { value: 'it', label: 'Italian' },
        { value: 'pt', label: 'Portuguese' },
        { value: 'ru', label: 'Russian' },
        { value: 'zh', label: 'Chinese' },
        { value: 'ja', label: 'Japanese' },
        { value: 'ko', label: 'Korean' },
      ],
    },
  },
};
