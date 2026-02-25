import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AIHealthSummary from './AIHealthSummary';

describe('AIHealthSummary', () => {
  const stats = [
    { label: 'Healthy', value: 12, status: 'healthy' as const },
    { label: 'Warning', value: 3, status: 'warning' as const },
    { label: 'Error', value: 1, status: 'error' as const },
  ];

  it('renders stat values and labels', () => {
    render(<AIHealthSummary stats={stats} />);
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Healthy')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('Warning')).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
    expect(screen.getByText('Error')).toBeInTheDocument();
  });

  it('renders title', () => {
    render(<AIHealthSummary stats={stats} title="Cluster Health" />);
    expect(screen.getByText('Cluster Health')).toBeInTheDocument();
  });

  it('renders breakdowns with kind and total', () => {
    render(
      <AIHealthSummary
        stats={stats}
        breakdowns={[
          {
            kind: 'Pods',
            total: 10,
            statuses: { healthy: 8, warning: 1, error: 1 },
          },
        ]}
      />,
    );
    expect(screen.getByText('Pods')).toBeInTheDocument();
    expect(screen.getByText('10 total')).toBeInTheDocument();
  });

  it('renders multiple breakdowns', () => {
    render(
      <AIHealthSummary
        stats={stats}
        breakdowns={[
          { kind: 'Pods', total: 10, statuses: { healthy: 8 } },
          { kind: 'Services', total: 5, statuses: { healthy: 5 } },
        ]}
      />,
    );
    expect(screen.getByText('Pods')).toBeInTheDocument();
    expect(screen.getByText('Services')).toBeInTheDocument();
  });
});
