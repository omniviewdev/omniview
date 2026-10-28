import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import type * as Runtime from '@omniviewdev/runtime';
import type { SearchScopeV1 } from '@omniviewdev/runtime';
import { resourceQueryKeys } from '../../../packages/omniviewdev-runtime/src/resourceQueryKeys';
import { useResource } from '../../../packages/omniviewdev-runtime/src/hooks/resource/useResource';
import { useEventBatcher } from '../../../packages/omniviewdev-runtime/src/hooks/resource/useEventBatcher';
import { kubernetesSearchProvider as provider } from '../../../../kubernetes/ui/src/search/provider';

const native = vi.hoisted(() => ({ get: vi.fn(), check: vi.fn(), actions: vi.fn() }));
vi.mock('@omniviewdev/runtime', async (original) => ({
  ...(await original<typeof Runtime>()), useExtensionRegistry: () => undefined,
}));
vi.mock('../../../packages/omniviewdev-runtime/src/hooks/snackbar/useSnackbar', () => ({
  useSnackbar: () => ({ showSnackbar: vi.fn() }),
}));
vi.mock('../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper', () => ({
  Get: native.get, CheckConnection: native.check, Update: vi.fn(), Delete: vi.fn(),
}));
vi.mock('../../../../kubernetes/ui/src/components/kubernetes/KubernetesSearchActionContext', () => ({
  default: () => null, searchActions: native.actions, executeSearchAction: vi.fn(), validateSearchAction: vi.fn(),
}));
afterEach(cleanup);

it('shares successful native and batched watch snapshots between useResource and scoped search', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const version1 = { metadata: { name: 'api', namespace: 'apps', uid: 'pod', resourceVersion: '1' } };
  const version2 = { metadata: { ...version1.metadata, resourceVersion: '2' } };
  native.get.mockResolvedValue({ success: true, result: version1 });
  native.check.mockResolvedValue({ status: 'CONNECTED' });
  native.actions.mockResolvedValue([]);
  const getResourceKey = (id: string, namespace: string) => resourceQueryKeys.resource('kubernetes', 'prod', 'core::v1::Pod', id, namespace);
  const listKey = resourceQueryKeys.list('kubernetes', 'prod', 'core::v1::Pod');
  const Context = provider.Context!;
  const wrapper = ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>
    <Context />{children}
  </QueryClientProvider>;
  const consumer = renderHook(() => ({
    resource: useResource({ pluginID: 'kubernetes', connectionID: 'prod', resourceKey: 'core::v1::Pod', resourceID: 'api', namespace: 'apps' }).resource,
    enqueue: useEventBatcher(client, listKey, getResourceKey, 'metadata.name', 2, { syncWindowMs: 1 }),
  }), { wrapper });
  await waitFor(() => expect(consumer.result.current.resource.data).toEqual({ success: true, result: version1 }));
  act(() => consumer.result.current.enqueue({ type: 'UPDATE', payload: {
    connection: 'prod', key: 'core::v1::Pod', id: 'api', namespace: 'apps', data: version2,
  } }));
  await waitFor(() => expect(consumer.result.current.resource.data).toEqual({ success: true, result: version2 }));
  const scope: SearchScopeV1 = { kind: 'resource', pluginId: 'kubernetes', connectionId: 'prod',
    resourceKey: 'core::v1::Pod', resourceId: 'api', namespace: 'apps', uid: 'pod', label: 'api' };
  const search = await provider.search({ scopes: [scope], query: 'open', generation: 1, limit: 20, signal: new AbortController().signal });
  expect(search.items.map(item => item.label)).toEqual(['Open details']);
  expect(search.status).toBeUndefined();
  expect(native.actions).toHaveBeenCalledWith(scope, expect.any(AbortSignal), version2);
  expect(native.get).toHaveBeenCalledTimes(1);
  consumer.unmount();
  client.clear();
});
