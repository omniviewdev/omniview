import { SparkLineChart } from '@mui/x-charts/SparkLineChart';
import type { SemanticColor } from '../types';
import { resolveChartColor } from './palette';

export interface SparklineProps {
  data: number[];
  plotType?: 'line' | 'bar';
  area?: boolean;
  color?: SemanticColor | string;
  height?: number;
  width?: number | string;
  showTooltip?: boolean;
  skipAnimation?: boolean;
}

const sizeMap = { top: 2, bottom: 2, left: 2, right: 2 };

export default function Sparkline({
  data,
  plotType = 'line',
  area = false,
  color = 'primary',
  height = 40,
  width = '100%',
  showTooltip = false,
  skipAnimation = false,
}: SparklineProps) {
  const resolvedColor = resolveChartColor(color);

  return (
    <SparkLineChart
      data={data}
      plotType={plotType}
      area={area}
      height={height}
      width={typeof width === 'number' ? width : undefined}
      color={resolvedColor}
      curve="natural"
      margin={sizeMap}
      showTooltip={showTooltip}
      skipAnimation={skipAnimation}
      sx={typeof width === 'string' ? { width } : undefined}
    />
  );
}

Sparkline.displayName = 'Sparkline';
