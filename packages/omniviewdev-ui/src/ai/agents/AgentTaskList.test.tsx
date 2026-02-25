import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AgentTaskList from './AgentTaskList';

const tasks = [
  { id: '1', label: 'Fetch config', status: 'complete' as const, timestamp: '10:30' },
  { id: '2', label: 'Apply changes', status: 'running' as const, detail: 'Step 2 of 3' },
  { id: '3', label: 'Verify', status: 'queued' as const },
];

describe('AgentTaskList', () => {
  it('renders all tasks with labels', () => {
    render(<AgentTaskList tasks={tasks} />);
    expect(screen.getByText('Fetch config')).toBeInTheDocument();
    expect(screen.getByText('Apply changes')).toBeInTheDocument();
    expect(screen.getByText('Verify')).toBeInTheDocument();
  });

  it('running task shows spinner', () => {
    render(<AgentTaskList tasks={tasks} />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('complete task shows check icon', () => {
    render(<AgentTaskList tasks={tasks} />);
    expect(screen.getByTestId('CheckCircleIcon')).toBeInTheDocument();
  });

  it('detail text shown when provided', () => {
    render(<AgentTaskList tasks={tasks} />);
    expect(screen.getByText('Step 2 of 3')).toBeInTheDocument();
  });

  it('timestamps rendered', () => {
    render(<AgentTaskList tasks={tasks} />);
    expect(screen.getByText('10:30')).toBeInTheDocument();
  });
});
