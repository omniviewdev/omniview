import { render, screen, fireEvent } from '@testing-library/react';
import { WatchState } from '@omniviewdev/runtime';
import ConnectionStateDialog from '../ConnectionStateDialog';

// Mock @omniviewdev/runtime — we only need WatchState and the resource key utils.
// Values must be defined inside the factory because vi.mock is hoisted.
vi.mock('@omniviewdev/runtime', () => ({
  WatchState: {
    IDLE: 0,
    SYNCING: 1,
    SYNCED: 2,
    ERROR: 3,
    FAILED: 4,
    FORBIDDEN: 5,
    STOPPED: 6,
    SKIPPED: 7,
  },
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

// Minimal MUI stubs — Dialog renders children when open
vi.mock('@mui/material/Dialog', () => ({
  __esModule: true,
  default: ({ open, children }: any) => open ? <div data-testid="dialog">{children}</div> : null,
}));
vi.mock('@mui/material/DialogContent', () => ({
  __esModule: true,
  default: ({ children }: any) => <div data-testid="dialog-content">{children}</div>,
}));
vi.mock('@mui/material/DialogActions', () => ({
  __esModule: true,
  default: ({ children }: any) => <div data-testid="dialog-actions">{children}</div>,
}));
vi.mock('@mui/material/CircularProgress', () => ({
  __esModule: true,
  default: () => <span data-testid="spinner" />,
}));
vi.mock('@mui/material/LinearProgress', () => ({
  __esModule: true,
  default: ({ value }: any) => <div data-testid="progress-bar" data-value={value} />,
}));
vi.mock('@mui/material/IconButton', () => ({
  __esModule: true,
  default: ({ children, onClick }: any) => <button data-testid="close-btn" onClick={onClick}>{children}</button>,
}));
vi.mock('@mui/material/Box', () => ({
  __esModule: true,
  default: ({ children, ...rest }: any) => <div {...rest}>{children}</div>,
}));

// Stub @omniviewdev/ui components
vi.mock('@omniviewdev/ui/buttons', () => ({
  Button: ({ children, onClick, ...rest }: any) => (
    <button onClick={onClick} data-testid={`btn-${children}`} {...rest}>{children}</button>
  ),
}));
vi.mock('@omniviewdev/ui/typography', () => ({
  Text: ({ children, ...rest }: any) => <span {...rest}>{children}</span>,
}));

// Stub react-icons
vi.mock('react-icons/lu', () => ({
  LuCircleCheck: () => <span data-testid="icon-check" />,
  LuCircleAlert: () => <span data-testid="icon-alert" />,
  LuCircleSlash: () => <span data-testid="icon-slash" />,
  LuShieldAlert: () => <span data-testid="icon-shield" />,
  LuX: () => <span data-testid="icon-x" />,
}));

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  connectionName: 'my-cluster',
  resources: {} as Record<string, number>,
  resourceCounts: {} as Record<string, number>,
  onRetryResource: vi.fn(),
};

describe('ConnectionStateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders nothing when closed', () => {
    const { container } = render(
      <ConnectionStateDialog {...defaultProps} open={false} />,
    );
    expect(container.innerHTML).toBe('');
  });

  it('renders "Syncing" header when not all done', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{
          'core::v1::Pod': WatchState.SYNCING,
          'core::v1::Service': WatchState.SYNCED,
        }}
      />,
    );
    expect(screen.getByText(/Syncing "my-cluster"/)).toBeTruthy();
  });

  it('renders "Synced" header when all resources are terminal', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{
          'core::v1::Pod': WatchState.SYNCED,
          'core::v1::Service': WatchState.SYNCED,
        }}
      />,
    );
    expect(screen.getByText(/Synced "my-cluster"/)).toBeTruthy();
  });

  it('groups resources by API group with "Core" first', () => {
    const { container } = render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{
          'apps::v1::Deployment': WatchState.SYNCED,
          'core::v1::Pod': WatchState.SYNCED,
        }}
      />,
    );
    const content = container.textContent!;
    const coreIdx = content.indexOf('CORE');
    const appsIdx = content.indexOf('APPS');
    // Allow either uppercase or natural case — just ensure Core comes first
    const coreLower = content.indexOf('Core');
    const appsLower = content.indexOf('Apps');
    const corePos = coreIdx >= 0 ? coreIdx : coreLower;
    const appsPos = appsIdx >= 0 ? appsIdx : appsLower;
    expect(corePos).toBeLessThan(appsPos);
  });

  it('shows retry button for ERROR state', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{ 'core::v1::Pod': WatchState.ERROR }}
        onRetryResource={defaultProps.onRetryResource}
      />,
    );
    const retryBtn = screen.getByTestId('btn-Retry');
    fireEvent.click(retryBtn);
    expect(defaultProps.onRetryResource).toHaveBeenCalledWith('core::v1::Pod');
  });

  it('shows retry button for FAILED state', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{ 'apps::v1::Deployment': WatchState.FAILED }}
      />,
    );
    expect(screen.getByTestId('btn-Retry')).toBeTruthy();
  });

  it('shows "No access" for FORBIDDEN resources', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{ 'core::v1::Secret': WatchState.FORBIDDEN }}
      />,
    );
    expect(screen.getByText('No access')).toBeTruthy();
  });

  it('shows resource count for SYNCED resources', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{ 'core::v1::Pod': WatchState.SYNCED }}
        resourceCounts={{ 'core::v1::Pod': 42 }}
      />,
    );
    expect(screen.getByText('42')).toBeTruthy();
  });

  it('excludes SKIPPED resources from progress denominator', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{
          'core::v1::Pod': WatchState.SYNCED,
          'core::v1::Secret': WatchState.SKIPPED,
          'apps::v1::Deployment': WatchState.SYNCED,
        }}
      />,
    );
    // 2 watched, 2 done → 100%  (SKIPPED excluded)
    expect(screen.getByText(/100%/)).toBeTruthy();
    expect(screen.getByText(/2\/2/)).toBeTruthy();
    // Skipped count shown
    expect(screen.getByText(/1 resource skipped/)).toBeTruthy();
  });

  it('calculates correct progress percentage', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{
          'core::v1::Pod': WatchState.SYNCED,
          'core::v1::Service': WatchState.SYNCING,
          'apps::v1::Deployment': WatchState.SYNCED,
          'apps::v1::StatefulSet': WatchState.SYNCING,
        }}
      />,
    );
    // 4 watched, 2 done → 50%
    expect(screen.getByText(/50%/)).toBeTruthy();
    expect(screen.getByText(/2\/4/)).toBeTruthy();
  });

  it('calls onClose when dismiss button is clicked', () => {
    render(<ConnectionStateDialog {...defaultProps} resources={{}} />);
    fireEvent.click(screen.getByTestId('btn-Dismiss'));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});
