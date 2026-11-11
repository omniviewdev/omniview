import React from 'react';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { focusManager, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { SchemaRequest } from '../../resource/v2/domain';
import type { EditorSchemaResult, SchemaFieldsResult } from '../../resource/v2/schema';
import { useEditorSchema } from './useEditorSchema';
import { useSchemaFields } from './useSchemaFields';

const native = vi.hoisted(() => ({
  schema: vi.fn(), fields: vi.fn(), phase: 'connected', generation: 1, listeners: new Set<() => void>(),
}));
vi.mock('../../resource/v2/client', () => ({ ResolveEditorSchema: native.schema, GetSchemaFields: native.fields }));
vi.mock('../useResolvedPluginId', () => ({ useResolvedPluginId: (id?: string) => id ?? 'provider' }));
vi.mock('../connection/useConnectionReadiness', () => ({ useConnectionReadiness: () => ({ phase: native.phase }) }));
vi.mock('../../connection/connectionReadiness', () => ({
  getConnectionReadinessGeneration: () => native.generation,
  isConnectionReadinessCurrent: (_plugin: string, _connection: string, generation: number) =>
    native.phase === 'connected' && native.generation === generation,
  connectionReadinessStore: () => ({
    subscribe: (listener: () => void) => {
      native.listeners.add(listener);
      return () => { native.listeners.delete(listener); };
    },
  }),
}));

const request: SchemaRequest = {
  route: { connection: 'cluster' }, type: 'k8s:/pods',
  target: { representation: { id: 'native', revision: 'format-1' } },
};
const clients: QueryClient[] = [];
const key = (target = request, generation = 1) => ['provider', 'resource-v2', 'editor-schema', target, generation];

function available(observation = 'first', target = request): EditorSchemaResult {
  return {
    type: target.type, target: target.target, observation, status: 'available',
    schemaRevision: observation, dialect: 'draft-07', root: '#/definitions/root',
    document: { documentId: observation, schema: { definitions: { root: { type: 'object' } } } },
  };
}

function fields(observation = 'first'): SchemaFieldsResult {
  return {
    type: request.type, target: request.target, observation, schemaState: 'available',
    schemaRevision: observation, fields: [], truncated: false,
    overlay: {
      Operations: [], NativeQueryLanguages: [], HostEvaluation: 'schemaChecked',
      HostEvaluationCode: '', Validation: 'full', Unvalidated: null,
    },
  };
}

function client() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  clients.push(queryClient);
  const wrapper = ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
  return { queryClient, wrapper };
}

function readiness(phase: string, generation: number) {
  act(() => {
    native.phase = phase;
    native.generation = generation;
    native.listeners.forEach(listener => listener());
  });
}

beforeEach(() => {
  native.schema.mockReset();
  native.fields.mockReset();
  native.phase = 'connected';
  native.generation = 1;
});

afterEach(() => {
  cleanup();
  for (const queryClient of clients.splice(0)) queryClient.clear();
  native.listeners.clear();
  focusManager.setFocused(undefined);
});

it('publishes only the demanded target with its coherent rendered document after pending resolves', async () => {
  const pending = Promise.withResolvers<EditorSchemaResult>();
  native.schema.mockReturnValue(pending.promise);
  const { wrapper, queryClient } = client();
  const hook = renderHook(() => useEditorSchema({ pluginID: 'provider', request }), { wrapper });
  await waitFor(() => expect(native.schema).toHaveBeenCalledOnce());
  expect(hook.result.current.result).toBeUndefined();
  expect(hook.result.current.isPending).toBe(true);
  const result = available();
  await act(async () => { pending.resolve(result); });
  await waitFor(() => expect(hook.result.current.result).toEqual(result));
  expect(native.schema).toHaveBeenCalledWith('provider', request);
  expect(queryClient.getQueryData(key())).toEqual(result);
  expect(native.fields).not.toHaveBeenCalled();
});

