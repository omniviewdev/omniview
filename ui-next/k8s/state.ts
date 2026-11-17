import { ErrorTypes, isCancelledError, parseAppError, type ConnectionReadinessPhase, type HostSourceStatus } from '@omniviewdev/runtime/ui/v1';

// What the Pods list says about the connection and the read, mapped from what the runtime hooks return (docs/ui-next/status/1a.2.md
// has the capture from the real host). The runtime reports a connection through `useConnectionReadiness`, and a read through the
// errors of the catalog, the target and the collection, and the status of the collection's source.

export type PodsFailureKind = 'needs-sign-in' | 'denied' | 'unreachable' | 'unsupported' | 'failed';

export type PodsFailure = {
  readonly kind: PodsFailureKind;
  /** The runtime's own sanitized text; the kind is what a page words. */
  readonly message?: string;
};

/** What the body of the list shows. */
export type PodsState =
  /** The runtime checks or starts the connection. */
  | { readonly kind: 'connecting' }
  /** The connection is stopped. A read never starts it: the caller offers Connect (plan D4). */
  | { readonly kind: 'disconnected' }
  | { readonly kind: 'needs-sign-in'; readonly message?: string }
  | { readonly kind: 'denied'; readonly message?: string }
  | { readonly kind: 'unreachable'; readonly message?: string }
  /** The runtime knows no such connection (removed while the page was open). */
  | { readonly kind: 'not-found'; readonly message?: string }
  /** The connection is fine and the read failed for another reason. */
  | { readonly kind: 'failed'; readonly message?: string }
  /** The cluster does not serve Pods. */
  | { readonly kind: 'unsupported' }
  /** Connected; the catalog, the target or the first rows are on their way. */
  | { readonly kind: 'loading' }
  /** The complete set is empty. */
  | { readonly kind: 'empty' }
  /** There are rows, complete or not. */
  | { readonly kind: 'loaded' };

/** What the runtime hooks returned, as plain data. An `error` of `null` or `undefined` is no error. */
export type PodsReads = {
  readonly phase: ConnectionReadinessPhase;
  /** `useConnectionReadiness().message`. */
  readonly message: string | undefined;
  readonly catalog: { readonly loaded: boolean; readonly offersPods: boolean; readonly error: unknown };
  readonly target: { readonly error: unknown };
  /** The collection: its query error, and the status of its source. */
  readonly read: { readonly error: unknown; readonly source: HostSourceStatus | undefined };
  /** Rows available to show: the first set, or the complete set. */
  readonly rows: number;
  readonly complete: boolean;
};

const WHOLE = { failure: undefined } as const;

/**
 * How an error files, by the status the host's error carries (`parseAppError` decodes what Wails and the SDK deliver). A cancelled
 * read is no failure: the runtime cancels every read of a connection that changes.
 */
export function podsFailure(error: unknown): PodsFailure | undefined {
  if (error === null || error === undefined || isCancelledError(error)) {
    return undefined;
  }

  const { type, status, recovery, detail } = parseAppError(error);
  // The server did not answer: the host says so by its type, its status, or by asking for a reconnect.
  const unanswered = recovery === 'reconnect' || type === ErrorTypes.CONNECTION_FAILED || type === ErrorTypes.RESOURCE_TIMEOUT || status === 502 || status === 503 || status === 504;
  const kind: PodsFailureKind
    = status === 401 ? 'needs-sign-in'
      : status === 403 ? 'denied'
        : status === 501 ? 'unsupported'
          : unanswered ? 'unreachable'
            : 'failed';
  return { kind, message: detail };
}

/** A source that fails after it opened says so in its status, not in the error of the query. */
const sourceError = (source: HostSourceStatus | undefined): unknown => (source?.state === 'failed' ? source.error : undefined);

/**
 * The state of the body, and the failure to show beside rows that are kept. A failure with rows does not replace the list (plan 1.4);
 * without rows it is the state. Nothing is read before the connection is ready: an old error or count never speaks for a connection
 * the runtime has since replaced.
 */
export function readPodsState(reads: PodsReads): { readonly state: PodsState; readonly failure: PodsFailure | undefined } {
  switch (reads.phase) {
    case 'checking':
    case 'connecting':
      return { state: { kind: 'connecting' }, ...WHOLE };
    case 'disconnected':
      return { state: { kind: 'disconnected' }, ...WHOLE };
    case 'unauthorized':
      return { state: { kind: 'needs-sign-in', message: reads.message }, ...WHOLE };
    case 'forbidden':
      return { state: { kind: 'denied', message: reads.message }, ...WHOLE };
    case 'not-found':
      return { state: { kind: 'not-found', message: reads.message }, ...WHOLE };
    case 'error':
      return { state: { kind: 'unreachable', message: reads.message }, ...WHOLE };
    case 'connected':
      break;
  }

  const failure
    = podsFailure(reads.catalog.error) ?? podsFailure(reads.target.error) ?? podsFailure(reads.read.error) ?? podsFailure(sourceError(reads.read.source));
  if (failure !== undefined) {
    return reads.rows > 0 ? { state: { kind: 'loaded' }, failure } : { state: { kind: failure.kind, message: failure.message }, ...WHOLE };
  }

  if (reads.catalog.loaded && !reads.catalog.offersPods) {
    return { state: { kind: 'unsupported' }, ...WHOLE };
  }

  if (reads.rows > 0) {
    return { state: { kind: 'loaded' }, ...WHOLE };
  }

  return { state: reads.complete ? { kind: 'empty' } : { kind: 'loading' }, ...WHOLE };
}
