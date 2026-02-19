/**
 * @omniviewdev/ui type system
 *
 * Re-exports all variant types and mapping utilities.
 */

// Types
export type {
  SemanticColor,
  Emphasis,
  ComponentSize,
  Density,
  Shape,
  Elevation,
  Status,
} from './variants';

// Mapping functions
export {
  toMuiColor,
  toMuiVariant,
  toMuiSize,
  toMuiInputSize,
  sizeOverrideSx,
  toBorderRadius,
  toCssColor,
  statusToColor,
  INPUT_HEIGHTS,
} from './maps';
