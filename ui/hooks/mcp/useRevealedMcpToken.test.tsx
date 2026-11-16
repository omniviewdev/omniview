import type { ReactNode } from 'react';
import { renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const relay = vi.hoisted(() => ({ revealToken: vi.fn() }));

vi.mock('./hostRelayClient', () => ({ McpRelayClient: { RevealToken: relay.revealToken } }));

import { useRevealedMcpToken } from './useMcpRelay';

const TOKEN_KEY = ['mcp', 'token'];

describe('useRevealedMcpToken', () => {
  let client: QueryClient;
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );

  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    relay.revealToken.mockReset().mockResolvedValue('secret-token');
  });

  afterEach(() => {
    client.clear();
  });

  it('does not ask for the token until it is shown', () => {
    const { result } = renderHook(() => useRevealedMcpToken(false), { wrapper });

    expect(result.current).toBeUndefined();
    expect(relay.revealToken).not.toHaveBeenCalled();
    expect(client.getQueryData(TOKEN_KEY)).toBeUndefined();
  });

  it('drops the token from the cache when it is hidden', async () => {
    const { result, rerender } = renderHook(({ visible }) => useRevealedMcpToken(visible), {
      wrapper,
      initialProps: { visible: true },
    });
    await waitFor(() => {
      expect(result.current).toBe('secret-token');
    });
    expect(client.getQueryData(TOKEN_KEY)).toBe('secret-token');

    rerender({ visible: false });

    expect(result.current).toBeUndefined();
    await waitFor(() => {
      expect(client.getQueryData(TOKEN_KEY)).toBeUndefined();
    });
  });

  it('drops the token from the cache when the page is left', async () => {
    const { result, unmount } = renderHook(() => useRevealedMcpToken(true), { wrapper });
    await waitFor(() => {
      expect(result.current).toBe('secret-token');
    });

    unmount();

    await waitFor(() => {
      expect(client.getQueryData(TOKEN_KEY)).toBeUndefined();
    });
  });
});
