/**
 * Global Variant Type System
 *
 * Canonical types used by every component in @omniviewdev/ui.
 * Consumers use our API (emphasis, SemanticColor, ComponentSize) —
 * MUI prop names are hidden behind the mapping layer in maps.ts.
 */

/** Consistent color prop across all components */
export type SemanticColor =
  | 'primary'
  | 'secondary'
  | 'success'
  | 'warning'
  | 'error'
  | 'info'
  | 'neutral'
  | 'accent'
  | 'danger'
  | 'muted';

/** Visual weight / fill style */
export type Emphasis = 'solid' | 'soft' | 'outline' | 'ghost' | 'link';

/** Consistent sizing */
export type ComponentSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

/** Density for tables/forms */
export type Density = 'compact' | 'comfortable' | 'spacious';

/** Border radius presets */
export type Shape = 'rounded' | 'pill' | 'square';

/** Surface depth */
export type Elevation = 'flat' | 'raised' | 'overlay';

/** Status values for indicators */
export type Status =
  | 'healthy'
  | 'warning'
  | 'degraded'
  | 'error'
  | 'unknown'
  | 'pending';
