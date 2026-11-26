import { createContext, useContext, type ReactNode } from 'react';
import type { PanelBindings } from './host';
import { PanelRenaming } from './renaming';

// The panel's bindings, handed down the shell's tree: the toggle, the strip and each body read their own slice of the model through them (./hooks.ts). The model itself is framework-free
// (../core/panel); what owns it is whoever mounts the shell.

const PanelContext = createContext<PanelBindings | null>(null);

export function PanelProvider({ panel, children }: { readonly panel: PanelBindings; readonly children: ReactNode }) {
  return (
    <PanelContext value={panel}>
      <PanelRenaming>{children}</PanelRenaming>
    </PanelContext>
  );
}

/** The panel of the shell this component is in. */
export function usePanel(): PanelBindings {
  const panel = useContext(PanelContext);
  if (panel === null) {
    throw new Error('A component of the panel was rendered outside a Shell that has one.');
  }

  return panel;
}

/** The panel of the shell this component is in, or `null` when the shell has none: the status bar draws a toggle only for a window that has a panel. */
export function useMaybePanel(): PanelBindings | null {
  return useContext(PanelContext);
}
