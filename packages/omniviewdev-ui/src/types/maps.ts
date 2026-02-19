/**
 * Mapping functions from our API types to MUI equivalents.
 *
 * These keep MUI implementation details out of component consumer code.
 */

import type { SemanticColor, Emphasis, ComponentSize, Shape, Status } from './variants';

// ---------------------------------------------------------------------------
// Color mapping
// ---------------------------------------------------------------------------

const muiColorMap: Record<SemanticColor, string> = {
  primary: 'primary',
  secondary: 'secondary',
  success: 'success',
  warning: 'warning',
  error: 'error',
  info: 'info',
  neutral: 'default',
  accent: 'primary',
  danger: 'error',
  muted: 'inherit',
};

/** Maps our SemanticColor to a MUI palette color prop value */
export function toMuiColor(color: SemanticColor): string {
  return muiColorMap[color];
}

// ---------------------------------------------------------------------------
// Variant / emphasis mapping
// ---------------------------------------------------------------------------

const muiVariantMap: Record<Emphasis, string> = {
  solid: 'contained',
  soft: 'soft',
  outline: 'outlined',
  ghost: 'text',
  link: 'link',
};

/** Maps our Emphasis to a MUI variant prop value */
export function toMuiVariant(emphasis: Emphasis): string {
  return muiVariantMap[emphasis];
}

// ---------------------------------------------------------------------------
// Size mapping
// ---------------------------------------------------------------------------

const muiSizeMap: Record<ComponentSize, string> = {
  xs: 'small',
  sm: 'small',
  md: 'medium',
  lg: 'large',
  xl: 'large',
};

/** Maps our ComponentSize to a MUI size prop value */
export function toMuiSize(size: ComponentSize): string {
  return muiSizeMap[size];
}

/**
 * Returns sx overrides for sizes that MUI doesn't natively support (xs, xl).
 * Returns undefined if no override is needed.
 */
export function sizeOverrideSx(size: ComponentSize): Record<string, unknown> | undefined {
  if (size === 'xs') {
    return { minHeight: '1.5rem', padding: '2px 8px', fontSize: '0.6875rem' };
  }
  if (size === 'xl') {
    return { minHeight: '3.25rem', padding: '12px 24px', fontSize: '1rem' };
  }
  return undefined;
}

// ---------------------------------------------------------------------------
// Input-specific size mapping
// ---------------------------------------------------------------------------

/** Height tokens for input components (Select, Autocomplete, TextField, TextArea). */
export const INPUT_HEIGHTS: Record<ComponentSize, string> = {
  xs: '1.75rem',
  sm: '2.25rem',
  md: '2.75rem',
  lg: '3.25rem',
  xl: '3.75rem',
};

/**
 * Maps ComponentSize to the MUI size for FormControl / InputLabel internals.
 * xs/sm → 'small' (compact label font), md/lg/xl → 'medium' (standard label font).
 */
export function toMuiInputSize(size: ComponentSize): 'small' | 'medium' {
  return size === 'xs' || size === 'sm' ? 'small' : 'medium';
}

// ---------------------------------------------------------------------------
// Shape mapping
// ---------------------------------------------------------------------------

const borderRadiusMap: Record<Shape, string | number> = {
  rounded: 'var(--ov-radius-md, 6px)',
  pill: 999,
  square: 0,
};

/** Maps our Shape to a CSS border-radius value */
export function toBorderRadius(shape: Shape): string | number {
  return borderRadiusMap[shape];
}

// ---------------------------------------------------------------------------
// CSS token color mapping
// ---------------------------------------------------------------------------

const cssColorMap: Record<SemanticColor, string> = {
  primary: 'var(--ov-accent)',
  secondary: 'var(--ov-fg-muted)',
  success: 'var(--ov-success-default)',
  warning: 'var(--ov-warning-default)',
  error: 'var(--ov-danger-default)',
  info: 'var(--ov-info-default)',
  neutral: 'var(--ov-fg-default)',
  accent: 'var(--ov-accent)',
  danger: 'var(--ov-danger-default)',
  muted: 'var(--ov-fg-muted)',
};

/** Maps our SemanticColor to a --ov-* CSS custom property */
export function toCssColor(color: SemanticColor): string {
  return cssColorMap[color];
}

// ---------------------------------------------------------------------------
// Status → SemanticColor mapping
// ---------------------------------------------------------------------------

const statusColorMap: Record<Status, SemanticColor> = {
  healthy: 'success',
  warning: 'warning',
  degraded: 'warning',
  error: 'error',
  unknown: 'neutral',
  pending: 'info',
};

/** Maps a Status value to the corresponding SemanticColor */
export function statusToColor(status: Status): SemanticColor {
  return statusColorMap[status];
}
