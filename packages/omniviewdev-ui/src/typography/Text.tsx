import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor, ComponentSize } from '../types';
import { toCssColor } from '../types';

export type TextWeight = 'normal' | 'medium' | 'semibold' | 'bold';

export interface TextProps {
  children: React.ReactNode;
  variant?: 'body' | 'caption' | 'overline' | 'mono' | 'code';
  color?: SemanticColor;
  size?: ComponentSize;
  weight?: TextWeight;
  truncate?: boolean;
  noWrap?: boolean;
  lines?: number;
  muted?: boolean;
  inline?: boolean;
  component?: React.ElementType;
  sx?: SxProps<Theme>;
}

const variantMap = {
  body: 'body2',
  caption: 'caption',
  overline: 'overline',
  mono: 'body2',
  code: 'body2',
} as const;

const sizeMap: Record<ComponentSize, string> = {
  xs: '0.625rem',
  sm: '0.75rem',
  md: '0.875rem',
  lg: '1rem',
  xl: '1.125rem',
};

const weightMap: Record<TextWeight, number> = {
  normal: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
};

export default function Text({
  children,
  variant = 'body',
  color,
  size,
  weight,
  truncate = false,
  noWrap = false,
  lines,
  muted = false,
  inline: _inline = false,
  component,
  sx,
}: TextProps) {
  const muiVariant = variantMap[variant];
  const isMono = variant === 'mono' || variant === 'code';

  const resolvedColor = muted
    ? 'var(--ov-fg-muted)'
    : color
      ? toCssColor(color)
      : undefined;

  return (
    <Typography
      variant={muiVariant}
      component={component ?? 'span'}
      noWrap={noWrap || truncate}
      sx={{
        ...(resolvedColor && { color: resolvedColor }),
        ...(size && { fontSize: sizeMap[size] }),
        ...(weight && { fontWeight: weightMap[weight] }),
        ...(isMono && {
          fontFamily: 'var(--ov-font-mono)',
          fontSize: size ? sizeMap[size] : (variant === 'code' ? '0.85em' : undefined),
        }),
        ...(variant === 'code' && {
          backgroundColor: 'var(--ov-bg-surface-inset)',
          padding: '1px 4px',
          borderRadius: '3px',
        }),
        ...(lines && lines > 0 && {
          display: '-webkit-box',
          WebkitLineClamp: lines,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }),
        ...((typeof sx === 'object' && !Array.isArray(sx)) ? sx : {}),
      } as SxProps<Theme>}
    >
      {children}
    </Typography>
  );
}

Text.displayName = 'Text';
