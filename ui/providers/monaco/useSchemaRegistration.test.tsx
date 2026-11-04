import { act, cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EditorSchemaBoundary, useSchemaRegistration } from './useSchemaRegistration';

const mocks = vi.hoisted(() => ({
  schemas: vi.fn(),
  register: vi.fn(),
  unregister: vi.fn(),
  whenFlushed: vi.fn(),
  refetch: vi.fn(),
}));

vi.mock('@omniviewdev/runtime', () => ({ useEditorSchemas: mocks.schemas }));
vi.mock('./schemaRegistry', () => ({ schemaRegistry: {
  register: mocks.register, unregister: mocks.unregister, whenFlushed: mocks.whenFlushed,
} }));

function query(overrides = {}) {
  return {
    associations: [{ type: 'pods', status: 'available' }],
    documents: [{ documentId: 'core' }],
    isLoading: false,
    error: null,
    refetch: mocks.refetch,
    ...overrides,
  };
}

beforeEach(() => {
  mocks.whenFlushed.mockResolvedValue(undefined);
  mocks.refetch.mockResolvedValue(undefined);
  mocks.schemas.mockReturnValue(query());
});
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it('shares concurrent owners and unregisters only after the final editor closes', async () => {
  const result = query();
  mocks.schemas.mockReturnValue(result);
  const first = renderHook(() => useSchemaRegistration({ pluginID: 'provider', connectionID: 'cluster' }));
  const second = renderHook(() => useSchemaRegistration({ pluginID: 'provider', connectionID: 'cluster' }));
  await act(async () => {});
  expect(mocks.register).toHaveBeenCalledExactlyOnceWith('provider', 'cluster', result.associations, result.documents);
  expect(first.result.current.isLoading).toBe(false);
  expect(second.result.current.isLoading).toBe(false);
  second.unmount();
  expect(mocks.unregister).not.toHaveBeenCalled();
  first.unmount();
  expect(mocks.unregister).toHaveBeenCalledExactlyOnceWith('provider', 'cluster');
});

it('does not register or wait for Monaco while demand is disabled', () => {
  const hook = renderHook(() => useSchemaRegistration({ pluginID: 'provider', connectionID: 'cluster', enabled: false }));
  expect(mocks.schemas).toHaveBeenCalledWith({ pluginID: 'provider', route: { connection: 'cluster' }, enabled: false });
  expect(hook.result.current.isLoading).toBe(false);
  expect(mocks.register).not.toHaveBeenCalled();
  expect(mocks.whenFlushed).not.toHaveBeenCalled();
  hook.unmount();
  expect(mocks.unregister).not.toHaveBeenCalled();
});

it('keeps loading until the Monaco update resolves', async () => {
  const pending = Promise.withResolvers<void>();
  mocks.whenFlushed.mockReturnValue(pending.promise);
  const hook = renderHook(() => useSchemaRegistration({ pluginID: 'provider', connectionID: 'cluster' }));
  expect(hook.result.current.isLoading).toBe(true);
  await act(async () => { pending.resolve(); await pending.promise; });
  expect(hook.result.current.isLoading).toBe(false);
  expect(hook.result.current.error).toBeNull();
});

it('exposes asynchronous update failure and retries both registration and fetching', async () => {
  const pending = Promise.withResolvers<void>();
  const failure = new Error('YAML update failed');
  mocks.whenFlushed.mockReturnValueOnce(pending.promise);
  const hook = renderHook(() => useSchemaRegistration({ pluginID: 'provider', connectionID: 'cluster' }));
  await act(async () => { pending.reject(failure); await pending.promise.catch(() => {}); });
  expect(hook.result.current.isLoading).toBe(false);
  expect(hook.result.current.error).toBe(failure);
  await act(async () => { await hook.result.current.retry(); });
  expect(mocks.refetch).toHaveBeenCalledOnce();
  expect(mocks.register).toHaveBeenCalledTimes(2);
  expect(hook.result.current.error).toBeNull();
  expect(hook.result.current.isLoading).toBe(false);
});

