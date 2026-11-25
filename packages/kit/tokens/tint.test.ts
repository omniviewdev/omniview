import { describe, expect, it } from 'vitest';
import { DATA_COLORS } from '../src/theme/dataColor.ts';
import { COLOR_ROLE_GROUPS } from './manifest.ts';
import { THEME_DEFINITIONS } from './themes.ts';

/** The role each data colour is, and so the hue its tint is a mix of. */
const HUES = {
  blue: 'link',
  green: 'success-fg',
  amber: 'warning-fg',
  red: 'error-fg',
  purple: 'chart-purple',
  cyan: 'chart-teal',
  gray: 'fg-muted',
} as const;

const colors = Object.keys(HUES) as Array<keyof typeof HUES>;
const channels = (hex: string): number[] => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

/** `color-mix(in srgb, <hue> 24%, <surface>)` as it is painted: every channel mixed, then rounded to 8 bits. */
function tintOf(hue: string, surface: string): string {
  const base = channels(surface);
  const mixed = channels(hue).map((channel, index) => Math.round(0.24 * channel + 0.76 * (base[index] ?? 0)));
  return `#${mixed.map((channel) => channel.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
}

describe('the tint roles', () => {
  it('are one per data colour', () => {
    expect([...DATA_COLORS]).toEqual(colors);
    expect([...COLOR_ROLE_GROUPS.tint]).toEqual(colors.map((color) => `tint-${color}`));
  });

  it('are, in every theme, the hue of the data colour mixed 24% over that theme\'s bg-island', () => {
    for (const theme of THEME_DEFINITIONS) {
      for (const color of colors) {
        const tint = `tint-${color}` as const;
        expect(theme.colors[tint], `${theme.id} ${tint}`).toBe(tintOf(theme.colors[HUES[color]], theme.colors['bg-island']));
      }
    }
  });
});
