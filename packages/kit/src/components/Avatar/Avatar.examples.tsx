import { Avatar, Stack, type DataColor } from '@omniviewdev/kit';

// A picture prepared locally, as a data URL: a mark twice as wide as it is tall, so a circle crops it and a square shows it whole.
const WIDE_PICTURE = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20"><rect width="40" height="20" fill="#7c5ac7"/><circle cx="20" cy="10" r="7" fill="#ffffff"/></svg>',
)}`;

// The two letters that stand for each hue of the data palette.
const KEYS: ReadonlyArray<readonly [DataColor, string]> = [
  ['blue', 'BL'],
  ['green', 'GN'],
  ['amber', 'AM'],
  ['red', 'RD'],
  ['purple', 'PR'],
  ['cyan', 'CY'],
  ['gray', 'GY'],
];

/** The first letters of the first two words. With no colour of its own the box is a tint chosen by the name, so a name is the same tint on every screen. */
export const Initials = () => <Avatar name="Connection A" />;

/** One word gives its first two letters. */
export const OneWord = () => <Avatar name="production" />;

/** The four tints a name can take: blue, purple, cyan and gray, each its hue mixed 24% over the surface. The names here are the ones that fall on each. */
export const Tints = () => (
  <Stack direction="row" gap={8} align="center">
    <Avatar name="Connection C" />
    <Avatar name="Connection D" />
    <Avatar name="Connection A" />
    <Avatar name="Connection B" />
  </Stack>
);

/** The sizes of the closed scale: 16 in a dense tree, 20 beside a name in a list, 24 in a table row, 28 in a form. */
export const Sizes = () => (
  <Stack direction="row" gap={8} align="center">
    <Avatar name="Connection A" size={16} />
    <Avatar name="Connection A" size={20} />
    <Avatar name="Connection A" size={24} />
    <Avatar name="Connection A" size={28} />
  </Stack>
);

/** A square, with the control radius, is for a thing or a category rather than a person. */
export const Square = () => <Avatar name="Connection A" shape="square" />;

/** A colour of the data palette is a solid fill with the ink of a data fill on it. */
export const DataColors = () => (
  <Stack direction="row" gap={8} align="center">
    {KEYS.map(([color, letters]) => (
      <Avatar key={color} name={letters} color={color} shape="square" />
    ))}
  </Stack>
);

/** A glyph instead of the initials: 16 px in every size. */
export const Glyph = () => <Avatar name="Connection A" icon="server" shape="square" />;

/** The dense form of a list row: a 16 px square with a glyph on a solid hue. */
export const GlyphOnColor = () => <Avatar name="Connection A" icon="server" color="green" size={16} shape="square" />;

/** A picture instead of the initials. In a circle it covers the box. */
export const Picture = () => <Avatar name="Connection A" image={WIDE_PICTURE} size={28} />;

/** In a square the picture is contained, whole, over the tint. */
export const PictureInSquare = () => <Avatar name="Connection A" image={WIDE_PICTURE} size={28} shape="square" />;

/** Decoration by default: the name is beside it, so it is hidden. With a label it is an image that has a name. */
export const Labelled = () => <Avatar name="Ada Lovelace" label="Ada Lovelace" />;
