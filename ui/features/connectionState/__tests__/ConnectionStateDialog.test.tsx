import { render, screen, fireEvent } from '@testing-library/react';
import type { Count, SourceSessionState } from '@omniviewdev/runtime';
import ConnectionStateDialog from '../ConnectionStateDialog';


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

const resources: Record<string, SourceSessionState> = {};
const resourceCounts: Record<string, Count> = {};

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
          'core::v1::Pod': 'snapshotting',
          'core::v1::Service': 'following',
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
          'core::v1::Pod': 'following',
          'core::v1::Service': 'finished',
        }}
      />,
    );
    expect(screen.getByText(/Synced "my-cluster"/)).toBeTruthy();
  });

  it('keeps resource types opaque rather than parsing provider-specific keys', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{
          'apps::v1::Deployment': 'following',
          'native/resource/type': 'following',
        }}
      />,
    );
    expect(screen.getByText('apps::v1::Deployment')).toBeTruthy();
    expect(screen.getByText('native/resource/type')).toBeTruthy();
  });

  it('shows retry button for failed state', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{ 'core::v1::Pod': 'failed' }}
        onRetryResource={defaultProps.onRetryResource}
      />,
    );
    const retryBtn = screen.getByTestId('btn-Retry');
    fireEvent.click(retryBtn);
    expect(defaultProps.onRetryResource).toHaveBeenCalledWith('core::v1::Pod');
  });


  it('shows resource count for SYNCED resources', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{ 'core::v1::Pod': 'following' }}
        resourceCounts={{ 'core::v1::Pod': { kind: 'exact', value: '9007199254740993' } }}
      />,
    );
    expect(screen.getByText('9007199254740993 (exact)')).toBeTruthy();
  });

  it('counts closed resources as terminal', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{ 'core::v1::Pod': 'following', 'core::v1::Secret': 'closed' }}
      />,
    );
    expect(screen.getByText(/100%/)).toBeTruthy();
    expect(screen.getAllByText(/2\/2/).length).toBeGreaterThan(0);
    expect(screen.getByText('Closed')).toBeTruthy();
  });

  it('calculates correct progress percentage', () => {
    render(
      <ConnectionStateDialog
        {...defaultProps}
        resources={{
          'core::v1::Pod': 'following',
          'core::v1::Service': 'snapshotting',
          'apps::v1::Deployment': 'finished',
          'apps::v1::StatefulSet': 'opening',
        }}
      />,
    );
    // 4 watched, 2 done → 50%
    expect(screen.getByText(/50%/)).toBeTruthy();
    expect(screen.getAllByText(/2\/4/).length).toBeGreaterThan(0);
  });

  it('calls onClose when dismiss button is clicked', () => {
    render(<ConnectionStateDialog {...defaultProps} resources={{}} />);
    fireEvent.click(screen.getByTestId('btn-Dismiss'));
    expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
  });
});
