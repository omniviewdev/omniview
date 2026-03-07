import { useState, useCallback } from 'react';
import type { HomepageCardConfig } from '@/features/extensions/homepage/types';

const STORAGE_KEY = 'omniview:homepage:cards';

type HomepageCardSettings = {
  order: string[];    // card IDs in display order; newly seen IDs appended
  hidden: string[];   // IDs to hide (blocklist); cards visible by default
  configs: Record<string, HomepageCardConfig>; // user overrides per card
};

const DEFAULT_SETTINGS: HomepageCardSettings = { order: [], hidden: [], configs: {} };

function readSettings(): HomepageCardSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_SETTINGS;
}

function writeSettings(s: HomepageCardSettings): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
}

export function useHomepageCardSettings() {
  const [settings, setSettingsState] = useState<HomepageCardSettings>(readSettings);

  const save = useCallback((next: HomepageCardSettings) => {
    writeSettings(next);
    setSettingsState(next);
  }, []);

  const setOrder = useCallback(
    (ids: string[]) => {
      save({ ...settings, order: ids });
    },
    [settings, save],
  );

  const toggleHidden = useCallback(
    (id: string) => {
      const hidden = settings.hidden.includes(id)
        ? settings.hidden.filter((h) => h !== id)
        : [...settings.hidden, id];
      save({ ...settings, hidden });
    },
    [settings, save],
  );

  const updateCardConfig = useCallback(
    (id: string, config: HomepageCardConfig) => {
      save({ ...settings, configs: { ...settings.configs, [id]: config } });
    },
    [settings, save],
  );

  const isHidden = useCallback(
    (id: string) => settings.hidden.includes(id),
    [settings],
  );

  const getCardConfig = useCallback(
    (id: string, defaultConfig: HomepageCardConfig): HomepageCardConfig => {
      return settings.configs[id] ?? defaultConfig;
    },
    [settings],
  );

  return { settings, setOrder, toggleHidden, updateCardConfig, isHidden, getCardConfig };
}
