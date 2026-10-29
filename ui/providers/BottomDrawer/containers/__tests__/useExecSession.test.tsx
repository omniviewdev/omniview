import React from 'react';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useExec } from '../../../../../packages/omniviewdev-runtime/src/hooks/exec/useExecSession';

const mocks = vi.hoisted(() => ({ create: vi.fn(), createTab: vi.fn(), updateTab: vi.fn(), snackbar: vi.fn() }));
vi.mock('../../../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/omniview/backend/pkg/plugin/exec/servicewrapper', () => ({ CreateSession: mocks.create }));
vi.mock('../../../../../packages/omniviewdev-runtime/src/bindings/github.com/omniviewdev/plugin-sdk/pkg/v1/exec/models', () => ({ SessionOptions: { createFrom: (value: unknown) => value } }));
vi.mock('../../../../../packages/omniviewdev-runtime/src/hooks/drawer', () => ({ useBottomDrawer: () => ({ createTab: mocks.createTab, updateTab: mocks.updateTab }) }));
vi.mock('../../../../../packages/omniviewdev-runtime/src/hooks/useResolvedPluginId', () => ({ useResolvedPluginId: () => 'kubernetes' }));
vi.mock('../../../../../packages/omniviewdev-runtime/src/hooks/snackbar/useSnackbar', () => ({ useSnackbar: () => ({ showSnackbar: mocks.snackbar }) }));
vi.mock('../../../../../packages/omniviewdev-runtime/src/errors/parseAppError', () => ({ parseAppError: (error: Error) => ({ detail: error.message }), showAppError: vi.fn() }));

function setup() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return renderHook(() => useExec({ pluginID: 'kubernetes' }), {
    wrapper: ({ children }: { children: React.ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
}

beforeEach(() => vi.clearAllMocks());

describe('exec session creation outcome', () => {
  it('returns the actual session identity so a caller can reconnect without another create', async () => {
    const session = { id: 'actual-debug-stream', created: 'now' };
    mocks.create.mockResolvedValue(session);
    const view = setup();
    let outcome: unknown;
    await act(async () => {
      outcome = await view.result.current.createSession({ connectionID: 'kind-kind', opts: { params: { mode: 'attach', container: 'debugger-1', pod_uid: 'original-pod' } } }); 
    });
    expect(outcome).toEqual(session);
    expect(mocks.updateTab.mock.calls[0][1]).toMatchObject({ id: 'actual-debug-stream', properties: { status: 'connected' } });
  });

  it('returns a failure outcome and keeps an errored tab when attachment fails', async () => {
    mocks.create.mockRejectedValue(new Error('Forbidden: pods/attach'));
    const view = setup();
    let outcome: unknown = 'not settled';
    await act(async () => {
      outcome = await view.result.current.createSession({ connectionID: 'kind-kind', opts: { params: { mode: 'attach', container: 'debugger-1' } } }); 
    });
    expect(outcome).toBeNull();
    expect(mocks.updateTab.mock.calls[0][1].properties).toMatchObject({ status: 'error', error: 'Forbidden: pods/attach' });
  });
});
