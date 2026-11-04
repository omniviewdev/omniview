import { createElement } from 'react';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { CancellablePromise } from '@wailsio/runtime';
import type { ResourceSetQueryResponse } from '../../bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/metric/models';
import { QueryResources, type ResourceSetQueryRequest } from '../../metric';
import { useResourceSetMetrics } from './useResourceSetMetrics';

vi.mock('../../metric', () => ({ QueryResources: vi.fn() }));

function request(connection = 'cluster-a'): ResourceSetQueryRequest {
  return {
    resource_plugin_id: 'kubernetes', resource_connection_id: connection, binding_id: 'binding',
    source: { plugin_id: 'grafana', connection_id: 'prometheus', datasource_uid: 'primary', datasource_kind: 'prometheus' },
    resources: [{ token: 'pod', resource_key: 'k8s:/pods', resource_id: 'pod', resource_namespace: 'default' }],
    metric_ids: ['cpu'], definitions: [], public_scope: {}, mapping_revision: '1', shape: 0,
    start_time: '1970-01-01T00:00:00Z', end_time: '1970-01-01T00:00:00Z', step: 0,
  };
}

function Consumer({ input }: { input: ResourceSetQueryRequest }) {
  'use no memo';
  // Plugins without compiler optimization may recreate equivalent inputs on every render.
  const query = useResourceSetMetrics({ ...input, resources: [...input.resources] });
  return createElement('output', null, query.error?.message ?? (query.isLoading ? 'loading' : query.data?.results[0]?.value?.current_value?.value ?? 'empty'));
}

afterEach(() => { cleanup(); vi.clearAllTimers(); vi.useRealTimers(); vi.clearAllMocks(); });

it('settles compiled subscriptions across equivalent consumer renders and isolates changed scope', async () => {
  vi.useFakeTimers();
  vi.mocked(QueryResources).mockImplementation(input => Promise.resolve({
    results: [{ resource_token: 'pod', metric_id: 'cpu', status: 'ok', value: { current_value: { value: input.resource_connection_id === 'cluster-a' ? 42 : 84 } } }], warnings: [],
  }) as CancellablePromise<ResourceSetQueryResponse | null>);
  const view = render(createElement(Consumer, { input: request() }));
  await act(() => vi.advanceTimersByTimeAsync(16));
  expect(screen.getByText('42')).toBeTruthy();
  for (let index = 0; index < 3; index++) view.rerender(createElement(Consumer, { input: request() }));
  await act(() => vi.advanceTimersByTimeAsync(16));
  expect(QueryResources).toHaveBeenCalledTimes(1);
  expect(screen.getByText('42')).toBeTruthy();
  view.rerender(createElement(Consumer, { input: request('cluster-b') }));
  await act(() => vi.advanceTimersByTimeAsync(16));
  expect(screen.getByText('84')).toBeTruthy();
  expect(QueryResources).toHaveBeenCalledTimes(2);
});
