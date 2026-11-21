import { createContext, useContext, type ReactNode } from 'react';
import type { NoticesBindings } from './host';

// The notices' bindings, handed down the shell's tree: the toast layer reads its slice of the model through them. The model itself is framework-free (../core/notices); what owns it is whoever mounts the shell.

const NoticesContext = createContext<NoticesBindings | null>(null);

export function NoticesProvider({ notices, children }: { readonly notices: NoticesBindings; readonly children: ReactNode }) {
  return <NoticesContext value={notices}>{children}</NoticesContext>;
}

/** The notices of the shell this component is in. */
export function useNotices(): NoticesBindings {
  const notices = useContext(NoticesContext);
  if (notices === null) {
    throw new Error('A component of the toast layer was rendered outside a Shell that has notices.');
  }

  return notices;
}
