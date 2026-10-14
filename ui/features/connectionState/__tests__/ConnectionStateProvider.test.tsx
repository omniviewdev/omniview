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
  WatchState: { IDLE: 0, SYNCING: 1, SYNCED: 2, ERROR: 3, FAILED: 4, FORBIDDEN: 5, STOPPED: 6, SKIPPED: 7 },
  parseResourceKey: (key: string) => {
    const parts = key.split('::');
    if (parts.length === 1) {
      return { group: 'core', version: '', kind: parts[0] };
    }

    return { group: parts[0] || 'core', version: parts[1] || '', kind: parts[2] || parts[0] };
  },
  formatGroup: (group: string) => {
    if (!group || group === 'core') {
      return 'Core';
    }

    return group.charAt(0).toUpperCase() + group.slice(1);
  },
}));

const mockEnsureResourceWatch = vi.fn().mockResolvedValue(undefined);
vi.mock('@omniviewdev/runtime/api', () => ({
  ResourceClient: {
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

  it('throws when useConnectionStateDialog is used outside provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      'useConnectionStateDialog must be used within a ConnectionStateProvider',
    );
    spy.mockRestore();
  });
});
