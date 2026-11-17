import { describe, expect, it, vi } from 'vitest';
import type { PodsFailure, PodsState, PodsView } from '../k8s';
import { podsListSource } from './source';

// A view as `usePods` hands it over; only what the mapping reads is real.
function view(over: Partial<PodsView> & { readonly state: PodsState }): PodsView {
  return {
    failure: undefined,
    rows: [],
    loaded: 0,
    complete: false,
    count: { kind: 'unknown', loaded: '0' },
    live: false,
    refreshing: false,
    connect: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    refresh: vi.fn(async () => undefined),
    ...over,
  };
}

describe('podsListSource: the rows and what the page asks of them pass through', () => {
  it('hands over the rows, whether the set is complete, whether a refresh runs, and the user\'s Refresh', () => {
    const refresh = vi.fn(async () => undefined);
    const rows = [{ key: 'a' }] as unknown as PodsView['rows'];
    const source = podsListSource(view({ state: { kind: 'loaded' }, rows, complete: true, refreshing: true, refresh }));
    expect(source.rows).toBe(rows);
    expect(source.complete).toBe(true);
    expect(source.refreshing).toBe(true);
    expect(source.refresh).toBe(refresh);
  });
});

describe('podsListSource: the state of the connection and the read, as the page words it', () => {
  it.each<PodsState>([{ kind: 'connecting' }, { kind: 'disconnected' }, { kind: 'loading' }])('is loading while the state is $kind (a connection is started by the page itself, so there is nothing to wait on but the answer)', (state) => {
    expect(podsListSource(view({ state })).state).toEqual({ kind: 'loading' });
  });

  it('is ready with rows, and ready with the whole set empty', () => {
    expect(podsListSource(view({ state: { kind: 'loaded' } })).state).toEqual({ kind: 'ready' });
    expect(podsListSource(view({ state: { kind: 'empty' }, complete: true })).state).toEqual({ kind: 'ready' });
  });

  it('is failed with the runtime\'s own words and a Retry that asks the view again, for a failure the connection can recover from', () => {
    const retry = vi.fn(async () => undefined);
    const { state } = podsListSource(view({ state: { kind: 'unreachable', message: 'dial tcp: i/o timeout' }, retry }));
    expect(state).toMatchObject({ kind: 'failed', message: 'dial tcp: i/o timeout' });
    if (state.kind !== 'failed') {
      throw new Error('failed expected');
    }

    state.retry?.();
    expect(retry).toHaveBeenCalledTimes(1);
  });

  it.each<[PodsState, string]>([
    [{ kind: 'needs-sign-in' }, 'The connection needs you to sign in.'],
    [{ kind: 'denied' }, 'You do not have access to list Pods.'],
    [{ kind: 'unreachable' }, 'The cluster did not answer.'],
    [{ kind: 'failed' }, 'Pods could not be read.'],
  ])('says in its own words what %j means when the runtime gave none', (state, message) => {
    expect(podsListSource(view({ state })).state).toMatchObject({ kind: 'failed', message });
  });

  it('offers no Retry where asking again cannot help: a cluster that serves no Pods, a connection that is gone', () => {
    const unsupported = podsListSource(view({ state: { kind: 'unsupported' } })).state;
    const gone = podsListSource(view({ state: { kind: 'not-found', message: 'No such connection.' } })).state;
    expect(unsupported).toEqual({ kind: 'failed', message: 'This cluster does not serve Pods.' });
    expect(gone).toEqual({ kind: 'failed', message: 'No such connection.' });
  });

  it('keeps the failure that came after rows as a failed state, so the page can keep the rows and not call a refresh an update', () => {
    const failure: PodsFailure = { kind: 'unreachable', message: 'Lost the cluster.' };
    const { state } = podsListSource(view({ state: { kind: 'loaded' }, failure, rows: [{ key: 'a' }] as unknown as PodsView['rows'] }));
    expect(state).toMatchObject({ kind: 'failed', message: 'Lost the cluster.' });
  });
});
