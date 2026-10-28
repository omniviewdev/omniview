import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { resourceQueryKeys } from '../../../packages/omniviewdev-runtime/src/resourceQueryKeys';
import { useResource } from '../../../packages/omniviewdev-runtime/src/hooks/resource/useResource';
import { useEventBatcher } from '../../../packages/omniviewdev-runtime/src/hooks/resource/useEventBatcher';

const native = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('../../../packages/omniviewdev-runtime/src/hooks/snackbar/useSnackbar', () => ({
  useSnackbar: () => ({ showSnackbar: vi.fn() }),
}));
vi.mock('../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper', () => ({
  Get: native.get, Update: vi.fn(), Delete: vi.fn(),
}));
afterEach(cleanup);

it('updates detail readers from batched watch events without losing native response shape or refetching', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const version1 = { metadata: { name: 'api', namespace: 'apps', uid: 'pod', resourceVersion: '1' } };
  const version2 = { metadata: { ...version1.metadata, resourceVersion: '2' } };
  native.get.mockResolvedValue({ success: true, result: version1 });
  const getResourceKey = (id: string, namespace: string) => resourceQueryKeys.resource('kubernetes', 'prod', 'core::v1::Pod', id, namespace);
  const listKey = resourceQueryKeys.list('kubernetes', 'prod', 'core::v1::Pod');
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>
    {children}
  </QueryClientProvider>;
  const consumer = renderHook(() => ({
    resource: useResource({ pluginID: 'kubernetes', connectionID: 'prod', resourceKey: 'core::v1::Pod', resourceID: 'api', namespace: 'apps' }).resource,
    enqueue: useEventBatcher(client, listKey, getResourceKey, 'metadata.name', 2, { syncWindowMs: 1 }),
  }), { wrapper });
  await waitFor(() => {
    expect(consumer.result.current.resource.data).toEqual({ success: true, result: version1 }); 
  });
  act(() => {
    consumer.result.current.enqueue({ type: 'UPDATE', payload: {
      connection: 'prod', key: 'core::v1::Pod', id: 'api', namespace: 'apps', data: version2,
    } }); 
  });
  await waitFor(() => {
    expect(consumer.result.current.resource.data).toEqual({ success: true, result: version2 }); 
  });
  expect(client.getQueryData(getResourceKey('api', 'apps'))).toEqual({ success: true, result: version2 });
  expect(native.get).toHaveBeenCalledTimes(1);
  consumer.unmount();
  client.clear();
});
