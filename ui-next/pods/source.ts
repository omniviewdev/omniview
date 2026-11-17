import type { PodRow, PodsFailureKind, PodsView } from '../k8s';

// What the Pods data layer tells the list page, in the page's words. The page is the host's and this directory is the Kubernetes scaffolding, which
// imports nothing from it (docs/ui-next/AGENTS.md rule 15): the shape below is the host's `ListSource<PodRow>` written out, and the one place the two
// meet, the mount point in `ui-next/main.tsx`, checks them against each other.

export type PodsListSourceState =
  | { readonly kind: 'loading' }
  | { readonly kind: 'ready' }
  | { readonly kind: 'failed'; readonly message?: string | undefined; readonly retry?: (() => void) | undefined };

export type PodsListSource = {
  readonly state: PodsListSourceState;
  readonly rows: readonly PodRow[];
  readonly complete: boolean;
  readonly refreshing: boolean;
  readonly refresh: () => Promise<void>;
};

/** What each failure means when the runtime sent no words of its own. */
const SENTENCE: Readonly<Record<PodsFailureKind | 'not-found', string>> = {
  'needs-sign-in': 'The connection needs you to sign in.',
  denied: 'You do not have access to list Pods.',
  unreachable: 'The cluster did not answer.',
  unsupported: 'This cluster does not serve Pods.',
  failed: 'Pods could not be read.',
  'not-found': 'This connection no longer exists.',
};

function failed(kind: PodsFailureKind | 'not-found', message: string | undefined, view: PodsView): PodsListSourceState {
  const said = message ?? SENTENCE[kind];
  // Where asking again cannot help (a cluster that serves no Pods, a connection that is gone) a Retry would be a button that does nothing.
  if (kind === 'unsupported' || kind === 'not-found') {
    return { kind: 'failed', message: said };
  }

  return {
    kind: 'failed',
    message: said,
    retry: () => {
      void view.retry();
    },
  };
}

function stateOf(view: PodsView): PodsListSourceState {
  const { state, failure } = view;
  switch (state.kind) {
    // The page starts a connection it finds stopped (a dev shortcut that 1a.7 removes), so a stopped one is a wait.
    case 'connecting':
    case 'disconnected':
    case 'loading':
      return { kind: 'loading' };
    case 'empty':
      return { kind: 'ready' };
    case 'loaded':
      // A failure that came after rows is kept beside them: the page keeps listing and does not call a refresh an update.
      return failure === undefined ? { kind: 'ready' } : failed(failure.kind, failure.message, view);
    case 'unsupported':
      return failed('unsupported', undefined, view);
    case 'needs-sign-in':
    case 'denied':
    case 'unreachable':
    case 'not-found':
    case 'failed':
      return failed(state.kind, state.message, view);
  }
}

/** The Pods view as the list page's source. */
export function podsListSource(view: PodsView): PodsListSource {
  return { state: stateOf(view), rows: view.rows, complete: view.complete, refreshing: view.refreshing, refresh: view.refresh };
}
