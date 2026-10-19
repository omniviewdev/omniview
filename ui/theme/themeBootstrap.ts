import {
  isBuiltInThemeId,
  type BuiltInThemeId,
} from '@omniviewdev/base-ui';
import {
  getBootIdentity,
  readProfileStorage,
  removeProfileStorage,
  writeProfileStorage,
} from '@/features/instance/boot';

const BOOTSTRAP_KEY = 'ov-theme-bootstrap-v1';
const LEGACY_VARIANT_KEY = 'ov-theme-variant';
const LEGACY_MODE_KEY = 'ov-theme-mode';

type ThemeBootstrapRecordV1 = {
  schemaVersion: 1;
  themeId: BuiltInThemeId;
};

function readVersionedTheme(storage: Storage): BuiltInThemeId | null {
  try {
    const raw = readProfileStorage(BOOTSTRAP_KEY, storage);
    if (raw === null) {
      return null;
    }

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
  if (getBootIdentity()?.kind !== 'production') {
    return null;
  }

  try {
    const variant = readProfileStorage(LEGACY_VARIANT_KEY, storage);
    if (variant === 'solarized') {
      return 'solarized-dark';
    }

    if (variant === 'default') {
      return 'void';
    }

    const mode = readProfileStorage(LEGACY_MODE_KEY, storage);
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
    writeProfileStorage(BOOTSTRAP_KEY, JSON.stringify(record), storage);
  } catch {
    // The backend setting remains authoritative when storage is unavailable.
  }
}

export function clearLegacyThemeKeys(storage: Storage): void {
  if (getBootIdentity()?.kind !== 'production') {
    return;
  }

  removeProfileStorage(LEGACY_VARIANT_KEY, storage);
  removeProfileStorage(LEGACY_MODE_KEY, storage);
}
