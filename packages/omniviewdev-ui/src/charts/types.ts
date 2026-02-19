import type { ReactNode } from 'react';
import type { SxProps, Theme } from '@mui/material/styles';
import type { SemanticColor, ComponentSize } from '../types';

/** A time-stamped data point */
export interface TimeSeriesPoint {
  timestamp: number; // epoch ms
  value: number;
}

/** A named series */
export interface TimeSeriesDef {
  id: string;
  label: string;
  data: TimeSeriesPoint[];
  color?: SemanticColor | string;
  area?: boolean;
  lineStyle?: 'solid' | 'dashed' | 'dotted';
}

/** Categorical data item for bar/pie */
export interface CategoricalDatum {
  id: string;
  label: string;
  value: number;
  color?: SemanticColor | string;
}

/** Vertical event marker at a specific timestamp (Lens-style) */
export interface ChartEventMarker {
  /** Epoch ms or Date — position on the x-axis */
  timestamp: number | Date;
  /** Short label shown above the caret (e.g. "Deploy", "Restart") */
  label?: string;
  /** Semantic color or CSS color. Default: 'muted' */
  color?: SemanticColor | string;
  /** Line style. Default: 'dashed' */
  lineStyle?: 'solid' | 'dashed';
  /** Tooltip content shown on hover. Pass any ReactNode. */
  tooltip?: ReactNode;
}

/** Horizontal reference/threshold line */
export interface ChartAnnotation {
  value: number;
  label?: string;
  color?: SemanticColor | string;
  lineStyle?: 'solid' | 'dashed';
}

/** Built-in value format presets (domain-agnostic) */
export type MetricFormat = 'bytes' | 'percent' | 'duration' | 'rate' | 'si' | 'number';

/** Time range */
export interface ChartTimeRange {
  from: Date;
  to: Date;
}

/** Auto-refresh intervals */
export type RefreshInterval = 0 | 5000 | 10000 | 15000 | 30000 | 60000;

/** Common props shared by all chart wrappers */
export interface BaseChartProps {
  size?: ComponentSize;
  height?: number;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  skipAnimation?: boolean;
  /** Custom unit suffix appended to formatted values (e.g., "MiB", "req/s") */
  unit?: string;
  /** Full custom value formatter, overrides valueFormat + unit */
  valueFormatter?: (value: number | null) => string;
  sx?: SxProps<Theme>;
}
