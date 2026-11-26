import type { ReactNode } from 'react';
import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import type { DataColor } from '../../theme/dataColor';
import { Icon, type IconName } from '../Icon';
import styles from './Avatar.module.css';

/** The box in pixels: 16 in a dense tree, 20 beside a name in a list, 24 in a table row, 28 in a form or beside two lines of text. */
export type AvatarSize = 16 | 20 | 24 | 28;

/** A circle is for a person or an account; a square, with the control radius, is for a thing or a category. */
export type AvatarShape = 'circle' | 'square';

/** What the box holds: the initials of the name, one glyph, or one picture. Never two. */
type AvatarFace =
  | { readonly icon?: undefined; readonly image?: undefined }
  | {
    /** A glyph instead of the initials. It is 16 px in every size. */
    readonly icon: IconName;
    readonly image?: undefined;
  }
  | {
    /**
       * A picture instead of the initials, from a `data:` or `blob:` URL: an image prepared locally, so the part loads nothing from the
       * network. It covers a circle and is contained, whole, in a square.
       */
    readonly image: string;
    readonly icon?: undefined;
  };

export type AvatarProps = {
  /**
   * The name the initials come from and, with no `color`, the tint follows: one name is one tint on every screen. It is never announced;
   * `label` names an avatar that means something.
   */
  readonly name: string;
  readonly size?: AvatarSize | undefined;
  readonly shape?: AvatarShape | undefined;
  /** A solid fill in a hue of the data palette, with the ink of a data fill on it. Without it the box is a tint of one of four hues, chosen by the name. */
  readonly color?: DataColor | undefined;
  /** Gives it a name for assistive technology: it is then an image. Without it the avatar is decoration, hidden, because the name is beside it. */
  readonly label?: string | undefined;
} & AvatarFace &
  DataAttributes;

/** The hues a name can take, in the order the mock picks them: blue (the link), purple, cyan (the teal) and gray (the muted text). */
const TONES = ['blue', 'purple', 'cyan', 'gray'] as const satisfies readonly DataColor[];

/** One word is cut at a dot, an underscore, an at sign or a hyphen as well as at a space: `ada.lovelace` is two words. */
const WORD_BREAK = /[\s._@-]+/;

/** Two letters at most: the first letters of the first two words, or the first two letters of a single word; `?` for no name. */
function initialsOf(name: string): string {
  const words = name.trim().split(WORD_BREAK).filter((word) => word !== '');
  const first = Array.from(words[0] ?? '?');
  const second = Array.from(words[1] ?? '');
  return (words.length > 1 ? [...first.slice(0, 1), ...second.slice(0, 1)] : first.slice(0, 2)).join('').toUpperCase();
}

/** The hue of a name: a hash of its code points, so that the same name is the same hue wherever it is drawn. */
function toneOf(name: string): DataColor {
  let hash = 7;
  for (const character of name.trim()) {
    hash = (hash * 31 + (character.codePointAt(0) ?? 0)) >>> 0;
  }

  return TONES[hash % TONES.length] ?? 'blue';
}

/**
 * A small box that stands for someone or something: the initials of its name, a glyph or a picture, in a tint chosen by the name or in a
 * solid hue of the data palette. The box has a fixed size, so it never shifts the layout, and it is decoration unless it has a `label`.
 * Props are closed: no `className`, no `style`; `data-*` passes through.
 */
export function Avatar({ name, size = 24, shape = 'circle', color, label, icon, image, ...rest }: AvatarProps) {
  const named = label !== undefined && label.trim() !== '';
  let face: ReactNode;
  if (image !== undefined) {
    face = <img className={styles.image} src={image} alt="" decoding="async" />;
  } else if (icon !== undefined) {
    face = <Icon name={icon} />;
  } else {
    face = initialsOf(name);
  }

  return (
    <span
      {...dataAttributes(rest)}
      className={styles.root}
      role={named ? 'img' : undefined}
      aria-label={named ? label : undefined}
      aria-hidden={named ? undefined : 'true'}
      data-ov-size={size}
      data-ov-shape={shape}
      data-ov-fill={color === undefined ? 'tint' : 'solid'}
      data-ov-color={color ?? toneOf(name)}
    >
      {face}
    </span>
  );
}
