import type { MetricFormat } from './types';

const numberFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });

/** Format bytes with auto-scaling (B → TiB). */
export function formatBytes(n: number, unit?: string): string {
  const abs = Math.abs(n);
  if (abs < 1024) return `${n} ${unit ?? 'B'}`;
  if (abs < 1024 ** 2) return `${numberFmt.format(n / 1024)} ${unit ?? 'KiB'}`;
  if (abs < 1024 ** 3) return `${numberFmt.format(n / 1024 ** 2)} ${unit ?? 'MiB'}`;
  if (abs < 1024 ** 4) return `${numberFmt.format(n / 1024 ** 3)} ${unit ?? 'GiB'}`;
  return `${numberFmt.format(n / 1024 ** 4)} ${unit ?? 'TiB'}`;
}

/** Format a value as a percentage. */
export function formatPercent(v: number, unit?: string): string {
  return `${numberFmt.format(v)}${unit ?? '%'}`;
}

/** Format a duration in ms with auto-scaling. */
export function formatDuration(ms: number, unit?: string): string {
  const abs = Math.abs(ms);
  if (unit) return `${numberFmt.format(ms)} ${unit}`;
  if (abs < 1000) return `${numberFmt.format(ms)} ms`;
  if (abs < 60_000) return `${numberFmt.format(ms / 1000)} s`;
  if (abs < 3_600_000) return `${numberFmt.format(ms / 60_000)} m`;
  return `${numberFmt.format(ms / 3_600_000)} h`;
}

const siPrefixes = ['', 'k', 'M', 'G', 'T', 'P'];

/** Format a rate (/s) with SI prefix. */
export function formatRate(v: number, unit?: string): string {
  const abs = Math.abs(v);
  let idx = 0;
  let scaled = abs;
  while (scaled >= 1000 && idx < siPrefixes.length - 1) {
    scaled /= 1000;
    idx++;
  }
  const sign = v < 0 ? '-' : '';
  return `${sign}${numberFmt.format(scaled)} ${siPrefixes[idx]}${unit ?? '/s'}`;
}

/** Format with SI prefix (1.2k, 3.4M, etc.). */
export function formatSI(v: number, unit?: string): string {
  const abs = Math.abs(v);
  let idx = 0;
  let scaled = abs;
  while (scaled >= 1000 && idx < siPrefixes.length - 1) {
    scaled /= 1000;
    idx++;
  }
  const sign = v < 0 ? '-' : '';
  const suffix = unit ? ` ${unit}` : siPrefixes[idx] ? ` ${siPrefixes[idx]}` : '';
  return `${sign}${numberFmt.format(scaled)}${suffix}`;
}

/** Format a number with locale-aware commas. */
export function formatNumber(v: number, unit?: string): string {
  const formatted = new Intl.NumberFormat(undefined).format(v);
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Format a Date for axis tick labels (HH:mm). */
export function formatTimeAxisTick(date: Date): string {
  return timeFmt.format(date);
}

/** Returns the formatter function for a given MetricFormat preset. Handles null for MUI X compat. */
export function getValueFormatter(
  format: MetricFormat,
  unit?: string,
): (v: number | null) => string {
  const inner = ((): (v: number) => string => {
    switch (format) {
      case 'bytes': return (v) => formatBytes(v, unit);
      case 'percent': return (v) => formatPercent(v, unit);
      case 'duration': return (v) => formatDuration(v, unit);
      case 'rate': return (v) => formatRate(v, unit);
      case 'si': return (v) => formatSI(v, unit);
      case 'number': return (v) => formatNumber(v, unit);
    }
  })();
  return (v: number | null) => (v == null ? '–' : inner(v));
}