it.each(['absent', 'unavailable', 'unsupported', 'invalid', 'limit'] as const)(
  'preserves explicit %s outcomes without fabricating a document or throwing',
  async status => {
    const result: EditorSchemaResult = {
      type: request.type, target: request.target, observation: 'observed', status,
      ...(status === 'unavailable' ? { code: 'FORBIDDEN' } : {}),
    };
    native.schema.mockResolvedValue(result);
    const { wrapper } = client();
    const hook = renderHook(() => useEditorSchema({ request }), { wrapper });
    await waitFor(() => expect(hook.result.current.result).toEqual(result));
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.result?.document).toBeUndefined();
  },
);

it('keeps unrequested and disconnected schema pending rather than reporting absent', async () => {
  native.schema.mockResolvedValue(available());
  const { wrapper } = client();
  const hook = renderHook(({ target }: { target: SchemaRequest | undefined }) =>
    useEditorSchema({ request: target }), { wrapper, initialProps: { target: undefined } });
  expect(hook.result.current.result).toBeUndefined();
  expect(hook.result.current.isPending).toBe(true);
  expect(native.schema).not.toHaveBeenCalled();
  readiness('disconnected', 2);
  hook.rerender({ target: request });
  expect(hook.result.current.result).toBeUndefined();
  expect(hook.result.current.isPending).toBe(true);
  expect(native.schema).not.toHaveBeenCalled();
  readiness('connected', 3);
  await waitFor(() => expect(hook.result.current.result?.status).toBe('available'));
});

it('coalesces target owners and preserves remaining demand when one owner unmounts', async () => {
  const pending = Promise.withResolvers<EditorSchemaResult>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  native.schema.mockReturnValue(Object.assign(pending.promise, { cancel }));
  const { wrapper } = client();
  const first = renderHook(() => useEditorSchema({ request }), { wrapper });
  const second = renderHook(() => useEditorSchema({ request: structuredClone(request) }), { wrapper });
  await waitFor(() => expect(native.schema).toHaveBeenCalledOnce());
  first.unmount();
  expect(cancel).not.toHaveBeenCalled();
  await act(async () => { pending.resolve(available()); });
  await waitFor(() => expect(second.result.current.result?.document?.documentId).toBe('first'));
  expect(cancel).not.toHaveBeenCalled();
  second.unmount();
  const later = renderHook(() => useEditorSchema({ request }), { wrapper });
  await waitFor(() => expect(later.result.current.result?.observation).toBe('first'));
  expect(native.schema).toHaveBeenCalledOnce();
});

it('cancels the last target owner and rejects a late successful response', async () => {
  const pending = Promise.withResolvers<EditorSchemaResult>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  native.schema.mockReturnValue(Object.assign(pending.promise, { cancel }));
  const { wrapper, queryClient } = client();
  const hook = renderHook(() => useEditorSchema({ request }), { wrapper });
  await waitFor(() => expect(native.schema).toHaveBeenCalledOnce());
  hook.unmount();
  expect(cancel).toHaveBeenCalledOnce();
  await act(async () => { pending.resolve(available('late')); });
  expect(queryClient.getQueryData(key())).toBeUndefined();
  expect(native.listeners.size).toBe(0);
});

it('does not reuse one format revision or auxiliary admission for a different target', async () => {
  const auxiliary: SchemaRequest = {
    route: request.route, type: 'helm:releases',
    target: { auxiliary: {
      key: 'team/release', sourceRevision: 'installed-7',
      reference: { address: {
        provider: 'helm', authority: 'host-authority', type: 'helm:releases',
        scope: [{ dimension: 'namespace', value: 'team' }], id: 'release',
      }, incarnation: 'release-incarnation' },
    } },
  };
  native.schema.mockImplementation((_plugin: string, target: SchemaRequest) =>
    Promise.resolve(available(JSON.stringify(target.target), target)));
  const { wrapper } = client();
  const hook = renderHook(({ target }) => useEditorSchema({ request: target }), {
    wrapper, initialProps: { target: request },
  });
  await waitFor(() => expect(hook.result.current.result?.target).toEqual(request.target));
  const next: SchemaRequest = { ...request, target: { representation: { id: 'native', revision: 'format-2' } } };
  hook.rerender({ target: next });
  await waitFor(() => expect(hook.result.current.result?.target).toEqual(next.target));
  hook.rerender({ target: auxiliary });
  await waitFor(() => expect(hook.result.current.result?.target).toEqual(auxiliary.target));
  expect(native.schema).toHaveBeenCalledTimes(3);
  expect(native.schema).toHaveBeenLastCalledWith('provider', auxiliary);
});

