import React from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { expect, it, vi } from 'vitest';
import type { EditorSchema } from '../../resource/v2/ancillary';
import type { SchemaDocument, SchemaDocumentReference } from '../../resource/v2/domain';
import { useEditorSchemas } from './useEditorSchemas';

const native = vi.hoisted(() => ({ schemas: vi.fn(), document: vi.fn() }));
vi.mock('../../resource/v2/client', () => ({ GetEditorSchemas: native.schemas, GetSchemaDocument: native.document }));
vi.mock('../useResolvedPluginId', () => ({ useResolvedPluginId: (id?: string) => id ?? 'provider' }));

it('keeps bindings unpublished while a later document is pending or fails', async () => {
  const dialect = 'https://json-schema.org/draft/2020-12/schema';
  const first = { id: 'core', revision: 'r1' };
  const second = { id: 'apps', revision: 'r2' };
  const schemas: EditorSchema[] = [first, second].map((reference, index) => ({
    type: index === 0 ? 'k8s:/pods' : 'k8s:apps/deployments',
    fileMatch: `file:///schema-${index}.yaml`,
    uri: `schema:///resource-${index}`,
    language: 'yaml',
    binding: { state: 'available', dialect, documentRef: reference, validation: 'none', unvalidated: [] },
  }));
  const document = (reference: SchemaDocumentReference): SchemaDocument => ({
    reference, dialect, document: { type: 'object' },
  });
  let started!: () => void;
  const pendingStarted = new Promise<void>((resolve) => { started = resolve; });
  let rejectPending!: (reason: Error) => void;
  const pending = new Promise<SchemaDocument>((_resolve, reject) => { rejectPending = reject; });
  let denied = false;
  native.schemas.mockResolvedValue(schemas);
  native.document.mockImplementation((_plugin: string, _route: unknown, reference: SchemaDocumentReference) => {
    if (reference.id === first.id) return Promise.resolve(document(reference));
    if (denied) return Promise.reject(new Error('document access denied'));
    started();
    return pending;
  });
  const client = new QueryClient({ defaultOptions: { queries: { retryDelay: 0, gcTime: 0 } } });
  const wrapper = ({ children }: { children: React.ReactNode }) => React.createElement(QueryClientProvider, { client }, children);
  const hook = renderHook(() => useEditorSchemas({ pluginID: 'provider', route: { connection: 'cluster' } }), { wrapper });
  try {
    await act(async () => { await pendingStarted; });
    expect(hook.result.current.isLoading).toBe(true);
    expect(hook.result.current.schemas).toEqual([]);
    expect(hook.result.current.documents).toEqual([]);
    denied = true;
    await act(async () => { rejectPending(new Error('document access denied')); });
    await waitFor(() => expect(hook.result.current.error).toBeInstanceOf(Error));
    expect(hook.result.current.schemas).toEqual([]);
    expect(hook.result.current.documents).toEqual([]);
  } finally {
    hook.unmount();
    client.clear();
  }
});
