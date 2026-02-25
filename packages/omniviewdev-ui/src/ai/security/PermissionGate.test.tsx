import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PermissionGate from './PermissionGate';

describe('PermissionGate', () => {
  it('renders children when allowed', () => {
    render(
      <PermissionGate allowed>
        <div>Secret content</div>
      </PermissionGate>,
    );
    expect(screen.getByText('Secret content')).toBeInTheDocument();
  });

  it('does not render children when not allowed', () => {
    render(
      <PermissionGate allowed={false}>
        <div>Secret content</div>
      </PermissionGate>,
    );
    expect(screen.queryByText('Secret content')).not.toBeInTheDocument();
  });

  it('shows lock icon and default message when not allowed', () => {
    render(
      <PermissionGate allowed={false}>
        <div>Hidden</div>
      </PermissionGate>,
    );
    expect(screen.getByText('Permission required to view this content')).toBeInTheDocument();
    expect(screen.getByTestId('LockIcon')).toBeInTheDocument();
  });

  it('shows custom message when provided', () => {
    render(
      <PermissionGate allowed={false} message="You need admin access">
        <div>Hidden</div>
      </PermissionGate>,
    );
    expect(screen.getByText('You need admin access')).toBeInTheDocument();
  });

  it('shows Request Access button when onRequest provided', () => {
    const onRequest = vi.fn();
    render(
      <PermissionGate allowed={false} onRequest={onRequest}>
        <div>Hidden</div>
      </PermissionGate>,
    );
    const btn = screen.getByRole('button', { name: 'Request Access' });
    expect(btn).toBeInTheDocument();
    fireEvent.click(btn);
    expect(onRequest).toHaveBeenCalledOnce();
  });

  it('does not show Request Access button when onRequest not provided', () => {
    render(
      <PermissionGate allowed={false}>
        <div>Hidden</div>
      </PermissionGate>,
    );
    expect(screen.queryByRole('button', { name: 'Request Access' })).not.toBeInTheDocument();
  });
});
