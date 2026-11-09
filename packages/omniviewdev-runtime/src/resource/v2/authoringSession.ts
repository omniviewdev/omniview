// Transport discipline for host completion: one in-flight request per document,
// UTF-16 -> UTF-8 cursor conversion, identity expectations, and a stale-response
// check. No schema logic lives here.
import type { CancellablePromise } from '@wailsio/runtime';
import { parseAppError } from '../../errors/parseAppError';
import {
  AUTHORING_VERSION,
  PREDICATE_PROFILE,
  UNIT_UTF8_BYTE,
} from './authoring';
import type {
  AuthoringIdentity,
  AuthoringTarget,
  CompletionRequest,
  CompletionResponse,
} from './authoring';
import { utf16ToByte } from './authoringUnits';
import { CompletePredicate } from './client';
import type { BindingType } from './query';

export type CompletionCall = (
  pluginID: string,
  request: CompletionRequest,
) => Promise<CompletionResponse> | CancellablePromise<CompletionResponse>;

export interface CompletionSessionOptions {
  pluginID: string;
  documentID: string;
  /** Transport; defaults to the host CompletePredicate binding. */
  call?: CompletionCall;
}

export interface CompletionInput {
  source: string;
  /** UTF-16 code unit offset into source, as an editor reports it. */
  cursor: number;
  target: AuthoringTarget;
  declarations?: Record<string, BindingType>;
  maxSuggestions: number;
}

export type CompletionOutcome =
  | { status: 'applied'; response: CompletionResponse }
  | { status: 'stale'; reason: string }
  | { status: 'cancelled' };

export interface CompletionSession {
  /** Supersedes any in-flight request. Rejects on invalid cursor or non-cancel errors. */
  complete(input: CompletionInput): Promise<CompletionOutcome>;
  /** Drops expectations and discards the in-flight request; call on provider/type/scope/schema switches. */
  invalidate(): void;
  /** Cancels the in-flight request and refuses further use. */
  dispose(): void;
}

const identityMembers = [
  'plugin',
  'provider',
  'connection',
  'type',
  'representation',
  'scopeKey',
  'catalogRevision',
  'representationRevision',
  'schemaRevision',
  'environmentRevision',
  'accessGeneration',
] as const satisfies readonly (keyof AuthoringIdentity)[];

function targetKey(input: CompletionInput): string {
  return JSON.stringify([
    input.target.route,
    input.target.type,
    input.target.representation ?? '',
    input.target.scope,
    input.declarations ?? {},
  ]);
}

interface Flight {
  revision: number;
  epoch: number;
  call: unknown;
}

