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

/**
 * The share of the hue in each theme's tint, in percent. The mock mixes 24% in every theme. Where the foreground on a 24% tint is under 4.5:1 for some
 * hue (the two Solarized themes, whose mid-tone hues lift the tint: 4.09:1 in the dark one and 4.35:1 in the light one at the least) the theme holds the
 * highest 2% step at which every initial reads at 4.5:1 and every glyph at 3:1 (dark 18%, light 22%).
 */
const DEFAULT_MIX = 24;
const MIX: Readonly<Record<string, number>> = { 'solarized-dark': 18, 'solarized-light': 22 };

const colors = Object.keys(HUES) as Array<keyof typeof HUES>;
const channels = (hex: string): number[] => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16));

/** `color-mix(in srgb, <hue> N%, <surface>)` as it is painted: every channel mixed, then rounded to 8 bits. */
function tintOf(hue: string, surface: string, percent: number): string {
  const base = channels(surface);
  const mixed = channels(hue).map((channel, index) => Math.round((percent * channel + (100 - percent) * (base[index] ?? 0)) / 100));
  return `#${mixed.map((channel) => channel.toString(16).toUpperCase().padStart(2, '0')).join('')}`;
}

/** The contrast ratio of two colours (WCAG 2): the lighter relative luminance plus 0.05 over the darker plus 0.05. */
function contrast(first: string, second: string): number {
  const luminance = (hex: string): number => {
    const [red = 0, green = 0, blue = 0] = channels(hex).map((channel) => {
      const share = channel / 255;
      return share <= 0.04045 ? share / 12.92 : ((share + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
  };

  const [high = 0, low = 0] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (high + 0.05) / (low + 0.05);
}

describe('the tint roles', () => {
  it('are one per data colour', () => {
    expect([...DATA_COLORS]).toEqual(colors);
    expect([...COLOR_ROLE_GROUPS.tint]).toEqual(colors.map((color) => `tint-${color}`));
  });

  it('are, in every theme, the hue of the data colour mixed over that theme\'s bg-island by that theme\'s own share (24% unless MIX says otherwise)', () => {
    for (const theme of THEME_DEFINITIONS) {
      for (const color of colors) {
        const tint = `tint-${color}` as const;
        expect(theme.colors[tint], `${theme.id} ${tint}`).toBe(tintOf(theme.colors[HUES[color]], theme.colors['bg-island'], MIX[theme.id] ?? DEFAULT_MIX));
      }
    }
  });

  it('hold the initials (the foreground) at 4.5:1 and the glyph (the hue) at 3:1 on every tint, in every theme: 63 of 63', () => {
    for (const theme of THEME_DEFINITIONS) {
      for (const color of colors) {
        const tint = theme.colors[`tint-${color}` as const];
        expect(contrast(theme.colors.fg, tint), `${theme.id} ${color} initials`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(theme.colors[HUES[color]], tint), `${theme.id} ${color} glyph`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});
