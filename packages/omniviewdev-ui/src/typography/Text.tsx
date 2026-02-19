import Typography from '@mui/material/Typography';
import type { SxProps, Theme } from '@mui/material/styles';

import type { SemanticColor } from '../types';
import { toCssColor } from '../types';

export interface TextProps {
  children: React.ReactNode;
  variant?: 'body' | 'caption' | 'overline' | 'mono' | 'code';
  color?: SemanticColor;
  truncate?: boolean;
  lines?: number;
  muted?: boolean;
  inline?: boolean;
  sx?: SxProps<Theme>;
}

const variantMap = {
  body: 'body2',
  caption: 'caption',
  overline: 'overline',
  mono: 'body2',
  code: 'body2',
} as const;

export default function Text({
  children,
  variant = 'body',
  color,
  truncate = false,
  lines,
  muted = false,
  inline = false,
  sx,
}: TextProps) {
  const muiVariant = variantMap[variant];
  const isMono = variant === 'mono' || variant === 'code';

  const resolvedColor = muted
    ? 'var(--ov-fg-muted)'
    : color
      ? toCssColor(color)
      : 'var(--ov-fg-default)';

  return (
    <Typography
      variant={muiVariant}
      component={inline ? 'span' : 'p'}
      sx={{
        color: resolvedColor,
        ...(isMono && {
          fontFamily: 'var(--ov-font-mono)',
          fontSize: variant === 'code' ? '0.85em' : undefined,
        }),
        ...(variant === 'code' && {
          backgroundColor: 'var(--ov-bg-surface-inset)',
          padding: '1px 4px',
          borderRadius: '3px',
        }),
        ...(truncate && {
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
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
