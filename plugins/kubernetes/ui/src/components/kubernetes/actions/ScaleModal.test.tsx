import { render, screen, fireEvent } from '@testing-library/react';
import { vi, describe, it, expect, beforeEach } from 'vitest';
import ScaleModal from './ScaleModal';

// MUI Modal renders via portal — mock it to render children inline.
vi.mock('@mui/material/Modal', () => ({
  default: ({ open, children }: { open: boolean; children: React.ReactNode }) =>
    open ? <div data-testid="modal">{children}</div> : null,
}));

/** Helper: get the number input (not the slider's hidden range input). */
function getReplicaInput() {
  return screen.getByRole('spinbutton');
}

describe('ScaleModal', () => {
  const defaultProps = {
    open: true,
    onClose: vi.fn(),
    onConfirm: vi.fn(),
    resourceType: 'Deployment',
    resourceName: 'nginx-deployment',
    currentReplicas: 3,
    isExecuting: false,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders resource type and name', () => {
    render(<ScaleModal {...defaultProps} />);
    expect(screen.getByText('Scale Deployment')).toBeInTheDocument();
    expect(screen.getByText('nginx-deployment')).toBeInTheDocument();
  });

  it('displays current replicas', () => {
    render(<ScaleModal {...defaultProps} />);
    expect(screen.getByText('Current')).toBeInTheDocument();
    // The current replica count appears in the "Current" section.
    const allThrees = screen.getAllByText('3');
    expect(allThrees.length).toBeGreaterThanOrEqual(1);
  });

  it('initializes desired to current replicas', () => {
    render(<ScaleModal {...defaultProps} />);
    expect(screen.getByText('Desired')).toBeInTheDocument();
    const input = getReplicaInput();
    expect(input).toHaveValue(3);
  });

  it('Scale button is disabled when desired equals current', () => {
    render(<ScaleModal {...defaultProps} />);
    const scaleButton = screen.getByText('Scale');
    expect(scaleButton).toHaveStyle({ pointerEvents: 'none' });
  });

  it('Scale button is enabled when desired differs from current', () => {
    render(<ScaleModal {...defaultProps} />);
    const input = getReplicaInput();
    fireEvent.change(input, { target: { value: '5' } });
    const scaleButton = screen.getByText('Scale');
    expect(scaleButton).toHaveStyle({ pointerEvents: 'auto' });
  });

  it('calls onConfirm with new replica count', () => {
    render(<ScaleModal {...defaultProps} />);
    const input = getReplicaInput();
    fireEvent.change(input, { target: { value: '7' } });
    const scaleButton = screen.getByText('Scale');
    fireEvent.click(scaleButton);
    expect(defaultProps.onConfirm).toHaveBeenCalledWith(7);
  });

  it('calls onClose on Cancel click', () => {
    render(<ScaleModal {...defaultProps} />);
    const cancelButton = screen.getByText('Cancel');
    fireEvent.click(cancelButton);
    expect(defaultProps.onClose).toHaveBeenCalled();
  });

  it('shows zero warning when scaled to 0', () => {
    render(<ScaleModal {...defaultProps} />);
    const input = getReplicaInput();
    fireEvent.change(input, { target: { value: '0' } });
    expect(screen.getByText(/Scaling to 0 will stop all pods/)).toBeInTheDocument();
  });

  it('hides zero warning when replicas > 0', () => {
    render(<ScaleModal {...defaultProps} />);
    expect(screen.queryByText(/Scaling to 0 will stop all pods/)).not.toBeInTheDocument();
  });

  it('shows Scaling... text when isExecuting', () => {
    render(<ScaleModal {...defaultProps} isExecuting={true} />);
    expect(screen.getByText('Scaling...')).toBeInTheDocument();
  });

  it('resets desired when reopened with different currentReplicas', () => {
    const { rerender } = render(<ScaleModal {...defaultProps} />);
    rerender(<ScaleModal {...defaultProps} currentReplicas={10} open={true} />);
    const input = getReplicaInput();
    expect(input).toHaveValue(10);
  });
});
