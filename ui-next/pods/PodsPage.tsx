import { ActivityProvider, useConnections } from '@omniviewdev/runtime';
import { useEffect, type ReactNode } from 'react';
import { usePods, type PodRow } from '../k8s';
import { podsListDefinition } from './listDefinition';
import { podsShellRegistration, type PodsShellRegistration } from './shellRegistration';
import { podsListSource, type PodsListSource } from './source';

// The Pods screen as the host mounts it: the data (which connection, which Pods, in what state) and the page's definition, handed to whatever draws
// them. This directory is scaffolding and imports nothing from the host's page or shell, so the screen does not draw itself: it calls `children` with
// plain data, and the mount point in `ui-next/main.tsx` hands that to the host's `Shell` and `ListPage`, whose types check it there.

const PLUGIN_ID = 'kubernetes';

/** What the screen hands the host: how it sits in the frame, what the page lists, and the rows and the state it lists them in. */
export type PodsPageParts = {
  readonly registration: PodsShellRegistration;
  readonly definition: typeof podsListDefinition;
  readonly source: PodsListSource;
};

type PodsPageProps = {
  /** The connection the URL names (`?connection=`), if it names one. A name the plugin does not know, or none, takes the plugin's first connection. */
  readonly connection: string | undefined;
  readonly children: (parts: PodsPageParts) => ReactNode;
};

const NO_ROWS: readonly PodRow[] = [];
const refreshNothing = async (): Promise<void> => undefined;
/** The connections are on their way: the page is loading, with nothing to list. */
const WAITING: PodsListSource = { state: { kind: 'loading' }, rows: NO_ROWS, complete: false, refreshing: false, refresh: refreshNothing };
/** The plugin has no connection (or is not installed): there is nothing to read, and nothing to retry. */
const NO_CONNECTIONS: PodsListSource = { ...WAITING, state: { kind: 'failed', message: 'No connections' } };

type ConnectedProps = PodsPageProps & { readonly connectionID: string };

// The read chain is `usePods`: the catalog, the resolved target, then the collection of its source view, live when the type advertises it, exactly as
// the old table reads it. A connection is never started by a read, so this page starts the one it finds stopped, once: a development shortcut that
// 1a.7 removes in favour of an explicit Connect (plan D4).
function Connected({ connection, connectionID, children }: ConnectedProps): ReactNode {
  const view = usePods({ connectionID });
  const { state, connect } = view;
  useEffect(() => {
    if (state.kind === 'disconnected') {
      void connect();
    }
  }, [state.kind, connect]);

  return children({ registration: podsShellRegistration(connection), definition: podsListDefinition, source: podsListSource(view) });
}

function Connection({ connection, children }: PodsPageProps): ReactNode {
  const { connections } = useConnections({ plugin: PLUGIN_ID });
  const list = connections.data ?? [];
  const chosen = list.find((candidate) => candidate.id === connection) ?? list[0];
  if (chosen === undefined) {
    return children({ registration: podsShellRegistration(connection), definition: podsListDefinition, source: connections.isPending ? WAITING : NO_CONNECTIONS });
  }

  // Keyed by the connection: another connection is another page, with none of the first one's reads or state.
  return (
    <Connected key={chosen.id} connection={connection} connectionID={chosen.id}>
      {children}
    </Connected>
  );
}

/** The QueryClient is the host's: `ui-next/main.tsx` mounts the one the shell owns (docs/ui-next/optimisations.md RTM-14, MNR-D8). */
export function PodsPage({ connection, children }: PodsPageProps) {
  return (
    <ActivityProvider>
      <Connection connection={connection}>{children}</Connection>
    </ActivityProvider>
  );
}
