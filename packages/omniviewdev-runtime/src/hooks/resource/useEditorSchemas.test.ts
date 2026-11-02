import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type { EditorSchemaAssociation, EditorSchemaDocument } from '../../resource/v2/schema';
import { useEditorSchemas } from './useEditorSchemas';
import { editorModelPath, useResourceEditorModelPath, useSchemaFields } from './useSchemaFields';

const native = vi.hoisted(() => ({ schemas: vi.fn(), document: vi.fn(), fields: vi.fn(), phase: 'connected', generation: 1, listeners: new Set<() => void>() }));
vi.mock('../../resource/v2/client', () => ({ GetEditorSchemas: native.schemas, GetEditorSchemaDocument: native.document, GetSchemaFields: native.fields }));
vi.mock('../useResolvedPluginId', () => ({ useResolvedPluginId: (id?: string) => id ?? 'provider' }));
vi.mock('../connection/useConnectionReadiness', () => ({ useConnectionReadiness: () => ({ phase: native.phase }) }));
vi.mock('../../connection/connectionReadiness', () => ({
  getConnectionReadinessGeneration: () => native.generation,
  isConnectionReadinessCurrent: (_plugin: string, _connection: string, generation: number) => native.phase === 'connected' && native.generation === generation,
  connectionReadinessStore: () => ({ subscribe: (listener: () => void) => { native.listeners.add(listener); return () => { native.listeners.delete(listener); }; } }),
}));

function association(overrides: Partial<EditorSchemaAssociation>): EditorSchemaAssociation {
  const hex16 = (overrides.type ?? 'type').length.toString(16).padStart(16, '0');
  return {
    type: 'k8s:/pods', representation: 'native', language: 'yaml', status: 'available', documentId: 'core', root: '#/definitions/n1',
    modelDirectory: `file:///omniview-schema/${hex16}`, fileMatch: `**/omniview-schema/${hex16}/*`,
    ...overrides,
  };
}

function client() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

it('fetches each unique available document once and skips non-available associations', async () => {
  const associations = [
    association({ type: 'k8s:/pods', documentId: 'core' }),
    association({ type: 'k8s:/services', documentId: 'core', root: '#/definitions/n2' }),
    association({ type: 'k8s:apps/deployments', documentId: 'apps' }),
    association({ type: 'k8s:/secrets', status: 'unavailable', code: 'FORBIDDEN', documentId: undefined, root: undefined }),
  ];
  native.schemas.mockResolvedValue(associations);
  native.document.mockImplementation((_plugin: string, _route: unknown, documentId: string) => Promise.resolve({ documentId, schema: { definitions: {} } }));
  const { queryClient, wrapper } = client();
  const route = { connection: 'cluster' };
  const hook = renderHook(() => useEditorSchemas({ pluginID: 'provider', route }), { wrapper });
  await waitFor(() => expect(hook.result.current.associations).toEqual(associations));
  expect(hook.result.current.documents.map((document) => document.documentId)).toEqual(['core', 'apps']);
  expect(native.document).toHaveBeenCalledTimes(2);
  expect(queryClient.getQueryData(['provider', 'resource-v2', 'editor-schema-document', route, 'core', 1])).toEqual({ documentId: 'core', schema: { definitions: {} } });
  hook.unmount();
  queryClient.clear();
  native.document.mockReset();
});