it('ignores a superseded connection flush until the current connection finishes', async () => {
  const oldFlush = Promise.withResolvers<void>();
  const currentFlush = Promise.withResolvers<void>();
  mocks.whenFlushed.mockReturnValueOnce(oldFlush.promise).mockReturnValueOnce(currentFlush.promise);
  const hook = renderHook(({ connectionID }) => useSchemaRegistration({ pluginID: 'provider', connectionID }), {
    initialProps: { connectionID: 'old' },
  });
  hook.rerender({ connectionID: 'current' });
  expect(mocks.unregister).toHaveBeenCalledWith('provider', 'old');
  await act(async () => { oldFlush.resolve(); await oldFlush.promise; });
  expect(hook.result.current.isLoading).toBe(true);
  await act(async () => { currentFlush.resolve(); await currentFlush.promise; });
  expect(hook.result.current.isLoading).toBe(false);
  expect(mocks.register.mock.calls.map((call) => call[1])).toEqual(['old', 'current']);
});

it('does not restore an older revision when its last owner closes', async () => {
  const oldRevision = query();
  mocks.schemas.mockReturnValue(oldRevision);
  const oldOwner = renderHook(() => useSchemaRegistration({ pluginID: 'provider', connectionID: 'cluster' }));
  const newRevision = query({ documents: [{ documentId: 'updated' }] });
  mocks.schemas.mockReturnValue(newRevision);
  const newOwner = renderHook(() => useSchemaRegistration({ pluginID: 'provider', connectionID: 'cluster' }));
  await act(async () => {});
  oldOwner.unmount();
  expect(mocks.unregister).not.toHaveBeenCalled();
  expect(mocks.register).toHaveBeenCalledTimes(2);
  expect(mocks.register).toHaveBeenLastCalledWith('provider', 'cluster', newRevision.associations, newRevision.documents);
  newOwner.unmount();
  expect(mocks.unregister).toHaveBeenCalledExactlyOnceWith('provider', 'cluster');
});

it('publishes the bridge and gates the actual editor until Monaco is ready', async () => {
  const pending = Promise.withResolvers<void>();
  mocks.whenFlushed.mockReturnValue(pending.promise);
  expect(window.__omniviewEditorSchemaBoundary).toBe(EditorSchemaBoundary);
  const Boundary = window.__omniviewEditorSchemaBoundary!;
  render(<Boundary pluginID="provider" connectionID="cluster"><textarea aria-label="Manifest" /></Boundary>);
  expect(screen.getByRole('status').textContent).toContain('Loading editor schemas');
  expect(screen.queryByRole('textbox')).toBeNull();
  await act(async () => { pending.resolve(); await pending.promise; });
  expect(screen.getByRole('textbox')).toBeTruthy();
});

it('keeps the editor useful after update failure and offers retry', async () => {
  mocks.whenFlushed.mockRejectedValueOnce(new Error('worker offline'));
  render(<EditorSchemaBoundary pluginID="provider" connectionID="cluster"><textarea aria-label="Manifest" /></EditorSchemaBoundary>);
  await act(async () => {});
  expect(screen.getByRole('alert').textContent).toContain('worker offline');
  fireEvent.change(screen.getByRole('textbox'), { target: { value: 'kind: Pod' } });
  expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe('kind: Pod');
  await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Retry editor schemas' })); });
  expect(mocks.refetch).toHaveBeenCalledOnce();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('textbox')).toBeTruthy();
});

it('shows explicit schema absence without hiding the editor', async () => {
  mocks.schemas.mockReturnValue(query({ associations: [{ type: 'pods', status: 'absent' }], documents: [] }));
  render(<EditorSchemaBoundary pluginID="provider" connectionID="cluster"><textarea aria-label="Manifest" /></EditorSchemaBoundary>);
  await act(async () => {});
  expect(screen.getByRole('status').textContent).toContain('No editor schema is available');
  expect(screen.getByRole('textbox')).toBeTruthy();
  expect(screen.queryByRole('button')).toBeNull();
});

