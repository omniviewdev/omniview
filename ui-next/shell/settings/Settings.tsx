import { useSyncExternalStore } from 'react';
import { useSettings } from './context';
import { useSettingsChords } from './useSettingsChords';

/**
 * Settings in a window: the chord that opens it, always, and the sheet only while it is open. A closed sheet draws nothing, holds no timer and listens to nothing but that one chord; opening it fetches the sheet's code (the
 * first time) and mounts it, and closing unmounts it and everything it started (`host.ts`).
 */
export function Settings() {
  const control = useSettings();
  const state = useSyncExternalStore(control.subscribe, control.getSnapshot);
  useSettingsChords(control);
  if (!state.open) {
    return null;
  }

  const { Surface } = state.module;
  return <Surface session={state.session} page={control.page} onClose={control.close} />;
}
