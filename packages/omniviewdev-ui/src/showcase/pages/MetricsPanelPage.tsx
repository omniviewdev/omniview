import { useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import { LuCpu, LuLayers } from 'react-icons/lu';

import { MetricCard } from '../../domain';
import {
  Sparkline,
  GaugeCard,
  MetricsPanel,
  StackedAreaChart,
} from '../../charts';
import type { TimeSeriesDef, ChartTimeRange, ChartEventMarker } from '../../charts';

// --- Helpers ---

function generateSeries(label: string, count: number, base: number, variance: number): TimeSeriesDef {
  const now = Date.now();
  const interval = 60_000;
  const data = Array.from({ length: count }, (_, i) => ({
    timestamp: now - (count - i) * interval,
    value: Math.max(0, base + Math.sin(i / 5) * variance + (Math.random() - 0.5) * variance * 0.3),
  }));
  return { id: label.toLowerCase().replace(/\s+/g, '-'), label, data };
}

const sparklineData = Array.from({ length: 20 }, () => Math.random() * 100);
const sparklineData2 = Array.from({ length: 20 }, (_, i) => 40 + Math.sin(i / 3) * 20);

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Typography variant="h6" sx={{ fontWeight: 600, color: 'var(--ov-fg-default)', mt: 4, mb: 1.5 }}>
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

export default function MetricsPanelPage() {
  const [timeRange, setTimeRange] = useState<ChartTimeRange>({
    from: new Date(Date.now() - 60 * 60 * 1000),
    to: new Date(),
  });

  const [panelSeries, setPanelSeries] = useState<TimeSeriesDef[]>([
    { ...generateSeries('Requests', 60, 120, 30), color: 'primary' },
    { ...generateSeries('Errors', 60, 8, 5), color: 'danger' },
  ]);

  const handleRefresh = useCallback(() => {
    const now = Date.now();
    const duration = timeRange.to.getTime() - timeRange.from.getTime();
    setTimeRange({ from: new Date(now - duration), to: new Date(now) });
    setPanelSeries([
      { ...generateSeries('Requests', 60, 120, 30), color: 'primary' },
      { ...generateSeries('Errors', 60, 8, 5), color: 'danger' },
    ]);
  }, [timeRange]);

  const [cpuTimeRange, setCpuTimeRange] = useState<ChartTimeRange>({
    from: new Date(Date.now() - 60 * 60 * 1000),
    to: new Date(),
  });

  const [cpuSeries, setCpuSeries] = useState<TimeSeriesDef[]>([
    { ...generateSeries('Node 1', 60, 45, 15), color: 'primary' },
    { ...generateSeries('Node 2', 60, 62, 10), color: 'success' },
    { ...generateSeries('Node 3', 60, 30, 20), color: 'warning' },
  ]);

  const handleCpuRefresh = useCallback(() => {
    const now = Date.now();
    const duration = cpuTimeRange.to.getTime() - cpuTimeRange.from.getTime();
    setCpuTimeRange({ from: new Date(now - duration), to: new Date(now) });
    setCpuSeries([
      { ...generateSeries('Node 1', 60, 45, 15), color: 'primary' },
      { ...generateSeries('Node 2', 60, 62, 10), color: 'success' },
      { ...generateSeries('Node 3', 60, 30, 20), color: 'warning' },
    ]);
  }, [cpuTimeRange]);

  const stackedSeries: TimeSeriesDef[] = [
    { ...generateSeries('Namespace A', 60, 200, 40), color: 'primary' },
    { ...generateSeries('Namespace B', 60, 150, 30), color: 'success' },
    { ...generateSeries('Namespace C', 60, 80, 20), color: 'warning' },
  ];

  return (
    <Box>
      <Typography variant="h4" sx={{ fontWeight: 700, color: 'var(--ov-fg-default)', mb: 1 }}>
        Metrics & Gauges
      </Typography>
      <Typography variant="body2" sx={{ color: 'var(--ov-fg-muted)', mb: 3 }}>
        Composed metric visualization components — Sparkline, GaugeCard, MetricsPanel, and StackedAreaChart.
      </Typography>

      {/* --- Sparkline --- */}
      <SectionTitle>Sparkline</SectionTitle>

      <Box sx={{ display: 'flex', gap: 3, flexWrap: 'wrap', mb: 2 }}>
        <Box>
          <SubTitle>Line (default)</SubTitle>
          <Box sx={{ width: 160, height: 40, bgcolor: 'var(--ov-bg-surface)', borderRadius: '4px', p: 0.5 }}>
            <Sparkline data={sparklineData} />
          </Box>
        </Box>
        <Box>
          <SubTitle>Bar</SubTitle>
          <Box sx={{ width: 160, height: 40, bgcolor: 'var(--ov-bg-surface)', borderRadius: '4px', p: 0.5 }}>
            <Sparkline data={sparklineData} plotType="bar" color="success" />
          </Box>
        </Box>
        <Box>
          <SubTitle>Area</SubTitle>
          <Box sx={{ width: 160, height: 40, bgcolor: 'var(--ov-bg-surface)', borderRadius: '4px', p: 0.5 }}>
            <Sparkline data={sparklineData2} area color="warning" />
          </Box>
        </Box>
      </Box>

      <SubTitle>Inside MetricCard</SubTitle>
      <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 2, mb: 2 }}>
        <MetricCard
          label="CPU Usage"
          value="72"
          unit="%"
          delta={3.2}
          deltaDirection="up"
          sparkline={<Sparkline data={sparklineData} area color="primary" />}
        />
        <MetricCard
          label="Memory"
          value="4.2"
          unit="GiB"
          delta={-1.1}
          deltaDirection="down"
          sparkline={<Sparkline data={sparklineData2} area color="success" />}
        />
        <MetricCard
          label="Network I/O"
          value="128"
          unit="Mbps"
          sparkline={<Sparkline data={sparklineData} plotType="bar" color="info" />}
        />
      </Box>

      {/* --- GaugeCard --- */}
      <SectionTitle>GaugeCard</SectionTitle>

      <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap', mb: 2 }}>
        <GaugeCard value={42} label="CPU" unit="%" size="sm" />
        <GaugeCard value={72} label="Memory" unit="%" size="md" />
        <GaugeCard value={91} label="Disk" unit="%" size="md" />
        <GaugeCard value={15} label="Network" unit="%" size="lg" />
        <GaugeCard value={50} label="Loading" unit="%" size="sm" loading />
      </Box>

      <SubTitle>Custom thresholds [30, 70]</SubTitle>
      <Box sx={{ display: 'flex', gap: 2, mb: 2 }}>
        <GaugeCard value={25} label="Low" unit="%" thresholds={[30, 70]} size="sm" />
        <GaugeCard value={50} label="Mid" unit="%" thresholds={[30, 70]} size="sm" />
        <GaugeCard value={85} label="High" unit="%" thresholds={[30, 70]} size="sm" />
      </Box>

      {/* --- MetricsPanel (Lens-style) --- */}
      <SectionTitle>MetricsPanel</SectionTitle>

      <SubTitle>Dashboard grid — default variant cards</SubTitle>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
          gap: 2,
          mb: 3,
        }}
      >
        <MetricsPanel
          title="CPU Usage"
          subtitle="Displaying from Kubernetes Metrics Server"
          series={cpuSeries}
          timeRange={cpuTimeRange}
          onTimeRangeChange={setCpuTimeRange}
          refreshInterval={15000}
          onRefresh={handleCpuRefresh}
          valueFormat="percent"
          area
          height={200}
          menuItems={[
            { label: 'Export CSV', onClick: () => {} },
            { label: 'Full Screen', onClick: () => {} },
          ]}
          toolbar={
            <>
              <IconButton size="small" sx={{ color: 'var(--ov-fg-muted)', p: 0.5 }}>
                <LuCpu size={13} />
              </IconButton>
              <IconButton size="small" sx={{ color: 'var(--ov-fg-muted)', p: 0.5 }}>
                <LuLayers size={13} />
              </IconButton>
            </>
          }
        />
        <MetricsPanel
          title="Request Rate"
          subtitle="Application load balancer"
          series={panelSeries}
          timeRange={timeRange}
          onTimeRangeChange={setTimeRange}
          refreshInterval={15000}
          onRefresh={handleRefresh}
          valueFormat="rate"
          unit="/s"
          area
          height={200}
          annotations={[{ value: 150, label: 'SLA Target', color: 'danger', lineStyle: 'dashed' }]}
        />
      </Box>

      <SubTitle>Compact variant — borderless, for embedding inside other containers</SubTitle>
      <Box
        sx={{
          border: '1px solid var(--ov-border-default)',
          borderRadius: '8px',
          bgcolor: 'var(--ov-bg-surface)',
          p: 1,
        }}
      >
        <MetricsPanel
          title="Memory Pressure"
          series={cpuSeries}
          timeRange={cpuTimeRange}
          onTimeRangeChange={setCpuTimeRange}
          onRefresh={handleCpuRefresh}
          valueFormat="percent"
          area
          variant="compact"
          height={180}
        />
      </Box>

      <SubTitle>With event markers + inline y-axis (Lens-style)</SubTitle>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))',
          gap: 2,
          mb: 3,
        }}
      >
        <MetricsPanel
          title="Pod CPU — Events"
          subtitle="Showing deploy, restart, and OOM events"
          series={cpuSeries}
          timeRange={cpuTimeRange}
          onTimeRangeChange={setCpuTimeRange}
          onRefresh={handleCpuRefresh}
          valueFormat="percent"
          area
          height={200}
          yAxisInline
          xAxisPosition="bottom"
          eventMarkers={[
            {
              timestamp: cpuTimeRange.to.getTime() - 45 * 60_000,
              label: 'Deploy',
              color: 'primary',
              tooltip: (
                <>
                  <strong>Deployment v2.4.1</strong>
                  <br />Rolled out 3/3 replicas
                  <br /><span style={{ opacity: 0.6 }}>45 min ago</span>
                </>
              ),
            },
            {
              timestamp: cpuTimeRange.to.getTime() - 30 * 60_000,
              label: 'Restart',
              color: 'warning',
              tooltip: (
                <>
                  <strong>Container Restart</strong>
                  <br />nginx-proxy restarted (exit code 137)
                  <br /><span style={{ opacity: 0.6 }}>30 min ago</span>
                </>
              ),
            },
            {
              timestamp: cpuTimeRange.to.getTime() - 10 * 60_000,
              label: 'OOM Kill',
              color: 'danger',
              tooltip: (
                <>
                  <strong>OOM Killed</strong>
                  <br />worker-3 exceeded 512Mi limit
                  <br /><span style={{ opacity: 0.6 }}>10 min ago</span>
                </>
              ),
            },
          ] satisfies ChartEventMarker[]}
        />
      </Box>

      {/* --- StackedAreaChart --- */}
      <SectionTitle>StackedAreaChart</SectionTitle>
      <SubTitle>With capacity line</SubTitle>
      <StackedAreaChart
        series={stackedSeries}
        capacity={500}
        valueFormat="si"
        unit="MiB"
        size="lg"
      />
    </Box>
  );
}
