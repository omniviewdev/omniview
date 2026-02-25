import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentPopup from './AgentPopup';

const agent = {
  id: 'agent-1',
  status: 'running' as const,
  taskName: 'Deploy service',
  startedAt: '2 min ago',
  tasks: [
    { id: 't1', label: 'Pull image', status: 'complete' as const },
    { id: 't2', label: 'Apply manifest', status: 'running' as const },
  ],
  output: ['Pulling image...', 'Image pulled successfully'],
};

describe('AgentPopup', () => {
  // Create a real anchor element for the popover
  const anchorEl = document.createElement('div');
  document.body.appendChild(anchorEl);

  it('renders task name and started time when open', () => {
    render(
      <AgentPopup
        open
        anchorEl={anchorEl}
        onClose={vi.fn()}
        agent={agent}
      />,
    );
    expect(screen.getByText('Deploy service')).toBeInTheDocument();
    expect(screen.getByText('Started 2 min ago')).toBeInTheDocument();
  });

  it('renders task list when tasks provided', () => {
    render(
      <AgentPopup open anchorEl={anchorEl} onClose={vi.fn()} agent={agent} />,
    );
    expect(screen.getByText('Pull image')).toBeInTheDocument();
    expect(screen.getByText('Apply manifest')).toBeInTheDocument();
  });

  it('renders output log when output lines provided', () => {
    render(
      <AgentPopup open anchorEl={anchorEl} onClose={vi.fn()} agent={agent} />,
    );
    expect(screen.getByText(/Pulling image.../)).toBeInTheDocument();
  });
});
