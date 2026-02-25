import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AILogViewer from './AILogViewer';
import type { AILogLine } from './AILogViewer';

const sampleLines: AILogLine[] = Array.from({ length: 20 }, (_, i) => ({
  timestamp: `2024-01-01T00:00:${String(i).padStart(2, '0')}Z`,
  content: `Log line ${i + 1}`,
  severity: i === 5 ? 'error' : i === 10 ? 'warn' : 'info',
}));

describe('AILogViewer', () => {
  it('renders log lines', () => {
    render(<AILogViewer lines={sampleLines.slice(0, 3)} />);
    expect(screen.getByText('Log line 1')).toBeInTheDocument();
    expect(screen.getByText('Log line 2')).toBeInTheDocument();
    expect(screen.getByText('Log line 3')).toBeInTheDocument();
  });

  it('truncates to maxLines by default', () => {
    render(<AILogViewer lines={sampleLines} maxLines={5} />);
    expect(screen.getByText('Log line 1')).toBeInTheDocument();
    expect(screen.getByText('Log line 5')).toBeInTheDocument();
    expect(screen.queryByText('Log line 6')).not.toBeInTheDocument();
  });

  it('shows "Show N more" button when truncated', () => {
    render(<AILogViewer lines={sampleLines} maxLines={5} />);
    expect(screen.getByText('Show 15 more lines')).toBeInTheDocument();
  });

  it('expands to show all lines', () => {
    render(<AILogViewer lines={sampleLines} maxLines={5} />);
    fireEvent.click(screen.getByText('Show 15 more lines'));
    expect(screen.getByText('Log line 20')).toBeInTheDocument();
  });

  it('shows error count badge', () => {
    render(<AILogViewer lines={sampleLines} />);
    expect(screen.getByText('1 errors')).toBeInTheDocument();
  });

  it('shows warning count badge', () => {
    render(<AILogViewer lines={sampleLines} />);
    expect(screen.getByText('1 warnings')).toBeInTheDocument();
  });

  it('renders custom title', () => {
    render(<AILogViewer lines={[]} title="Pod logs: nginx" />);
    expect(screen.getByText('Pod logs: nginx')).toBeInTheDocument();
  });

  it('shows View full logs button when onExpand provided', () => {
    const handleExpand = vi.fn();
    render(<AILogViewer lines={sampleLines} onExpand={handleExpand} />);
    fireEvent.click(screen.getByText('View full logs'));
    expect(handleExpand).toHaveBeenCalledOnce();
  });
});