it('keeps associations unpublished while a later document is pending or fails', async () => {
  native.schemas.mockResolvedValue([association({ documentId: 'core' }), association({ type: 'k8s:apps/deployments', documentId: 'apps' })]);
  let started!: () => void;
  const pendingStarted = new Promise<void>((resolve) => { started = resolve; });
  let rejectPending!: (reason: Error) => void;
  const pending = new Promise<EditorSchemaDocument>((_resolve, reject) => { rejectPending = reject; });
  native.document.mockImplementation((_plugin: string, _route: unknown, documentId: string) => {
    if (documentId === 'core') return Promise.resolve({ documentId, schema: {} });
    started();
    return pending;
  });
  const { queryClient, wrapper } = client();
  const hook = renderHook(() => useEditorSchemas({ pluginID: 'provider', route: { connection: 'cluster' } }), { wrapper });
  try {
    await act(async () => { await pendingStarted; });
    expect(hook.result.current.isLoading).toBe(true);
    expect(hook.result.current.associations).toEqual([]);
    await act(async () => { rejectPending(new Error('document not referenced')); });
    await waitFor(() => expect(hook.result.current.error).toBeInstanceOf(Error));
    expect(hook.result.current.associations).toEqual([]);
    expect(hook.result.current.documents).toEqual([]);
  } finally {
    hook.unmount();
    queryClient.clear();
    native.document.mockReset();
  }
});

it('cancels an owned editor-document request when its consumer unmounts', async () => {
  native.schemas.mockResolvedValue([association({ documentId: 'shared' })]);
  const pending = Promise.withResolvers<EditorSchemaDocument>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  native.document.mockReturnValue(Object.assign(pending.promise, { cancel }));
  const { queryClient, wrapper } = client();
  const route = { connection: 'cluster' };
  const hook = renderHook(() => useEditorSchemas({ pluginID: 'provider', route }), { wrapper });
  await waitFor(() => expect(native.document).toHaveBeenCalledWith('provider', route, 'shared'));
  hook.unmount();
  expect(cancel).toHaveBeenCalledTimes(1);
  await act(async () => { pending.resolve({ documentId: 'shared', schema: {} }); });
  expect(queryClient.getQueryData(['provider', 'resource-v2', 'editor-schema-document', route, 'shared', 1])).toBeUndefined();
  queryClient.clear();
  native.document.mockReset();
});

it('clears schemas while disconnected and reacquires them after reconnecting', async () => {
  native.schemas.mockReset();
  native.document.mockReset();
  native.schemas.mockResolvedValueOnce([association({ documentId: 'first' })])
    .mockResolvedValueOnce([association({ documentId: 'second' })]);
  native.document.mockImplementation((_plugin: string, _route: unknown, documentId: string) => Promise.resolve({ documentId, schema: {} }));
  const { queryClient, wrapper } = client();
  const hook = renderHook(() => useEditorSchemas({ pluginID: 'provider', route: { connection: 'cluster' } }), { wrapper });
  try {
    await waitFor(() => expect(hook.result.current.documents[0]?.documentId).toBe('first'));
    act(() => {
      native.phase = 'disconnected';
      native.generation = 2;
      native.listeners.forEach((listener) => listener());
    });
    expect(hook.result.current.associations).toEqual([]);
    expect(hook.result.current.documents).toEqual([]);
    act(() => {
      native.phase = 'connected';
      native.generation = 3;
      native.listeners.forEach((listener) => listener());
    });
    await waitFor(() => expect(hook.result.current.documents[0]?.documentId).toBe('second'));
    expect(native.schemas).toHaveBeenCalledTimes(2);
  } finally {
    hook.unmount();
    queryClient.clear();
    native.phase = 'connected';
    native.generation = 1;
    native.schemas.mockReset();
    native.document.mockReset();
  }
});

