import React from 'react';
import { SettingsContext, SettingsContextType } from '../../context/settings/SettingsContext';

// Hook to use the settings context
export const useSettings = () => {
  const context = React.useContext(SettingsContext);
  if (!context) {
    throw new Error('useSettings must be used within a SettingsProvider');
  }
  return context as SettingsContextType;
};
