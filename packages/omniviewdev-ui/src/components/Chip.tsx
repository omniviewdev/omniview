import type { ReactNode, ReactElement, CSSProperties } from 'react';
import MuiChip from '@mui/material/Chip';
import type { SxProps, Theme } from '@mui/material/styles';
import type { SemanticColor, Emphasis, ComponentSize, Shape } from '../types';
import { toMuiColor, toMuiSize, toBorderRadius, toCssColor } from '../types';

export interface ChipProps {
  label?: ReactNode;
  /** Alias for label when used as children */
  children?: ReactNode;
  color?: SemanticColor;
  emphasis?: Emphasis;
  /** Alias for emphasis (maps Joy UI variant names) */
  variant?: 'soft' | 'outlined' | 'solid' | 'plain' | 'filled';
  size?: ComponentSize;
  /** Border-radius preset */
  shape?: Shape;
  /** CSS text-transform value applied to the label */
  textTransform?: CSSProperties['textTransform'];
  icon?: ReactElement;
  /** Alias for icon */
  startAdornment?: ReactNode;
  /** Trailing content */
  endAdornment?: ReactNode;
  deletable?: boolean;
  onDelete?: () => void;
  onClick?: () => void;
  disabled?: boolean;
  sx?: SxProps<Theme>;
}

function toChipVariant(emphasis: Emphasis): 'filled' | 'outlined' {
  switch (emphasis) {
    case 'outline':
    case 'ghost':
      return 'outlined';
    case 'solid':
    case 'link':
    default:
      return 'filled';
  }
}

/** Build sx overrides for emphasis variants that MUI doesn't natively express. */
function emphasisSx(emphasis: Emphasis, color: SemanticColor): Record<string, unknown> | undefined {
  if (emphasis === 'soft') {
    const cssColor = toCssColor(color);
    return {
      bgcolor: `color-mix(in srgb, ${cssColor} 18%, transparent)`,
      color: cssColor,
      border: '1px solid',
      borderColor: `color-mix(in srgb, ${cssColor} 30%, transparent)`,
      fontWeight: 600,
      '& .MuiChip-label': { color: cssColor },
      '& .MuiChip-icon': { color: cssColor },
      '& .MuiChip-deleteIcon': { color: cssColor, opacity: 0.7, '&:hover': { opacity: 1 } },
    };
  }
  if (emphasis === 'ghost') {
    return { borderColor: 'transparent', bgcolor: 'transparent' };
  }
  return undefined;
}

/** Size overrides for xs and xl which MUI doesn't support natively. */
function chipSizeSx(size: ComponentSize): Record<string, unknown> | undefined {
  if (size === 'xs') {
    return { height: 20, fontSize: '0.6875rem', '& .MuiChip-label': { px: '6px' }, '& .MuiChip-icon': { fontSize: '0.75rem', flexShrink: 0 } };
  }
  if (size === 'xl') {
    return { height: 40, fontSize: '1rem', '& .MuiChip-label': { px: '16px' } };
  }
  return undefined;
}

const variantToEmphasis: Record<string, Emphasis> = {
  soft: 'soft',
  outlined: 'outline',
  solid: 'solid',
  plain: 'ghost',
  filled: 'solid',
};

export default function Chip({
  label,
  children,
  color = 'neutral',
  emphasis,
  variant,
  size = 'sm',
  shape,
  textTransform,
  icon,
  startAdornment,
  endAdornment: _endAdornment,
  deletable = false,
  onDelete,
  onClick,
  disabled = false,
  sx,
}: ChipProps) {
  const resolvedEmphasis = emphasis ?? (variant ? variantToEmphasis[variant] ?? 'soft' : 'soft');
  const resolvedLabel = label ?? children;
  const resolvedIcon = icon ?? (startAdornment as ReactElement | undefined);

  // For soft emphasis, use 'filled' base + the real color so the theme's
  // color-specific variants apply.  The emphasisSx then dials back the bg to
  // a translucent tint.  Previously we used 'outlined' + color='default',
  // which matched the theme rule for outlined-default and forced a transparent
  // background that couldn't be overridden via sx.
  const muiVariant = resolvedEmphasis === 'soft' ? 'filled' : toChipVariant(resolvedEmphasis);

  const overrideSx = emphasisSx(resolvedEmphasis, color);
  const sizeSx = chipSizeSx(size);
  const shapeSx = shape ? { borderRadius: toBorderRadius(shape) } : undefined;
  const transformSx = textTransform ? { '& .MuiChip-label': { textTransform } } : undefined;

  return (
    <MuiChip
      label={resolvedLabel}
      color={toMuiColor(color) as 'default' | 'primary' | 'secondary' | 'error' | 'info' | 'success' | 'warning'}
      variant={muiVariant}
      size={toMuiSize(size) as 'small' | 'medium'}
      icon={resolvedIcon}
      onDelete={deletable || onDelete ? (onDelete ?? undefined) : undefined}
      onClick={onClick}
      disabled={disabled}
      sx={{
        ...overrideSx,
        ...sizeSx,
        ...shapeSx,
        ...transformSx,
        ...sx as Record<string, unknown>,
      }}
    />
  );
}

Chip.displayName = 'Chip';
