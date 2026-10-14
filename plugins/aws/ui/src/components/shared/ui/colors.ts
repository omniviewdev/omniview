import type { ComponentColor, ComponentVariant } from '@omniviewdev/base-ui';

/** Colour names used by the previous component library / MUI. */
export type LegacyColor =
  | ComponentColor
  | 'default'
  | 'primary'
  | 'error';

/** Map a legacy colour name (MUI / old ui) to a base-ui ComponentColor. */
export function toColor(color: LegacyColor | undefined): ComponentColor {
  switch (color) {
    case undefined:
    case 'default':
      return 'neutral';
    case 'primary':
      return 'brand';
    case 'error':
      return 'danger';
    default:
      return color;
  }
}

/** Map a legacy chip/button variant name to a base-ui variant. */
export function toVariant(variant: string | undefined): ComponentVariant | undefined {
  switch (variant) {
    case 'filled':
    case 'solid':
    case 'contained':
      return 'solid';
    case 'outlined':
    case 'outline':
      return 'outline';
    case 'plain':
    case 'text':
    case 'ghost':
      return 'ghost';
    case 'soft':
      return 'soft';
    default:
      return undefined;
  }
}

/** Chip style shared by the plugin's status/value chips (square-ish 4px corners). */
export const chipStyle = { borderRadius: 4 } as const;
