import React, { useEffect, useRef, useMemo, useState, useCallback } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Menu from '@mui/material/Menu';
import { LuRefreshCw, LuEllipsisVertical } from 'react-icons/lu';

import type { SemanticColor } from '../types';
import type {
  TimeSeriesDef,
  ChartTimeRange,
  ChartAnnotation,
  ChartEventMarker,
  MetricFormat,
  RefreshInterval,
} from './types';
import type { ChartMargin } from './TimeSeriesChart';
import type { TimeRangePreset } from '../inputs/TimeRangePicker';
import Select from '../inputs/Select';
import TimeSeriesChart from './TimeSeriesChart';

export interface MetricsPanelMenuItem {
  label: string;
  onClick: () => void;
}

const defaultPresets: TimeRangePreset[] = [
  { label: '15m', duration: 15 * 60 * 1000 },
  { label: '1h', duration: 60 * 60 * 1000 },
  { label: '6h', duration: 6 * 60 * 60 * 1000 },
  { label: '24h', duration: 24 * 60 * 60 * 1000 },
  { label: '7d', duration: 7 * 24 * 60 * 60 * 1000 },
];

/** Find the closest matching preset duration for a time range */
function matchPresetDuration(range: ChartTimeRange, presets: TimeRangePreset[]): string {
  const duration = range.to.getTime() - range.from.getTime();
  let closest = presets[0];
  let minDiff = Math.abs(duration - closest.duration);
  for (const p of presets) {
    const diff = Math.abs(duration - p.duration);
    if (diff < minDiff) {
      closest = p;
      minDiff = diff;
    }
  }
  return String(closest.duration);
}

export interface MetricsPanelProps {
  title: string;
  /** Muted subtitle below title (e.g. "From Kubernetes Metrics Server") */
  subtitle?: string;
  series: TimeSeriesDef[];
  timeRange: ChartTimeRange;
  onTimeRangeChange?: (range: ChartTimeRange) => void;
  refreshInterval?: RefreshInterval;
  onRefresh?: () => void;
  valueFormat?: MetricFormat;
  unit?: string;
  valueFormatter?: (value: number | null) => string;
  annotations?: ChartAnnotation[];
  /** Lens-style vertical event markers at specific timestamps */
  eventMarkers?: ChartEventMarker[];
  area?: boolean;
  presets?: TimeRangePreset[];
  colors?: (SemanticColor | string)[];
  /** @deprecated Use `toolbar` instead */
  headerActions?: React.ReactNode;
  /** Slot for icon buttons rendered in the header row */
  toolbar?: React.ReactNode;
  /** Three-dot menu items (top-right) */
  menuItems?: MetricsPanelMenuItem[];
  /** Position of the y-axis. Default: 'none' */
  yAxisPosition?: 'left' | 'right' | 'none';
  /** Position of the x-axis. Default: 'none' */
  xAxisPosition?: 'bottom' | 'top' | 'none';
  /** Override chart margins (space between SVG edge and axes). Partial — unset keys use defaults. */
  margin?: ChartMargin;
  /** Override y-axis width (space for tick labels). */
  yAxisWidth?: number;
  /** Override x-axis height (space for tick labels). */
  xAxisHeight?: number;
  /** Render y-axis labels inside the chart area (Grafana/Lens style). Default: true */
  yAxisInline?: boolean;
  /** Which side to render inline y-axis labels. Default: 'right' */
  yAxisInlinePosition?: 'left' | 'right';
  /** 'compact' = minimal padding, no outer border. Default: 'default' */
  variant?: 'default' | 'compact';
  height?: number;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
}

