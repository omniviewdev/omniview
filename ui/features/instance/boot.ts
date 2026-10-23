export type BootIdentity = Readonly<{
  schemaVersion: 1;
  instanceID: string;
  displayName: string;
  generation: string;
  kind: 'development' | 'production';
}>;

// index.html captures and validates identity before the first cache read. Never
// derive a profile from Vite mode, origin, or a descriptor that arrives later.
export function getBootIdentity(): BootIdentity | null {
  return window.__OMNIVIEW_BOOTSTRAP__?.identity ?? null;
}

export function profileStorageKey(key: string): string | null {
  return window.__OMNIVIEW_BOOTSTRAP__?.storageKey(key) ?? null;
}

export function readProfileStorage(key: string, storage?: Storage): string | null {
  const scopedKey = profileStorageKey(key);
  if (scopedKey === null) {
    return null;
  }

  try {
    return (storage ?? window.localStorage).getItem(scopedKey);
  } catch {
    return null;
  }
}

export function writeProfileStorage(key: string, value: string, storage?: Storage): void {
  const scopedKey = profileStorageKey(key);
  if (scopedKey === null) {
    return;
  }

  try {
    (storage ?? window.localStorage).setItem(scopedKey, value);
  } catch {
    // Browser storage is only a best-effort UI cache, not canonical backend state.
  }
}

export function removeProfileStorage(key: string, storage?: Storage): void {
  const scopedKey = profileStorageKey(key);
  if (scopedKey === null) {
    return;
  }

  try {
    (storage ?? window.localStorage).removeItem(scopedKey);
  } catch {
    // A restricted browser must still render the application.
  }
}
