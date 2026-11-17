import { dataAttributes, type DataAttributes } from '../../shared/dataAttributes';
import { GLYPHS, type GlyphPaint, type IconName } from './glyphs';
import styles from './Icon.module.css';

/** The sizes of the closed icon scale, in pixels: 16 is the glyph beside text, 12 the one inside a header, a path or a chevron. */
export type IconSize = 12 | 16;

export type IconProps = {
  /** The glyph, from the registry. There is no other way to draw an icon. */
  readonly name: IconName;
  readonly size?: IconSize | undefined;
} & DataAttributes;

/** The paint a presentation attribute carries: ink is the text colour of the context, a literal is part of the artwork; a role is the stylesheet's. */
function attributePaint(paint: GlyphPaint | undefined): string | undefined {
  if (paint === undefined) {
    return undefined;
  }

  return paint === 'ink' ? 'currentColor' : paint.startsWith('#') ? paint : undefined;
}

/** The role a stylesheet rule resolves to a theme token. */
function rolePaint(paint: GlyphPaint | undefined): string | undefined {
  return paint === undefined || paint === 'ink' || paint.startsWith('#') ? undefined : paint;
}

/**
 * A glyph of the registry as an inline svg: one svg and one path per paint. It is decorative: hidden from assistive technology and
 * out of the pointer's way, because the control or the text beside it carries the name. Props are closed: no `className`, no
 * `style`; `data-*` passes through.
 */
export function Icon({ name, size = 16, ...rest }: IconProps) {
  const glyph = GLYPHS[name];
  return (
    <svg
      {...dataAttributes(rest)}
      className={styles.root}
      data-ov-glyph={name}
      data-ov-size={size}
      viewBox={`0 0 ${glyph.box} ${glyph.box}`}
      aria-hidden="true"
    >
      {glyph.layers.map((layer, index) => (
        <path
          key={index}
          d={layer.d}
          fill={layer.fill === undefined ? 'none' : attributePaint(layer.fill)}
          data-ov-fill={rolePaint(layer.fill)}
          stroke={attributePaint(layer.stroke)}
          data-ov-stroke={rolePaint(layer.stroke)}
          strokeWidth={layer.width}
          strokeLinecap={layer.cap}
          strokeLinejoin={layer.join}
          fillRule={layer.evenodd === true ? 'evenodd' : undefined}
        />
      ))}
    </svg>
  );
}