export default function MetricsPanel({
  title,
  subtitle,
  series,
  timeRange,
  onTimeRangeChange,
  refreshInterval = 0,
  onRefresh,
  valueFormat = 'number',
  unit,
  valueFormatter,
  annotations,
  eventMarkers,
  area = false,
  presets = defaultPresets,
  colors,
  headerActions,
  toolbar,
  menuItems,
  yAxisPosition = 'none',
  xAxisPosition = 'none',
  margin,
  yAxisWidth,
  xAxisHeight,
  yAxisInline = true,
  yAxisInlinePosition,
  variant = 'default',
  height = 260,
  loading,
  error,
  onRetry,
}: MetricsPanelProps) {
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [isAutoRefreshing, setIsAutoRefreshing] = useState(refreshInterval > 0);
  const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);

  const isCompact = variant === 'compact';

  const selectedDuration = useMemo(
    () => matchPresetDuration(timeRange, presets),
    [timeRange, presets],
  );

  const selectOptions = useMemo(
    () => presets.map((p) => ({ value: String(p.duration), label: p.label })),
    [presets],
  );

  const clearTimer = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }, []);

  useEffect(() => {
    clearTimer();
    if (isAutoRefreshing && refreshInterval > 0 && onRefresh) {
      intervalRef.current = setInterval(onRefresh, refreshInterval);
    }
    return clearTimer;
  }, [isAutoRefreshing, refreshInterval, onRefresh, clearTimer]);

  const handlePresetChange = (val: string | string[]) => {
    if (!onTimeRangeChange) return;
    const duration = Number(Array.isArray(val) ? val[0] : val);
    const now = new Date();
    onTimeRangeChange({ from: new Date(now.getTime() - duration), to: now });
  };

  const hasControls = onTimeRangeChange || toolbar || headerActions || onRefresh;
  const hasMenu = menuItems && menuItems.length > 0;

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        ...(isCompact
          ? { bgcolor: 'transparent' }
          : {
              bgcolor: 'var(--ov-bg-surface)',
              border: '1px solid var(--ov-border-default)',
              borderRadius: '8px',
            }),
      }}
    >
      {/* Single header row: Title/subtitle (left) | Select + toolbar + refresh + menu (right) */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: 0.75,
          px: 1,
          py: 0.5,
          minHeight: 32,
        }}
      >
        {/* Left: title + subtitle */}
        <Box sx={{ minWidth: 0, flex: 1 }}>
          <Typography
            variant="subtitle2"
            noWrap
            sx={{
              fontWeight: 600,
              color: 'var(--ov-fg-default)',
              fontSize: '0.75rem',
              lineHeight: 1.2,
            }}
          >
            {title}
          </Typography>
          {subtitle && (
            <Typography
              variant="caption"
              noWrap
              sx={{
                color: 'var(--ov-fg-muted)',
                fontSize: '0.625rem',
                lineHeight: 1.2,
                display: 'block',
              }}
            >
              {subtitle}
            </Typography>
          )}
        </Box>

        {/* Right: controls */}
        {hasControls && (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.25, flexShrink: 0 }}>
            {onTimeRangeChange && (
              <Select
                options={selectOptions}
                value={selectedDuration}
                onChange={handlePresetChange}
                size="xs"
              />
            )}
            {toolbar}
            {headerActions}
            {onRefresh && (
              <IconButton
                size="small"
                onClick={() => {
                  if (refreshInterval > 0) {
                    setIsAutoRefreshing((v) => !v);
                  } else {
                    onRefresh();
                  }
                }}
                sx={{
                  color: isAutoRefreshing ? 'var(--ov-accent)' : 'var(--ov-fg-muted)',
                  p: 0.25,
                }}
              >
                <LuRefreshCw size={12} />
              </IconButton>
            )}
          </Box>
        )}

        {/* Menu button */}
        {hasMenu && (
          <>
            <IconButton
              size="small"
              onClick={(e) => setMenuAnchor(e.currentTarget)}
              sx={{ color: 'var(--ov-fg-muted)', p: 0.25, flexShrink: 0 }}
            >
              <LuEllipsisVertical size={13} />
            </IconButton>
            <Menu
              anchorEl={menuAnchor}
              open={Boolean(menuAnchor)}
              onClose={() => setMenuAnchor(null)}
              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
              slotProps={{
                paper: {
                  sx: {
                    bgcolor: 'var(--ov-bg-surface)',
                    border: '1px solid var(--ov-border-subtle)',
                    minWidth: 140,
                  },
                },
              }}
            >
              {menuItems!.map((item) => (
                <MenuItem
                  key={item.label}
                  onClick={() => {
                    setMenuAnchor(null);
                    item.onClick();
                  }}
                  sx={{ fontSize: '0.8125rem' }}
                >
                  {item.label}
                </MenuItem>
              ))}
            </Menu>
          </>
        )}
      </Box>

      {/* Chart — flush, no padding wrapper */}
      <TimeSeriesChart
        series={series}
        timeRange={timeRange}
        valueFormat={valueFormat}
        unit={unit}
        valueFormatter={valueFormatter}
        annotations={annotations}
        eventMarkers={eventMarkers}
        area={area}
        colors={colors}
        height={height}
        loading={loading}
        error={error}
        onRetry={onRetry}
        skipAnimation={isAutoRefreshing}
        yAxisPosition={yAxisPosition}
        xAxisPosition={xAxisPosition}
        margin={margin}
        yAxisWidth={yAxisWidth}
        xAxisHeight={xAxisHeight}
        yAxisInline={yAxisInline}
        yAxisInlinePosition={yAxisInlinePosition}
        compact
        grid
      />
    </Box>
  );
}

MetricsPanel.displayName = 'MetricsPanel';
