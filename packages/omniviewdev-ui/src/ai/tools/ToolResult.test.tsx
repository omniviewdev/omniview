import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import ToolResult from './ToolResult';

describe('ToolResult', () => {
  it('renders string result as text', () => {
    render(<ToolResult result="Operation completed" />);
    expect(screen.getByText('Operation completed')).toBeInTheDocument();
  });

  it('renders object result as JSON', () => {
    render(<ToolResult result={{ status: 'ok', count: 5 }} />);
    expect(screen.getByText(/\"status\": \"ok\"/)).toBeInTheDocument();
  });

  it('shows error with danger styling when error prop provided', () => {
    render(<ToolResult result={null} error="Something went wrong" />);
    expect(screen.getByText('Something went wrong')).toBeInTheDocument();
  });

  it('shows error instead of result when both provided', () => {
    render(<ToolResult result="good" error="bad" />);
    expect(screen.getByText('bad')).toBeInTheDocument();
    expect(screen.queryByText('good')).not.toBeInTheDocument();
  });
});
