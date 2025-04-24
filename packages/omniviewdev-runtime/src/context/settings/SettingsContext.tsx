import React, { createContext, useState } from 'react';
import { Values } from '../../wailsjs/go/settings/provider';

// Define the context type
export interface SettingsContextType {
  settings: Record<string, any>;
  reload: () => void;
}

// Create the context with a default value
export const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

// Provider component
export const SettingsProvider = ({ children }: {
  children: React.ReactNode;
}) => {
  const [settings, setSettings] = useState<Record<string, any>>({});

  /**
   * Fetch the settings from the backend stores
   */
  const fetchSettings = () => {
    Values()
      .then((values) => {
        console.log('Fetched settings:', values);
        setSettings(values)
      })
      .catch((error) => {
        console.error('Error fetching settings:', error);
      })
  }

  React.useEffect(() => {
    fetchSettings();
  }, [])

  const reload = () => {
    fetchSettings();
  }

  return (
    <SettingsContext.Provider value={{ settings, reload }}>
      {children}
    </SettingsContext.Provider>
  );
};

