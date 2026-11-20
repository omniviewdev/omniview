import { createContext, useContext, type ReactNode } from 'react';
import type { PaletteBindings } from './host';

// The palette's bindings, handed down the shell's tree: the top row's Search control, the chords and the surface read their own slice of the model through them (./hooks.ts). The model itself is
// framework-free (../core/palette); what owns it is whoever mounts the shell.

const PaletteContext = createContext<PaletteBindings | null>(null);

export function PaletteProvider({ palette, children }: { readonly palette: PaletteBindings; readonly children: ReactNode }) {
  return <PaletteContext value={palette}>{children}</PaletteContext>;
}

/** The palette of the shell this component is in. */
export function usePalette(): PaletteBindings {
  const palette = useContext(PaletteContext);
  if (palette === null) {
    throw new Error('A component of the palette was rendered outside a Shell that has one.');
  }

  return palette;
}

/** The palette of the shell this component is in, or `null` when the shell has none: the top row draws a Search control only for a window that has a palette. */
export function useMaybePalette(): PaletteBindings | null {
  return useContext(PaletteContext);
}
