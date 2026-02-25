import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AICommandSuggestion from './AICommandSuggestion';

describe('AICommandSuggestion', () => {
  beforeEach(() => {
    vi.mocked(navigator.clipboard.writeText).mockClear();
  });

  it('renders the command text', () => {
    render(<AICommandSuggestion command="kubectl get pods" />);
    expect(screen.getByText('kubectl get pods')).toBeInTheDocument();
  });

  it('renders description when provided', () => {
    render(
      <AICommandSuggestion
        command="ls -la"
        description="List all files"
      />,
    );
    expect(screen.getByText('List all files')).toBeInTheDocument();
  });

  it('copies command to clipboard', async () => {
    render(<AICommandSuggestion command="kubectl get pods" />);
    fireEvent.click(screen.getByLabelText('Copy command'));
    await waitFor(() => {
      expect(navigator.clipboard.writeText).toHaveBeenCalledWith('kubectl get pods');
    });
  });

  it('shows Copied feedback', async () => {
    render(<AICommandSuggestion command="echo hello" />);
    fireEvent.click(screen.getByLabelText('Copy command'));
    await waitFor(() => {
      expect(screen.getByLabelText('Copied')).toBeInTheDocument();
    });
  });

  it('calls onRun with command for non-dangerous commands', () => {
    const handleRun = vi.fn();
    render(
      <AICommandSuggestion command="kubectl get pods" onRun={handleRun} />,
    );
    fireEvent.click(screen.getByLabelText('Run in terminal'));
    expect(handleRun).toHaveBeenCalledWith('kubectl get pods');
  });

  it('shows confirmation for dangerous commands before running', () => {
    const handleRun = vi.fn();
    render(
      <AICommandSuggestion
        command="kubectl delete pod nginx"
        dangerous
        onRun={handleRun}
      />,
    );
    fireEvent.click(screen.getByLabelText('Run in terminal'));
    expect(handleRun).not.toHaveBeenCalled();
    expect(screen.getByText('This command may be destructive. Are you sure?')).toBeInTheDocument();
  });

  it('shows custom danger message', () => {
    render(
      <AICommandSuggestion
        command="rm -rf /"
        dangerous
        dangerMessage="This will delete everything!"
        onRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Run in terminal'));
    expect(screen.getByText('This will delete everything!')).toBeInTheDocument();
  });

  it('runs dangerous command after confirmation', () => {
    const handleRun = vi.fn();
    render(
      <AICommandSuggestion
        command="kubectl delete pod nginx"
        dangerous
        onRun={handleRun}
      />,
    );
    fireEvent.click(screen.getByLabelText('Run in terminal'));
    fireEvent.click(screen.getByLabelText('Confirm run'));
    expect(handleRun).toHaveBeenCalledWith('kubectl delete pod nginx');
  });

  it('cancels dangerous command confirmation', () => {
    render(
      <AICommandSuggestion
        command="kubectl delete pod nginx"
        dangerous
        onRun={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByLabelText('Run in terminal'));
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByText('This command may be destructive. Are you sure?')).not.toBeInTheDocument();
  });

  it('shows warning icon for dangerous commands', () => {
    render(<AICommandSuggestion command="rm -rf /" dangerous />);
    expect(screen.getByText('dangerous command')).toBeInTheDocument();
  });
});