it('cancels obsolete target demand without publishing it into the next target', async () => {
  const old = Promise.withResolvers<EditorSchemaResult>();
  const next = Promise.withResolvers<EditorSchemaResult>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  native.schema.mockReturnValueOnce(Object.assign(old.promise, { cancel })).mockReturnValueOnce(next.promise);
  const target: SchemaRequest = { ...request, type: 'k8s:/services' };
  const { wrapper, queryClient } = client();
  const hook = renderHook(({ selected }) => useEditorSchema({ request: selected }), {
    wrapper, initialProps: { selected: request },
  });
  await waitFor(() => expect(native.schema).toHaveBeenCalledOnce());
  hook.rerender({ selected: target });
  await waitFor(() => expect(native.schema).toHaveBeenCalledTimes(2));
  expect(cancel).toHaveBeenCalledOnce();
  expect(hook.result.current.result).toBeUndefined();
  await act(async () => { old.resolve(available('old')); });
  expect(hook.result.current.result).toBeUndefined();
  expect(queryClient.getQueryData(key())).toBeUndefined();
  await act(async () => { next.resolve(available('next', target)); });
  await waitFor(() => expect(hook.result.current.result?.type).toBe(target.type));
});

it('cancels retirement, hides cached evidence, and admits only the reconnected generation', async () => {
  const old = Promise.withResolvers<EditorSchemaResult>();
  const next = Promise.withResolvers<EditorSchemaResult>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  native.schema.mockReturnValueOnce(Object.assign(old.promise, { cancel })).mockReturnValueOnce(next.promise);
  const { wrapper, queryClient } = client();
  const hook = renderHook(() => useEditorSchema({ request }), { wrapper });
  await waitFor(() => expect(native.schema).toHaveBeenCalledOnce());
  readiness('disconnected', 2);
  expect(cancel).toHaveBeenCalledOnce();
  expect(hook.result.current.result).toBeUndefined();
  expect(hook.result.current.isPending).toBe(true);
  readiness('connected', 3);
  await waitFor(() => expect(native.schema).toHaveBeenCalledTimes(2));
  await act(async () => { old.resolve(available('retired')); });
  expect(queryClient.getQueryData(key())).toBeUndefined();
  expect(hook.result.current.result).toBeUndefined();
  await act(async () => { next.resolve(available('current')); });
  await waitFor(() => expect(hook.result.current.result?.observation).toBe('current'));
  expect(queryClient.getQueryData(key(request, 3))).toEqual(available('current'));
  readiness('disconnected', 4);
  expect(hook.result.current.result).toBeUndefined();
});

it('refreshes mounted enrichment without invalidating catalog, source, or generation', async () => {
  native.schema.mockResolvedValueOnce(available()).mockResolvedValueOnce(available('replacement'));
  const { wrapper, queryClient } = client();
  const catalogKey = ['provider', 'resource-v2', 'catalog', request.route, 1];
  const sourceKey = ['provider', 'resources', request.route, 'host-target'];
  const catalog = { revision: 'support-1', types: [] };
  const source = { complete: true, records: ['full-selected-body'] };
  queryClient.setQueryData(catalogKey, catalog);
  queryClient.setQueryData(sourceKey, source);
  const hook = renderHook(() => useEditorSchema({ request }), { wrapper });
  await waitFor(() => expect(hook.result.current.result?.observation).toBe('first'));
  await act(async () => { await hook.result.current.refetch(); });
  await waitFor(() => expect(hook.result.current.result?.document?.documentId).toBe('replacement'));
  expect(queryClient.getQueryData(catalogKey)).toBe(catalog);
  expect(queryClient.getQueryData(sourceKey)).toBe(source);
  expect(queryClient.getQueryState(catalogKey)?.isInvalidated).toBe(false);
  expect(queryClient.getQueryState(sourceKey)?.isInvalidated).toBe(false);
  expect(native.generation).toBe(1);
});