it('derives model paths from the matching catalog or auxiliary association', async () => {
  const catalog = association({ type: 'helm:releases', representation: 'native', modelDirectory: 'file:///omniview-schema/aaaaaaaaaaaaaaaa' });
  const values = association({ type: 'helm:releases', representation: undefined, key: 'default/web', language: 'json', modelDirectory: 'file:///omniview-schema/bbbbbbbbbbbbbbbb' });
  native.schemas.mockResolvedValue([values, catalog]);
  native.document.mockImplementation((_plugin: string, _route: unknown, documentId: string) => Promise.resolve({ documentId, schema: {} }));
  expect(editorModelPath(catalog, 'my draft')).toBe('file:///omniview-schema/aaaaaaaaaaaaaaaa/my%20draft.yaml');
  const { queryClient, wrapper } = client();
  const route = { connection: 'cluster' };
  const hook = renderHook(() => ({
    catalog: useResourceEditorModelPath({ pluginID: 'provider', route, type: 'helm:releases', name: 'draft' }),
    represented: useResourceEditorModelPath({ pluginID: 'provider', route, type: 'helm:releases', representation: 'native', name: 'draft' }),
    other: useResourceEditorModelPath({ pluginID: 'provider', route, type: 'helm:releases', representation: 'summary', name: 'draft' }),
    aux: useResourceEditorModelPath({ pluginID: 'provider', route, type: 'helm:releases', key: 'default/web', name: 'values' }),
  }), { wrapper });
  expect(hook.result.current.catalog).toBeUndefined();
  await waitFor(() => expect(hook.result.current.catalog).toBe('file:///omniview-schema/aaaaaaaaaaaaaaaa/draft.yaml'));
  expect(hook.result.current.represented).toBe(hook.result.current.catalog);
  expect(hook.result.current.other).toBeUndefined();
  expect(hook.result.current.aux).toBe('file:///omniview-schema/bbbbbbbbbbbbbbbb/values.json');
  hook.unmount();
  queryClient.clear();
  native.document.mockReset();
});

it('fetches schema fields under the schema-fields key', async () => {
  const result = { catalogRevision: 'r', type: 'k8s:/pods', representation: 'native', schemaState: 'absent', fields: [], truncated: false,
    overlay: { Operations: [], NativeQueryLanguages: [], HostEvaluation: 'dynamic', HostEvaluationCode: '', Validation: 'none', Unvalidated: null } };
  native.fields.mockResolvedValue(result);
  const { queryClient, wrapper } = client();
  const route = { connection: 'cluster' };
  const path = [{ Kind: 'field' as const, Name: 'spec' }];
  const hook = renderHook(() => useSchemaFields({ pluginID: 'provider', route, type: 'k8s:/pods', path }), { wrapper });
  await waitFor(() => expect(hook.result.current.overlay?.HostEvaluation).toBe('dynamic'));
  expect(native.fields).toHaveBeenCalledWith('provider', { route, type: 'k8s:/pods', representation: undefined, path });
  expect(queryClient.getQueryData(['provider', 'resource-v2', 'schema-fields', route, 'k8s:/pods', '', path, 1])).toEqual(result);
  hook.unmount();
  queryClient.clear();
});

it('reacquires schema fields after readiness generation changes', async () => {
  native.fields.mockReset();
  const result = (hostEvaluation: string) => ({ catalogRevision: hostEvaluation, type: 'pods', representation: 'native', schemaState: 'absent', fields: [], truncated: false,
    overlay: { Operations: [], NativeQueryLanguages: [], HostEvaluation: hostEvaluation, HostEvaluationCode: '', Validation: 'none', Unvalidated: null } });
  native.fields.mockResolvedValueOnce(result('dynamic')).mockResolvedValueOnce(result('schemaChecked'));
  const { queryClient, wrapper } = client();
  const route = { connection: 'cluster' };
  const hook = renderHook(() => useSchemaFields({ pluginID: 'provider', route, type: 'pods', path: [] }), { wrapper });
  await waitFor(() => expect(hook.result.current.overlay?.HostEvaluation).toBe('dynamic'));
  act(() => {
    native.phase = 'disconnected';
    native.generation = 2;
    native.listeners.forEach((listener) => listener());
  });
  expect(hook.result.current.overlay).toBeUndefined();
  act(() => {
    native.phase = 'connected';
    native.generation = 3;
    native.listeners.forEach((listener) => listener());
  });
  await waitFor(() => expect(hook.result.current.overlay?.HostEvaluation).toBe('schemaChecked'));
  expect(native.fields).toHaveBeenCalledTimes(2);
  hook.unmount();
  queryClient.clear();
  native.phase = 'connected';
  native.generation = 1;
  native.fields.mockReset();
});
