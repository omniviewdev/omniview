import { useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';

import {
  TimeSeriesChart,
  BarChart,
  PieChart,
  ScatterChart,
} from '@omniviewdev/ui/charts';
import type { TimeSeriesDef, CategoricalDatum, ChartAnnotation } from '@omniviewdev/ui/charts';

// --- Demo data generators ---

function generateTimeSeries(label: string, count: number, base: number, variance: number): TimeSeriesDef {
  const now = Date.now();
  const interval = 60_000; // 1 minute
  const data = Array.from({ length: count }, (_, i) => ({
    timestamp: now - (count - i) * interval,
    value: base + Math.sin(i / 5) * variance + (Math.random() - 0.5) * variance * 0.3,
  }));
  return { id: label.toLowerCase().replace(/\s+/g, '-'), label, data };
}

const singleSeries: TimeSeriesDef[] = [
  generateTimeSeries('Series A', 60, 50, 20),
];

const multiSeries: TimeSeriesDef[] = [
  { ...generateTimeSeries('CPU', 60, 45, 15), color: 'primary' },
  { ...generateTimeSeries('Memory', 60, 65, 10), color: 'success' },
  { ...generateTimeSeries('Network', 60, 30, 25), color: 'warning' },
];

const annotations: ChartAnnotation[] = [
  { value: 80, label: 'Threshold', color: 'danger', lineStyle: 'dashed' },
];

const barData: CategoricalDatum[] = [
  { id: 'a', label: 'Alpha', value: 42 },
  { id: 'b', label: 'Beta', value: 78 },
  { id: 'c', label: 'Gamma', value: 35 },
  { id: 'd', label: 'Delta', value: 91 },
  { id: 'e', label: 'Epsilon', value: 56 },
];

const pieData: CategoricalDatum[] = [
  { id: 'web', label: 'Web', value: 45, color: 'primary' },
  { id: 'api', label: 'API', value: 30, color: 'success' },
  { id: 'worker', label: 'Worker', value: 15, color: 'warning' },
  { id: 'other', label: 'Other', value: 10, color: 'info' },
];

const scatterSeries = [
  {
    id: 'cluster-a',
    label: 'Cluster A',
    data: Array.from({ length: 30 }, (_, i) => ({
      x: Math.random() * 100,
      y: Math.random() * 100,
      id: i,
    })),
    color: 'primary' as const,
  },
  {
    id: 'cluster-b',
    label: 'Cluster B',
    data: Array.from({ length: 30 }, (_, i) => ({
      x: 50 + Math.random() * 50,
      y: 50 + Math.random() * 50,
      id: i,
    })),
    color: 'warning' as const,
  },
];

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography
      variant="h6"
      sx={{ fontWeight: 600, color: 'var(--ov-fg-default)', mt: 4, mb: 1.5 }}
    >
      {children}
    </Typography>
  );
}

function SubTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="subtitle2" sx={{ color: 'var(--ov-fg-muted)', mb: 1 }}>
      {children}
    </Typography>
  );
}

export default function ChartsPage() {
  const [lineLoading, setLineLoading] = useState(false);
  const [lineError, setLineError] = useState(false);
  const [lineEmpty, setLineEmpty] = useState(false);

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, color: 'var(--ov-fg-default)', mb: 1 }}>
        Core Charts
      </Typography>
      <Typography variant="body2" sx={{ color: 'var(--ov-fg-muted)', mb: 3 }}>
        Generic chart wrappers built on @mui/x-charts with Omniview theming and unit formatting.
      </Typography>

      {/* --- TimeSeriesChart --- */}
      <SectionTitle>TimeSeriesChart</SectionTitle>

      <SubTitle>Single series</SubTitle>
      <TimeSeriesChart series={singleSeries} size="md" />

      <SubTitle>Multi-series with area fill</SubTitle>
      <TimeSeriesChart series={multiSeries} area size="md" showLegend />

      <SubTitle>With annotations</SubTitle>
      <TimeSeriesChart
        series={multiSeries}
        annotations={annotations}
        valueFormat="number"
        size="md"
      />

      <SubTitle>States: loading, error, empty</SubTitle>
      <Box sx={{ display: 'flex', gap: 1, mb: 1 }}>
        <button onClick={() => setLineLoading((v) => !v)}>
          Toggle loading ({lineLoading ? 'ON' : 'OFF'})
        </button>
        <button onClick={() => setLineError((v) => !v)}>
          Toggle error ({lineError ? 'ON' : 'OFF'})
        </button>
        <button onClick={() => setLineEmpty((v) => !v)}>
          Toggle empty ({lineEmpty ? 'ON' : 'OFF'})
        </button>
      </Box>
      <TimeSeriesChart
        series={lineEmpty ? [] : singleSeries}
        loading={lineLoading}
        error={lineError ? 'Failed to fetch metrics data.' : undefined}
        onRetry={() => setLineError(false)}
        size="sm"
      />

      {/* --- BarChart --- */}
      <SectionTitle>BarChart</SectionTitle>

      <SubTitle>Vertical</SubTitle>
      <BarChart data={barData} size="md" />

      <SubTitle>Horizontal</SubTitle>
      <BarChart data={barData} horizontal size="md" />

      {/* --- PieChart --- */}
      <SectionTitle>PieChart</SectionTitle>

      <Box sx={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        <Box>
          <SubTitle>Full pie</SubTitle>
          <PieChart data={pieData} size="md" />
        </Box>
        <Box>
          <SubTitle>Donut</SubTitle>
          <PieChart data={pieData} innerRadius={50} size="md" />
        </Box>
      </Box>

      {/* --- ScatterChart --- */}
      <SectionTitle>ScatterChart</SectionTitle>
      <ScatterChart
        series={scatterSeries}
        xAxisLabel="Latency (ms)"
        yAxisLabel="Throughput"
        size="md"
      />
    </Box>
  );
}
