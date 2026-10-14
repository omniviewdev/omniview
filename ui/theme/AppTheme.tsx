import React, { useEffect, useState } from 'react';
import { ThemeProvider, useTheme } from '@omniviewdev/base-ui';
import { useSettings } from '@omniviewdev/runtime';

import { registerSolarizedTheme, SOLARIZED_THEME_ID } from './solarized';

registerSolarizedTheme();

const THEME_KEY = 'ov-theme-variant';

type ThemeId = 'dark' | typeof SOLARIZED_THEME_ID;

function toThemeId(value: unknown): ThemeId {
  return value === 'solarized' ? SOLARIZED_THEME_ID : 'dark';
}

/** Last applied theme, so the first paint matches before settings load. */
function readStoredTheme(): ThemeId {
  try {
    return toThemeId(localStorage.getItem(THEME_KEY));
  } catch {
    return 'dark';
  }
}

function storeTheme(value: ThemeId): void {
  try {
    localStorage.setItem(THEME_KEY, value === SOLARIZED_THEME_ID ? 'solarized' : 'default');
  } catch {
    // non-fatal in restricted storage environments
  }
}

/** Applies later changes of the `appearance.theme` setting to base-ui. */
function ThemeSettingSync({ appearanceTheme }: { appearanceTheme: unknown }) {
  const { theme, setTheme } = useTheme();

  useEffect(() => {
    if (typeof appearanceTheme !== 'string') {
      return;
    }

    const next = toThemeId(appearanceTheme);
    if (next !== theme) {
      setTheme(next);
    }

    storeTheme(next);
  }, [appearanceTheme, theme, setTheme]);

  return null;
}

/**
 * The app's theme root: base-ui's ThemeProvider (compact density, always a
 * dark theme), driven by the `appearance.theme` setting. Must be rendered
 * inside SettingsProvider.
 */
export default function AppTheme({ children }: { children: React.ReactNode }) {
  const { settings } = useSettings();
  const appearanceTheme = settings?.['appearance.theme'];
  // ThemeProvider applies its initial theme in an effect that runs after its
  // children's effects, so the first theme must come in through initialTheme.
  const [initialTheme] = useState<ThemeId>(() =>
    typeof appearanceTheme === 'string' ? toThemeId(appearanceTheme) : readStoredTheme(),
  );

  return (
    <ThemeProvider initialTheme={initialTheme} initialDensity="compact" persist={false}>
      <ThemeSettingSync appearanceTheme={appearanceTheme} />
      {children}
    </ThemeProvider>
  );
}
