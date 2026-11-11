import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type * as WailsRuntime from '@wailsio/runtime';
import type { EditorSchemaResult, SchemaRequest } from '@omniviewdev/runtime';
import { schemaRegistry } from './schemaRegistry';
import { useSchemaRegistration } from './useSchemaRegistration';

const native = vi.hoisted(() => ({
  schema: vi.fn(),
  check: vi.fn(),
  yaml: vi.fn(),
  json: vi.fn(),
  listeners: new Map<string, Set<(event: { data: unknown }) => void>>(),
}));

// Keep the real runtime hook, query ownership, readiness store and registry.
// Only native host I/O and the external Monaco adapters cross test boundaries.
vi.mock('@wailsio/runtime', async (importOriginal) => {
  const actual = await importOriginal<typeof WailsRuntime>();
  return {
    ...actual,
    Call: {
      ...actual.Call,
      ByName: (method: string, pluginID: string, request: SchemaRequest) => {
        if (!method.endsWith('.ResolveEditorSchema')) {
          throw new Error(`Unexpected native call: ${method}`);
        }

        return native.schema(pluginID, request);
      },
    },
    Events: {
      ...actual.Events,
      On: (name: string, listener: (event: { data: unknown }) => void) => {
        const listeners = native.listeners.get(name) ?? new Set();
        listeners.add(listener);
        native.listeners.set(name, listeners);
        return () => listeners.delete(listener);
      },
    },
  };
});
vi.mock('../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/resource/servicewrapper', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  CheckConnection: native.check,
}));
vi.mock('@/providers/monaco/bootstrap', () => ({
  monacoYaml: { update: native.yaml },
  monaco: { languages: { json: { jsonDefaults: { setDiagnosticsOptions: native.json } } } },
}));

const request: SchemaRequest = {
  route: { connection: 'cluster' },
  type: 'pods',
  target: { representation: { id: 'native', revision: 'format-1' } },
};
const firstURI = 'file:///editors/first.yaml';
const secondURI = 'file:///editors/second.yaml';
const clients: QueryClient[] = [];

function available(target = request): EditorSchemaResult {
  return {
    type: target.type,
    target: target.target,
    observation: 'observed-1',
    status: 'available',
    root: '#/definitions/root',
    document: {
      documentId: 'shared-rendered-document',
      schema: { definitions: { root: { type: 'object', properties: { replicas: { type: 'integer' } } } } },
    },
  };
}

function client() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  clients.push(queryClient);
  const wrapper = ({ children }: React.PropsWithChildren) =>
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
  return { wrapper };
}

function registeredModels() {
  return Object.values(schemaRegistry.getSnapshot()).flatMap((entries) =>
    entries.flatMap((entry) => entry.fileMatch ? [entry.fileMatch] : []));
}

async function flushMicrotasks() {
  const { promise, resolve } = Promise.withResolvers<void>();
  queueMicrotask(resolve);
  await promise;
}

function emit(name: string, data: unknown) {
  act(() => {
    for (const listener of native.listeners.get(name) ?? []) {
      listener({ data });
    }
  });
}

beforeEach(() => {
  native.schema.mockReset().mockImplementation(async (_pluginID: string, target: SchemaRequest) => Promise.resolve(available(target)));
  native.check.mockReset().mockImplementation(async (_pluginID: string, connectionID: string) => Promise.resolve({
    status: 'CONNECTED', connection: { id: connectionID, name: connectionID }, error: '', details: '',
  }));
  native.yaml.mockClear();
  native.json.mockClear();
});

afterEach(async () => {
  cleanup();
  for (const queryClient of clients.splice(0)) {
    queryClient.clear();
  }

  schemaRegistry.unregisterPlugin('provider');
  native.listeners.clear();
  await flushMicrotasks();
});

it('registers the pre-existing exact URI only after its coherent result arrives', async () => {
  const pending = Promise.withResolvers<EditorSchemaResult>();
  native.schema.mockReturnValue(pending.promise);
  const { wrapper } = client();
  const hook = renderHook(() => useSchemaRegistration({ pluginID: 'provider', request, modelURI: firstURI }), { wrapper });
  await waitFor(() => {
    expect(native.schema).toHaveBeenCalledOnce(); 
  });
  expect(hook.result.current.result).toBeUndefined();
  expect(hook.result.current.isPending).toBe(true);
  expect(registeredModels()).toEqual([]);
  const result = available();
  await act(async () => {
    pending.resolve(result); 
  });
  await waitFor(() => {
    expect(registeredModels()).toEqual([firstURI]); 
  });
  expect(hook.result.current.result).toEqual(result);
  expect(hook.result.current.isPending).toBe(false);
});

it('keeps a shared exact model registered until its last consumer unmounts', async () => {
  const { wrapper } = client();
  const first = renderHook(() => useSchemaRegistration({ pluginID: 'provider', request, modelURI: firstURI }), { wrapper });
  const second = renderHook(() => useSchemaRegistration({ pluginID: 'provider', request, modelURI: firstURI }), { wrapper });
  await waitFor(() => {
    expect(registeredModels()).toEqual([firstURI, firstURI]); 
  });
  expect(schemaRegistry.getRegisteredKeys()).toHaveLength(2);
  expect(native.schema).toHaveBeenCalledOnce();
  second.unmount();
  expect(registeredModels()).toEqual([firstURI]);
  expect(first.result.current.result?.status).toBe('available');
  first.unmount();
  expect(registeredModels()).toEqual([]);
  await flushMicrotasks();
  expect(schemaRegistry.getLastFlushedYamlSchemas()).toEqual([]);
});

