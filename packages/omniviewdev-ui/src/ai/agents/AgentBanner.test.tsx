import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentBanner from './AgentBanner';

describe('AgentBanner', () => {
  it('shows "Agent running:" prefix when running', () => {
    render(<AgentBanner taskName="Deploy service" status="running" />);
    expect(screen.getByText(/Agent running:/)).toBeInTheDocument();
  });

  it('shows "Agent completed:" prefix when completed', () => {
    render(<AgentBanner taskName="Deploy service" status="completed" />);
    expect(screen.getByText(/Agent completed:/)).toBeInTheDocument();
  });

  it('shows "Agent paused:" prefix when paused', () => {
    render(<AgentBanner taskName="Deploy service" status="paused" />);
    expect(screen.getByText(/Agent paused:/)).toBeInTheDocument();
  });

  it('shows "Agent error:" prefix when error', () => {
    render(<AgentBanner taskName="Deploy service" status="error" />);
    expect(screen.getByText(/Agent error:/)).toBeInTheDocument();
  });

  it('displays task name', () => {
    render(<AgentBanner taskName="Deploy service" status="running" />);
    expect(screen.getByText('Deploy service')).toBeInTheDocument();
  });

  it('View button calls onView', () => {
    const onView = vi.fn();
    render(<AgentBanner taskName="Deploy" status="running" onView={onView} />);
    fireEvent.click(screen.getByRole('button', { name: 'View' }));
    expect(onView).toHaveBeenCalledOnce();
  });

  it('Dismiss button calls onDismiss', () => {
    const onDismiss = vi.fn();
    render(<AgentBanner taskName="Deploy" status="completed" onDismiss={onDismiss} />);
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it('does not show Dismiss button when onDismiss not provided', () => {
    render(<AgentBanner taskName="Deploy" status="completed" />);
    expect(screen.queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument();
  });
});
