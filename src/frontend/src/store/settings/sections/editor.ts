import { SettingsSection } from '@/store/settings/types';

export type EditorSettings = SettingsSection;

export const initialState: EditorSettings = {
  id: 'editor',
  label: 'Editor',
  description: 'Customize the code editor',
  icon: 'LuCode2',
  settings: {
    theme: {
      label: 'Theme',
      description: 'Choose a theme for the code editor',
      visible: true,
      type: 'select',
      default: 'default',
      value: 'default',
      options: [
        { value: 'default', label: 'Default' },
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
      ]
    },
    fontSize: {
      label: 'Font Size',
      description: 'Set the font size for the code editor',
      visible: true,
      type: 'integer',
      default: 14,
      value: 14,
    },
    fontFamily: {
      label: 'Font Family',
      description: 'Set the font family for the code editor',
      visible: true,
      type: 'select',
      default: 'monospace',
      value: 'monospace',
      options: [
        { value: 'monospace', label: 'Monospace' },
        { value: 'sans-serif', label: 'Sans-serif' },
        { value: 'serif', label: 'Serif' },
      ]
    },
    tabSize: {
      label: 'Tab Size',
      description: 'Set the tab size for the code editor',
      visible: true,
      type: 'integer',
      default: 2,
      value: 2,
    },
    wordWrap: {
      label: 'Word Wrap',
      description: 'Enable or disable word wrapping for the code editor',
      visible: true,
      type: 'select',
      default: 'off',
      value: 'off',
      options: [
        { value: 'off', label: 'Off' },
        { value: 'on', label: 'On' },
        { value: 'wordWrapColumn', label: 'Word Wrap Column' },
        { value: 'bounded', label: 'Bounded' },
      ]
    },
    lineNumbers: {
      label: 'Line Numbers',
      description: 'Enable or disable line numbers for the code editor',
      visible: true,
      type: 'select',
      default: 'on',
      value: 'on',
      options: [
        { value: 'on', label: 'On' },
        { value: 'off', label: 'Off' },
      ]
    },
  },
} 
