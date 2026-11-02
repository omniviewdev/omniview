import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { resourceQueryKeys } from '../../../packages/omniviewdev-runtime/src/resourceQueryKeys';
import { useResource } from '../../../packages/omniviewdev-runtime/src/hooks/resource/useResource';
import type { HostGetRequest, HostRecord } from '../../../packages/omniviewdev-runtime/src/resource/v2/host';

const native = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../packages/omniviewdev-runtime/src/hooks/snackbar/useSnackbar', () => ({
  useSnackbar: () => ({ showSnackbar: vi.fn() }),
}));
vi.mock('../../../packages/omniviewdev-runtime/src/resource/v2/client', () => ({
  Get: native.get, Mutate: vi.fn(),
}));
vi.mock('../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper', () => ({
  CheckConnection: vi.fn().mockResolvedValue({ status: 'CONNECTED', connection: null, error: '', details: '' }),
}));
afterEach(cleanup);

it('refreshes detail readers after resource cache invalidation', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const version1: HostRecord = {
    key: 'host-membership-key', addressKey: 'host-address-key', targetId: 'search-context', route: { connection: 'prod' },
    record: {
      reference: { address: { provider: 'kubernetes', authority: 'host-test-authority', type: 'k8s:/pods', id: 'api', scope: [{ dimension: 'namespace', value: 'apps' }] }, incarnation: 'pod' },
      body: { kind: 'map', value: { version: { kind: 'string', value: '1' } } },
      representation: { id: 'json', revision: '1', schema: { state: 'unavailable', validation: 'unvalidated', unvalidated: [] } },
      coverage: { kind: 'complete', paths: [] }, sourceRevision: '1',
    },
  };
  const version2: HostRecord = { ...version1, record: { ...version1.record,
    body: { kind: 'map', value: { version: { kind: 'string', value: '2' } } }, sourceRevision: '2' } };
  const request: HostGetRequest = { targetId: version1.targetId, request: {
    route: version1.route, reference: version1.record.reference, representation: 'json',
  } };
  const detailKey = resourceQueryKeys.resource('kubernetes', request);
  native.get.mockResolvedValue(version1);
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>
    {children}
  </QueryClientProvider>;
  const consumer = renderHook(() => ({
    resource: useResource({ pluginID: 'kubernetes', request }).resource,
  }), { wrapper });
  await waitFor(() => {
    expect(consumer.result.current.resource.data).toEqual(version1); 
  });
  native.get.mockResolvedValue(version2);
  await act(async () => {
    await client.invalidateQueries({ queryKey: resourceQueryKeys.all('kubernetes') });
  });
  await waitFor(() => {
    expect(consumer.result.current.resource.data).toEqual(version2); 
  });
  expect(client.getQueryData(detailKey)).toEqual(version2);
  expect(native.get).toHaveBeenCalledTimes(2);
  consumer.unmount();
  client.clear();
});
