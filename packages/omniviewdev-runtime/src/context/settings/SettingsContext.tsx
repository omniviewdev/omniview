import React, { createContext, useMemo } from 'react';
import { HOST_SETTINGS_SCOPE, scopedSettingID, useScopedSettings } from '../../hooks/settings/useScopedSettings';

export interface SettingsContextType {
  settings: Record<string, any>;
}

export const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: React.ReactNode }) => {
  const { categories } = useScopedSettings(HOST_SETTINGS_SCOPE);
  const settings = useMemo(() => {
    const values: Record<string, unknown> = {};
    for (const [categoryID, category] of Object.entries(categories)) {
      for (const [id, setting] of Object.entries(category?.settings ?? {})) {
        if (setting) values[scopedSettingID(HOST_SETTINGS_SCOPE, categoryID, id)] = setting.value;
      }
    }
    return values;
  }, [categories]);
  return <SettingsContext.Provider value={{ settings }}>{children}</SettingsContext.Provider>;
};