export function createCompletionSession(options: CompletionSessionOptions): CompletionSession {
  const { pluginID, documentID } = options;
  const call: CompletionCall = options.call ?? CompletePredicate;
  let revision = 0;
  let epoch = 0;
  let disposed = false;
  let flight: Flight | undefined;
  let stored: { identity: AuthoringIdentity; key: string } | undefined;
  let current: { key: string; target: AuthoringTarget } | undefined;

  const cancelFlight = () => {
    const pending = flight?.call as { cancel?: () => void } | undefined;
    flight = undefined;
    if (pending && typeof pending.cancel === 'function') {
      try {
        pending.cancel();
      } catch {
        // A transport that cannot cancel is still superseded by revision.
      }
    }
  };

  const isCurrent = (issued: Flight) =>
    !disposed && issued.revision === revision && issued.epoch === epoch;

  const issue = (
    input: CompletionInput,
    byteOffset: number,
    baseline: AuthoringIdentity | undefined,
  ): { issued: Flight; request: CompletionRequest } => {
    revision += 1;
    const issued: Flight = { revision, epoch, call: undefined };
    flight = issued;
    const request: CompletionRequest = {
      version: AUTHORING_VERSION,
      requestId: `${documentID}#${revision}`,
      documentId: documentID,
      documentRevision: revision,
      source: input.source,
      cursor: { offset: byteOffset, unit: UNIT_UTF8_BYTE },
      profile: PREDICATE_PROFILE,
      target: {
        route: input.target.route,
        type: input.target.type,
        scope: input.target.scope,
        ...(input.target.representation ? { representation: input.target.representation } : {}),
      },
      maxSuggestions: input.maxSuggestions,
      ...(input.declarations && Object.keys(input.declarations).length > 0
        ? { declarations: input.declarations }
        : {}),
      ...(baseline?.catalogRevision ? { catalogRevision: baseline.catalogRevision } : {}),
      ...(baseline?.representationRevision
        ? { representationRevision: baseline.representationRevision }
        : {}),
      ...(baseline?.schemaRevision ? { schemaRevision: baseline.schemaRevision } : {}),
      ...(baseline?.environmentRevision
        ? { environmentRevision: baseline.environmentRevision }
        : {}),
      ...(baseline?.accessGeneration ? { accessGeneration: baseline.accessGeneration } : {}),
    };
    return { issued, request };
  };

  const staleReason = (
    issued: Flight,
    request: CompletionRequest,
    response: CompletionResponse,
    baseline: AuthoringIdentity | undefined,
  ): string | undefined => {
    if (disposed) return 'disposed';
    if (issued.epoch !== epoch) return 'invalidated';
    if (issued.revision !== revision) return 'superseded';
    if (response.documentId !== documentID) return 'documentId';
    if (response.documentRevision !== request.documentRevision) return 'documentRevision';
    if (response.requestId !== request.requestId) return 'requestId';
    if (
      response.cursor?.offset !== request.cursor.offset ||
      response.cursor?.unit !== request.cursor.unit
    ) {
      return 'cursor';
    }
    const identity = response.identity;
    const target = current?.target;
    if (!identity || !target) return 'identity';
    if (identity.plugin !== pluginID) return 'identity.plugin';
    if (identity.connection !== target.route.connection) return 'identity.connection';
    if (identity.type !== target.type) return 'identity.type';
    if (target.representation && identity.representation !== target.representation) {
      return 'identity.representation';
    }
    if (baseline) {
      for (const member of identityMembers) {
        if ((identity[member] ?? '') !== (baseline[member] ?? '')) return `identity.${member}`;
      }
    }
    return undefined;
  };

  const complete = async (input: CompletionInput): Promise<CompletionOutcome> => {
    if (disposed) throw new Error('Completion session is disposed.');
    // Convert first: an invalid cursor must not disturb the in-flight request.
    const byteOffset = utf16ToByte(input.source, input.cursor);
    const key = targetKey(input);
    cancelFlight();
    if (stored && stored.key !== key) stored = undefined;
    current = { key, target: input.target };

    let baseline = stored?.identity;
    for (let attempt = 0; ; attempt++) {
      const { issued, request } = issue(input, byteOffset, baseline);
      let response: CompletionResponse;
      try {
        const pending = call(pluginID, request);
        issued.call = pending;
        response = await pending;
      } catch (error) {
        // A superseded, invalidated or disposed request never surfaces its error.
        if (!isCurrent(issued)) return { status: 'cancelled' };
        flight = undefined;
        const code = parseAppError(error).code;
        if (code === 'CANCELLED') return { status: 'cancelled' };
        if (code === 'RESET_REQUIRED' && attempt === 0) {
          stored = undefined;
          baseline = undefined;
          continue;
        }
        throw error;
      }
      const reason = staleReason(issued, request, response, baseline);
      if (flight === issued) flight = undefined;
      if (reason !== undefined) {
        // Identity drift against a trusted baseline: force a resync next time.
        if (reason.startsWith('identity') && isCurrent(issued)) stored = undefined;
        return { status: 'stale', reason };
      }
      stored = { identity: response.identity, key };
      return { status: 'applied', response };
    }
  };

  return {
    complete,
    invalidate() {
      epoch += 1;
      stored = undefined;
      current = undefined;
      cancelFlight();
    },
    dispose() {
      disposed = true;
      stored = undefined;
      current = undefined;
      cancelFlight();
    },
  };
}
