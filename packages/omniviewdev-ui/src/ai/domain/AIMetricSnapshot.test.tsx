import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import AIMetricSnapshot from './AIMetricSnapshot';

describe('AIMetricSnapshot', () => {
  it('renders metric labels and values', () => {
    render(
      <AIMetricSnapshot
        metrics={[
          { label: 'CPU Usage', value: 75, unit: '%' },
          { label: 'Memory', value: '512', unit: 'Mi' },
          { label: 'Requests', value: 1200, unit: 'req/s' },
        ]}
      />,
    );
    expect(screen.getByText('CPU Usage')).toBeInTheDocument();
    expect(screen.getByText('75')).toBeInTheDocument();
    expect(screen.getByText('%')).toBeInTheDocument();
    expect(screen.getByText('Memory')).toBeInTheDocument();
    expect(screen.getByText('512')).toBeInTheDocument();
    expect(screen.getByText('Requests')).toBeInTheDocument();
    expect(screen.getByText('1200')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(
      <AIMetricSnapshot
        title="Resource Metrics"
        metrics={[{ label: 'CPU', value: 50 }]}
      />,
    );
    expect(screen.getByText('Resource Metrics')).toBeInTheDocument();
  });

  it('renders delta indicator', () => {
    render(
      <AIMetricSnapshot
        metrics={[{ label: 'CPU', value: 75, delta: 5.2, deltaDirection: 'up' }]}
      />,
    );
    expect(screen.getByText('5.2')).toBeInTheDocument();
  });

  it('renders sparkline SVG when data provided', () => {
    const { container } = render(
      <AIMetricSnapshot
        metrics={[{ label: 'CPU', value: 75, sparkline: [10, 20, 30, 25, 40] }]}
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('does not render sparkline with fewer than 2 data points', () => {
    const { container } = render(
      <AIMetricSnapshot
        metrics={[{ label: 'CPU', value: 75, sparkline: [10] }]}
      />,
    );
    const svg = container.querySelector('svg');
    expect(svg).not.toBeInTheDocument();
  });
});
