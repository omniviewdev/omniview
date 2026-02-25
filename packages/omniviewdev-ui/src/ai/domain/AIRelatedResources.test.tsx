import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AIRelatedResources from './AIRelatedResources';

describe('AIRelatedResources', () => {
  const primary = { kind: 'Deployment', name: 'nginx-deploy' };
  const related = [
    { kind: 'ReplicaSet', name: 'nginx-rs-abc', relationship: 'manages' },
    { kind: 'Service', name: 'nginx-svc', relationship: 'exposes' },
    { kind: 'ConfigMap', name: 'nginx-config', relationship: 'mounts' },
  ];

  it('renders primary resource', () => {
    render(<AIRelatedResources primary={primary} related={related} />);
    expect(screen.getByText('Deployment')).toBeInTheDocument();
    expect(screen.getByText('nginx-deploy')).toBeInTheDocument();
  });

  it('renders related resources with relationship labels', () => {
    render(<AIRelatedResources primary={primary} related={related} />);
    expect(screen.getByText('ReplicaSet')).toBeInTheDocument();
    expect(screen.getByText('nginx-rs-abc')).toBeInTheDocument();
    expect(screen.getByText('manages')).toBeInTheDocument();
    expect(screen.getByText('Service')).toBeInTheDocument();
    expect(screen.getByText('exposes')).toBeInTheDocument();
  });

  it('calls onNavigate with kind and name when related resource clicked', () => {
    const handleNav = vi.fn();
    render(
      <AIRelatedResources
        primary={primary}
        related={related}
        onNavigate={handleNav}
      />,
    );
    fireEvent.click(screen.getByText('nginx-rs-abc'));
    expect(handleNav).toHaveBeenCalledWith('ReplicaSet', 'nginx-rs-abc');
  });

  it('does not crash without onNavigate', () => {
    render(<AIRelatedResources primary={primary} related={related} />);
    // Should render without errors
    expect(screen.getByText('nginx-deploy')).toBeInTheDocument();
  });
});
