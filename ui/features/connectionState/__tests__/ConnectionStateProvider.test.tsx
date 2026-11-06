import { render, act, screen } from '@testing-library/react';
import { ConnectionStateProvider, useConnectionStateDialog } from '../index';
import type { HostSourceStates } from '@omniviewdev/runtime';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockSourceStateReturn = {
  summary: undefined as HostSourceStates | undefined,
  isFullySynced: false,
  getTypeStatus: vi.fn(),
  syncProgress: 0,
  errorCount: 0,
};

vi.mock('@omniviewdev/runtime', () => ({
  useSourceStates: () => mockSourceStateReturn,
}));

const mockRetryConnectionSources = vi.fn().mockResolvedValue(undefined);
vi.mock('@omniviewdev/runtime/api', () => ({
  ResourceClient: {
    RetryConnectionSources: (...args: unknown[]) => mockRetryConnectionSources(...args),
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
    mockSourceStateReturn.summary = undefined;
    mockSourceStateReturn.isFullySynced = false;
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
    mockSourceStateReturn.isFullySynced = true;

    // Re-render to pick up the mock change
    act(() => {
      vi.advanceTimersByTime(2000);
    });

    // Dialog should still be open (manual open = no auto-close)
    expect(screen.getByTestId('dialog')).toBeTruthy();
  });

  it('retries sources for the connection', async () => {
    mockSourceStateReturn.summary = { route: { connection: 'c1' }, types: { 'opaque/type': { state: 'failed', mode: 'snapshot', count: { kind: 'unknown' } } } };
    render(<ConnectionStateProvider><TestConsumer /></ConnectionStateProvider>);
    act(() => {
      showFn({ pluginID: 'provider', connectionID: 'c1', connectionName: 'Production' }); 
    });
    await act(async () => {
      screen.getByText('Retry').click(); 
    });
    expect(mockRetryConnectionSources).toHaveBeenCalledWith('provider', { connection: 'c1' });
  });

  it('throws when useConnectionStateDialog is used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<TestConsumer />)).toThrow(
      'useConnectionStateDialog must be used within a ConnectionStateProvider',
    );
    spy.mockRestore();
  });
});
