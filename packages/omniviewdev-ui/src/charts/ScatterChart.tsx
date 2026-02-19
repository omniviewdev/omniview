import { useMemo } from 'react';
import Box from '@mui/material/Box';
import { ScatterChart as MuiScatterChart } from '@mui/x-charts/ScatterChart';

import type { ComponentSize, SemanticColor } from '../types';
import type { BaseChartProps, MetricFormat } from './types';
import { resolveChartColor, chartPalette } from './palette';
import { getValueFormatter } from './formatters';
import { useChartTheme } from './useChartTheme';
import ChartContainer from './ChartContainer';

const heightMap: Record<ComponentSize, number> = { xs: 120, sm: 180, md: 260, lg: 360, xl: 480 };

export interface ScatterSeriesDef {
  id: string;
  label: string;
  data: Array<{ x: number; y: number; id?: string | number }>;
  color?: SemanticColor | string;
}

export interface ScatterChartProps extends BaseChartProps {
  series: ScatterSeriesDef[];
  xAxisLabel?: string;
  yAxisLabel?: string;
  xFormat?: MetricFormat;
  yFormat?: MetricFormat;
  colors?: (SemanticColor | string)[];
}

export default function ScatterChart({
  series,
  xAxisLabel,
  yAxisLabel,
  xFormat = 'number',
  yFormat = 'number',
  colors,
  size = 'md',
  height: heightOverride,
  loading,
  error,
  onRetry,
  skipAnimation = false,
  sx,
}: ScatterChartProps) {
  const chartTheme = useChartTheme();
  const chartHeight = heightOverride ?? heightMap[size];
  const palette = useMemo(() => chartPalette(colors), [colors]);
  const isEmpty = series.length === 0 || series.every((s) => s.data.length === 0);

  const xFmt = useMemo(() => getValueFormatter(xFormat), [xFormat]);
  const yFmt = useMemo(() => getValueFormatter(yFormat), [yFormat]);

  const muiSeries = useMemo(
    () =>
      series.map((s, i) => ({
        id: s.id,
        label: s.label,
        data: s.data.map((pt, idx) => ({ x: pt.x, y: pt.y, id: pt.id ?? idx })),
        color: s.color ? resolveChartColor(s.color) : palette[i % palette.length],
      })),
    [series, palette],
  );

  return (
    <Box sx={sx}>
      <ChartContainer loading={loading} error={error} onRetry={onRetry} empty={isEmpty} height={chartHeight}>
        <MuiScatterChart
          height={chartHeight}
          series={muiSeries}
          xAxis={[{ label: xAxisLabel, valueFormatter: xFmt }]}
          yAxis={[{ label: yAxisLabel, valueFormatter: yFmt }]}
          skipAnimation={skipAnimation}
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

ScatterChart.displayName = 'ScatterChart';
