import { createContext, useContext, type ReactNode } from 'react';
import type { SettingsControl } from './host';

// The control of Settings, handed down the shell's tree: the top row's gear and the chord read it through here, and the host's palette command calls the same one. What owns it is whoever mounts the shell.

const SettingsContext = createContext<SettingsControl | null>(null);

export function SettingsProvider({ settings, children }: { readonly settings: SettingsControl; readonly children: ReactNode }) {
  return <SettingsContext value={settings}>{children}</SettingsContext>;
}

/** The Settings control of the shell this component is in. */
export function useSettings(): SettingsControl {
  const settings = useContext(SettingsContext);
  if (settings === null) {
    throw new Error('A component of Settings was rendered outside a Shell that has it.');
  }

  return settings;
}

/** The Settings control of the shell this component is in, or `null` when the shell has none: the top row draws the gear only for a window that can open Settings. */
export function useMaybeSettings(): SettingsControl | null {
  return useContext(SettingsContext);
}
