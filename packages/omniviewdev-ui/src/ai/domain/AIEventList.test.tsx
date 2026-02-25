import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import AIEventList from './AIEventList';
import type { AIEvent } from './AIEventList';

const sampleEvents: AIEvent[] = Array.from({ length: 10 }, (_, i) => ({
  type: i % 3 === 0 ? 'error' : i % 3 === 1 ? 'warning' : 'info',
  reason: `Event-${i + 1}`,
  message: `Something happened ${i + 1}`,
  source: `component-${i}`,
  count: i === 0 ? 5 : undefined,
}));

describe('AIEventList', () => {
  it('renders events', () => {
    render(<AIEventList events={sampleEvents.slice(0, 3)} />);
    expect(screen.getByText('Event-1')).toBeInTheDocument();
    expect(screen.getByText('Something happened 1')).toBeInTheDocument();
  });

  it('shows title when provided', () => {
    render(<AIEventList events={[]} title="Recent Events" />);
    expect(screen.getByText('Recent Events')).toBeInTheDocument();
  });

  it('truncates to maxEvents', () => {
    render(<AIEventList events={sampleEvents} maxEvents={3} />);
    expect(screen.getByText('Event-1')).toBeInTheDocument();
    expect(screen.getByText('Event-3')).toBeInTheDocument();
    expect(screen.queryByText('Event-4')).not.toBeInTheDocument();
  });

  it('shows "Show N more" when truncated', () => {
    render(<AIEventList events={sampleEvents} maxEvents={3} />);
    expect(screen.getByText('Show 7 more')).toBeInTheDocument();
  });

  it('expands to show all events', () => {
    render(<AIEventList events={sampleEvents} maxEvents={3} />);
    fireEvent.click(screen.getByText('Show 7 more'));
    expect(screen.getByText('Event-10')).toBeInTheDocument();
  });

  it('shows count badge', () => {
    render(<AIEventList events={sampleEvents.slice(0, 1)} />);
    expect(screen.getByText('×5')).toBeInTheDocument();
  });

  it('shows source', () => {
    render(<AIEventList events={sampleEvents.slice(0, 1)} />);
    expect(screen.getByText('component-0')).toBeInTheDocument();
  });

  it('calls onExpand when View all clicked', () => {
    const handleExpand = vi.fn();
    render(<AIEventList events={sampleEvents} onExpand={handleExpand} />);
    fireEvent.click(screen.getByText('View all events'));
    expect(handleExpand).toHaveBeenCalledOnce();
  });
});