it('releases a disabled owner without releasing another exact model owner', async () => {
  const { wrapper } = client();
  const first = renderHook(
    ({ enabled }) => useSchemaRegistration({ pluginID: 'provider', request, modelURI: firstURI, enabled }),
    { wrapper, initialProps: { enabled: true } },
  );
  const second = renderHook(() => useSchemaRegistration({ pluginID: 'provider', request, modelURI: secondURI }), { wrapper });
  await waitFor(() => {
    expect(registeredModels().toSorted()).toEqual([firstURI, secondURI]); 
  });
  const ownerKeys = schemaRegistry.getRegisteredKeys();
  first.rerender({ enabled: false });
  expect(registeredModels()).toEqual([secondURI]);
  expect(first.result.current.result).toBeUndefined();
  expect(second.result.current.result?.status).toBe('available');
  await flushMicrotasks();
  expect(schemaRegistry.getLastFlushedYamlSchemas().flatMap((entry) => entry.fileMatch)).toEqual([secondURI]);
  first.rerender({ enabled: true });
  await waitFor(() => {
    expect(registeredModels().sort()).toEqual([firstURI, secondURI]); 
  });
  expect(schemaRegistry.getRegisteredKeys().sort()).toEqual(ownerKeys.sort());
  expect(native.schema).toHaveBeenCalledOnce();
});

it.each(['absent', 'unavailable', 'unsupported', 'invalid', 'limit'] as const)(
  'clears only its owner and preserves the explicit %s target status', async (status) => {
    const otherRequest: SchemaRequest = { ...request, type: 'disks' };
    const { wrapper } = client();
    const first = renderHook(() => useSchemaRegistration({ pluginID: 'provider', request, modelURI: firstURI }), { wrapper });
    const second = renderHook(() => useSchemaRegistration({ pluginID: 'provider', request: otherRequest, modelURI: secondURI }), { wrapper });
    await waitFor(() => {
      expect(registeredModels().toSorted()).toEqual([firstURI, secondURI]); 
    });
    const unavailable: EditorSchemaResult = {
      type: request.type, target: request.target, observation: 'observed-2', status,
      ...(status === 'unavailable' ? { code: 'FORBIDDEN' } : {}),
    };
    native.schema.mockImplementation(async (_pluginID: string, target: SchemaRequest) =>
      Promise.resolve(target.type === request.type ? unavailable : available(target)));
    await act(async () => {
      await first.result.current.refetch(); 
    });
    await waitFor(() => {
      expect(registeredModels()).toEqual([secondURI]); 
    });
    expect(first.result.current.result).toEqual(unavailable);
    expect(first.result.current.error).toBeNull();
    expect(second.result.current.result?.status).toBe('available');
  },
);

it('leaves an undefined request pending and unregistered without native demand', () => {
  const { wrapper } = client();
  const hook = renderHook(() => useSchemaRegistration({ pluginID: 'provider', request: undefined, modelURI: firstURI }), { wrapper });
  expect(hook.result.current.result).toBeUndefined();
  expect(hook.result.current.isPending).toBe(true);
  expect(registeredModels()).toEqual([]);
  expect(native.schema).not.toHaveBeenCalled();
  expect(native.check).not.toHaveBeenCalled();
});

it('retires only the disconnected connection owner', async () => {
  const otherRequest: SchemaRequest = { ...request, route: { connection: 'other-cluster' } };
  const { wrapper } = client();
  const first = renderHook(() => useSchemaRegistration({ pluginID: 'provider', request, modelURI: firstURI }), { wrapper });
  const second = renderHook(() => useSchemaRegistration({ pluginID: 'provider', request: otherRequest, modelURI: secondURI }), { wrapper });
  await waitFor(() => {
    expect(registeredModels()).toEqual([firstURI, secondURI]); 
  });
  emit('connection/status', { pluginID: 'provider', connectionID: 'cluster', status: 'DISCONNECTED' });
  await waitFor(() => {
    expect(registeredModels()).toEqual([secondURI]); 
  });
  expect(first.result.current.result).toBeUndefined();
  expect(first.result.current.isPending).toBe(true);
  expect(second.result.current.result?.status).toBe('available');
});

it('uses a JSON-only registration when the editor language is JSON', async () => {
  const modelURI = 'file:///editors/resource.json';
  const { wrapper } = client();
  renderHook(() => useSchemaRegistration({ pluginID: 'provider', request, modelURI, language: 'json' }), { wrapper });
  await waitFor(() => {
    expect(registeredModels()).toEqual([modelURI]); 
  });
  const entries = Object.values(schemaRegistry.getSnapshot()).flat();
  expect(entries.every((entry) => entry.language === 'json')).toBe(true);
  await flushMicrotasks();
  expect(schemaRegistry.getLastFlushedYamlSchemas()).toEqual([]);
});
