import React from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useResources } from './useResources';
import type { HostEnumerateRequest, HostRecord, HostSourceViewEvent, HostSourceViewOpened } from '../../resource/v2/host';
import { jsonToValue, valueToJSONText } from '../../resource/v2/value';

const native = vi.hoisted(() => ({
  enumerate: vi.fn(), open: vi.fn(), sync: vi.fn(), refresh: vi.fn(), close: vi.fn(), on: vi.fn(),
}));
vi.mock('@wailsio/runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('@wailsio/runtime')>();
  return { ...actual, Events: { ...actual.Events, On: native.on } };
});
vi.mock('../../resource/v2/client', () => ({
  Enumerate: native.enumerate,
  OpenSourceView: native.open,
  SyncSourceView: native.sync,
  RefreshSourceView: native.refresh,
  CloseSourceView: native.close,
}));
vi.mock('../useResolvedPluginId', () => ({ useResolvedPluginId: (id?: string) => id ?? 'provider' }));
vi.mock('../connection/useConnectionReadiness', () => ({
  useConnectionReadiness: () => ({ phase: 'connected' }),
}));
vi.mock('../../connection/connectionReadiness', () => ({
  getConnectionReadinessGeneration: () => 1,
  isConnectionReadinessCurrent: (_plugin: string, _connection: string, generation: number) => generation === 1,
  connectionReadinessStore: () => ({ subscribe: () => () => {} }),
}));

const request: HostEnumerateRequest = {
  targetId: 'target',
  request: {
    target: {
      route: { connection: 'c' }, provider: 'provider', authority: 'authority',
      type: 'items', scope: [], representation: 'raw',
    },
    pageSize: 1,
  },
};
const body = { metadata: { name: 'recovered-item' }, spec: { value: 'full-body' }, status: { phase: 'Ready' } };
const bodyText = JSON.stringify(body);
const row: HostRecord = {
  key: 'record-one', addressKey: 'address-one', targetId: 'target', route: { connection: 'c' },
  record: {
    reference: { address: { provider: 'provider', authority: 'authority', type: 'items', scope: [], id: 'one' } },
    body: jsonToValue(body),
    representation: { id: 'raw', revision: 'r' },
    coverage: { kind: 'complete', paths: [] },
    sourceRevision: 'native-revision-1',
  },
};

function Collection({ name = 'Collection' }: { name?: string }) {
  const { resources, acquired, source } = useResources({ pluginID: 'provider', request, collection: true });
  const [retryError, setRetryError] = React.useState('');
  const error = retryError || resources.error?.message;
  return React.createElement('section', { 'aria-label': name },
    error ? React.createElement('p', { role: 'alert' }, error) : null,
    source ? React.createElement('p', { role: 'status' }, source.state) : null,
    React.createElement('button', {
      type: 'button',
      onClick: () => {
        setRetryError('');
        void resources.refetch().catch((reason: unknown) => {
          setRetryError(reason instanceof Error ? reason.message : String(reason));
        });
      },
    }, 'Retry'),
    React.createElement('ul', { 'aria-label': 'Resources' },
      acquired?.page.records.map(record => React.createElement('li', { key: record.key }, valueToJSONText(record.record.body))),
    ),
  );
}

let client: QueryClient;
let emit: (event: { data: HostSourceViewEvent }) => void;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  native.open.mockResolvedValue({ viewId: 'view', topic: 'resource-view', mode: 'snapshotAndUpdates' });
  native.on.mockImplementation((_topic: string, listener: typeof emit) => {
    emit = listener;
    return () => {};
  });
  native.sync.mockImplementation(async () => {
    emit({ data: { viewId: 'view', viewGeneration: 'generation-1', sequence: '1', kind: 'snapshot', records: [row] } });
    emit({ data: {
      viewId: 'view', viewGeneration: 'generation-1', sequence: '2', kind: 'snapshotEnd',
      status: { state: 'following', mode: 'snapshotAndUpdates', continuity: 'bestEffort', count: { kind: 'exact', value: '1' } },
    } });
  });
  native.refresh.mockResolvedValue(undefined);
  native.close.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  client.clear();
});

it.each([
  { scenario: 'initial open succeeds', failFirstOpen: false },
  { scenario: 'explicit Retry follows an initial open failure', failFirstOpen: true },
])('renders accepted complete data when $scenario', async ({ failFirstOpen }) => {
  if (failFirstOpen) native.open.mockRejectedValueOnce(new Error('Source open failed'));
  render(React.createElement(QueryClientProvider, { client }, React.createElement(Collection)));

  if (failFirstOpen) {
    expect((await screen.findByRole('alert')).textContent).toBe('Source open failed');
    expect(screen.queryByRole('listitem')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
  }

  expect((await screen.findByRole('listitem')).textContent).toBe(bodyText);
  expect(screen.queryByRole('alert')).toBeNull();
});

it('reattaches every mounted observer to one pending Retry, then refreshes the recovered view', async () => {
  const opened: HostSourceViewOpened = { viewId: 'view', topic: 'resource-view', mode: 'snapshotAndUpdates' };
  const pending = Promise.withResolvers<HostSourceViewOpened>();
  native.open.mockRejectedValueOnce(new Error('Source open failed')).mockReturnValueOnce(pending.promise);
  const mounted = render(React.createElement(QueryClientProvider, { client },
    React.createElement(React.Fragment, null,
      React.createElement(Collection, { key: 'first', name: 'First' }),
      null,
    ),
  ));
  const first = within(screen.getByRole('region', { name: 'First' }));
  expect((await first.findByRole('alert')).textContent).toBe('Source open failed');

  mounted.rerender(React.createElement(QueryClientProvider, { client },
    React.createElement(React.Fragment, null,
      React.createElement(Collection, { key: 'first', name: 'First' }),
      React.createElement(Collection, { key: 'second', name: 'Second' }),
    ),
  ));
  const second = within(screen.getByRole('region', { name: 'Second' }));
  expect((await second.findByRole('alert')).textContent).toBe('Source open failed');
  await act(async () => {});
  expect(native.open).toHaveBeenCalledTimes(1);

  fireEvent.click(first.getByRole('button', { name: 'Retry' }));
  fireEvent.click(second.getByRole('button', { name: 'Retry' }));
  expect(native.open).toHaveBeenCalledTimes(2);
  expect(first.queryByRole('listitem')).toBeNull();
  expect(second.queryByRole('listitem')).toBeNull();

  await act(async () => pending.resolve(opened));
  for (const observer of [first, second]) {
    expect((await observer.findByRole('listitem')).textContent).toBe(bodyText);
    expect(observer.getByRole('status').textContent).toBe('following');
    expect(observer.queryByRole('alert')).toBeNull();
  }
  expect(native.refresh).not.toHaveBeenCalled();

  const refreshedBody = { ...body, spec: { value: 'refreshed-full-body' } };
  native.refresh.mockImplementationOnce(async () => {
    emit({ data: {
      viewId: 'view', viewGeneration: 'generation-1', sequence: '3', kind: 'changes',
      upserts: [{ ...row, record: { ...row.record, body: jsonToValue(refreshedBody), sourceRevision: 'native-revision-2' } }],
    } });
  });
  fireEvent.click(first.getByRole('button', { name: 'Retry' }));
  await waitFor(() => {
    for (const observer of [first, second]) {
      expect(observer.getByRole('listitem').textContent).toBe(JSON.stringify(refreshedBody));
      expect(observer.queryByRole('alert')).toBeNull();
    }
  });
  expect(native.refresh).toHaveBeenCalledTimes(1);
  expect(native.open).toHaveBeenCalledTimes(2);
});
