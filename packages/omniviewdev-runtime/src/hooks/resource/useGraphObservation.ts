import { Events } from '@wailsio/runtime';
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { connectionReadinessStore, isConnectionReadinessCurrent } from '../../connection/connectionReadiness';
import { parseAppError } from '../../errors/parseAppError';
import { CloseGraphObservation, OpenGraphObservation, SyncGraphObservation } from '../../resource/v2/graph-client';
import type { HostGraphObservationRequest, HostGraphObservationSnapshot } from '../../resource/v2/graph';
import { useConnectionReadiness } from '../connection/useConnectionReadiness';
import { useConnectionGeneration } from './useConnectionGeneration';

type Request = Omit<HostGraphObservationRequest, 'clientToken'>;
type ObservationState = {
  key: string;
  snapshot?: HostGraphObservationSnapshot;
  isFetching: boolean;
  error: Error | null;
};
type Owner = { key: string; refetch(): Promise<void> };

function requestIdentity(request: Request): string {
  const { address, incarnation } = request.reference;
  return JSON.stringify([
    request.pluginID, request.route.connection,
    address.provider, address.authority, address.type, address.id,
    address.scope.map(entry => JSON.stringify([entry.dimension, entry.value])).sort(), incarnation ?? null,
    request.kind, request.direction ?? null, request.relationshipType ?? null,
    request.maxDepth ?? null, request.upDepth ?? null, request.downDepth ?? null,
  ]);
}

/**
 * One mounted owner, one native reservation. Full snapshots need no finite-query cache or replay.
 * Render identity owns loading and clears retired evidence before a replacement can publish.
 */
export function useGraphObservation(request: Request, enabled: boolean) {
  const { pluginID, route: { connection } } = request;
  const eligible = enabled && !!pluginID && !!connection && !!request.reference.address.id;
  const readiness = useConnectionReadiness({ pluginID, connectionID: connection, enabled: eligible });
  const generation = useConnectionGeneration(pluginID, connection, eligible);
  const active = eligible && readiness.phase === 'connected' && generation !== undefined;
  const key = active ? JSON.stringify([requestIdentity(request), generation]) : '';
  const requestRef = useRef(request);
  const ownerRef = useRef<Owner | null>(null);
  const [state, setState] = useState<ObservationState>({ key, isFetching: active, error: null });
  if (state.key !== key) setState({ key, isFetching: active, error: null });

  useLayoutEffect(() => { requestRef.current = request; }, [request]);
  useLayoutEffect(() => {
    if (!active) return;
    const token = crypto.randomUUID();
    const topic = `resource/graph-observation/${token}`;
    let retired = false;
    let listening = false;
    let frameGeneration: string | undefined;
    let sequence = 0n;
    let unsubscribe = () => {};
    let releaseReadiness = () => {};
    const current = () => !retired && isConnectionReadinessCurrent(pluginID, connection, generation);
    const close = (id: string) => {
      // Retired owners cannot receive errors. Native window retirement also releases demand.
      void CloseGraphObservation(id).catch(() => {});
    };
    const retire = () => {
      if (retired) return;
      retired = true;
      unsubscribe();
      releaseReadiness();
      if (ownerRef.current === owner) ownerRef.current = null;
      close(token);
    };
    const pending = () => setState(previous => ({
      key,
      snapshot: previous.key === key ? previous.snapshot : undefined,
      isFetching: true,
      error: null,
    }));
    const fail = (error: unknown) => {
      if (!current()) return;
      setState({ key, isFetching: false, error: Object.assign(new Error(parseAppError(error).detail), { cause: error }) });
    };
    const accept = (snapshot: HostGraphObservationSnapshot) => {
      if (!current() || !snapshot || snapshot.observationId !== token
        || typeof snapshot.generation !== 'string' || !snapshot.generation
        || typeof snapshot.sequence !== 'string' || !/^(0|[1-9][0-9]*)$/.test(snapshot.sequence)
        || !['pending', 'ready', 'failed'].includes(snapshot.state)) return;
      if (frameGeneration !== undefined && snapshot.generation !== frameGeneration) return;
      const next = BigInt(snapshot.sequence);
      if (next <= sequence) return;
      frameGeneration = snapshot.generation;
      sequence = next;
      if (snapshot.state === 'pending') pending();
      else if (snapshot.state === 'failed') fail(snapshot.error);
      else setState({ key, snapshot, isFetching: false, error: null });
    };
    const opening = (async () => {
      const opened = await OpenGraphObservation({ ...requestRef.current, clientToken: token });
      if (!current()) {
        retire();
        close(opened.observationId);
        return;
      }
      if (opened.observationId !== token || opened.topic !== topic) {
        close(opened.observationId);
        throw new Error('The host returned a different graph observation.');
      }
      unsubscribe = Events.On(topic, event => accept(event.data as HostGraphObservationSnapshot));
      listening = true;
    })();
    const sync = async () => {
      try {
        await opening;
        if (!current()) return;
        pending();
        await SyncGraphObservation(token);
      } catch (error) {
        fail(error);
        if (!listening) retire();
        throw error;
      }
    };
    const owner: Owner = { key, refetch: sync };
    ownerRef.current = owner;
    releaseReadiness = connectionReadinessStore(pluginID, connection).subscribe(() => {
      if (!current()) retire();
    });
    if (retired) releaseReadiness();
    else if (!current()) retire();
    else void sync().catch(() => {});
    return retire;
  }, [active, key, pluginID, connection, generation]);

  const refetch = useCallback(async () => {
    const owner = ownerRef.current;
    if (active && owner?.key === key) await owner.refetch();
  }, [active, key]);
  const visible = active && state.key === key ? state : undefined;
  const isFetching = active && (visible?.isFetching ?? true);
  return {
    snapshot: visible?.snapshot,
    isLoading: isFetching && !visible?.snapshot,
    isFetching,
    error: visible?.error ?? null,
    refetch,
  };
}
