/**
 * The data palette: the seven hues that mark data (a folder, an avatar, a swatch). They are not the brand hues of a provider's tile
 * (`KindTileTone`) and not the roles of a state (`Status`, `Chip`). Each hue is a colour role that every theme defines, so the palette
 * follows the theme: blue is `link`, green `success-fg`, amber `warning-fg`, red `error-fg`, purple `chart-purple`, cyan `chart-teal` and
 * gray `fg-muted`. Each also has a tint role (`tint-blue`, `tint-green`, ...): the hue mixed over `bg-island` (24%; less in the two Solarized
 * themes, so that the foreground reads at 4.5:1 on every tint). A hue never carries a meaning alone; the name beside it does.
 */
export const DATA_COLORS = ['blue', 'green', 'amber', 'red', 'purple', 'cyan', 'gray'] as const;

export type DataColor = (typeof DATA_COLORS)[number];
