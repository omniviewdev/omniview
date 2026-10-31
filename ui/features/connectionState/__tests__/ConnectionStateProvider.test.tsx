import { render, act, screen } from '@testing-library/react';
import { ConnectionStateProvider, useConnectionStateDialog } from '../index';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockWatchStateReturn = {
  summary: { data: null } as any,
  isFullySynced: false,
  getResourceState: vi.fn(),
  syncProgress: 0,
  errorCount: 0,
};

vi.mock('@omniviewdev/runtime', () => ({
  useWatchState: () => mockWatchStateReturn,
  WatchState: {
    WatchStateIdle: 0, WatchStateSyncing: 1, WatchStateSynced: 2, WatchStateError: 3,
    WatchStateStopped: 4, WatchStateFailed: 5, WatchStateForbidden: 6, WatchStateSkipped: 7,
  },
}));

const mockEnsureResourceWatch = vi.fn().mockResolvedValue(undefined);
const admittedTarget = { route: { connection: 'c1' }, provider: 'test', authority: 'host', type: 'opaque/type', scope: [], representation: 'json' };
const mockResolveTarget = vi.fn().mockResolvedValue({ targetId: 'admitted', target: admittedTarget });
vi.mock('@omniviewdev/runtime/api', () => ({
  ResourceClient: {
    ResolveTarget: (...args: unknown[]) => mockResolveTarget(...args),
    EnsureResourceWatch: (...args: any[]) => mockEnsureResourceWatch(...args),
  },
}));

// Minimal base-ui stubs — Dialog renders children inline (no portal) when open
vi.mock('@omniviewdev/base-ui', () => {
  const Dialog = ({ open, children }: any) => open ? <div data-testid="dialog">{children}</div> : null;
  Dialog.Title = ({ children }: any) => <h2>{children}</h2>;
  return {
    Dialog,
    Spinner: () => <span />,
    Progress: () => <div />,
    IconButton: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
    Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
    Text: ({ children }: any) => <span>{children}</span>,
  };
});
vi.mock('react-icons/lu', () => ({
  LuCircleCheck: () => <span />,
  LuCircleAlert: () => <span />,
  LuCircleSlash: () => <span />,
  LuShieldAlert: () => <span />,
  LuX: () => <span />,
}));

// ---------------------------------------------------------------------------
// Test consumer that exposes the context's show() function
// ---------------------------------------------------------------------------

let showFn: ReturnType<typeof useConnectionStateDialog>['show'];

function TestConsumer() {
  const { show } = useConnectionStateDialog();
  showFn = show;
  return <div data-testid="consumer">ready</div>;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectionStateProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    mockWatchStateReturn.summary = { data: null };
    mockWatchStateReturn.isFullySynced = false;
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('opens dialog on show() call', () => {
    render(
      <ConnectionStateProvider>
        <TestConsumer />
      </ConnectionStateProvider>,
    );

    expect(screen.queryByTestId('dialog')).toBeNull();

    act(() => {
      showFn({ pluginID: 'kubernetes', connectionID: 'c1', connectionName: 'my-cluster' });
    });

    expect(screen.getByTestId('dialog')).toBeTruthy();
  });

  it('opens dialog on ov:show-connection-state DOM event', () => {
    render(
      <ConnectionStateProvider>
        <TestConsumer />
      </ConnectionStateProvider>,
    );

    expect(screen.queryByTestId('dialog')).toBeNull();

    act(() => {
      window.dispatchEvent(
        new CustomEvent('ov:show-connection-state', {
          detail: { pluginID: 'kubernetes', connectionID: 'c1', connectionName: 'my-cluster' },
        }),
      );
    });

    expect(screen.getByTestId('dialog')).toBeTruthy();
  });

  it('does not auto-close when manually opened even after sync completes', () => {
    render(
      <ConnectionStateProvider>
        <TestConsumer />
      </ConnectionStateProvider>,
    );

    // Open manually
    act(() => {
      showFn({ pluginID: 'kubernetes', connectionID: 'c1', connectionName: 'my-cluster' });
    });
    expect(screen.getByTestId('dialog')).toBeTruthy();

    // Simulate sync completing
    mockWatchStateReturn.isFullySynced = true;

    // Re-render to pick up the mock change
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Dialog should still be open (manual open = no auto-close)
    expect(screen.getByTestId('dialog')).toBeTruthy();
  });

  it('retries the host-resolved canonical target', async () => {
    mockWatchStateReturn.summary = { data: { resources: { 'opaque/type': 3 }, resourceCounts: {}, scope: [] } };
    render(<ConnectionStateProvider><TestConsumer /></ConnectionStateProvider>);
    act(() => {
      showFn({ pluginID: 'provider', connectionID: 'c1', connectionName: 'Production' }); 
    });
    await act(async () => {
      screen.getByText('Retry').click(); 
    });
    expect(mockResolveTarget).toHaveBeenCalledWith('provider', {
      route: { connection: 'c1' }, type: 'opaque/type', scope: [],
    });
    expect(mockEnsureResourceWatch).toHaveBeenCalledWith('provider', admittedTarget);
  });

  it('throws when useConnectionStateDialog is used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<TestConsumer />)).toThrow(
      'useConnectionStateDialog must be used within a ConnectionStateProvider',
    );
    spy.mockRestore();
  });
});
