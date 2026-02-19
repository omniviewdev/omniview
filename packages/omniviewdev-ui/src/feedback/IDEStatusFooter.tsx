import React from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import LinearProgress from '@mui/material/LinearProgress';
import MuiTooltip from '@mui/material/Tooltip';
import type { SxProps, Theme } from '@mui/material/styles';

// ---------------------------------------------------------------------------
// StatusChip - Colored mode indicator (e.g. "DEVELOPMENT MODE", "DEV")
// ---------------------------------------------------------------------------

export interface StatusChipProps {
  label: string;
  bgColor?: string;
  color?: string;
  icon?: React.ReactNode;
  onClick?: () => void;
  tooltip?: string;
}

function StatusChip({ label, bgColor, color, icon, onClick, tooltip }: StatusChipProps) {
  const content = (
    <Box
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        px: '6px',
        height: '100%',
        fontSize: '0.625rem',
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        bgcolor: bgColor ?? 'transparent',
        color: color ?? '#fff',
        cursor: onClick ? 'pointer' : 'default',
        whiteSpace: 'nowrap',
        '&:hover': onClick ? { filter: 'brightness(1.15)' } : {},
      }}
    >
      {icon && <Box sx={{ display: 'flex', fontSize: '0.625rem' }}>{icon}</Box>}
      {label}
    </Box>
  );

  return tooltip ? <MuiTooltip title={tooltip}>{content}</MuiTooltip> : content;
}

// ---------------------------------------------------------------------------
// FooterStatusDot - Tiny colored status indicator
// ---------------------------------------------------------------------------

export interface FooterStatusDotProps {
  color: string;
  pulse?: boolean;
  tooltip?: string;
}

function FooterStatusDot({ color, pulse, tooltip }: FooterStatusDotProps) {
  const dot = (
    <Box
      sx={{
        width: 8,
        height: 8,
        borderRadius: '50%',
        bgcolor: color,
        flexShrink: 0,
        ...(pulse && {
          animation: 'ov-footer-pulse 1.5s ease-in-out infinite',
          '@keyframes ov-footer-pulse': {
            '0%, 100%': { opacity: 1 },
            '50%': { opacity: 0.3 },
          },
        }),
      }}
    />
  );

  return tooltip ? <MuiTooltip title={tooltip}>{dot}</MuiTooltip> : dot;
}

// ---------------------------------------------------------------------------
// StatusText - Simple text segment
// ---------------------------------------------------------------------------

export interface StatusTextProps {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onClick?: () => void;
  tooltip?: string;
}

function StatusText({ children, icon, onClick, tooltip }: StatusTextProps) {
  const content = (
    <Box
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        px: '6px',
        fontSize: '0.6875rem',
        color: 'var(--ov-fg-default)',
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: '2px',
        whiteSpace: 'nowrap',
        '&:hover': onClick ? { bgcolor: 'rgba(255,255,255,0.08)' } : {},
      }}
    >
      {icon && <Box sx={{ display: 'flex', fontSize: '0.6875rem' }}>{icon}</Box>}
      {children}
    </Box>
  );

  return tooltip ? <MuiTooltip title={tooltip}>{content}</MuiTooltip> : content;
}

// ---------------------------------------------------------------------------
// StatusSpinner - Activity indicator with label
// ---------------------------------------------------------------------------

export interface StatusSpinnerProps {
  label?: string;
  tooltip?: string;
}

function StatusSpinner({ label, tooltip }: StatusSpinnerProps) {
  const content = (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        px: '6px',
        fontSize: '0.6875rem',
        color: 'var(--ov-fg-default)',
      }}
    >
      <CircularProgress size={10} thickness={5} sx={{ color: 'var(--ov-fg-muted)' }} />
      {label && <span>{label}</span>}
    </Box>
  );

  return tooltip ? <MuiTooltip title={tooltip}>{content}</MuiTooltip> : content;
}

// ---------------------------------------------------------------------------
// StatusProgress - Inline progress bar for footer
// ---------------------------------------------------------------------------

export interface StatusProgressProps {
  /** 0–100 progress value. Omit for indeterminate. */
  value?: number;
  /** Width in px */
  width?: number;
  /** Bar color (CSS value) */
  color?: string;
  /** Label shown beside the bar */
  label?: string;
  /** Whether to show percentage text */
  showValue?: boolean;
  tooltip?: string;
}

