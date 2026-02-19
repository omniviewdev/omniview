import { useMemo } from 'react';
import Box from '@mui/material/Box';
import { PieChart as MuiPieChart } from '@mui/x-charts/PieChart';

import type { ComponentSize, SemanticColor } from '../types';
import type { BaseChartProps, CategoricalDatum } from './types';
import { resolveChartColor, chartPalette } from './palette';
import ChartContainer from './ChartContainer';

const heightMap: Record<ComponentSize, number> = { xs: 120, sm: 180, md: 260, lg: 360, xl: 480 };

export interface PieChartProps extends BaseChartProps {
  data: CategoricalDatum[];
  innerRadius?: number;
  showLabels?: boolean;
  colors?: (SemanticColor | string)[];
}

export default function PieChart({
  data,
  innerRadius,
  showLabels = false,
  colors,
  size = 'md',
  height: heightOverride,
  loading,
  error,
  onRetry,
  skipAnimation = false,
  sx,
}: PieChartProps) {
  const chartHeight = heightOverride ?? heightMap[size];
  const palette = useMemo(() => chartPalette(colors), [colors]);
  const isEmpty = data.length === 0;

  const pieData = useMemo(
    () =>
      data.map((d, i) => ({
        id: d.id,
        value: d.value,
        label: d.label,
        color: d.color ? resolveChartColor(d.color) : palette[i % palette.length],
      })),
    [data, palette],
  );

  return (
    <Box sx={sx}>
      <ChartContainer loading={loading} error={error} onRetry={onRetry} empty={isEmpty} height={chartHeight}>
        <MuiPieChart
          height={chartHeight}
          series={[
            {
              data: pieData,
              innerRadius: innerRadius ?? 0,
              arcLabel: showLabels ? (item) => item.label ?? '' : undefined,
            },
          ]}
          skipAnimation={skipAnimation}
        />
      </ChartContainer>
    </Box>
  );
}

PieChart.displayName = 'PieChart';
