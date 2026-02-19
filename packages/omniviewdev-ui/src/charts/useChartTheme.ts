import { useMemo } from 'react';
import { useTheme } from '@mui/material/styles';

export interface ChartTheme {
  axisLineColor: string;
  gridColor: string;
  tooltipBg: string;
  tooltipFg: string;
  fontFamily: string;
  fontSize: number;
  areaOpacity: number;
}

function resolveToken(prop: string, fallback: string): string {
  if (typeof document === 'undefined') return fallback;
  const val = getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
  return val || fallback;
}

/** Returns chart axis/grid/tooltip styling derived from --ov-* tokens. */
export function useChartTheme(): ChartTheme {
  const theme = useTheme();
  const isDark = theme.palette.mode === 'dark';

  return useMemo<ChartTheme>(() => ({
    axisLineColor: resolveToken('--ov-border-default', isDark ? '#3a3a3a' : '#d4d4d4'),
    gridColor: resolveToken('--ov-border-subtle', isDark ? '#2a2a2a' : '#e8e8e8'),
    tooltipBg: resolveToken('--ov-bg-surface', isDark ? '#1e1e1e' : '#ffffff'),
    tooltipFg: resolveToken('--ov-fg-default', isDark ? '#e0e0e0' : '#1a1a1a'),
    fontFamily: resolveToken('--ov-font-sans', theme.typography.fontFamily ?? 'sans-serif'),
    fontSize: 11,
    areaOpacity: 0.15,
  }), [isDark, theme.typography.fontFamily]);
}