function StatusProgress({
  value,
  width = 80,
  color = 'var(--ov-accent)',
  label,
  showValue = false,
  tooltip,
}: StatusProgressProps) {
  const indeterminate = value === undefined;
  const content = (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '4px',
        px: '6px',
        fontSize: '0.625rem',
        color: 'var(--ov-fg-default)',
      }}
    >
      {label && (
        <Box component="span" sx={{ whiteSpace: 'nowrap', color: 'var(--ov-fg-muted)' }}>
          {label}
        </Box>
      )}
      <LinearProgress
        variant={indeterminate ? 'indeterminate' : 'determinate'}
        value={indeterminate ? undefined : value}
        sx={{
          width,
          height: 3,
          borderRadius: 1.5,
          bgcolor: 'rgba(255,255,255,0.1)',
          '& .MuiLinearProgress-bar': {
            bgcolor: color,
            borderRadius: 1.5,
          },
        }}
      />
      {showValue && !indeterminate && value !== undefined && (
        <Box component="span" sx={{ whiteSpace: 'nowrap', color: 'var(--ov-fg-muted)' }}>
          {Math.round(value)}%
        </Box>
      )}
    </Box>
  );

  return tooltip ? <MuiTooltip title={tooltip}>{content}</MuiTooltip> : content;
}

// ---------------------------------------------------------------------------
// StatusSeparator - Thin vertical divider
// ---------------------------------------------------------------------------

export interface StatusSeparatorProps {
  color?: string;
}

function StatusSeparator({ color }: StatusSeparatorProps) {
  return (
    <Box
      sx={{
        width: '1px',
        height: '60%',
        bgcolor: color ?? 'var(--ov-border-default)',
        flexShrink: 0,
        mx: '2px',
      }}
    />
  );
}

// ---------------------------------------------------------------------------
// StatusButton - Tiny clickable action button
// ---------------------------------------------------------------------------

export interface StatusButtonProps {
  icon?: React.ReactNode;
  label?: string;
  onClick?: () => void;
  tooltip?: string;
  color?: string;
}

function StatusButton({ icon, label, onClick, tooltip, color }: StatusButtonProps) {
  const content = (
    <Box
      component="button"
      onClick={onClick}
      sx={{
        all: 'unset',
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        px: '5px',
        height: '100%',
        fontSize: '0.625rem',
        fontWeight: 500,
        color: color ?? 'var(--ov-fg-default)',
        cursor: 'pointer',
        borderRadius: '2px',
        whiteSpace: 'nowrap',
        '&:hover': { bgcolor: 'rgba(255,255,255,0.1)' },
        '&:active': { bgcolor: 'rgba(255,255,255,0.15)' },
      }}
    >
      {icon && <Box sx={{ display: 'flex', fontSize: '0.625rem' }}>{icon}</Box>}
      {label}
    </Box>
  );

  return tooltip ? <MuiTooltip title={tooltip}>{content}</MuiTooltip> : content;
}

// ---------------------------------------------------------------------------
// StatusBadge - Notification count badge
// ---------------------------------------------------------------------------

export interface StatusBadgeProps {
  count: number;
  icon?: React.ReactNode;
  maxCount?: number;
  onClick?: () => void;
  tooltip?: string;
  color?: string;
}

function StatusBadge({ count, icon, maxCount = 99, onClick, tooltip, color }: StatusBadgeProps) {
  const display = count > maxCount ? `${maxCount}+` : String(count);
  const content = (
    <Box
      onClick={onClick}
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        px: '5px',
        height: '100%',
        fontSize: '0.625rem',
        fontWeight: 600,
        color: 'var(--ov-fg-default)',
        cursor: onClick ? 'pointer' : 'default',
        '&:hover': onClick ? { bgcolor: 'rgba(255,255,255,0.08)' } : {},
      }}
    >
      {icon && <Box sx={{ display: 'flex', fontSize: '0.625rem' }}>{icon}</Box>}
      {count > 0 && (
        <Box
          component="span"
          sx={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            minWidth: 14,
            height: 14,
            borderRadius: '7px',
            bgcolor: color ?? 'var(--ov-accent)',
            color: '#fff',
            fontSize: '0.5625rem',
            fontWeight: 700,
            lineHeight: 1,
            px: '3px',
          }}
        >
          {display}
        </Box>
      )}
    </Box>
  );

  return tooltip ? <MuiTooltip title={tooltip}>{content}</MuiTooltip> : content;
}

