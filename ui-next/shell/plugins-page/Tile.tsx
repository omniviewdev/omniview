import { Icon, type DataAttributes } from '@omniviewdev/kit';
import type { Tile as PluginTile } from './core/model';
import styles from './Tile.module.css';

// The tile of a plugin (ch16 S133: the identity tile of a row of the list and of the detail's header, the mock's `H.avatar` drawn as a square): the plugin's glyph in the hue its contribution names, over a tint of that hue. One part
// for both places, so a plugin looks the same in the list and in the detail, and the glyph and the hue are the model's (`Tile`, the rail's own), so it looks the same in the rail. A plugin that names no hue has the neutral tile,
// in the muted text colour. The tile is decoration, hidden from assistive technology: the name beside it says what the plugin is. Props are closed, as the kit's are: `data-*` is the only pass-through, for the probes and the tests.

type TileProps = {
  /** The glyph and the hue of the plugin, as the model says them. */
  readonly tile: PluginTile;
  /** The box in pixels: 24 in a row of the list, 28 in the detail's header. The glyph in it is 16 in both. */
  readonly size: 24 | 28;
} & DataAttributes;

export function Tile({ tile, size, ...rest }: TileProps) {
  return (
    <span {...rest} className={styles.tile} data-accent={tile.accent} data-size={size} aria-hidden="true">
      <Icon name={tile.icon} />
    </span>
  );
}
