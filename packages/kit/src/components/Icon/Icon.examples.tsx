import { Icon, Stack, type IconName } from '@omniviewdev/kit';

/** The default: 16 px, in the text colour of its context. */
export const Default = () => <Icon name="refresh" />;

/** The 12 px size, for a sort arrow, a chevron beside text or a path separator. */
export const Small = () => <Icon name="chevron-down" size={12} />;

/** A glyph that keeps a paint of its own: the chevron grey is pinned to a theme role, whatever colour the text around it has. */
export const PinnedChevron = () => <Icon name="chevron-right" />;

/** The four status glyphs: two paints each, in the status colours of the theme. */
export const Status = () => (
  <Stack direction="row" gap={8}>
    <Icon name="status-success" />
    <Icon name="status-warning" />
    <Icon name="status-error" />
    <Icon name="status-info" />
  </Stack>
);

// Every glyph of the registry, for review: the test of this file fails when the registry and this list differ.
const ALL: readonly IconName[] = [
  'arrow-down', 'arrow-up', 'box', 'check', 'chevron-down', 'chevron-right', 'circle-minus', 'clock', 'close', 'columns', 'copy',
  'folder-tree', 'layers', 'loader', 'loader-circle', 'play', 'refresh', 'search', 'search-x', 'server', 'status-error', 'status-info',
  'status-success', 'status-warning',
];

/** Every glyph of the registry, at both sizes. */
export const AllGlyphs = () => (
  <Stack gap={8}>
    <Stack direction="row" gap={8} align="center">
      {ALL.map((name) => (
        <Icon key={name} name={name} />
      ))}
    </Stack>
    <Stack direction="row" gap={8} align="center">
      {ALL.map((name) => (
        <Icon key={name} name={name} size={12} />
      ))}
    </Stack>
  </Stack>
);
