import { useMemo, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import Box from '@mui/material/Box';
import Popper from '@mui/material/Popper';
import { LineChart } from '@mui/x-charts/LineChart';
import { ChartsReferenceLine } from '@mui/x-charts/ChartsReferenceLine';
import { useXScale, useYScale, useDrawingArea } from '@mui/x-charts/hooks';

import type { ComponentSize, SemanticColor } from '../types';
import type { BaseChartProps, TimeSeriesDef, ChartTimeRange, ChartAnnotation, ChartEventMarker, MetricFormat } from './types';
import { resolveChartColor, chartPalette } from './palette';
import { getValueFormatter } from './formatters';
import { useChartTheme } from './useChartTheme';
import ChartContainer from './ChartContainer';

const heightMap: Record<ComponentSize, number> = { xs: 120, sm: 180, md: 260, lg: 360, xl: 480 };

interface VirtualAnchor {
  getBoundingClientRect: () => DOMRect;
}

/** SVG overlay that renders ▼ carets, labels, and hover tooltips for event markers */
function EventMarkerOverlay({ markers }: { markers: ChartEventMarker[] }) {
  const xScale = useXScale<'time'>();
  const { top } = useDrawingArea();
  const [hovered, setHovered] = useState<{ index: number; anchor: VirtualAnchor } | null>(null);

  const handleEnter = useCallback((i: number, e: React.PointerEvent<SVGGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setHovered({
      index: i,
      anchor: { getBoundingClientRect: () => rect },
    });
  }, []);

  const handleLeave = useCallback(() => setHovered(null), []);

  const hoveredMarker = hovered != null ? markers[hovered.index] : null;

  return (
    <g>
      {markers.map((m, i) => {
        const ts = m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp);
        const x = xScale(ts);
        if (x == null || isNaN(x as number)) return null;
        const color = resolveChartColor(m.color ?? 'muted');
        const hasTooltip = !!m.tooltip;
        return (
          <g
            key={`evt-${i}`}
            style={hasTooltip ? { cursor: 'pointer' } : undefined}
            onPointerEnter={hasTooltip ? (e) => handleEnter(i, e) : undefined}
            onPointerLeave={hasTooltip ? handleLeave : undefined}
          >
            {/* Invisible hit area for easier hover targeting */}
            {hasTooltip && (
              <rect
                x={(x as number) - 16}
                y={top - (m.label ? 20 : 12)}
                width={32}
                height={m.label ? 20 : 12}
                fill="transparent"
              />
            )}
            <text x={x as number} y={top - 1} textAnchor="middle" fill={color} fontSize={8}>
              &#x25BC;
            </text>
            {m.label && (
              <text x={x as number} y={top - 9} textAnchor="middle" fill={color} fontSize={9} fontWeight={500}>
                {m.label}
              </text>
            )}
          </g>
        );
      })}
      {hovered && hoveredMarker?.tooltip && createPortal(
        <Popper
          open
          anchorEl={hovered.anchor as unknown as HTMLElement}
          placement="top"
          modifiers={[{ name: 'offset', options: { offset: [0, 6] } }]}
          sx={{ zIndex: 1500, pointerEvents: 'none' }}
        >
          <Box
            sx={{
              bgcolor: 'var(--ov-bg-elevated, #1e1e2e)',
              color: 'var(--ov-fg-default, #cdd6f4)',
              border: '1px solid var(--ov-border-subtle, #45475a)',
              borderRadius: '6px',
              px: 1.25,
              py: 0.75,
              fontSize: '0.75rem',
              lineHeight: 1.4,
              maxWidth: 260,
              boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
            }}
          >
            {hoveredMarker.tooltip}
          </Box>
        </Popper>,
        document.body,
      )}
    </g>
  );
}

/** Renders y-axis tick labels inside the drawing area (Grafana/Lens style) */
function InlineYAxisLabels({ formatter, color, position = 'right' }: {
  formatter: (v: number | null) => string;
  color: string;
  position?: 'left' | 'right';
}) {
  const yScale = useYScale<'linear'>();
  const { left, top, width, height } = useDrawingArea();

  // d3 linear scale exposes .ticks()
  const ticks: number[] = (yScale as unknown as { ticks: (count?: number) => number[] }).ticks?.() ?? [];

  const isRight = position === 'right';
  const x = isRight ? left + width - 4 : left + 4;
  const anchor = isRight ? 'end' : 'start';

  return (
    <g>
      {ticks.map((tick) => {
        const y = yScale(tick) as unknown as number;
        if (y == null || isNaN(y)) return null;
        if (y < top - 2 || y > top + height + 2) return null;
        const label = formatter(tick);
        return (
          <text
            key={tick}
            x={x}
            y={y - 4}
            textAnchor={anchor}
            fill={color}
            fontSize={10}
            opacity={0.7}
          >
            {label}
          </text>
        );
      })}
    </g>
  );
}