it('revalidates stale demanded enrichment on focus even when the app disables global focus refresh', async () => {
  focusManager.setFocused(false);
  native.schema.mockResolvedValueOnce(available()).mockResolvedValueOnce(available('focused'));
  const { wrapper, queryClient } = client();
  const hook = renderHook(() => useEditorSchema({ request }), { wrapper });
  await waitFor(() => expect(hook.result.current.result?.observation).toBe('first'));
  queryClient.setQueryData(key(), available(), { updatedAt: Date.now() - 31_000 });
  act(() => { focusManager.setFocused(true); });
  await waitFor(() => expect(hook.result.current.result?.observation).toBe('focused'));
  expect(native.schema).toHaveBeenCalledTimes(2);
});

it('exposes failed refresh locally without retaining successful typed evidence or retrying it', async () => {
  const failure = new Error('target admission rejected');
  native.schema.mockResolvedValueOnce(available()).mockRejectedValueOnce(failure);
  const { wrapper } = client();
  const hook = renderHook(() => useEditorSchema({ request }), { wrapper });
  await waitFor(() => expect(hook.result.current.result?.status).toBe('available'));
  await act(async () => { await hook.result.current.refetch(); });
  await waitFor(() => expect(hook.result.current.error).toBe(failure));
  expect(hook.result.current.result).toBeUndefined();
  expect(hook.result.current.isError).toBe(true);
  expect(native.schema).toHaveBeenCalledTimes(2);
});

it('preserves targeted field applicability, observation, and truncation without walking raw schemas', async () => {
  const result: SchemaFieldsResult = {
    ...fields(), truncated: true, truncationReason: 'visits',
    fields: [{
      Segment: { Kind: 'field', Name: 'template' }, Types: ['object'], Format: '', Title: '', Description: '',
      Enum: null, Presence: 'optional', Nullable: 'no', Applicability: 'conditional',
      Conditions: [{ Pointer: '/oneOf', Branch: 1, Combinator: 'oneOf' }],
      CELChecking: 'partial', HasChildren: true, NativeFilter: 'unsupported',
    }],
  };
  native.fields.mockResolvedValue(result);
  const path = [{ Kind: 'field' as const, Name: 'spec' }];
  const { wrapper, queryClient } = client();
  const hook = renderHook(() => useSchemaFields({ request, path }), { wrapper });
  await waitFor(() => expect(hook.result.current.result).toEqual(result));
  expect(hook.result.current.fields?.[0]?.Applicability).toBe('conditional');
  expect(hook.result.current.result?.truncated).toBe(true);
  expect(native.fields).toHaveBeenCalledWith('provider', { request, path });
  expect(queryClient.getQueryData(['provider', 'resource-v2', 'schema-fields', request, path, 1])).toEqual(result);
  expect(native.schema).not.toHaveBeenCalled();
});

