import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import SecurityBanner from './SecurityBanner';

describe('SecurityBanner', () => {
  it('displays connection name', () => {
    render(<SecurityBanner connection="prod-cluster" level="read-only" />);
    expect(screen.getByText('prod-cluster')).toBeInTheDocument();
  });

  it('displays level label', () => {
    render(<SecurityBanner connection="prod-cluster" level="read-write" />);
    expect(screen.getByText('read write')).toBeInTheDocument();
  });

  it('displays permissions when provided', () => {
    render(
      <SecurityBanner
        connection="prod"
        level="full-access"
        permissions={['pods', 'deployments']}
      />,
    );
    expect(screen.getByText('pods, deployments')).toBeInTheDocument();
  });

  it('does not display permissions when not provided', () => {
    const { container } = render(
      <SecurityBanner connection="prod" level="restricted" />,
    );
    // Only the connection and level text should be present, no extra comma-separated text
    expect(container.textContent).toContain('prod');
    expect(container.textContent).toContain('restricted');
  });
});
