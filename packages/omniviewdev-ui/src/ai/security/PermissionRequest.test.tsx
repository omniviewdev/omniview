import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import PermissionRequest from './PermissionRequest';

const baseRequest = {
  action: 'Delete Pod',
  resource: 'pod/nginx-abc',
  connection: 'prod-cluster',
  namespace: 'default',
  requestedBy: 'AI Agent',
  riskLevel: 'warning' as const,
};

describe('PermissionRequest', () => {
  it('shows dialog with "Permission Required" title when open', () => {
    render(
      <PermissionRequest
        open
        onAllow={vi.fn()}
        onDeny={vi.fn()}
        request={baseRequest}
      />,
    );
    expect(screen.getByText('Permission Required')).toBeInTheDocument();
  });

  it('displays action name', () => {
    render(
      <PermissionRequest open onAllow={vi.fn()} onDeny={vi.fn()} request={baseRequest} />,
    );
    expect(screen.getByText('Delete Pod')).toBeInTheDocument();
  });

  it.each([
    ['info', 'Low Risk'],
    ['warning', 'Medium Risk'],
    ['danger', 'High Risk'],
  ] as const)('risk level %s shows badge "%s"', (riskLevel, label) => {
    render(
      <PermissionRequest
        open
        onAllow={vi.fn()}
        onDeny={vi.fn()}
        request={{ ...baseRequest, riskLevel }}
      />,
    );
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('shows detail rows for resource, connection, namespace, requestedBy', () => {
    render(
      <PermissionRequest open onAllow={vi.fn()} onDeny={vi.fn()} request={baseRequest} />,
    );
    expect(screen.getByText('pod/nginx-abc')).toBeInTheDocument();
    expect(screen.getByText('prod-cluster')).toBeInTheDocument();
    expect(screen.getByText('default')).toBeInTheDocument();
    expect(screen.getByText('AI Agent')).toBeInTheDocument();
  });

  it('omits optional fields when not provided', () => {
    const minimalRequest = {
      action: 'List Pods',
      requestedBy: 'Agent',
      riskLevel: 'info' as const,
    };
    render(
      <PermissionRequest open onAllow={vi.fn()} onDeny={vi.fn()} request={minimalRequest} />,
    );
    expect(screen.queryByText('Resource:')).not.toBeInTheDocument();
    expect(screen.queryByText('Connection:')).not.toBeInTheDocument();
    expect(screen.queryByText('Namespace:')).not.toBeInTheDocument();
  });

  it('Deny button calls onDeny', () => {
    const onDeny = vi.fn();
    render(
      <PermissionRequest open onAllow={vi.fn()} onDeny={onDeny} request={baseRequest} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Deny' }));
    expect(onDeny).toHaveBeenCalledOnce();
  });

  it('Allow Once calls onAllow("once")', () => {
    const onAllow = vi.fn();
    render(
      <PermissionRequest open onAllow={onAllow} onDeny={vi.fn()} request={baseRequest} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Allow Once' }));
    expect(onAllow).toHaveBeenCalledWith('once');
  });

  it('unchecked remember: session button calls onAllow("session")', () => {
    const onAllow = vi.fn();
    render(
      <PermissionRequest open onAllow={onAllow} onDeny={vi.fn()} request={baseRequest} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Allow for Session' }));
    expect(onAllow).toHaveBeenCalledWith('session');
  });

  it('checked remember: button changes to "Allow Always" and calls onAllow("always")', () => {
    const onAllow = vi.fn();
    render(
      <PermissionRequest open onAllow={onAllow} onDeny={vi.fn()} request={baseRequest} />,
    );
    // Check the "Remember" checkbox
    const checkbox = screen.getByRole('checkbox');
    fireEvent.click(checkbox);
    // Button text should change
    const allowBtn = screen.getByRole('button', { name: 'Allow Always' });
    fireEvent.click(allowBtn);
    expect(onAllow).toHaveBeenCalledWith('always');
  });
});