it('hides fields while unrequested or retired and reacquires the exact target in a new generation', async () => {
  native.fields.mockResolvedValueOnce(fields()).mockResolvedValueOnce(fields('next'));
  const { wrapper } = client();
  const hook = renderHook(({ selected }: { selected: SchemaRequest | undefined }) =>
    useSchemaFields({ request: selected, path: [] }), { wrapper, initialProps: { selected: undefined } });
  expect(hook.result.current.fields).toBeUndefined();
  expect(hook.result.current.isPending).toBe(true);
  expect(native.fields).not.toHaveBeenCalled();
  hook.rerender({ selected: request });
  await waitFor(() => expect(hook.result.current.result?.observation).toBe('first'));
  readiness('disconnected', 2);
  expect(hook.result.current.fields).toBeUndefined();
  expect(hook.result.current.overlay).toBeUndefined();
  readiness('connected', 3);
  await waitFor(() => expect(hook.result.current.result?.observation).toBe('next'));
  expect(native.fields).toHaveBeenCalledTimes(2);
});

it('cancels the last field owner and rejects its late navigation evidence', async () => {
  const pending = Promise.withResolvers<SchemaFieldsResult>();
  const cancel = vi.fn().mockResolvedValue(undefined);
  native.fields.mockReturnValue(Object.assign(pending.promise, { cancel }));
  const { wrapper, queryClient } = client();
  const hook = renderHook(() => useSchemaFields({ request, path: [] }), { wrapper });
  await waitFor(() => expect(native.fields).toHaveBeenCalledOnce());
  hook.unmount();
  expect(cancel).toHaveBeenCalledOnce();
  await act(async () => { pending.resolve(fields('late')); });
  expect(queryClient.getQueryData(['provider', 'resource-v2', 'schema-fields', request, [], 1])).toBeUndefined();
  expect(native.listeners.size).toBe(0);
});

it('exposes the existing retirement token without rotating it for optional enrichment or failed reads', async () => {
  const optional: EditorSchemaResult = {
    type: request.type, target: request.target, observation: 'optional-unavailable',
    status: 'unavailable', code: 'FORBIDDEN',
  };
  const unavailable: SchemaFieldsResult = {
    ...fields('optional-unavailable'), schemaState: 'unavailable',
    overlay: { ...fields().overlay, HostEvaluation: 'unavailable', HostEvaluationCode: 'FORBIDDEN', Validation: 'none' },
  };
  const failure = new Error('schema read failed');
  native.schema.mockResolvedValueOnce(available()).mockResolvedValueOnce(optional).mockRejectedValueOnce(failure);
  native.fields.mockResolvedValueOnce(fields()).mockResolvedValueOnce(unavailable).mockRejectedValueOnce(failure);
  const { wrapper } = client();
  const hook = renderHook(() => ({
    editor: useEditorSchema({ request }),
    navigation: useSchemaFields({ request, path: [] }),
  }), { wrapper });
  await waitFor(() => expect(hook.result.current.editor.result?.status).toBe('available'));
  await waitFor(() => expect(hook.result.current.navigation.result?.schemaState).toBe('available'));
  expect(hook.result.current.editor.generation).toBe(1);
  expect(hook.result.current.navigation.generation).toBe(1);
  await act(async () => {
    await Promise.all([hook.result.current.editor.refetch(), hook.result.current.navigation.refetch()]);
  });
  await waitFor(() => expect(hook.result.current.editor.result?.status).toBe('unavailable'));
  await waitFor(() => expect(hook.result.current.navigation.result?.schemaState).toBe('unavailable'));
  expect(hook.result.current.editor.generation).toBe(1);
  expect(hook.result.current.navigation.generation).toBe(1);
  await act(async () => {
    await Promise.all([hook.result.current.editor.refetch(), hook.result.current.navigation.refetch()]);
  });
  await waitFor(() => expect(hook.result.current.editor.error).toBe(failure));
  await waitFor(() => expect(hook.result.current.navigation.error).toBe(failure));
  expect(hook.result.current.editor.generation).toBe(1);
  expect(hook.result.current.navigation.generation).toBe(1);
  expect(hook.result.current.editor.result).toBeUndefined();
  expect(hook.result.current.navigation.result).toBeUndefined();
  expect(hook.result.current.navigation.fields).toBeUndefined();
  expect(hook.result.current.navigation.overlay).toBeUndefined();
  readiness('forbidden', 2);
  expect(hook.result.current.editor.generation).toBe(2);
  expect(hook.result.current.navigation.generation).toBe(2);
  expect(hook.result.current.editor.result).toBeUndefined();
  expect(hook.result.current.navigation.fields).toBeUndefined();
  expect(native.schema).toHaveBeenCalledTimes(3);
  expect(native.fields).toHaveBeenCalledTimes(3);
});

