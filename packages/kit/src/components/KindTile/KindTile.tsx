import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { Icon, type IconName } from '../Icon';
import styles from './KindTile.module.css';

/** The colour of the glyph: the icon role, or one of the brand hues of the design (13 GL1; the seven hues of the token scale). */
export type KindTileTone = 'neutral' | 'orange' | 'green' | 'blue' | 'purple' | 'pink' | 'red' | 'teal';
/** The box in pixels: 20 beside a name in a list, 16 in a dense tree. The glyph inside is 16 px in both. */
export type KindTileSize = 16 | 20;

export type KindTileProps = {
  /** The glyph of the kind, from the registry. The mapping from a kind to its glyph and tone is the caller's data: the kit knows no kind. */
  readonly icon: IconName;
  readonly tone?: KindTileTone | undefined;
  readonly size?: KindTileSize | undefined;
} & DataAttributes;

/**
 * The tile of a kind: its glyph in a square, in a tone. It is decoration, hidden from assistive technology: the name beside it says
 * what the thing is, and two tiles of different kinds carry different glyphs so they never look alike (design 13 GL1). Props are
 * closed: no `className`, no `style`; `data-*` passes through.
 */
export function KindTile({ icon, tone = 'neutral', size = 20, ...rest }: KindTileProps) {
  return (
    <span {...dataAttributes(rest)} className={styles.root} aria-hidden="true" data-ov-tone={tone} data-ov-size={size}>
      <Icon name={icon} />
    </span>
  );
}
