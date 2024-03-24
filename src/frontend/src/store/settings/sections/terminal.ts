import { type SettingsSection } from '@/store/settings/types';

export type TerminalSettings = SettingsSection;

export const initialState: TerminalSettings = {
  id: 'terminal',
  label: 'Terminal',
  description: 'Customize the terminal',
  icon: 'LuTerminalSquare',
  settings: {
    defaultShell: {
      label: 'Default Shell',
      description: 'The default shell to use for new terminals',
      visible: true,
      type: 'text',
      default: '/bin/sh',
      value: '/bin/sh',
    },
    theme: {
      label: 'Theme',
      description: 'Choose a theme for the terminal',
      visible: true,
      type: 'select',
      default: 'default',
      value: 'default',
      options: [
        { value: 'default', label: 'Default' },
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
      ],
    },
    fontSize: {
      label: 'Font Size',
      description: 'Set the font size for the terminal',
      visible: true,
      type: 'integer',
      default: 14,
      value: 14,
    },
    fontFamily: {
      label: 'Font Family',
      description: 'Set the font family for the terminal',
      visible: true,
      type: 'select',
      default: 'monospace',
      value: 'monospace',
      options: [
        { value: 'monospace', label: 'Monospace' },
        { value: 'sans-serif', label: 'Sans Serif' },
        { value: 'serif', label: 'Serif' },
      ],
    },
    fontWeight: {
      label: 'Font Weight',
      description: 'Set the font weight for the terminal',
      visible: true,
      type: 'select',
      default: 'normal',
      value: 'normal',
      options: [
        { value: 'normal', label: 'Normal' },
        { value: 'bold', label: 'Bold' },
      ],
    },
    cursorStyle: {
      label: 'Cursor Style',
      description: 'Set the cursor style for the terminal',
      visible: true,
      type: 'select',
      default: 'block',
      value: 'block',
      options: [
        { value: 'block', label: 'Block' },
        { value: 'underline', label: 'Underline' },
        { value: 'bar', label: 'Bar' },
      ],
    },
    cursorWidth: {
      label: 'Cursor Width',
      description: 'Set the cursor width for the terminal',
      visible: true,
      type: 'integer',
      default: 2,
      value: 2,
    },
    cursorBlink: {
      label: 'Cursor Blink',
      description: 'Enable or disable cursor blinking for the terminal',
      visible: true,
      type: 'toggle',
      default: true,
      value: true,
    },
  },
};
