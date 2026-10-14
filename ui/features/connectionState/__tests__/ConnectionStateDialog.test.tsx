import { render, screen, fireEvent } from '@testing-library/react';
import { WatchState } from '@omniviewdev/runtime';
import ConnectionStateDialog from '../ConnectionStateDialog';

// Mock @omniviewdev/runtime — we only need WatchState and the resource key utils.
// Values must be defined inside the factory because vi.mock is hoisted.
vi.mock('@omniviewdev/runtime', () => ({
  WatchState: {
    WatchStateIdle: 0,
    WatchStateSyncing: 1,
    WatchStateSynced: 2,
    WatchStateError: 3,
    WatchStateStopped: 4,
    WatchStateFailed: 5,
    WatchStateForbidden: 6,
    WatchStateSkipped: 7,
  },
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

// Minimal base-ui stubs — Dialog renders children inline (no portal) when open
vi.mock('@omniviewdev/base-ui', () => {
  const Dialog = ({ open, children }: any) => open ? <div data-testid="dialog">{children}</div> : null;
  Dialog.Title = ({ children }: any) => <h2>{children}</h2>;
  return {
    Dialog,
    Spinner: () => <span data-testid="spinner" />,
    Progress: ({ value }: any) => <div data-testid="progress-bar" data-value={value} />,
    IconButton: ({ children, onClick }: any) => <button data-testid="close-btn" onClick={onClick}>{children}</button>,
    Button: ({ children, onClick }: any) => (
      <button onClick={onClick} data-testid={`btn-${children}`}>{children}</button>
    ),
    Text: ({ children }: any) => <span>{children}</span>,
  };
});

// Stub react-icons
vi.mock('react-icons/lu', () => ({
  LuCircleCheck: () => <span data-testid="icon-check" />,
  LuCircleAlert: () => <span data-testid="icon-alert" />,
  LuCircleSlash: () => <span data-testid="icon-slash" />,
  LuShieldAlert: () => <span data-testid="icon-shield" />,
  LuX: () => <span data-testid="icon-x" />,
}));

const resources: Record<string, number> = {};
const resourceCounts: Record<string, number> = {};

const defaultProps = {
  open: true,
  onClose: vi.fn(),
  connectionName: 'my-cluster',
  resources,
  resourceCounts,
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
          'core::v1::Pod': WatchState.WatchStateSyncing,
          'core::v1::Service': WatchState.WatchStateSynced,
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
          'core::v1::Pod': WatchState.WatchStateSynced,
          'core::v1::Service': WatchState.WatchStateSynced,
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
          'apps::v1::Deployment': WatchState.WatchStateSynced,
          'core::v1::Pod': WatchState.WatchStateSynced,
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
        resources={{ 'core::v1::Pod': WatchState.WatchStateError }}
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
        resources={{ 'apps::v1::Deployment': WatchState.WatchStateFailed }}
      />,
    );
    expect(screen.getByTestId('btn-Retry')).toBeTruthy();
  });

  it('shows "No access" for FORBIDDEN resources', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{ 'core::v1::Secret': WatchState.WatchStateForbidden }}
      />,
    );
    expect(screen.getByText('No access')).toBeTruthy();
  });

  it('shows resource count for SYNCED resources', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{ 'core::v1::Pod': WatchState.WatchStateSynced }}
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
          'core::v1::Pod': WatchState.WatchStateSynced,
          'core::v1::Secret': WatchState.WatchStateSkipped,
          'apps::v1::Deployment': WatchState.WatchStateSynced,
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
          'core::v1::Pod': WatchState.WatchStateSynced,
          'core::v1::Service': WatchState.WatchStateSyncing,
          'apps::v1::Deployment': WatchState.WatchStateSynced,
          'apps::v1::StatefulSet': WatchState.WatchStateSyncing,
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
