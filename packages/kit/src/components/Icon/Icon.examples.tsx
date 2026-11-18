import { Icon, Stack, type IconName } from '@omniviewdev/kit';

/** The default: 16 px, in the text colour of its context. */
export const Default = () => <Icon name="refresh" />;

/** The 12 px size, for a sort arrow, a chevron beside text or a path separator. */
export const Small = () => <Icon name="chevron-down" size={12} />;

/** The 20 px size, the glyph of a toolbar button's 30 px face. */
export const Large = () => <Icon name="plus" size={20} />;

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
  'arrow-down', 'arrow-left', 'arrow-right', 'arrow-up', 'box', 'check', 'chevron-down', 'chevron-right', 'circle-minus', 'clock', 'close', 'columns', 'copy',
  'ellipsis', 'folder-tree', 'layers', 'loader', 'loader-circle', 'play', 'plus', 'refresh', 'search', 'search-x', 'server', 'status-error', 'status-info',
  'status-success', 'status-warning',
];

const ROW = 8;
const rows = (names: readonly IconName[]): IconName[][] => Array.from({ length: Math.ceil(names.length / ROW) }, (_row, index) => names.slice(index * ROW, (index + 1) * ROW));

/** Every glyph of the registry, at all three sizes. */
export const AllGlyphs = () => (
  <Stack gap={12}>
    <Stack gap={8}>
      {rows(ALL).map((row) => (
        <Stack key={row.join()} direction="row" gap={8} align="center">
          {row.map((name) => (
            <Icon key={name} name={name} />
          ))}
        </Stack>
      ))}
    </Stack>
    <Stack gap={8}>
      {rows(ALL).map((row) => (
        <Stack key={row.join()} direction="row" gap={8} align="center">
          {row.map((name) => (
            <Icon key={name} name={name} size={20} />
          ))}
        </Stack>
      ))}
    </Stack>
    <Stack gap={8}>
      {rows(ALL).map((row) => (
        <Stack key={row.join()} direction="row" gap={8} align="center">
          {row.map((name) => (
            <Icon key={name} name={name} size={12} />
          ))}
        </Stack>
      ))}
    </Stack>
  </Stack>
);
