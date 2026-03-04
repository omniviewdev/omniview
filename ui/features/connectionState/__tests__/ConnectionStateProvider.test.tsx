import { render, act, screen } from '@testing-library/react';
import { ConnectionStateProvider, useConnectionStateDialog } from '../index';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockWatchStateReturn = {
  summary: { data: null } as any,
  isFullySynced: false,
  getResourceState: jest.fn(),
  syncProgress: 0,
  errorCount: 0,
};

jest.mock('@omniviewdev/runtime', () => ({
  useWatchState: () => mockWatchStateReturn,
  WatchState: { IDLE: 0, SYNCING: 1, SYNCED: 2, ERROR: 3, FAILED: 4, FORBIDDEN: 5, STOPPED: 6, SKIPPED: 7 },
  parseResourceKey: (key: string) => {
    const parts = key.split('::');
    if (parts.length === 1) return { group: 'core', version: '', kind: parts[0] };
    return { group: parts[0] || 'core', version: parts[1] || '', kind: parts[2] || parts[0] };
  },
  formatGroup: (group: string) => {
    if (!group || group === 'core') return 'Core';
    return group.charAt(0).toUpperCase() + group.slice(1);
  },
}));

const mockEnsureResourceWatch = jest.fn().mockResolvedValue(undefined);
jest.mock('@omniviewdev/runtime/api', () => ({
  ResourceClient: {
    EnsureResourceWatch: (...args: any[]) => mockEnsureResourceWatch(...args),
  },
}));

// Minimal MUI stubs
jest.mock('@mui/material/Dialog', () => ({
  __esModule: true,
  default: ({ open, children }: any) => open ? <div data-testid="dialog">{children}</div> : null,
}));
jest.mock('@mui/material/DialogContent', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('@mui/material/DialogActions', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('@mui/material/CircularProgress', () => ({
  __esModule: true,
  default: () => <span />,
}));
jest.mock('@mui/material/LinearProgress', () => ({
  __esModule: true,
  default: () => <div />,
}));
jest.mock('@mui/material/IconButton', () => ({
  __esModule: true,
  default: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}));
jest.mock('@mui/material/Box', () => ({
  __esModule: true,
  default: ({ children }: any) => <div>{children}</div>,
}));
jest.mock('@omniviewdev/ui/buttons', () => ({
  Button: ({ children, onClick }: any) => <button onClick={onClick}>{children}</button>,
}));
jest.mock('@omniviewdev/ui/typography', () => ({
  Text: ({ children }: any) => <span>{children}</span>,
}));
jest.mock('react-icons/lu', () => ({
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
    jest.clearAllMocks();
    jest.useFakeTimers();
    mockWatchStateReturn.summary = { data: null };
    mockWatchStateReturn.isFullySynced = false;
  });

  afterEach(() => {
    jest.useRealTimers();
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
      jest.advanceTimersByTime(2000);
    });

    // Dialog should still be open (manual open = no auto-close)
    expect(screen.getByTestId('dialog')).toBeTruthy();
  });

  it('throws when useConnectionStateDialog is used outside provider', () => {
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<TestConsumer />)).toThrow(
      'useConnectionStateDialog must be used within a ConnectionStateProvider',
    );
    spy.mockRestore();
  });
});
