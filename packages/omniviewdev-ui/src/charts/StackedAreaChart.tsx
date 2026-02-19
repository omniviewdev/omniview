import { useMemo } from 'react';
import Box from '@mui/material/Box';
import { LineChart } from '@mui/x-charts/LineChart';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';

import type { ComponentSize, SemanticColor } from '../types';
import type { BaseChartProps, TimeSeriesDef, ChartTimeRange, MetricFormat } from './types';
import { resolveChartColor, chartPalette } from './palette';
import { getValueFormatter } from './formatters';
import { useChartTheme } from './useChartTheme';
import ChartContainer from './ChartContainer';

const heightMap: Record<ComponentSize, number> = { xs: 120, sm: 180, md: 260, lg: 360, xl: 480 };

export interface StackedAreaChartProps extends BaseChartProps {
  series: TimeSeriesDef[];
  /** Horizontal reference line for capacity/limit */
  capacity?: number;
  timeRange?: ChartTimeRange;
  valueFormat?: MetricFormat;
  stacked?: boolean;
  colors?: (SemanticColor | string)[];
  /** Position of the y-axis. Default: 'left' */
  yAxisPosition?: 'left' | 'right' | 'none';
}

export default function StackedAreaChart({
  series,
  capacity,
  timeRange,
  valueFormat = 'number',
  unit,
  valueFormatter: customFormatter,
  stacked = true,
  colors,
  yAxisPosition = 'left',
  size = 'md',
  height: heightOverride,
  loading,
  error,
  onRetry,
  skipAnimation = false,
  sx,
}: StackedAreaChartProps) {
  const chartTheme = useChartTheme();
  const chartHeight = heightOverride ?? heightMap[size];
  const palette = useMemo(() => chartPalette(colors), [colors]);
  const fmt = useMemo(
    () => customFormatter ?? getValueFormatter(valueFormat, unit),
    [customFormatter, valueFormat, unit],
  );

  const isEmpty = series.length === 0 || series.every((s) => s.data.length === 0);

  const xData = useMemo(() => {
    for (const s of series) {
      if (s.data.length > 0) return s.data.map((p) => new Date(p.timestamp));
    }
    return [];
  }, [series]);

  const muiSeries = useMemo(
    () =>
      series.map((s, i) => ({
        id: s.id,
        label: s.label,
        data: s.data.map((p) => p.value),
        color: s.color ? resolveChartColor(s.color) : palette[i % palette.length],
        area: true,
        showMark: false,
        stack: stacked ? 'total' : undefined,
        valueFormatter: fmt,
      })),
    [series, stacked, fmt, palette],
  );

  return (
    <Box sx={sx}>
      <ChartContainer loading={loading} error={error} onRetry={onRetry} empty={isEmpty} height={chartHeight}>
        <LineChart
          height={chartHeight}
          series={muiSeries}
          xAxis={[
            {
              data: xData,
              scaleType: 'time' as const,
              ...(timeRange && { min: timeRange.from, max: timeRange.to }),
            },
          ]}
          yAxis={[{ valueFormatter: fmt, position: yAxisPosition }]}
          grid={{ horizontal: true }}
          skipAnimation={skipAnimation}
          hideLegend
          sx={{
            '& .MuiChartsAxis-line': { stroke: chartTheme.axisLineColor },
            '& .MuiChartsAxis-tick': { stroke: chartTheme.axisLineColor },
            '& .MuiChartsAxis-tickLabel': {
              fill: chartTheme.tooltipFg,
              fontSize: chartTheme.fontSize,
            },
            '& .MuiChartsGrid-line': { stroke: chartTheme.gridColor },
            '& .MuiAreaElement-root': { opacity: chartTheme.areaOpacity },
          }}
        >
          {capacity != null && (
            <ChartsReferenceLine
              y={capacity}
              label="Capacity"
              lineStyle={{
                stroke: resolveChartColor('danger'),
                strokeDasharray: '6 3',
              }}
              labelStyle={{ fill: chartTheme.tooltipFg, fontSize: chartTheme.fontSize }}
            />
          )}
        </LineChart>
      </ChartContainer>
    </Box>
  );
}

StackedAreaChart.displayName = 'StackedAreaChart';
