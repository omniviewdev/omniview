import React from 'react';
import MuiAlert from '@mui/material/Alert';
import IconButton from '@mui/material/IconButton';
import CloseIcon from '@mui/icons-material/Close';
import { alpha } from '@mui/material/styles';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, Emphasis, ComponentSize } from '../types';

export interface AlertProps {
  children: React.ReactNode;
  color?: SemanticColor;
  emphasis?: Extract<Emphasis, 'solid' | 'soft' | 'outline'>;
  dismissible?: boolean;
  onDismiss?: () => void;
  actions?: React.ReactNode;
  icon?: React.ReactNode | false;
  size?: ComponentSize;
  sx?: SxProps<Theme>;
}

const emphasisToMuiVariant: Record<string, string> = {
  solid: 'filled',
  soft: 'standard',
  outline: 'outlined',
};

const sizeStyles: Record<ComponentSize, { padding: string; fontSize: string; iconSize: number; borderRadius: number; closeSize: 'small' | 'medium' }> = {
  xs: { padding: '0px 6px', fontSize: 'var(--ov-text-xs)', iconSize: 16, borderRadius: 6, closeSize: 'small' },
  sm: { padding: '2px 8px', fontSize: 'var(--ov-text-sm)', iconSize: 18, borderRadius: 8, closeSize: 'small' },
  md: { padding: '6px 12px', fontSize: 'var(--ov-text-sm)', iconSize: 20, borderRadius: 10, closeSize: 'small' },
  lg: { padding: '8px 16px', fontSize: 'var(--ov-text-md)', iconSize: 22, borderRadius: 10, closeSize: 'medium' },
  xl: { padding: '12px 16px', fontSize: 'var(--ov-text-md)', iconSize: 24, borderRadius: 12, closeSize: 'medium' },
};

interface ColorPair {
  light: { bg: string; fg: string; border: string; icon: string };
  dark: { bg: string; fg: string; border: string; icon: string };
}

const colorPalettes: Record<SemanticColor, ColorPair> = {
  success: {
    light: { bg: 'hsl(120, 80%, 98%)', fg: 'hsl(120, 87%, 6%)', border: 'hsl(120, 61%, 77%)', icon: 'hsl(120, 44%, 53%)' },
    dark: { bg: 'hsl(120, 84%, 10%)', fg: 'hsl(120, 75%, 94%)', border: 'hsl(120, 75%, 16%)', icon: 'hsl(120, 44%, 53%)' },
  },
  warning: {
    light: { bg: 'hsl(45, 100%, 97%)', fg: 'hsl(45, 93%, 12%)', border: 'hsl(45, 90%, 65%)', icon: 'hsl(45, 90%, 40%)' },
    dark: { bg: 'hsl(45, 95%, 16%)', fg: 'hsl(45, 92%, 90%)', border: 'hsl(45, 94%, 20%)', icon: 'hsl(45, 90%, 40%)' },
  },
  error: {
    light: { bg: 'hsl(0, 100%, 97%)', fg: 'hsl(0, 93%, 6%)', border: 'hsl(0, 90%, 65%)', icon: 'hsl(0, 90%, 40%)' },
    dark: { bg: 'hsl(0, 95%, 12%)', fg: 'hsl(0, 92%, 90%)', border: 'hsl(0, 94%, 18%)', icon: 'hsl(0, 90%, 40%)' },
  },
  danger: {
    light: { bg: 'hsl(0, 100%, 97%)', fg: 'hsl(0, 93%, 6%)', border: 'hsl(0, 90%, 65%)', icon: 'hsl(0, 90%, 40%)' },
    dark: { bg: 'hsl(0, 95%, 12%)', fg: 'hsl(0, 92%, 90%)', border: 'hsl(0, 94%, 18%)', icon: 'hsl(0, 90%, 40%)' },
  },
  info: {
    light: { bg: 'hsl(210, 100%, 95%)', fg: 'hsl(210, 100%, 21%)', border: 'hsl(210, 100%, 65%)', icon: 'hsl(210, 98%, 42%)' },
    dark: { bg: 'hsl(210, 100%, 16%)', fg: 'hsl(210, 100%, 92%)', border: 'hsl(210, 100%, 35%)', icon: 'hsl(210, 98%, 55%)' },
  },
  primary: {
    light: { bg: 'hsl(210, 100%, 95%)', fg: 'hsl(210, 100%, 21%)', border: 'hsl(210, 100%, 80%)', icon: 'hsl(210, 98%, 48%)' },
    dark: { bg: 'hsl(210, 100%, 16%)', fg: 'hsl(210, 100%, 92%)', border: 'hsl(210, 100%, 35%)', icon: 'hsl(210, 98%, 55%)' },
  },
  secondary: {
    light: { bg: 'hsl(270, 100%, 97%)', fg: 'hsl(270, 70%, 42%)', border: 'hsl(270, 80%, 80%)', icon: 'hsl(270, 70%, 50%)' },
    dark: { bg: 'hsl(270, 80%, 16%)', fg: 'hsl(270, 92%, 90%)', border: 'hsl(270, 75%, 25%)', icon: 'hsl(270, 70%, 65%)' },
  },
  accent: {
    light: { bg: 'hsl(270, 100%, 97%)', fg: 'hsl(270, 70%, 42%)', border: 'hsl(270, 80%, 80%)', icon: 'hsl(270, 70%, 50%)' },
    dark: { bg: 'hsl(270, 80%, 16%)', fg: 'hsl(270, 92%, 90%)', border: 'hsl(270, 75%, 25%)', icon: 'hsl(270, 70%, 65%)' },
  },
  neutral: {
    light: { bg: 'hsl(220, 35%, 97%)', fg: 'hsl(220, 20%, 42%)', border: 'hsl(220, 20%, 88%)', icon: 'hsl(220, 20%, 65%)' },
    dark: { bg: 'hsl(220, 30%, 6%)', fg: 'hsl(220, 30%, 94%)', border: 'hsl(220, 20%, 25%)', icon: 'hsl(220, 20%, 80%)' },
  },
  muted: {
    light: { bg: 'hsl(220, 35%, 97%)', fg: 'hsl(220, 20%, 42%)', border: 'hsl(220, 20%, 88%)', icon: 'hsl(220, 20%, 65%)' },
    dark: { bg: 'hsl(220, 30%, 6%)', fg: 'hsl(220, 30%, 94%)', border: 'hsl(220, 20%, 25%)', icon: 'hsl(220, 20%, 80%)' },
  },
};

