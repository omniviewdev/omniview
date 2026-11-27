import { createContext, useContext, type ReactNode } from 'react';
import type { NoticesBindings } from './host';

// The notices' bindings, handed down the shell's tree: the toast layer and the notification centre read their slice of the model through them. The model itself is framework-free (../core/notices); what owns it is
// whoever mounts the shell.

const NoticesContext = createContext<NoticesBindings | null>(null);

export function NoticesProvider({ notices, children }: { readonly notices: NoticesBindings | null; readonly children: ReactNode }) {
  return <NoticesContext value={notices}>{children}</NoticesContext>;
}

/** The notices of the shell this component is in. */
export function useNotices(): NoticesBindings {
  const notices = useContext(NoticesContext);
  if (notices === null) {
    throw new Error('A component of the toast layer or the notification centre was rendered outside a Shell that has notices.');
  }

  return notices;
}

/** The notices of the shell this component is in, or `null` where the window has none: a part of the frame that is there only with notices (the bell) asks this. */
export function useMaybeNotices(): NoticesBindings | null {
  return useContext(NoticesContext);
}
