import type { ThemeDensity, ThemeTextSize } from '@omniviewdev/base-ui';
import { readProfileStorage, writeProfileStorage } from '@/features/instance/boot';

export type MotionPreference = 'system' | 'normal' | 'reduced';
export type AppearancePreferences = {
  density: ThemeDensity;
  textSize: ThemeTextSize;
  motion: MotionPreference;
};

const BOOTSTRAP_KEY = 'ov-appearance-bootstrap-v1';
export const DEFAULT_APPEARANCE: AppearancePreferences = {
  density: 'comfortable', textSize: '100', motion: 'system',
};

export function resolveAppearance(values: Record<string, unknown>, fallback = DEFAULT_APPEARANCE): AppearancePreferences {
  return {
    density: values.density === 'compact' || values.density === 'comfortable' ? values.density : fallback.density,
    textSize: values.textSize === '80' || values.textSize === '90' || values.textSize === '100' || values.textSize === '110' || values.textSize === '125' ? values.textSize : fallback.textSize,
    motion: values.motion === 'system' || values.motion === 'normal' || values.motion === 'reduced' ? values.motion : fallback.motion,
  };
}

export function readAppearanceBootstrap(storage: Storage | null): AppearancePreferences {
  if (storage === null) return DEFAULT_APPEARANCE;
  try {
    const record: unknown = JSON.parse(readProfileStorage(BOOTSTRAP_KEY, storage) ?? 'null');
    if (typeof record !== 'object' || record === null || !('schemaVersion' in record) || record.schemaVersion !== 1) {
      return DEFAULT_APPEARANCE;
    }
    return resolveAppearance(record as Record<string, unknown>);
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function writeAppearanceBootstrap(storage: Storage | null, preferences: AppearancePreferences): void {
  if (storage === null) return;
  try {
    writeProfileStorage(BOOTSTRAP_KEY, JSON.stringify({ schemaVersion: 1, ...preferences }), storage);
  } catch {
    // Backend settings remain authoritative when the paint cache is unavailable.
  }
}
