import { useMemo } from 'react';
import Box from '@mui/material/Box';
import { BarChart as MuiBarChart } from '@mui/x-charts/BarChart';

import type { ComponentSize, SemanticColor } from '../types';
import type { BaseChartProps, CategoricalDatum, MetricFormat } from './types';
import { resolveChartColor, chartPalette } from './palette';
import { getValueFormatter } from './formatters';
import { useChartTheme } from './useChartTheme';
import ChartContainer from './ChartContainer';

const heightMap: Record<ComponentSize, number> = { xs: 120, sm: 180, md: 260, lg: 360, xl: 480 };

export interface BarChartProps extends BaseChartProps {
  data: CategoricalDatum[];
  horizontal?: boolean;
  valueFormat?: MetricFormat;
  showLabels?: boolean;
  stacked?: boolean;
  colors?: (SemanticColor | string)[];
}

export default function BarChart({
  data,
  horizontal = false,
  valueFormat = 'number',
  unit,
  valueFormatter: customFormatter,
  showLabels = false,
  colors,
  size = 'md',
  height: heightOverride,
  loading,
  error,
  onRetry,
  skipAnimation = false,
  sx,
}: BarChartProps) {
  const chartTheme = useChartTheme();
  const chartHeight = heightOverride ?? heightMap[size];
  const palette = useMemo(() => chartPalette(colors), [colors]);
  const fmt = useMemo(
    () => customFormatter ?? getValueFormatter(valueFormat, unit),
    [customFormatter, valueFormat, unit],
  ) as (v: number | null) => string;

  const isEmpty = data.length === 0;

  const resolvedColors = useMemo(
    () => data.map((d, i) => (d.color ? resolveChartColor(d.color) : palette[i % palette.length])),
    [data, palette],
  );

  const labels = useMemo(() => data.map((d) => d.label), [data]);
  const values = useMemo(() => data.map((d) => d.value), [data]);

  return (
    <Box sx={sx}>
      <ChartContainer loading={loading} error={error} onRetry={onRetry} empty={isEmpty} height={chartHeight}>
        <MuiBarChart
          height={chartHeight}
          layout={horizontal ? 'horizontal' : 'vertical'}
          series={[
            {
              data: values,
              valueFormatter: fmt,
              label: showLabels ? 'Value' : undefined,
            },
          ]}
          xAxis={
            horizontal
              ? [{ valueFormatter: fmt }]
              : [{ data: labels, scaleType: 'band' as const }]
          }
          yAxis={
            horizontal
              ? [{ data: labels, scaleType: 'band' as const }]
              : [{ valueFormatter: fmt }]
          }
          colors={resolvedColors}
          skipAnimation={skipAnimation}
          hideLegend
          sx={{
            '& .MuiChartsAxis-line': { stroke: chartTheme.axisLineColor },
            '& .MuiChartsAxis-tick': { stroke: chartTheme.axisLineColor },
            '& .MuiChartsAxis-tickLabel': {
              fill: chartTheme.tooltipFg,
              fontSize: chartTheme.fontSize,
            },
          }}
        />
      </ChartContainer>
    </Box>
  );
}

BarChart.displayName = 'BarChart';
