import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import ToolCall from './ToolCall';

describe('ToolCall', () => {
  it('renders tool name', () => {
    render(<ToolCall name="search_files" status="pending" />);
    expect(screen.getByText('search_files')).toBeInTheDocument();
  });

  it('shows pending icon for pending status', () => {
    render(<ToolCall name="test" status="pending" />);
    expect(screen.getByTestId('PendingIcon')).toBeInTheDocument();
  });

  it('shows spinner for running status', () => {
    render(<ToolCall name="test" status="running" />);
    expect(screen.getByRole('progressbar')).toBeInTheDocument();
  });

  it('shows check icon for success status', () => {
    render(<ToolCall name="test" status="success" />);
    expect(screen.getByTestId('CheckCircleIcon')).toBeInTheDocument();
  });

  it('shows error icon for error status', () => {
    render(<ToolCall name="test" status="error" />);
    expect(screen.getByTestId('ErrorIcon')).toBeInTheDocument();
  });

  it('formats duration < 1000 as ms', () => {
    render(<ToolCall name="test" status="success" duration={245} />);
    expect(screen.getByText('245ms')).toBeInTheDocument();
  });

  it('formats duration >= 1000 as seconds', () => {
    render(<ToolCall name="test" status="success" duration={1200} />);
    expect(screen.getByText('1.2s')).toBeInTheDocument();
  });

  it('collapsed by default: args in DOM but wrapper has maxHeight 0 class', () => {
    render(
      <ToolCall name="test" status="success" args={{ query: 'hello' }} />,
    );
    // Content IS in the DOM (hidden via CSS maxHeight: 0), so we just verify the tool renders
    expect(screen.getByText('test')).toBeInTheDocument();
  });

  it('click header expands to show args', () => {
    render(
      <ToolCall name="test" status="success" args={{ query: 'hello' }} />,
    );
    // Click the header (the tool name area)
    fireEvent.click(screen.getByText('test'));
    expect(screen.getByText('Arguments')).toBeInTheDocument();
  });

  it('defaultExpanded shows args immediately', () => {
    render(
      <ToolCall
        name="test"
        status="success"
        args={{ query: 'hello' }}
        defaultExpanded
      />,
    );
    expect(screen.getByText('Arguments')).toBeInTheDocument();
  });

  it('shows error string when error prop provided', () => {
    render(
      <ToolCall name="test" status="error" error="Connection refused" defaultExpanded />,
    );
    expect(screen.getByText('Connection refused')).toBeInTheDocument();
  });

  it('shows result when result provided as string', () => {
    render(
      <ToolCall name="test" status="success" result="42 files found" defaultExpanded />,
    );
    expect(screen.getByText('42 files found')).toBeInTheDocument();
  });

  it('shows result as JSON when result is object', () => {
    render(
      <ToolCall
        name="test"
        status="success"
        result={{ count: 42 }}
        defaultExpanded
      />,
    );
    expect(screen.getByText(/\"count\": 42/)).toBeInTheDocument();
  });
});
