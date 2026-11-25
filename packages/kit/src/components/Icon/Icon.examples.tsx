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
  'activity', 'archive', 'arrow-down', 'arrow-down-to-line', 'arrow-left', 'arrow-right', 'arrow-up', 'arrow-up-wide-narrow', 'beaker', 'bell', 'bell-off', 'blocks', 'bookmark', 'box',
  'boxes', 'brick-wall', 'calendar-clock', 'case-sensitive', 'check', 'check-check', 'chevron-down', 'chevron-right', 'chevron-up', 'circle', 'circle-check', 'circle-minus',
  'clipboard-check', 'clock', 'close', 'code', 'columns', 'copy', 'cpu', 'database', 'ellipsis', 'eraser', 'external-link', 'eye', 'eye-off', 'file-cog', 'filter-x', 'flask-conical',
  'folder', 'folder-plus', 'folder-tree', 'gauge', 'globe', 'grip-vertical', 'hard-drive', 'hard-drive-download', 'history', 'hourglass', 'house', 'key-round', 'layers', 'layout-grid',
  'layout-list', 'layout-template', 'list-filter', 'list-ordered', 'loader', 'loader-circle', 'log-in', 'minus', 'network', 'package', 'paintbrush', 'panel-bottom', 'panel-right-open',
  'paste', 'pause', 'pencil', 'pin', 'play', 'plug', 'plus', 'power', 'power-off', 'puzzle', 'refresh', 'regex', 'repeat', 'rocket', 'rotate-ccw', 'rotate-cw', 'ruler', 'scaling',
  'scroll-text', 'search', 'search-x', 'select-all', 'server', 'server-cog', 'settings', 'settings-2', 'shield', 'shield-check', 'ship', 'sliders-horizontal', 'split', 'square-terminal',
  'status-error', 'status-info', 'status-success', 'status-warning', 'table', 'target', 'trash', 'triangle-alert', 'umbrella', 'undo', 'unplug', 'waypoints', 'whole-word', 'wrench',
];

// Six to a row: eight 20 px glyphs and their gaps (216 px) are wider than the stage of one example (200 px) and would stand outside its border.
const ROW = 6;
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
