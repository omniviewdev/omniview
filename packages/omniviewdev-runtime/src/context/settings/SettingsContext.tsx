import React, { createContext, useCallback, useRef, useState } from 'react';
import { Events } from '@wailsio/runtime';
import { Values } from '../../bindings/github.com/omniviewdev/omniview/internal/settings/servicewrapper';

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
  const requestGeneration = useRef(0);

  /**
   * Fetch the settings from the backend stores
   */
  const fetchSettings = useCallback((): void => {
    const generation = requestGeneration.current + 1;
    requestGeneration.current = generation;

    Values()
      .then((values) => {
        if (generation !== requestGeneration.current) {
          return;
        }

        setSettings(values);
      })
      .catch((error: unknown) => {
        if (generation !== requestGeneration.current) {
          return;
        }

        console.error('Error fetching settings:', error);
      });
  }, []);

  React.useEffect(() => {
    const unsubscribe = Events.On('settings/changed', () => fetchSettings());
    fetchSettings();
    return () => {
      requestGeneration.current += 1;
      unsubscribe();
    };
  }, [fetchSettings]);

  const reload = useCallback((): void => {
    fetchSettings();
  }, [fetchSettings]);

  return (
    <SettingsContext.Provider value={{ settings, reload }}>
      {children}
    </SettingsContext.Provider>
  );
};

