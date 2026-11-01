import { createContext } from 'react';

export enum Section {
  Core = 'core',
  Plugins = 'plugins',
  Extensions = 'extensions',
  AITools = 'ai-tools',
}

export type SectionSelection = {
  section: Section;
  /** Category or plugin ID within the selected section. */
  id: string;
};

type SettingsFocusRequest = {
  settingId: string;
  requestKey: string;
};

export const SettingsFocusContext = createContext<SettingsFocusRequest | null>(null);

/** Dismisses the retained window without discarding mounted form drafts. */
export const SettingsCloseContext = createContext<(() => void) | undefined>(undefined);
