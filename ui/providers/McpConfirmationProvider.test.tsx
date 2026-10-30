import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import type * as WailsRuntime from '@wailsio/runtime';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const native = vi.hoisted(() => ({
  listeners: new Map<string, Set<(event: { data: unknown }) => void>>(),
  listPending: vi.fn(),
  resolve: vi.fn(),
  emit(name: string, data: unknown) {
    for (const listener of native.listeners.get(name) ?? []) {
      listener({ data });
    }
  },
}));

vi.mock('@omniviewdev/runtime/api', () => ({
  McpRelayClient: {
    ListPendingConfirmations: native.listPending,
    ResolveConfirmation: native.resolve,
  },
}));

vi.mock('@wailsio/runtime', async (importOriginal) => {
  const original = await importOriginal<typeof WailsRuntime>();
  return {
    ...original,
    Events: {
      ...original.Events,
      On: (name: string, callback: (event: { data: unknown }) => void) => {
        const listeners = native.listeners.get(name) ?? new Set();
        listeners.add(callback);
        native.listeners.set(name, listeners);
        return () => {
          listeners.delete(callback);
        };
      },
    },
  };
});

import { McpConfirmationProvider } from './McpConfirmationProvider';

const request = {
  id: 'req-1',
  mcpName: 'kubernetes_delete_resource',
  pluginID: 'kubernetes',
  pluginName: 'Kubernetes',
  connectionID: 'test',
  connectionName: 'Test cluster',
  arguments: { apiVersion: 'v1', kind: 'ConfigMap', name: 'demo' },
  requestedAt: '2026-01-01T00:00:00Z',
};

describe('McpConfirmationProvider', () => {
  beforeEach(() => {
    native.listeners.clear();
    native.listPending.mockReset().mockResolvedValue([]);
    native.resolve.mockReset().mockResolvedValue(undefined);
  });

  afterEach(cleanup);

  it('shows a requested call and resolves it with Allow', async () => {
    render(<McpConfirmationProvider><div>app</div></McpConfirmationProvider>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await act(async () => {
      native.emit('mcp/confirmation/requested', request);
    });

    expect(screen.getByText('Allow Kubernetes tool "kubernetes_delete_resource"?')).toBeInTheDocument();
    expect(screen.getByText('Connection: Test cluster (test)')).toBeInTheDocument();
    expect(screen.getByTestId('mcp-confirmation-arguments').textContent).toContain('"kind": "ConfigMap"');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    });

    expect(native.resolve).toHaveBeenCalledWith('req-1', true);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('drops a request that the backend resolved elsewhere', async () => {
    native.listPending.mockResolvedValue([request]);
    render(<McpConfirmationProvider><div>app</div></McpConfirmationProvider>);
    expect(await screen.findByRole('button', { name: 'Deny' })).toBeInTheDocument();

    await act(async () => {
      native.emit('mcp/confirmation/resolved', { id: 'req-1', approved: false, reason: 'timeout' });
    });

    expect(screen.queryByRole('button', { name: 'Deny' })).not.toBeInTheDocument();
    expect(native.resolve).not.toHaveBeenCalled();
  });
});
