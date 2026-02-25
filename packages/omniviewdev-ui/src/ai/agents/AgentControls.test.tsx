import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AgentControls from './AgentControls';

describe('AgentControls', () => {
  it('running: shows pause, cancel, detach buttons', () => {
    render(
      <AgentControls
        status="running"
        onPause={vi.fn()}
        onCancel={vi.fn()}
        onDetach={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Pause')).toBeInTheDocument();
    expect(screen.getByLabelText('Cancel')).toBeInTheDocument();
    expect(screen.getByLabelText('Run in background')).toBeInTheDocument();
  });

  it('paused: shows resume, cancel; no pause, no detach', () => {
    render(
      <AgentControls
        status="paused"
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
        onDetach={vi.fn()}
      />,
    );
    expect(screen.getByLabelText('Resume')).toBeInTheDocument();
    expect(screen.getByLabelText('Cancel')).toBeInTheDocument();
    expect(screen.queryByLabelText('Pause')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Run in background')).not.toBeInTheDocument();
  });

  it('idle: no buttons rendered', () => {
    const { container } = render(
      <AgentControls
        status="idle"
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('completed: no buttons rendered', () => {
    const { container } = render(
      <AgentControls
        status="completed"
        onPause={vi.fn()}
        onResume={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('click handlers called correctly', () => {
    const onPause = vi.fn();
    const onCancel = vi.fn();
    render(
      <AgentControls status="running" onPause={onPause} onCancel={onCancel} />,
    );
    fireEvent.click(screen.getByLabelText('Pause'));
    expect(onPause).toHaveBeenCalledOnce();
    fireEvent.click(screen.getByLabelText('Cancel'));
    expect(onCancel).toHaveBeenCalledOnce();
  });
});
