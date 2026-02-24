import { renderHook, act } from '@testing-library/react';
import { useConnectionNamespaces } from './useConnectionNamespaces';

describe('useConnectionNamespaces', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  // ---------------------------------------------------------------------------
  // Basic behavior
  // ---------------------------------------------------------------------------

  it('returns empty array when nothing stored', () => {
    const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));
    expect(result.current.namespaces).toEqual([]);
  });

  it('persists namespaces to localStorage', () => {
    const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));

    act(() => {
      result.current.setNamespaces(['default', 'kube-system']);
    });

    expect(result.current.namespaces).toEqual(['default', 'kube-system']);
    expect(JSON.parse(localStorage.getItem('kubernetes-cluster-1-namespaces')!)).toEqual([
      'default',
      'kube-system',
    ]);
  });

  it('reads existing namespaces from localStorage on mount', () => {
    localStorage.setItem(
      'kubernetes-cluster-1-namespaces',
      JSON.stringify(['default']),
    );

    const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));
    expect(result.current.namespaces).toEqual(['default']);
  });

  it('persists across unmount/remount (simulates route change)', () => {
    const { result, unmount } = renderHook(() =>
      useConnectionNamespaces('cluster-1'),
    );

    act(() => {
      result.current.setNamespaces(['default', 'kube-system']);
    });

    unmount();

    const { result: result2 } = renderHook(() =>
      useConnectionNamespaces('cluster-1'),
    );
    expect(result2.current.namespaces).toEqual(['default', 'kube-system']);
  });

  it('maintains independent state per connection', () => {
    localStorage.setItem(
      'kubernetes-cluster-1-namespaces',
      JSON.stringify(['default']),
    );
    localStorage.setItem(
      'kubernetes-cluster-2-namespaces',
      JSON.stringify(['monitoring']),
    );

    const { result: r1 } = renderHook(() =>
      useConnectionNamespaces('cluster-1'),
    );
    const { result: r2 } = renderHook(() =>
      useConnectionNamespaces('cluster-2'),
    );

    expect(r1.current.namespaces).toEqual(['default']);
    expect(r2.current.namespaces).toEqual(['monitoring']);
  });

  // ---------------------------------------------------------------------------
  // Clearing
  // ---------------------------------------------------------------------------

  it('clears all namespaces when set to empty array', () => {
    const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));

    act(() => {
      result.current.setNamespaces(['default', 'kube-system']);
    });
    expect(result.current.namespaces).toEqual(['default', 'kube-system']);

    act(() => {
      result.current.setNamespaces([]);
    });
    expect(result.current.namespaces).toEqual([]);
    expect(JSON.parse(localStorage.getItem('kubernetes-cluster-1-namespaces')!)).toEqual([]);
  });

  it('removes an individual namespace by setting a filtered array', () => {
    const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));

    act(() => {
      result.current.setNamespaces(['default', 'kube-system', 'monitoring']);
    });

    act(() => {
      result.current.setNamespaces(
        result.current.namespaces.filter((ns) => ns !== 'kube-system'),
      );
    });

    expect(result.current.namespaces).toEqual(['default', 'monitoring']);
  });

  it('handles successive rapid updates', () => {
    const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));

    act(() => {
      result.current.setNamespaces(['a']);
      result.current.setNamespaces(['a', 'b']);
      result.current.setNamespaces(['a', 'b', 'c']);
    });

    expect(result.current.namespaces).toEqual(['a', 'b', 'c']);
  });

  // ---------------------------------------------------------------------------
  // Migration from per-resource column-filters
  // ---------------------------------------------------------------------------

  describe('migration', () => {
    it('promotes namespace filter from per-resource column-filters', () => {
      localStorage.setItem(
        'kubernetes-cluster-1-core::v1::Pod-column-filters',
        JSON.stringify([{ id: 'namespace', value: ['default', 'kube-system'] }]),
      );

      const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));
      expect(result.current.namespaces).toEqual(['default', 'kube-system']);
    });

    it('strips namespace entry from per-resource column-filters after migration', () => {
      localStorage.setItem(
        'kubernetes-cluster-1-core::v1::Pod-column-filters',
        JSON.stringify([
          { id: 'namespace', value: ['default'] },
          { id: 'status', value: ['Running'] },
        ]),
      );

      renderHook(() => useConnectionNamespaces('cluster-1'));

      const filters = JSON.parse(
        localStorage.getItem('kubernetes-cluster-1-core::v1::Pod-column-filters')!,
      );
      expect(filters).toEqual([{ id: 'status', value: ['Running'] }]);
    });

    it('uses the largest namespace selection when multiple resources exist', () => {
      localStorage.setItem(
        'kubernetes-cluster-1-core::v1::Pod-column-filters',
        JSON.stringify([{ id: 'namespace', value: ['default'] }]),
      );
      localStorage.setItem(
        'kubernetes-cluster-1-core::v1::Service-column-filters',
        JSON.stringify([
          { id: 'namespace', value: ['default', 'kube-system', 'monitoring'] },
        ]),
      );

      const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));
      expect(result.current.namespaces).toEqual([
        'default',
        'kube-system',
        'monitoring',
      ]);
    });

    it('does not re-migrate after shared key already exists', () => {
      localStorage.setItem(
        'kubernetes-cluster-1-namespaces',
        JSON.stringify(['existing']),
      );
      localStorage.setItem(
        'kubernetes-cluster-1-core::v1::Pod-column-filters',
        JSON.stringify([{ id: 'namespace', value: ['default', 'kube-system'] }]),
      );

      const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));
      // Should keep the existing shared value, not overwrite with migration
      expect(result.current.namespaces).toEqual(['existing']);
    });

    it('handles per-resource keys with no namespace filter', () => {
      localStorage.setItem(
        'kubernetes-cluster-1-core::v1::Pod-column-filters',
        JSON.stringify([{ id: 'status', value: ['Running'] }]),
      );

      const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));
      expect(result.current.namespaces).toEqual([]);
    });

    it('handles malformed localStorage entries gracefully', () => {
      localStorage.setItem(
        'kubernetes-cluster-1-core::v1::Pod-column-filters',
        'not-valid-json',
      );

      const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));
      expect(result.current.namespaces).toEqual([]);
    });

    it('only migrates keys matching the connection ID', () => {
      // cluster-2 key should not affect cluster-1 migration
      localStorage.setItem(
        'kubernetes-cluster-2-core::v1::Pod-column-filters',
        JSON.stringify([{ id: 'namespace', value: ['other-ns'] }]),
      );

      const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));
      expect(result.current.namespaces).toEqual([]);
    });

    it('strips namespace from all per-resource keys during migration', () => {
      localStorage.setItem(
        'kubernetes-cluster-1-core::v1::Pod-column-filters',
        JSON.stringify([{ id: 'namespace', value: ['default'] }]),
      );
      localStorage.setItem(
        'kubernetes-cluster-1-apps::v1::Deployment-column-filters',
        JSON.stringify([
          { id: 'namespace', value: ['default', 'staging'] },
          { id: 'replicas', value: [3] },
        ]),
      );

      renderHook(() => useConnectionNamespaces('cluster-1'));

      const podFilters = JSON.parse(
        localStorage.getItem('kubernetes-cluster-1-core::v1::Pod-column-filters')!,
      );
      const deployFilters = JSON.parse(
        localStorage.getItem(
          'kubernetes-cluster-1-apps::v1::Deployment-column-filters',
        )!,
      );

      expect(podFilters).toEqual([]);
      expect(deployFilters).toEqual([{ id: 'replicas', value: [3] }]);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('preserves stale namespace values (namespace deleted from cluster)', () => {
      // Hook stores whatever strings it receives — it does not validate against
      // the cluster's current namespace list. Cleanup is the display layer's job.
      localStorage.setItem(
        'kubernetes-cluster-1-namespaces',
        JSON.stringify(['default', 'deleted-ns']),
      );

      const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));
      expect(result.current.namespaces).toEqual(['default', 'deleted-ns']);
    });

    it('allows removing a stale namespace', () => {
      localStorage.setItem(
        'kubernetes-cluster-1-namespaces',
        JSON.stringify(['default', 'deleted-ns']),
      );

      const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));

      act(() => {
        result.current.setNamespaces(
          result.current.namespaces.filter((ns) => ns !== 'deleted-ns'),
        );
      });

      expect(result.current.namespaces).toEqual(['default']);
    });

    it('works after localStorage.clear() mid-session', () => {
      const { result } = renderHook(() => useConnectionNamespaces('cluster-1'));

      act(() => {
        result.current.setNamespaces(['default']);
      });
      expect(result.current.namespaces).toEqual(['default']);

      // Simulate external localStorage clear
      localStorage.clear();

      // State is still in-memory
      expect(result.current.namespaces).toEqual(['default']);

      // Re-setting writes back to localStorage
      act(() => {
        result.current.setNamespaces(['kube-system']);
      });
      expect(result.current.namespaces).toEqual(['kube-system']);
      expect(
        JSON.parse(localStorage.getItem('kubernetes-cluster-1-namespaces')!),
      ).toEqual(['kube-system']);
    });

    it('handles empty connection ID', () => {
      const { result } = renderHook(() => useConnectionNamespaces(''));

      act(() => {
        result.current.setNamespaces(['default']);
      });
      expect(result.current.namespaces).toEqual(['default']);
      expect(JSON.parse(localStorage.getItem('kubernetes--namespaces')!)).toEqual([
        'default',
      ]);
    });
  });
});
