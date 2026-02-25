import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentStatusItem from './AgentStatusItem';

describe('AgentStatusItem', () => {
  it('running: shows spinner and task name', () => {
    render(<AgentStatusItem status="running" taskName="Deploying app" />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
    expect(screen.getByText('Deploying app')).toBeInTheDocument();
  });

  it('idle: shows "Agent idle"', () => {
    render(<AgentStatusItem status="idle" />);
    expect(screen.getByText('Agent idle')).toBeInTheDocument();
  });

  it('paused: shows task name or default', () => {
    render(<AgentStatusItem status="paused" taskName="Build" />);
    expect(screen.getByText('Build')).toBeInTheDocument();
  });

  it('error: shows task name or default', () => {
    render(<AgentStatusItem status="error" />);
    expect(screen.getByText('Agent error')).toBeInTheDocument();
  });

  it('completed: shows task name or default', () => {
    render(<AgentStatusItem status="completed" />);
    expect(screen.getByText('Agent completed')).toBeInTheDocument();
  });

  it('progress percentage displayed when provided', () => {
    render(<AgentStatusItem status="running" taskName="Build" progress={75} />);
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('click calls onClick', () => {
    const onClick = vi.fn();
    render(<AgentStatusItem status="idle" onClick={onClick} />);
    fireEvent.click(screen.getByText('Agent idle'));
    expect(onClick).toHaveBeenCalledOnce();
  });
});
