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

  const save = useCallback((updater: (prev: HomepageCardSettings) => HomepageCardSettings) => {
    setSettingsState((prev) => {
      const next = updater(prev);
      writeSettings(next);
      return next;
    });
  }, []);

  const setOrder = useCallback(
    (ids: string[]) => {
      save((prev) => ({ ...prev, order: ids }));
    },
    [save],
  );

  const toggleHidden = useCallback(
    (id: string) => {
      save((prev) => {
        const hidden = prev.hidden.includes(id)
          ? prev.hidden.filter((h) => h !== id)
          : [...prev.hidden, id];
        return { ...prev, hidden };
      });
    },
    [save],
  );

  const updateCardConfig = useCallback(
    (id: string, config: HomepageCardConfig) => {
      save((prev) => ({ ...prev, configs: { ...prev.configs, [id]: config } }));
    },
    [save],
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