export interface ChartMargin {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface TimeSeriesChartProps extends BaseChartProps {
  series: TimeSeriesDef[];
  timeRange?: ChartTimeRange;
  yAxisLabel?: string;
  valueFormat?: MetricFormat;
  annotations?: ChartAnnotation[];
  area?: boolean;
  grid?: boolean;
  showLegend?: boolean;
  showMarks?: boolean;
  colors?: (SemanticColor | string)[];
  /** Position of the y-axis. Default: 'left' */
  yAxisPosition?: 'left' | 'right' | 'none';
  /** Position of the x-axis. Default: 'bottom' */
  xAxisPosition?: 'bottom' | 'top' | 'none';
  /** Compact mode hides axis lines for embedded use */
  compact?: boolean;
  /** Override chart margins (space between SVG border and axes). Partial — unset keys use defaults. */
  margin?: ChartMargin;
  /** Override y-axis width (space for tick labels). Default: 30 in compact, 40 otherwise. */
  yAxisWidth?: number;
  /** Override x-axis height (space for tick labels). Default: 20 in compact, 24 otherwise. */
  xAxisHeight?: number;
  /** Render y-axis labels inside the chart area (Grafana/Lens style). Hides the external y-axis. */
  yAxisInline?: boolean;
  /** Which side to render inline y-axis labels. Default: 'right' */
  yAxisInlinePosition?: 'left' | 'right';
  /** Lens-style vertical event markers at specific timestamps */
  eventMarkers?: ChartEventMarker[];
}

export default function TimeSeriesChart({
  series,
  timeRange,
  yAxisLabel,
  valueFormat = 'number',
  unit,
  valueFormatter: customFormatter,
  annotations,
  area = false,
  grid = true,
  showLegend = false,
  showMarks = false,
  colors,
  yAxisPosition = 'left',
  xAxisPosition = 'bottom',
  compact = false,
  margin: marginOverride,
  yAxisWidth: yAxisWidthOverride,
  xAxisHeight: xAxisHeightOverride,
  yAxisInline = false,
  yAxisInlinePosition = 'right',
  eventMarkers,
  size = 'md',
  height: heightOverride,
  loading,
  error,
  onRetry,
  skipAnimation = false,
  sx,
}: TimeSeriesChartProps) {
  const chartTheme = useChartTheme();
  const chartHeight = heightOverride ?? heightMap[size];
  const palette = useMemo(() => chartPalette(colors), [colors]);
  const fmt = useMemo(
    () => customFormatter ?? getValueFormatter(valueFormat, unit),
    [customFormatter, valueFormat, unit],
  );

  const isEmpty = series.length === 0 || series.every((s) => s.data.length === 0);

  // Build the x-axis timestamps from the first series that has data (they should align)
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
        area: s.area ?? area,
        showMark: showMarks,
        valueFormatter: fmt,
        ...(s.lineStyle === 'dashed' ? { strokeDasharray: '6 3' } : {}),
        ...(s.lineStyle === 'dotted' ? { strokeDasharray: '2 2' } : {}),
      })),
    [series, area, showMarks, fmt, palette],
  );

  // Margin = space between SVG edge and axis area. Axis width/height is separate.
  const defaultMargin = compact
    ? { top: 4, right: 2, bottom: 2, left: 2 }
    : { top: 8, right: 8, bottom: 8, left: 8 };

  // Bump top margin when event markers are present so carets/labels aren't clipped
  const markerTopPad = eventMarkers?.length
    ? eventMarkers.some((m) => m.label) ? 20 : 10
    : 0;

  const chartMargin = {
    ...defaultMargin,
    ...marginOverride,
    top: (marginOverride?.top ?? defaultMargin.top) + markerTopPad,
  };

  const yWidth = yAxisInline ? 0 : (yAxisWidthOverride ?? (compact ? 30 : 40));
  const xHeight = xAxisHeightOverride ?? (compact ? 20 : 24);

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
              height: xHeight,
              position: xAxisPosition,
              ...(timeRange && { min: timeRange.from, max: timeRange.to }),
            },
          ]}
          yAxis={[
            {
              label: yAxisLabel,
              valueFormatter: fmt,
              position: yAxisPosition,
              width: yWidth,
            },
          ]}
          grid={grid ? { horizontal: true } : undefined}
          skipAnimation={skipAnimation}
          hideLegend={!showLegend}
          margin={chartMargin}
          sx={{
            '& .MuiChartsAxis-line': compact ? { display: 'none' } : { stroke: chartTheme.axisLineColor },
            '& .MuiChartsAxis-tick': compact ? { display: 'none' } : { stroke: chartTheme.axisLineColor },
            '& .MuiChartsAxis-tickLabel': {
              fill: chartTheme.tooltipFg,
              fontSize: chartTheme.fontSize,
            },
            // Hide the entire default y-axis when rendering labels inline
            ...(yAxisInline && { '& .MuiChartsAxis-left, & .MuiChartsAxis-right': { display: 'none' } }),
            '& .MuiChartsGrid-line': { stroke: chartTheme.gridColor, opacity: 0.5 },
            '& .MuiAreaElement-root': { opacity: chartTheme.areaOpacity },
          }}
        >
          {annotations?.map((ann, i) => (
            <ChartsReferenceLine
              key={`ann-${i}`}
              y={ann.value}
              label={ann.label}
              lineStyle={{
                stroke: ann.color ? resolveChartColor(ann.color) : 'var(--ov-fg-muted)',
                strokeDasharray: ann.lineStyle === 'dashed' ? '6 3' : undefined,
              }}
              labelStyle={{ fill: chartTheme.tooltipFg, fontSize: chartTheme.fontSize }}
            />
          ))}
          {eventMarkers?.map((m, i) => (
            <ChartsReferenceLine
              key={`evt-line-${i}`}
              x={m.timestamp instanceof Date ? m.timestamp : new Date(m.timestamp)}
              lineStyle={{
                stroke: resolveChartColor(m.color ?? 'muted'),
                strokeDasharray: m.lineStyle === 'solid' ? undefined : '4 3',
                strokeWidth: 1,
              }}
            />
          ))}
          {eventMarkers?.length && <EventMarkerOverlay markers={eventMarkers} />}
          {yAxisInline && <InlineYAxisLabels formatter={fmt} color={chartTheme.tooltipFg} position={yAxisInlinePosition} />}
        </LineChart>
      </ChartContainer>
    </Box>
  );
}

TimeSeriesChart.displayName = 'TimeSeriesChart';