/**
 * Builds emphasis-aware color styles for the given mode palette.
 */
function buildEmphasisStyles(
  mode: ColorPair['light'],
  emphasis: string,
): { bg: string; fg: string; border: string; icon: string } {
  if (emphasis === 'outline') {
    return { bg: 'transparent', fg: mode.fg, border: `1px solid ${alpha(mode.border, 0.7)}`, icon: mode.icon };
  }
  if (emphasis === 'solid') {
    return { bg: mode.icon, fg: '#fff', border: 'none', icon: '#fff' };
  }
  // soft (default)
  return { bg: mode.bg, fg: mode.fg, border: `1px solid ${alpha(mode.border, 0.5)}`, icon: mode.icon };
}

export default function Alert({
  children,
  color = 'info',
  emphasis = 'soft',
  dismissible = false,
  onDismiss,
  actions,
  icon,
  size = 'md',
  sx,
}: AlertProps) {
  const muiVariant = emphasisToMuiVariant[emphasis] || 'standard';
  const s = sizeStyles[size];

  const severityMap: Record<string, 'success' | 'info' | 'warning' | 'error'> = {
    success: 'success', info: 'info', warning: 'warning', error: 'error',
    danger: 'error', primary: 'info', secondary: 'info',
    accent: 'info', neutral: 'info', muted: 'info',
  };
  const severity = severityMap[color] ?? 'info';

  return (
    <MuiAlert
      severity={severity}
      variant={muiVariant as any}
      icon={icon === false ? false : icon}
      action={
        <>
          {actions}
          {dismissible && (
            <IconButton
              size={s.closeSize}
              color="inherit"
              onClick={onDismiss}
              aria-label="Dismiss"
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          )}
        </>
      }
      sx={(theme) => {
        const palette = colorPalettes[color];
        const light = buildEmphasisStyles(palette.light, emphasis);
        const dark = buildEmphasisStyles(palette.dark, emphasis);

        // Dark bg needs alpha for soft emphasis
        const darkBg = emphasis === 'soft' ? alpha(dark.bg, 0.3) : dark.bg;

        return {
          // Sizing
          padding: s.padding,
          fontSize: s.fontSize,
          borderRadius: `${s.borderRadius}px`,
          alignItems: 'center',

          // Light mode colors (default)
          backgroundColor: light.bg,
          color: light.fg,
          border: light.border,

          '& .MuiAlert-icon': {
            fontSize: s.iconSize,
            mr: size === 'xs' ? 0.5 : 1,
            py: 0,
            color: light.icon,
          },
          '& .MuiAlert-message': {
            py: 0,
            overflow: 'hidden',
          },
          '& .MuiAlert-action': {
            py: 0,
            alignItems: 'center',
          },

          // Dark mode overrides via MUI v7 CSS variables
          ...theme.applyStyles('dark', {
            backgroundColor: darkBg,
            color: dark.fg,
            border: dark.border,
            '& .MuiAlert-icon': { color: dark.icon },
          }),

          // User-provided sx last
          ...(typeof sx === 'object' && sx !== null ? sx as Record<string, unknown> : {}),
        };
      }}
    >
      {children}
    </MuiAlert>
  );
}

Alert.displayName = 'Alert';
