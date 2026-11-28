import { Suspense, useContext, useLayoutEffect, useSyncExternalStore } from 'react';
import { ContributionBoundary } from './ContributionBoundary';
import { ExtensionMenuNavigationContext } from './extensionMenuNavigation';
import type { TerminalExtensionMenu, TerminalMenuOpening } from './terminalExtensionMenu';
import styles from '../../shell/panel/Panel.module.css';

function OwnerOutlet({ opening }: { readonly opening: TerminalMenuOpening }) {
  const { useOutlet, origin } = opening;
  const outlet = useOutlet(origin);
  const navigation = useContext(ExtensionMenuNavigationContext);
  // A hook can return a new projection without replacing its object. Validate every committed showing, never a speculative render.
  useLayoutEffect(() => {
    opening.publish(outlet, navigation);
  });
  return null;
}

function Unavailable({ opening }: { readonly opening: TerminalMenuOpening }) {
  useLayoutEffect(() => {
    opening.publish(undefined, null);
  }, [opening]);
  return null;
}

/** One host-owned result and one owner-only adapter for the invoked terminal, never one per mounted xterm or tab. */
export function TerminalMenuContent({ menu }: { readonly menu: TerminalExtensionMenu }) {
  const state = useSyncExternalStore(menu.subscribe, menu.getSnapshot);
  useLayoutEffect(() => () => {
    menu.dismiss();
  }, [menu]);
  if (!state) {
    return null;
  }

  const { opening, status } = state;
  return <>
    <ContributionBoundary key={opening.key} name="terminal menu" fallback={() => <Unavailable opening={opening} />}>
      <Suspense fallback={<Unavailable opening={opening} />}><OwnerOutlet opening={opening} /></Suspense>
    </ContributionBoundary>
    <div role="status" aria-label={`Terminal information: ${opening.title}`} aria-live="polite" aria-atomic="true" className={status === undefined ? undefined : styles.menuStatus}>
      {status !== undefined && <><strong>{opening.title}: </strong><span>{status}</span></>}
    </div>
  </>;
}
