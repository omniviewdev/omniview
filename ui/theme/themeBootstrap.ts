import {
  isBuiltInThemeId,
  type BuiltInThemeId,
} from '@omniviewdev/base-ui';

const BOOTSTRAP_KEY = 'ov-theme-bootstrap-v1';
const LEGACY_VARIANT_KEY = 'ov-theme-variant';
const LEGACY_MODE_KEY = 'ov-theme-mode';

interface ThemeBootstrapRecordV1 {
  schemaVersion: 1;
  themeId: BuiltInThemeId;
}

function readVersionedTheme(storage: Storage): BuiltInThemeId | null {
  try {
    const raw = storage.getItem(BOOTSTRAP_KEY);
    if (raw === null) return null;

    const record: unknown = JSON.parse(raw);
    if (
      typeof record !== 'object'
      || record === null
      || !('schemaVersion' in record)
      || record.schemaVersion !== 1
      || !('themeId' in record)
      || typeof record.themeId !== 'string'
      || !isBuiltInThemeId(record.themeId)
    ) {
      return null;
    }

    return record.themeId;
  } catch {
    return null;
  }
}

export function readLegacyPaintHint(storage: Storage): BuiltInThemeId | null {
  try {
    const variant = storage.getItem(LEGACY_VARIANT_KEY);
    if (variant === 'solarized') return 'solarized-dark';
    if (variant === 'default') return 'void';

    const mode = storage.getItem(LEGACY_MODE_KEY);
    return mode !== null && isBuiltInThemeId(mode) ? mode : null;
  } catch {
    return null;
  }
}

export function readBootstrapTheme(storage: Storage): BuiltInThemeId {
  return readVersionedTheme(storage) ?? readLegacyPaintHint(storage) ?? 'void';
}

export function writeBootstrapTheme(storage: Storage, selectedId: string): void {
  const record: ThemeBootstrapRecordV1 = {
    schemaVersion: 1,
    themeId: isBuiltInThemeId(selectedId) ? selectedId : 'void',
  };

  try {
    storage.setItem(BOOTSTRAP_KEY, JSON.stringify(record));
  } catch {
    // The backend setting remains authoritative when storage is unavailable.
  }
}

export function clearLegacyThemeKeys(storage: Storage): void {
  try {
    storage.removeItem(LEGACY_VARIANT_KEY);
  } catch {
    // Legacy cache cleanup is best-effort in restricted storage environments.
  }

  try {
    storage.removeItem(LEGACY_MODE_KEY);
  } catch {
    // Legacy cache cleanup is best-effort in restricted storage environments.
  }
}