it('keeps the editor visible when schema fetching fails before registration', () => {
  mocks.schemas.mockReturnValue(query({ error: new Error('schema request failed') }));
  render(<EditorSchemaBoundary pluginID="provider" connectionID="cluster"><textarea aria-label="Manifest" /></EditorSchemaBoundary>);
  expect(screen.getByRole('alert').textContent).toContain('schema request failed');
  expect(screen.getByRole('textbox')).toBeTruthy();
  expect(screen.getByRole('button', { name: 'Retry editor schemas' })).toBeTruthy();
  expect(mocks.register).not.toHaveBeenCalled();
});

it('reports absence for the editor resource even when another resource has a schema', async () => {
  render(<EditorSchemaBoundary pluginID="provider" connectionID="cluster" resourceType="deployments">
    <textarea aria-label="Manifest" />
  </EditorSchemaBoundary>);
  await act(async () => {});
  expect(screen.getByRole('status').textContent).toContain('No editor schema is available');
  expect(screen.getByRole('textbox')).toBeTruthy();
});

it('does not borrow an available schema from another model directory', async () => {
  mocks.schemas.mockReturnValue(query({
    associations: [{ type: 'pods', status: 'available', modelDirectory: 'file:///schema/release-a' }],
  }));
  const editor = render(<EditorSchemaBoundary pluginID="provider" connectionID="cluster"
    resourceType="pods" modelPath="file:///schema/release-b/manifest.yaml">
    <textarea aria-label="Manifest" />
  </EditorSchemaBoundary>);
  await act(async () => {});
  expect(screen.getByRole('status').textContent).toContain('No editor schema is available for this model');
  expect(screen.getByRole('textbox')).toBeTruthy();
  editor.rerender(<EditorSchemaBoundary pluginID="provider" connectionID="cluster"
    resourceType="pods" modelPath="file:///schema/release-a/manifest.yaml">
    <textarea aria-label="Manifest" />
  </EditorSchemaBoundary>);
  expect(screen.queryByRole('status')).toBeNull();
  expect(screen.getByRole('textbox')).toBeTruthy();
});

it('keeps a concurrent owner registered after the retrying editor closes', async () => {
  const first = renderHook(() => useSchemaRegistration({ pluginID: 'provider', connectionID: 'cluster' }));
  const second = renderHook(() => useSchemaRegistration({ pluginID: 'provider', connectionID: 'cluster' }));
  await act(async () => {});
  await act(async () => { await first.result.current.retry(); });
  expect(mocks.register).toHaveBeenCalledTimes(2);
  expect(mocks.unregister).not.toHaveBeenCalled();
  first.unmount();
  expect(mocks.unregister).not.toHaveBeenCalled();
  second.unmount();
  expect(mocks.unregister).toHaveBeenCalledExactlyOnceWith('provider', 'cluster');
});

it('keeps the newest revision registered when its editor closes before an older owner', async () => {
  const oldRevision = query();
  mocks.schemas.mockReturnValue(oldRevision);
  const oldOwner = renderHook(() => useSchemaRegistration({ pluginID: 'provider', connectionID: 'cluster' }));
  const newRevision = query({ documents: [{ documentId: 'updated' }] });
  mocks.schemas.mockReturnValue(newRevision);
  const newOwner = renderHook(() => useSchemaRegistration({ pluginID: 'provider', connectionID: 'cluster' }));
  await act(async () => {});
  newOwner.unmount();
  expect(mocks.unregister).not.toHaveBeenCalled();
  expect(mocks.register).toHaveBeenCalledTimes(2);
  expect(mocks.register).toHaveBeenLastCalledWith('provider', 'cluster', newRevision.associations, newRevision.documents);
  oldOwner.unmount();
  expect(mocks.unregister).toHaveBeenCalledExactlyOnceWith('provider', 'cluster');
  expect(mocks.register).toHaveBeenCalledTimes(2);
});
