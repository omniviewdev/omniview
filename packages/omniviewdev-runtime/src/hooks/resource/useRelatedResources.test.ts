import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import React from 'react';
import type { Mock } from 'vitest';

vi.mock('../useResolvedPluginId', () => ({
  useResolvedPluginId: (explicit?: string) => explicit ?? 'kubernetes',
}));

let mockGetRelated: Mock;
let mockGetDependencyTree: Mock;
vi.mock('../../bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/graphservice', () => ({
  get GetRelated() {
    return mockGetRelated;
  },
  get GetDependencyTree() {
    return mockGetDependencyTree;
  },
}));

import { relationshipLabel, toRelatedResources, useRelatedResources } from './useRelatedResources';
import { useDependencyTree } from './useDependencyTree';

const node = (resourceKey: string, id: string, namespace = '') => ({
  pluginId: 'kubernetes',
  connectionId: 'c1',
  resourceKey,
  id,
  namespace,
});

const pod = node('core::v1::Pod', 'web-1', 'default');
const rs = node('apps::v1::ReplicaSet', 'web-abc', 'default');
const worker = node('core::v1::Node', 'worker-1');

function wrapper({ children }: { children: React.ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return React.createElement(QueryClientProvider, { client }, children);
}

beforeEach(() => {
  mockGetRelated = vi.fn();
  mockGetDependencyTree = vi.fn();
});

describe('toRelatedResources', () => {
  it('reports the far end and the direction from the viewed resource', () => {
    const related = toRelatedResources(pod, [
      { source: pod, target: worker, type: 'runs_on', label: 'runs on' },
      // Declared by the Pod, so labelled from its side.
      { source: rs, target: pod, type: 'owns', label: 'owned by' },
    ] as any);

    expect(related).toEqual([
      { resource: worker, type: 'runs_on', direction: 'outgoing', label: 'runs on' },
      { resource: rs, type: 'owns', direction: 'incoming', label: 'owned by' },
    ]);
  });

  it('treats a missing namespace as empty', () => {
    const self = { ...worker, namespace: undefined };
    const [related] = toRelatedResources(self as any, [
      { source: pod, target: worker, type: 'runs_on', label: 'runs on' },
    ] as any);
    expect(related.direction).toBe('incoming');
  });
});

describe('relationshipLabel', () => {
  it('names known types from either side', () => {
    expect(relationshipLabel('owns', 'outgoing')).toBe('Owns');
    expect(relationshipLabel('owns', 'incoming')).toBe('Owned by');
    expect(relationshipLabel('runs_on', 'incoming')).toBe('Running here');
  });

  it('falls back to the type name', () => {
    expect(relationshipLabel('peers_with', 'outgoing')).toBe('peers with');
    expect(relationshipLabel('peers_with', 'incoming')).toBe('peers with (incoming)');
  });
});

describe('useRelatedResources', () => {
  it('queries both directions and maps the edges', async () => {
    mockGetRelated.mockResolvedValue([{ source: pod, target: worker, type: 'runs_on', label: 'runs on' }]);

    const { result } = renderHook(() => useRelatedResources({
      connectionID: 'c1', resourceKey: 'core::v1::Pod', resourceID: 'web-1', namespace: 'default',
    }), { wrapper });

    await waitFor(() => {
      expect(result.current.related).toHaveLength(1);
    });
    expect(mockGetRelated).toHaveBeenCalledWith('kubernetes', 'c1', 'core::v1::Pod', 'default', 'web-1', 'both', null);
    expect(result.current.related[0]).toMatchObject({ resource: worker, direction: 'outgoing' });
  });

  it('passes direction and type filters through', async () => {
    mockGetRelated.mockResolvedValue([]);

    renderHook(() => useRelatedResources({
      pluginID: 'other', connectionID: 'c1', resourceKey: 'core::v1::Node', resourceID: 'worker-1',
      direction: 'incoming', relationshipType: 'runs_on',
    }), { wrapper });

    await waitFor(() => {
      expect(mockGetRelated).toHaveBeenCalled();
    });
    expect(mockGetRelated).toHaveBeenCalledWith('other', 'c1', 'core::v1::Node', '', 'worker-1', 'incoming', 'runs_on');
  });

  it('does not query without a resource ID', () => {
    const { result } = renderHook(() => useRelatedResources({
      connectionID: 'c1', resourceKey: 'core::v1::Pod', resourceID: '',
    }), { wrapper });

    expect(mockGetRelated).not.toHaveBeenCalled();
    expect(result.current.related).toEqual([]);
  });
});

describe('useDependencyTree', () => {
  it('fetches the tree with the requested depth', async () => {
    const tree = { root: rs, children: [] };
    mockGetDependencyTree.mockResolvedValue(tree);

    const { result } = renderHook(() => useDependencyTree({
      connectionID: 'c1', resourceKey: 'apps::v1::ReplicaSet', resourceID: 'web-abc', namespace: 'default', maxDepth: 2,
    }), { wrapper });

    await waitFor(() => {
      expect(result.current.tree).toEqual(tree);
    });
    expect(mockGetDependencyTree).toHaveBeenCalledWith('kubernetes', 'c1', 'apps::v1::ReplicaSet', 'default', 'web-abc', 2);
  });
});