// ---------------------------------------------------------------------------
// StatusTimer - Elapsed time / countdown display
// ---------------------------------------------------------------------------

export interface StatusTimerProps {
  /** Time string to display, e.g. "02:34" or "1h 23m" */
  time: string;
  icon?: React.ReactNode;
  running?: boolean;
  tooltip?: string;
}

function StatusTimer({ time, icon, running, tooltip }: StatusTimerProps) {
  const content = (
    <Box
      sx={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '3px',
        px: '6px',
        fontSize: '0.625rem',
        fontFamily: 'var(--ov-font-mono)',
        fontFeatureSettings: '"tnum"',
        color: 'var(--ov-fg-muted)',
        whiteSpace: 'nowrap',
        ...(running && {
          animation: 'ov-footer-timer-blink 2s step-end infinite',
          '@keyframes ov-footer-timer-blink': {
            '0%, 100%': { opacity: 1 },
            '50%': { opacity: 0.6 },
          },
        }),
      }}
    >
      {icon && <Box sx={{ display: 'flex', fontSize: '0.625rem' }}>{icon}</Box>}
      {time}
    </Box>
  );

  return tooltip ? <MuiTooltip title={tooltip}>{content}</MuiTooltip> : content;
}

// ---------------------------------------------------------------------------
// StatusCircular - Tiny circular progress for footer
// ---------------------------------------------------------------------------

export interface StatusCircularProps {
  /** 0–100 value. Omit for indeterminate. */
  value?: number;
  /** Diameter in px */
  size?: number;
  /** Bar color */
  color?: string;
  tooltip?: string;
}

function StatusCircular({ value, size = 12, color, tooltip }: StatusCircularProps) {
  const indeterminate = value === undefined;
  const content = (
    <Box sx={{ display: 'inline-flex', alignItems: 'center', px: '4px' }}>
      <CircularProgress
        variant={indeterminate ? 'indeterminate' : 'determinate'}
        value={indeterminate ? undefined : value}
        size={size}
        thickness={5}
        sx={{
          color: color ?? 'var(--ov-accent)',
          ...(indeterminate && { animationDuration: '1s' }),
        }}
      />
    </Box>
  );

  return tooltip ? <MuiTooltip title={tooltip}>{content}</MuiTooltip> : content;
}

// ---------------------------------------------------------------------------
// IDEStatusFooter - Main component
// ---------------------------------------------------------------------------

export interface IDEStatusFooterProps {
  left?: React.ReactNode;
  right?: React.ReactNode;
  height?: number;
  sx?: SxProps<Theme>;
}

function IDEStatusFooter({
  left,
  right,
  height = 22,
  sx,
}: IDEStatusFooterProps) {
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        height,
        bgcolor: 'var(--ov-bg-surface)',
        borderTop: '1px solid var(--ov-border-default)',
        fontFamily: 'var(--ov-font-ui)',
        overflow: 'hidden',
        flexShrink: 0,
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', gap: 0.25 }}>
        {left}
      </Box>
      <Box sx={{ display: 'flex', alignItems: 'center', height: '100%', gap: 0.25 }}>
        {right}
      </Box>
    </Box>
  );
}

IDEStatusFooter.displayName = 'IDEStatusFooter';

// Attach sub-components for compound usage
IDEStatusFooter.Chip = StatusChip;
IDEStatusFooter.Dot = FooterStatusDot;
IDEStatusFooter.Text = StatusText;
IDEStatusFooter.Spinner = StatusSpinner;
IDEStatusFooter.Progress = StatusProgress;
IDEStatusFooter.Circular = StatusCircular;
IDEStatusFooter.Separator = StatusSeparator;
IDEStatusFooter.Button = StatusButton;
IDEStatusFooter.Badge = StatusBadge;
IDEStatusFooter.Timer = StatusTimer;

export default IDEStatusFooter;
