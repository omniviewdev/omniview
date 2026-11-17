import { KindTile, Stack } from '@omniviewdev/kit';

/** The tile of a kind in the icon role: 20 px, the glyph at 16. It is decoration; the name beside it names the kind. */
export const Neutral = () => <KindTile icon="box" />;

/** A brand hue of the design, for a plugin's own tiles. */
export const Blue = () => <KindTile icon="box" tone="blue" />;

/** The 16 px tile of a dense tree: the glyph stays 16 px, the box shrinks to it. */
export const Small = () => <KindTile icon="box" tone="blue" size={16} />;

/** The whole tone scale: the icon role and the seven brand hues. */
export const AllTones = () => (
  <Stack direction="row" gap={8}>
    <KindTile icon="box" />
    <KindTile icon="box" tone="orange" />
    <KindTile icon="box" tone="green" />
    <KindTile icon="box" tone="blue" />
    <KindTile icon="box" tone="purple" />
    <KindTile icon="box" tone="pink" />
    <KindTile icon="box" tone="red" />
    <KindTile icon="box" tone="teal" />
  </Stack>
);

/** One glyph per kind: two tiles of different kinds never look alike, so a glyph is never shared (design 13 GL1). */
export const DistinctKinds = () => (
  <Stack direction="row" gap={8}>
    <KindTile icon="box" tone="blue" />
    <KindTile icon="server" tone="blue" />
    <KindTile icon="folder-tree" tone="blue" />
    <KindTile icon="layers" tone="blue" />
  </Stack>
);
