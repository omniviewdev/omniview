import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AIActionConfirmation from './AIActionConfirmation';

describe('AIActionConfirmation', () => {
  const defaultProps = {
    action: 'Delete 3 pods',
    risk: 'high' as const,
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
  };

  it('renders action text', () => {
    render(<AIActionConfirmation {...defaultProps} />);
    expect(screen.getByText('Delete 3 pods')).toBeInTheDocument();
  });

  it('shows risk badge', () => {
    render(<AIActionConfirmation {...defaultProps} />);
    expect(screen.getByText('High Risk')).toBeInTheDocument();
  });

  it('renders description', () => {
    render(
      <AIActionConfirmation
        {...defaultProps}
        description="This will permanently remove the pods."
      />,
    );
    expect(screen.getByText('This will permanently remove the pods.')).toBeInTheDocument();
  });

  it('renders affected resources', () => {
    render(
      <AIActionConfirmation
        {...defaultProps}
        affectedResources={[
          { kind: 'Pod', name: 'nginx-1' },
          { kind: 'Pod', name: 'nginx-2' },
        ]}
      />,
    );
    expect(screen.getByText('Pod/nginx-1')).toBeInTheDocument();
    expect(screen.getByText('Pod/nginx-2')).toBeInTheDocument();
    expect(screen.getByText('Affected Resources')).toBeInTheDocument();
  });

  it('calls onConfirm when Confirm clicked', () => {
    const handleConfirm = vi.fn();
    render(
      <AIActionConfirmation
        {...defaultProps}
        onConfirm={handleConfirm}
      />,
    );
    fireEvent.click(screen.getByText('Confirm'));
    expect(handleConfirm).toHaveBeenCalledOnce();
  });

  it('calls onCancel when Cancel clicked', () => {
    const handleCancel = vi.fn();
    render(
      <AIActionConfirmation
        {...defaultProps}
        onCancel={handleCancel}
      />,
    );
    fireEvent.click(screen.getByText('Cancel'));
    expect(handleCancel).toHaveBeenCalledOnce();
  });

  it('shows different risk labels', () => {
    const { rerender } = render(
      <AIActionConfirmation {...defaultProps} risk="low" />,
    );
    expect(screen.getByText('Low Risk')).toBeInTheDocument();

    rerender(<AIActionConfirmation {...defaultProps} risk="critical" />);
    expect(screen.getByText('Critical')).toBeInTheDocument();
  });
});
