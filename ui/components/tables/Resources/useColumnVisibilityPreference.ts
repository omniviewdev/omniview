import { useEffect, useState } from 'react';
import type { ColumnVisibilityState } from '@tanstack/react-table';

import { readProfileStorage, writeProfileStorage } from '@/features/instance/boot';

/** Add the declared defaults of columns the visibility state has not seen. Reuses `current` when none are new. */
function withDeclaredColumns(current: ColumnVisibilityState, defaults: ColumnVisibilityState | undefined): ColumnVisibilityState {
  if (defaults === undefined) {
    return current;
  }

  let merged = current;
  for (const [id, visible] of Object.entries(defaults)) {
    if (!Object.hasOwn(current, id)) {
      if (merged === current) {
        merged = { ...current };
      }

      merged[id] = visible;
    }
  }

  return merged;
}

/** The profile's saved choice, if it is a visibility object. A damaged entry counts as no choice. */
function readSavedVisibility(storageKey: string): ColumnVisibilityState | undefined {
  const saved = readProfileStorage(storageKey);
  if (saved === null) {
    return undefined;
  }

  try {
    const parsed: unknown = JSON.parse(saved);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)
      ? parsed as ColumnVisibilityState
      : undefined;
  } catch {
    return undefined;
  }
}

/** Saved choices win. Columns declared since the choice was saved start at their declared default. */
function restoreVisibility(storageKey: string, defaults: ColumnVisibilityState | undefined): ColumnVisibilityState {
  if (defaults === undefined) {
    return {};
  }

  return withDeclaredColumns(readSavedVisibility(storageKey) ?? {}, defaults);
}

/**
 * Column visibility for one resource table, kept in the profile's storage under `storageKey`.
 *
 * The first render already shows the restored columns, so hidden columns never mount. When the
 * provider declares more columns later, those join the current choices; nothing the user toggled
 * is reset. A different `storageKey` restores that table's saved choices.
 */
export function useColumnVisibilityPreference(
  storageKey: string,
  defaults: ColumnVisibilityState | undefined,
) {
  const [visibility, setVisibility] = useState(() => restoreVisibility(storageKey, defaults));
  const [source, setSource] = useState({ storageKey, defaults });
  if (source.storageKey !== storageKey || source.defaults !== defaults) {
    setSource({ storageKey, defaults });
    setVisibility(source.storageKey === storageKey
      ? withDeclaredColumns(visibility, defaults)
      : restoreVisibility(storageKey, defaults));
  }

  useEffect(() => {
    const serialized = JSON.stringify(visibility);
    if (serialized !== '{}') {
      writeProfileStorage(storageKey, serialized);
    }
  }, [visibility, storageKey]);

  return [visibility, setVisibility] as const;
}