it('withdraws cached schema claims while revalidation is pending or fails, then republishes a successful retry', async () => {
  const editorPending = Promise.withResolvers<EditorSchemaResult>();
  const fieldsPending = Promise.withResolvers<SchemaFieldsResult>();
  const originalFields: SchemaFieldsResult = {
    ...fields(), fields: [{
      Segment: { Kind: 'field', Name: 'spec' }, Types: ['object'], Format: '', Title: '', Description: '',
      Enum: null, Presence: 'optional', Nullable: 'no', Applicability: 'unconditional',
      Conditions: null, CELChecking: 'static', HasChildren: true, NativeFilter: 'unsupported',
    }],
  };
  native.schema.mockResolvedValueOnce(available()).mockReturnValueOnce(editorPending.promise)
    .mockResolvedValueOnce(available('retried'));
  native.fields.mockResolvedValueOnce(originalFields).mockReturnValueOnce(fieldsPending.promise)
    .mockResolvedValueOnce(fields('retried'));
  const { wrapper, queryClient } = client();
  const hook = renderHook(() => ({
    editor: useEditorSchema({ request }),
    navigation: useSchemaFields({ request, path: [] }),
  }), { wrapper });
  await waitFor(() => expect(hook.result.current.editor.result?.observation).toBe('first'));
  await waitFor(() => expect(hook.result.current.navigation.fields?.[0]?.Segment.Name).toBe('spec'));
  let refreshes: readonly Promise<unknown>[] = [];
  act(() => {
    refreshes = [hook.result.current.editor.refetch(), hook.result.current.navigation.refetch()];
  });
  await waitFor(() => expect(hook.result.current.editor.isFetching).toBe(true));
  await waitFor(() => expect(hook.result.current.navigation.isFetching).toBe(true));
  expect(hook.result.current.editor.result).toBeUndefined();
  expect(hook.result.current.navigation.result).toBeUndefined();
  expect(hook.result.current.navigation.fields).toBeUndefined();
  expect(hook.result.current.navigation.overlay).toBeUndefined();
  expect(hook.result.current.editor.isPending).toBe(true);
  expect(hook.result.current.navigation.isPending).toBe(true);
  expect(hook.result.current.navigation.generation).toBe(1);
  const failure = new Error('revalidation failed');
  await act(async () => {
    editorPending.reject(failure);
    fieldsPending.reject(failure);
    await Promise.all(refreshes);
  });
  await waitFor(() => expect(hook.result.current.editor.error).toBe(failure));
  await waitFor(() => expect(hook.result.current.navigation.error).toBe(failure));
  expect(queryClient.getQueryData(key())).toEqual(available());
  expect(queryClient.getQueryData(['provider', 'resource-v2', 'schema-fields', request, [], 1])).toEqual(originalFields);
  expect(hook.result.current.editor.result).toBeUndefined();
  expect(hook.result.current.navigation.result).toBeUndefined();
  expect(hook.result.current.navigation.fields).toBeUndefined();
  expect(hook.result.current.navigation.overlay).toBeUndefined();
  expect(hook.result.current.navigation.isError).toBe(true);
  await act(async () => {
    await Promise.all([hook.result.current.editor.refetch(), hook.result.current.navigation.refetch()]);
  });
  await waitFor(() => expect(hook.result.current.editor.result?.observation).toBe('retried'));
  await waitFor(() => expect(hook.result.current.navigation.result?.observation).toBe('retried'));
  expect(hook.result.current.navigation.generation).toBe(1);
});
