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
  argumentsJSON: '{ "apiVersion": "v1", "kind": "ConfigMap", "name": "demo" }',
  requestedAt: '2026-01-01T00:00:00Z',
  origin: 'external-agent',
  credentialID: 'host-credential-1',
  sessionID: 'host-session-1',
  target: { pluginID: 'kubernetes', connectionID: 'test', resourceKey: 'v1/configmaps', resourceID: 'demo' },
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
    expect(screen.getByText(/Host origin: external-agent; credential: host-credential-1/)).toBeInTheDocument();
    expect(screen.getByTestId('mcp-confirmation-target')).toHaveTextContent('v1/configmaps');
    expect(screen.getByTestId('mcp-confirmation-target')).toHaveTextContent('demo');

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

  it('never resurrects resolved consent from a delayed snapshot or requested event', async () => {
    const { promise, resolve: finish } = Promise.withResolvers<Array<typeof request>>();
    native.listPending.mockReturnValue(promise);
    render(<McpConfirmationProvider><div>app</div></McpConfirmationProvider>);
    await act(async () => {
      native.emit('mcp/confirmation/resolved', { id: request.id });
      finish([request]);
    });
    await act(async () => {
      native.emit('mcp/confirmation/requested', request);
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('merges requested events with the snapshot and authorizes only each selected request', async () => {
    const snapshot = Promise.withResolvers<Array<typeof request>>();
    const next = { ...request, id: 'req-2', argumentsJSON: '{"name":"next"}' };
    native.listPending.mockReturnValue(snapshot.promise);
    render(<McpConfirmationProvider><div>app</div></McpConfirmationProvider>);
    await act(async () => {
      native.emit('mcp/confirmation/requested', request);
      native.emit('mcp/confirmation/requested', next);
      snapshot.resolve([request]);
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    });
    expect(native.resolve).toHaveBeenCalledTimes(1);
    expect(native.resolve).toHaveBeenNthCalledWith(1, request.id, true);
    expect(screen.getByTestId('mcp-confirmation-arguments').textContent).toBe(next.argumentsJSON);
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    });
    expect(native.resolve).toHaveBeenCalledTimes(2);
    expect(native.resolve).toHaveBeenNthCalledWith(2, next.id, false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it.each(['resolve', 'reject'] as const)('ignores a cancelled snapshot that later %ss after reload', async (settle) => {
    const stale = Promise.withResolvers<Array<typeof request>>();
    native.listPending.mockReturnValueOnce(stale.promise).mockResolvedValue([request]);
    native.resolve.mockRejectedValueOnce(new Error('offline'));
    render(<McpConfirmationProvider><div>panel</div></McpConfirmationProvider>);
    await act(async () => {
      native.emit('mcp/confirmation/requested', request);
    });
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }));
    const reload = await screen.findByRole('button', { name: 'Reload pending requests' });
    await act(async () => {
      fireEvent.click(reload);
    });
    expect(native.listPending).toHaveBeenCalledTimes(2);

    await act(async () => {
      if (settle === 'resolve') {
        stale.resolve([]);
      } else {
        stale.reject(new Error('stale failure'));
      }
    });
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
    expect(screen.getByTestId('mcp-confirmation-arguments').textContent).toBe(request.argumentsJSON);
    expect(screen.queryByRole('button', { name: 'Retry pending requests' })).not.toBeInTheDocument();
    expect(native.resolve).toHaveBeenCalledTimes(1);
  });

  it('keeps failed decisions actionable and allows a successful retry', async () => {
    native.listPending.mockResolvedValue([request]);
    native.resolve.mockRejectedValueOnce(new Error('offline'));
    render(<McpConfirmationProvider><div>app</div></McpConfirmationProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Allow' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Decision could not be submitted');
    expect(screen.getByRole('button', { name: 'Deny' })).toBeEnabled();
    await act(async () => fireEvent.click(screen.getByRole('button', { name: 'Deny' })));
    expect(native.resolve).toHaveBeenLastCalledWith(request.id, false);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('resets list errors on retry, retains pending requests through failure, and recovers', async () => {
    const retry = Promise.withResolvers<Array<typeof request>>();
    native.listPending.mockRejectedValueOnce(new Error('offline'))
      .mockReturnValueOnce(retry.promise)
      .mockResolvedValue([request]);
    render(<McpConfirmationProvider><div>panel</div></McpConfirmationProvider>);
    const reload = await screen.findByRole('button', { name: 'Retry pending requests' });
    await act(async () => {
      native.emit('mcp/confirmation/requested', request);
      fireEvent.click(reload);
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
    expect(native.listPending).toHaveBeenCalledTimes(2);

    await act(async () => {
      retry.reject(new Error('still offline'));
    });
    const retryAgain = await screen.findByRole('button', { name: 'Retry pending requests' });
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
    expect(native.resolve).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(retryAgain);
    });
    expect(native.listPending).toHaveBeenCalledTimes(3);
    expect(screen.getByRole('button', { name: 'Allow' })).toBeEnabled();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each(['snapshot', 'event'])('preserves exact argument text through serialized %s payload', async (source) => {
    const argumentsJSON = '{"revision":9007199254740993,"value":-0}';
    const payload = JSON.parse(JSON.stringify({ ...request, argumentsJSON }));
    if (source === 'snapshot') {
      native.listPending.mockResolvedValue([payload]);
    }

    render(<McpConfirmationProvider><div>app</div></McpConfirmationProvider>);
    if (source === 'event') {
      await act(async () => {
        native.emit('mcp/confirmation/requested', payload);
      });
    }

    await screen.findByRole('dialog');
    expect(screen.getByTestId('mcp-confirmation-arguments').textContent).toBe(argumentsJSON);
  });
});
