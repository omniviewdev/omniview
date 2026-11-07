import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDiagnostics } from './useDiagnostics';
import { PageVisibilityContext } from '@/features/workspace/pageVisibility';
import { MemoryRouter } from 'react-router';
import Performance from '@/pages/developer-tools/Performance';

const service = vi.hoisted(() => ({ GetHistory: vi.fn(), ListCaptures: vi.fn(), GetCatalog: vi.fn() }));
vi.mock('@omniviewdev/runtime/api', () => ({ Diagnostics: service }));

beforeEach(() => {
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
  service.GetHistory.mockResolvedValue({ samples: [{ sequence: 1, timestamp: '2026-11-07T00:00:00Z', metrics: [] }] });
  service.ListCaptures.mockResolvedValue([]);
  service.GetCatalog.mockResolvedValue({ metrics: [] });
});
afterEach(() => {
  vi.restoreAllMocks(); vi.clearAllMocks(); 
});

function QueryWrapper({ children }: PropsWithChildren) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } }));
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function InactivePageWrapper({ children }: PropsWithChildren) {
  return <QueryWrapper><PageVisibilityContext value={false}>{children}</PageVisibilityContext></QueryWrapper>;
}

describe('diagnostics polling lifecycle', () => {
  it('does not collect for an inactive IDE page even when the document is visible', async () => {
    const view = renderHook(useDiagnostics, { wrapper: InactivePageWrapper });
    await act(async () => {
      await view.result.current.refresh(); 
    });
    expect(service.GetHistory).not.toHaveBeenCalled();
    expect(service.ListCaptures).not.toHaveBeenCalled();
    expect(service.GetCatalog).not.toHaveBeenCalled();
    view.unmount();
  });
  it('does not collect while initially hidden and resumes when visible', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden');
    const view = renderHook(useDiagnostics, { wrapper: QueryWrapper });
    expect(service.GetHistory).not.toHaveBeenCalled();
    visibility.mockReturnValue('visible');
    act(() => {
      document.dispatchEvent(new Event('visibilitychange')); 
    });
    await waitFor(() => {
      expect(view.result.current.samples).toHaveLength(1); 
    });
    view.unmount();
  });

  it('exposes degraded current collection health without changing healthy retained samples', async () => {
    const recordedAt = '2026-11-07T00:00:00Z';
    const sampleHealth = { complete: true, errors: 0, gaps: 0, dropped: 0, lastError: '' };
    service.GetHistory.mockResolvedValueOnce({
      samples: [{ sequence: 1, timestamp: recordedAt, metrics: [], health: sampleHealth }],
      health: { ...sampleHealth, complete: false, gaps: 1, lastError: 'collection stale' },
    });
    const view = renderHook(useDiagnostics, { wrapper: QueryWrapper });
    await waitFor(() => {
      expect(view.result.current.health?.complete).toBe(false); 
    });
    expect(view.result.current.error).toBe('');
    expect(view.result.current.health?.lastError).toBe('collection stale');
    expect(view.result.current.latest?.health.complete).toBe(true);
    expect(view.result.current.latest?.timestamp).toBe(recordedAt);
    view.unmount();
  });
  it('marks the Performance view degraded when IPC succeeds but collection is stale', async () => {
    const healthy = { complete: true, errors: 0, gaps: 0, dropped: 0, lastError: '' };
    service.GetHistory.mockResolvedValue({
      samples: [{
        sequence: 1,
        timestamp: '2026-11-07T00:00:00Z',
        identity: { version: 'test', revision: 'abc', sourceState: 'clean' },
        metrics: [],
        health: healthy,
      }],
      health: { ...healthy, complete: false, gaps: 1, lastError: 'collection stale' },
    });
    const view = render(<QueryWrapper><MemoryRouter><Performance /></MemoryRouter></QueryWrapper>);
    await waitFor(() => expect(screen.getByText('Degraded')).toBeVisible());
    expect(screen.getByText('collection stale')).toBeVisible();
    expect(screen.queryByText('Live')).not.toBeInTheDocument();
    view.unmount();
  });


  it('retains observed samples when a refresh fails', async () => {
    const view = renderHook(useDiagnostics, { wrapper: QueryWrapper });
    await waitFor(() => {
      expect(view.result.current.samples).toHaveLength(1); 
    });
    const observed = view.result.current.samples;
    service.GetHistory.mockRejectedValueOnce(new Error('collection unavailable'));
    await act(async () => {
      await view.result.current.refresh(); 
    });
    await waitFor(() => {
      expect(view.result.current.error).toContain('collection unavailable'); 
    });
    expect(view.result.current.samples).toBe(observed);
    view.unmount();
  });
});
